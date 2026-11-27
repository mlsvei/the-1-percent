import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { requireUser } from '../middleware/require-user.js';
import { requireContestCreator } from '../middleware/require-contest-creator.js';
import { refreshContestStatuses } from '../services/contest-status.js';
import { ensureStreakSchema, verifyEspnTraceable } from '../services/streak.js';
import type { NormalizedGame } from '../integrations/sportsdataio.js';
import type { AuthenticatedRequest } from '../types.js';

export const streakRouter = Router();

const createStreakPickSchema = z.union([
  z.object({ gameId: z.string().uuid(), pickedWinner: z.string().min(1) }),
  z.object({ gameId: z.string().uuid(), propId: z.string().uuid(), optionKey: z.string().min(1) })
]);

const createStreakPropSchema = z.object({
  gameId: z.string().uuid(),
  propType: z.enum(['FIRST_TD', 'PLAYER_STAT_OU']),
  label: z.string().min(1),
  statLine: z.number().optional(),
  playerName: z.string().min(1).optional(),
  statKey: z.string().min(1).optional()
});

type StreakContest = {
  id: string;
  type: string;
  status: 'DRAFT' | 'OPEN' | 'LOCKED' | 'COMPLETE';
};

async function getStreakContest(contestId: string): Promise<StreakContest | null> {
  const result = await query<StreakContest>('select id, type, status from contests where id = $1', [contestId]);
  const contest = result.rows[0];
  if (!contest || contest.type !== 'STREAK') return null;
  return contest;
}

async function getOrCreateEntry(contestId: string, userId: string | undefined): Promise<{ id: string; currentStreak: number; bestStreak: number }> {
  const existing = await query<{ id: string; current_streak: number; best_streak: number }>(
    'select id, current_streak, best_streak from entries where contest_id = $1 and user_id = $2',
    [contestId, userId]
  );
  if (existing.rows[0]) {
    return { id: existing.rows[0].id, currentStreak: existing.rows[0].current_streak, bestStreak: existing.rows[0].best_streak };
  }

  const entryId = randomUUID();
  await query('insert into entries (id, contest_id, user_id, submitted_at) values ($1, $2, $3, now())', [entryId, contestId, userId]);
  return { id: entryId, currentStreak: 0, bestStreak: 0 };
}

streakRouter.post('/contests/:contestId/streak-picks', requireUser, async (req: AuthenticatedRequest, res) => {
  await ensureStreakSchema();
  await refreshContestStatuses(req.params.contestId);

  const parsed = createStreakPickSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const contest = await getStreakContest(req.params.contestId);
  if (!contest) {
    res.status(404).json({ error: 'Streak contest not found' });
    return;
  }
  if (contest.status !== 'OPEN') {
    res.status(409).json({ error: 'Contest is not open for picks' });
    return;
  }

  const game = await query<{ id: string; homeTeam: string; awayTeam: string; startTime: string }>(
    `select id, home_team as "homeTeam", away_team as "awayTeam", start_time as "startTime"
       from games where id = $1 and contest_id = $2`,
    [parsed.data.gameId, req.params.contestId]
  );
  const gameRow = game.rows[0];
  if (!gameRow) {
    res.status(404).json({ error: 'Game not found for this contest' });
    return;
  }
  if (new Date(gameRow.startTime).getTime() <= Date.now()) {
    res.status(423).json({ error: 'That game has already started' });
    return;
  }

  let propId: string | null = null;
  let selectedOptionKey: string;

  if ('propId' in parsed.data) {
    const prop = await query<{ id: string; optionAKey: string; optionBKey: string; status: string }>(
      `select id, option_a_key as "optionAKey", option_b_key as "optionBKey", status
         from streak_props where id = $1 and game_id = $2`,
      [parsed.data.propId, gameRow.id]
    );
    const propRow = prop.rows[0];
    if (!propRow) {
      res.status(404).json({ error: 'Prop not found for this game' });
      return;
    }
    if (propRow.status !== 'OPEN') {
      res.status(409).json({ error: 'This prop is no longer open for picks' });
      return;
    }
    if (parsed.data.optionKey !== propRow.optionAKey && parsed.data.optionKey !== propRow.optionBKey) {
      res.status(400).json({ error: 'optionKey must match one of this prop\'s options' });
      return;
    }
    propId = propRow.id;
    selectedOptionKey = parsed.data.optionKey;
  } else {
    const existingProp = await query<{ id: string }>('select id from streak_props where game_id = $1 limit 1', [gameRow.id]);
    if (existingProp.rows[0]) {
      res.status(400).json({ error: "This game's pick is a prop - use the prop options instead" });
      return;
    }
    if (parsed.data.pickedWinner !== gameRow.homeTeam && parsed.data.pickedWinner !== gameRow.awayTeam) {
      res.status(400).json({ error: 'pickedWinner must be the home or away team' });
      return;
    }
    selectedOptionKey = parsed.data.pickedWinner;
  }

  const entry = await getOrCreateEntry(req.params.contestId, req.userId);

  const active = await query<{ id: string }>(
    "select id from streak_picks where entry_id = $1 and status = 'ACTIVE'",
    [entry.id]
  );
  if (active.rows[0]) {
    res.status(409).json({ error: 'You already have an active pick. Forfeit it or wait for its game to finish first.' });
    return;
  }

  const pickId = randomUUID();
  try {
    await query(
      `insert into streak_picks (id, entry_id, game_id, prop_id, picked_winner, status, streak_before)
       values ($1, $2, $3, $4, $5, 'ACTIVE', $6)`,
      [pickId, entry.id, gameRow.id, propId, selectedOptionKey, entry.currentStreak]
    );
  } catch (error) {
    res.status(409).json({ error: 'You already have an active pick.' });
    return;
  }

  res.status(201).json({ id: pickId, entryId: entry.id, gameId: gameRow.id, propId, pickedWinner: selectedOptionKey, status: 'ACTIVE' });
});

streakRouter.post('/contests/:contestId/streak-props', requireUser, requireContestCreator, async (req: AuthenticatedRequest, res) => {
  await ensureStreakSchema();

  const parsed = createStreakPropSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const contest = await getStreakContest(req.params.contestId);
  if (!contest) {
    res.status(404).json({ error: 'Streak contest not found' });
    return;
  }

  const game = await query<{
    id: string;
    providerGameId: string;
    sport: NormalizedGame['sport'];
    homeTeam: string;
    awayTeam: string;
    status: string;
  }>(
    `select id, provider_game_id as "providerGameId", sport, home_team as "homeTeam", away_team as "awayTeam", status
       from games where id = $1 and contest_id = $2`,
    [parsed.data.gameId, req.params.contestId]
  );
  const gameRow = game.rows[0];
  if (!gameRow) {
    res.status(404).json({ error: 'Game not found for this contest' });
    return;
  }

  try {
    await verifyEspnTraceable(gameRow);
  } catch (error) {
    res.status(422).json({ error: (error as Error).message });
    return;
  }

  let optionAKey: string;
  let optionALabel: string;
  let optionBKey: string;
  let optionBLabel: string;
  let statLine: number | null = null;

  if (parsed.data.propType === 'FIRST_TD') {
    optionAKey = gameRow.homeTeam;
    optionALabel = gameRow.homeTeam;
    optionBKey = gameRow.awayTeam;
    optionBLabel = gameRow.awayTeam;
  } else {
    if (parsed.data.statLine == null || !parsed.data.playerName || !parsed.data.statKey) {
      res.status(400).json({ error: 'statLine, playerName, and statKey are required for PLAYER_STAT_OU props' });
      return;
    }
    if (Math.abs(parsed.data.statLine * 2 - Math.round(parsed.data.statLine * 2)) > 1e-9 || parsed.data.statLine % 1 !== 0.5) {
      res.status(400).json({ error: 'statLine must end in .5 (e.g. 19.5) to avoid ties' });
      return;
    }
    statLine = parsed.data.statLine;
    optionAKey = 'OVER';
    optionALabel = `Over ${parsed.data.statLine}`;
    optionBKey = 'UNDER';
    optionBLabel = `Under ${parsed.data.statLine}`;
  }

  const propId = randomUUID();
  await query(
    `insert into streak_props
       (id, game_id, prop_type, label, option_a_key, option_a_label, option_b_key, option_b_label, stat_line, player_name, stat_key, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'OPEN')`,
    [
      propId,
      gameRow.id,
      parsed.data.propType,
      parsed.data.label,
      optionAKey,
      optionALabel,
      optionBKey,
      optionBLabel,
      statLine,
      parsed.data.playerName ?? null,
      parsed.data.statKey ?? null
    ]
  );

  res.status(201).json({ id: propId, gameId: gameRow.id, propType: parsed.data.propType, status: 'OPEN' });
});

streakRouter.get('/contests/:contestId/streak-props', async (req, res) => {
  await ensureStreakSchema();

  const props = await query<{
    id: string;
    gameId: string;
    propType: string;
    label: string;
    optionAKey: string;
    optionALabel: string;
    optionBKey: string;
    optionBLabel: string;
    status: string;
    resultKey: string | null;
  }>(
    `select sp.id, sp.game_id as "gameId", sp.prop_type as "propType", sp.label,
            sp.option_a_key as "optionAKey", sp.option_a_label as "optionALabel",
            sp.option_b_key as "optionBKey", sp.option_b_label as "optionBLabel",
            sp.status, sp.result_key as "resultKey"
       from streak_props sp
       join games g on g.id = sp.game_id
      where g.contest_id = $1
      order by sp.created_at asc`,
    [req.params.contestId]
  );

  res.json({ props: props.rows });
});

streakRouter.post('/contests/:contestId/streak-picks/:pickId/forfeit', requireUser, async (req: AuthenticatedRequest, res) => {
  await ensureStreakSchema();

  const contest = await getStreakContest(req.params.contestId);
  if (!contest) {
    res.status(404).json({ error: 'Streak contest not found' });
    return;
  }

  const pick = await query<{ id: string; entryId: string; status: string }>(
    `select sp.id, sp.entry_id as "entryId", sp.status
       from streak_picks sp
       join entries e on e.id = sp.entry_id
      where sp.id = $1 and e.contest_id = $2 and e.user_id = $3`,
    [req.params.pickId, req.params.contestId, req.userId]
  );
  const pickRow = pick.rows[0];
  if (!pickRow) {
    res.status(404).json({ error: 'Pick not found' });
    return;
  }
  if (pickRow.status !== 'ACTIVE') {
    res.status(409).json({ error: 'Pick is no longer active' });
    return;
  }

  await query("update streak_picks set status = 'FORFEITED', resolved_at = now() where id = $1", [pickRow.id]);
  await query('update entries set current_streak = 0 where id = $1', [pickRow.entryId]);

  res.json({ id: pickRow.id, status: 'FORFEITED' });
});

streakRouter.get('/contests/:contestId/streak-picks/me', requireUser, async (req: AuthenticatedRequest, res) => {
  await ensureStreakSchema();

  const contest = await getStreakContest(req.params.contestId);
  if (!contest) {
    res.status(404).json({ error: 'Streak contest not found' });
    return;
  }

  const entry = await query<{ id: string; current_streak: number; best_streak: number }>(
    'select id, current_streak, best_streak from entries where contest_id = $1 and user_id = $2',
    [req.params.contestId, req.userId]
  );
  const entryRow = entry.rows[0];
  if (!entryRow) {
    res.json({ currentStreak: 0, bestStreak: 0, activePick: null, history: [] });
    return;
  }

  const picks = await query<{
    id: string;
    gameId: string;
    pickedWinner: string;
    status: string;
    createdAt: string;
    homeTeam: string;
    awayTeam: string;
    startTime: string;
    propId: string | null;
    propLabel: string | null;
    selectedOptionLabel: string | null;
  }>(
    `select sp.id, sp.game_id as "gameId", sp.picked_winner as "pickedWinner", sp.status, sp.created_at as "createdAt",
            g.home_team as "homeTeam", g.away_team as "awayTeam", g.start_time as "startTime",
            p.id as "propId", p.label as "propLabel",
            case when p.id is null then null
                 when sp.picked_winner = p.option_a_key then p.option_a_label
                 when sp.picked_winner = p.option_b_key then p.option_b_label
                 else null end as "selectedOptionLabel"
       from streak_picks sp
       join games g on g.id = sp.game_id
       left join streak_props p on p.id = sp.prop_id
      where sp.entry_id = $1
      order by sp.created_at desc
      limit 20`,
    [entryRow.id]
  );

  res.json({
    currentStreak: entryRow.current_streak,
    bestStreak: entryRow.best_streak,
    activePick: picks.rows.find((pick) => pick.status === 'ACTIVE') ?? null,
    history: picks.rows
  });
});
