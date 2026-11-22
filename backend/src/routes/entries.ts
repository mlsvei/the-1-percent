import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { refreshContestStatuses } from '../services/contest-status.js';
import { requireUser } from '../middleware/require-user.js';
import type { AuthenticatedRequest } from '../types.js';

export const entriesRouter = Router();

const createEntrySchema = z.object({
  submittedAt: z.string().datetime().optional()
});

const entryTiebreakerSchema = z.object({
  week: z.number().int().min(0).default(0),
  prompt: z.string().min(1),
  answer: z.string().min(1),
  numericGuess: z.number().int().nullable().optional()
});

let tiebreakersTableEnsured = false;

async function ensureEntryTiebreakersTable() {
  if (tiebreakersTableEnsured) return;

  await query(`
    create table if not exists entry_tiebreakers (
      entry_id uuid not null references entries(id) on delete cascade,
      week smallint not null default 0,
      prompt text not null,
      answer text not null,
      numeric_guess int,
      updated_at timestamptz not null default now(),
      primary key (entry_id, week)
    )
  `);

  // Upgrade an older single-tiebreaker-per-entry table shape in place.
  await query('alter table entry_tiebreakers add column if not exists week smallint not null default 0');

  const pk = await query<{ pkCols: string | null }>(`
    select string_agg(a.attname, ',' order by a.attnum) as "pkCols"
    from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = 'entry_tiebreakers'::regclass and i.indisprimary
  `);
  if (pk.rows[0]?.pkCols === 'entry_id') {
    await query('alter table entry_tiebreakers drop constraint entry_tiebreakers_pkey');
    await query('alter table entry_tiebreakers add primary key (entry_id, week)');
  }

  tiebreakersTableEnsured = true;
}

function isFinalGameStatus(status: string): boolean {
  return /final|complete/i.test(status);
}

type GameRow = { id: string; contestId: string; week: number | null; winner: string | null; status: string };

function effectiveWeekFor(games: GameRow[]): number | null {
  const weeks = games.map((g) => g.week).filter((w): w is number => w != null);
  if (weeks.length === 0) return null;

  const incompleteWeeks = games
    .filter((g) => g.week != null && g.winner == null && !isFinalGameStatus(g.status))
    .map((g) => g.week as number);

  if (incompleteWeeks.length > 0) return Math.min(...incompleteWeeks);
  return Math.max(...weeks);
}

entriesRouter.post('/contests/:contestId/entries', requireUser, async (req: AuthenticatedRequest, res) => {
  const parsed = createEntrySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const contestResult = await query('select id, status from contests where id = $1', [req.params.contestId]);
  if (!contestResult.rows[0]) {
    res.status(404).json({ error: 'Contest not found' });
    return;
  }

  const contestStatus = String((contestResult.rows[0] as { status?: string }).status ?? '').toUpperCase();
  if (contestStatus === 'DRAFT') {
    res.status(409).json({ error: 'Contest is not open yet' });
    return;
  }

  const existing = await query<{ id: string }>(
    'select id from entries where contest_id = $1 and user_id = $2 limit 1',
    [req.params.contestId, req.userId]
  );

  if (existing.rows[0]) {
    res.status(409).json({ error: 'Entry already exists', id: existing.rows[0].id });
    return;
  }

  const entryId = randomUUID();
  const submittedAt = parsed.data.submittedAt ?? new Date().toISOString();

  await query(
    'insert into entries (id, contest_id, user_id, submitted_at) values ($1, $2, $3, $4)',
    [entryId, req.params.contestId, req.userId, submittedAt]
  );

  res.status(201).json({ id: entryId, contestId: req.params.contestId, userId: req.userId, submittedAt });
});

entriesRouter.get('/entries/me', requireUser, async (req: AuthenticatedRequest, res) => {
  await ensureEntryTiebreakersTable();

  const entriesResult = await query<{
    id: string;
    contestId: string;
    userId: string;
    submittedAt: string;
    totalPoints: number;
    contestType: 'PICKEM_NFL' | 'PICKEM_NBA' | 'PICKEM_NHL' | 'BRACKET_NCAAM';
    scoringConfig: Record<string, unknown> | null;
  }>(
    `select e.id,
            e.contest_id as "contestId",
            e.user_id as "userId",
            e.submitted_at as "submittedAt",
            e.total_points as "totalPoints",
            c.type as "contestType",
            c.scoring_config as "scoringConfig"
     from entries e
     join contests c on c.id = e.contest_id
     where e.user_id = $1
     order by e.submitted_at desc`,
    [req.userId]
  );

  const entries = entriesResult.rows;
  if (entries.length === 0) {
    res.json({ entries: [] });
    return;
  }

  const entryIds = entries.map((e) => e.id);
  const contestIds = [...new Set(entries.map((e) => e.contestId))];

  const [gamesResult, picksResult, bracketPicksResult, tiebreakerResult] = await Promise.all([
    query<GameRow>(
      'select id, contest_id as "contestId", week, winner, status from games where contest_id = any($1)',
      [contestIds]
    ),
    query<{ entryId: string; gameId: string }>(
      'select entry_id as "entryId", game_id as "gameId" from picks where entry_id = any($1)',
      [entryIds]
    ),
    query<{ entryId: string; count: string }>(
      'select entry_id as "entryId", count(*)::text as count from bracket_picks where entry_id = any($1) group by entry_id',
      [entryIds]
    ),
    query<{ entryId: string; week: number }>(
      'select entry_id as "entryId", week from entry_tiebreakers where entry_id = any($1)',
      [entryIds]
    )
  ]);

  const gamesByContest = new Map<string, GameRow[]>();
  for (const game of gamesResult.rows) {
    const list = gamesByContest.get(game.contestId) ?? [];
    list.push(game);
    gamesByContest.set(game.contestId, list);
  }

  const picksByEntry = new Map<string, Set<string>>();
  for (const pick of picksResult.rows) {
    const set = picksByEntry.get(pick.entryId) ?? new Set<string>();
    set.add(pick.gameId);
    picksByEntry.set(pick.entryId, set);
  }

  const bracketCountByEntry = new Map(bracketPicksResult.rows.map((row) => [row.entryId, Number(row.count)]));

  const tiebreakerWeeksByEntry = new Map<string, Set<number>>();
  for (const row of tiebreakerResult.rows) {
    const set = tiebreakerWeeksByEntry.get(row.entryId) ?? new Set<number>();
    set.add(row.week);
    tiebreakerWeeksByEntry.set(row.entryId, set);
  }

  const out = entries.map((entry) => {
    const games = gamesByContest.get(entry.contestId) ?? [];
    const effectiveWeek = effectiveWeekFor(games);
    const relevantGames = effectiveWeek == null ? games : games.filter((g) => g.week == null || g.week === effectiveWeek);
    const gameCount = relevantGames.length;
    const relevantGameIds = new Set(relevantGames.map((g) => g.id));
    const pickedGameIds = picksByEntry.get(entry.id) ?? new Set<string>();
    const pickCount = [...pickedGameIds].filter((id) => relevantGameIds.has(id)).length;

    const scoringConfig = entry.scoringConfig ?? {};
    const tiebreakersMap = (scoringConfig as { tiebreakers?: Record<string, unknown> }).tiebreakers;
    const legacyPrompt = (scoringConfig as { tiebreaker?: { prompt?: unknown } }).tiebreaker?.prompt;
    const tiebreakerWeek = effectiveWeek ?? 0;

    const tiebreakerRequired =
      (tiebreakersMap && typeof tiebreakersMap === 'object' && Boolean(tiebreakersMap[String(tiebreakerWeek)])) ||
      (effectiveWeek == null && Boolean(legacyPrompt));

    const hasTiebreaker = tiebreakerRequired ? (tiebreakerWeeksByEntry.get(entry.id)?.has(tiebreakerWeek) ?? false) : true;

    let isComplete = false;
    if (entry.contestType === 'PICKEM_NFL' || entry.contestType === 'PICKEM_NBA' || entry.contestType === 'PICKEM_NHL') {
      isComplete = pickCount >= Math.max(gameCount, 1) && hasTiebreaker;
    } else if (entry.contestType === 'BRACKET_NCAAM') {
      const bracketCount = bracketCountByEntry.get(entry.id) ?? 0;
      isComplete = bracketCount >= Math.max(gameCount, 1) && hasTiebreaker;
    }

    return {
      id: entry.id,
      contestId: entry.contestId,
      userId: entry.userId,
      submittedAt: entry.submittedAt,
      totalPoints: entry.totalPoints,
      isComplete
    };
  });

  res.json({ entries: out });
});

entriesRouter.get('/contests/:contestId/users/:targetUserId/entry', requireUser, async (req: AuthenticatedRequest, res) => {
  await refreshContestStatuses(req.params.contestId);

  const contestResult = await query<{
    id: string;
    type: 'PICKEM_NFL' | 'PICKEM_NBA' | 'PICKEM_NHL' | 'BRACKET_NCAAM';
    status: 'DRAFT' | 'OPEN' | 'LOCKED' | 'COMPLETE';
  }>(
    'select id, type, status from contests where id = $1',
    [req.params.contestId]
  );
  const contest = contestResult.rows[0];

  if (!contest) {
    res.status(404).json({ error: 'Contest not found' });
    return;
  }

  const isOwnEntry = req.params.targetUserId === req.userId;
  if (!isOwnEntry && contest.status !== 'LOCKED' && contest.status !== 'COMPLETE') {
    res.status(403).json({ error: 'Participant entries become visible after contest lock.' });
    return;
  }

  const entryResult = await query<{
    id: string;
    contestId: string;
    userId: string;
    displayName: string;
    submittedAt: string;
    totalPoints: number;
  }>(
    `select e.id,
            e.contest_id as "contestId",
            e.user_id as "userId",
            u.display_name as "displayName",
            e.submitted_at as "submittedAt",
            e.total_points as "totalPoints"
     from entries e
     join users u on u.id = e.user_id
     where e.contest_id = $1 and e.user_id = $2
     limit 1`,
    [req.params.contestId, req.params.targetUserId]
  );

  const entry = entryResult.rows[0];
  if (!entry) {
    res.status(404).json({ error: 'Entry not found for selected participant' });
    return;
  }

  await ensureEntryTiebreakersTable();
  const tiebreakerResult = await query<{
    week: number;
    prompt: string;
    answer: string;
    numericGuess: number | null;
  }>(
    `select week, prompt, answer, numeric_guess as "numericGuess"
     from entry_tiebreakers
     where entry_id = $1
     order by week asc`,
    [entry.id]
  );
  const tiebreakers = tiebreakerResult.rows;
  const tiebreaker = tiebreakers[0] ?? null;

  if (contest.type === 'PICKEM_NFL' || contest.type === 'PICKEM_NBA' || contest.type === 'PICKEM_NHL') {
    const picksResult = await query<{
      gameId: string;
      pickedWinner: string;
      confidencePoints: number | null;
      isCorrect: boolean | null;
      pointsAwarded: number;
      homeTeam: string;
      awayTeam: string;
      startTime: string;
      week: number | null;
    }>(
      `select p.game_id as "gameId",
              p.picked_winner as "pickedWinner",
              p.confidence_points as "confidencePoints",
              p.is_correct as "isCorrect",
              p.points_awarded as "pointsAwarded",
              g.home_team as "homeTeam",
              g.away_team as "awayTeam",
              g.start_time as "startTime",
              g.week as "week"
       from picks p
       join games g on g.id = p.game_id
       where p.entry_id = $1
       order by g.start_time asc`,
      [entry.id]
    );

    res.json({
      contestId: req.params.contestId,
      contestType: contest.type,
      entry,
      picks: picksResult.rows,
      tiebreaker,
      tiebreakers
    });
    return;
  }

  const bracketResult = await query<{
    gameSlot: string;
    pickedTeam: string;
    round: number;
    isCorrect: boolean | null;
    pointsAwarded: number;
  }>(
    `select game_slot as "gameSlot",
            picked_team as "pickedTeam",
            round,
            is_correct as "isCorrect",
            points_awarded as "pointsAwarded"
     from bracket_picks
     where entry_id = $1
     order by round asc, game_slot asc`,
    [entry.id]
  );

  res.json({
    contestId: req.params.contestId,
    contestType: contest.type,
    entry,
    picks: bracketResult.rows,
    tiebreaker,
    tiebreakers
  });
});

entriesRouter.get('/contests/:contestId/entries/:entryId/tiebreaker', requireUser, async (req: AuthenticatedRequest, res) => {
  const ownerCheck = await query<{ id: string }>(
    'select id from entries where id = $1 and contest_id = $2 and user_id = $3',
    [req.params.entryId, req.params.contestId, req.userId]
  );
  if (!ownerCheck.rows[0]) {
    res.status(404).json({ error: 'Entry not found for current user' });
    return;
  }

  await ensureEntryTiebreakersTable();
  const week = Number(req.query.week ?? 0) || 0;
  const result = await query<{
    prompt: string;
    answer: string;
    numericGuess: number | null;
  }>(
    `select prompt, answer, numeric_guess as "numericGuess"
     from entry_tiebreakers
     where entry_id = $1 and week = $2`,
    [req.params.entryId, week]
  );

  res.json({ entryId: req.params.entryId, week, tiebreaker: result.rows[0] ?? null });
});

entriesRouter.post('/contests/:contestId/entries/:entryId/tiebreaker', requireUser, async (req: AuthenticatedRequest, res) => {
  const ownerCheck = await query<{ id: string }>(
    'select id from entries where id = $1 and contest_id = $2 and user_id = $3',
    [req.params.entryId, req.params.contestId, req.userId]
  );
  if (!ownerCheck.rows[0]) {
    res.status(404).json({ error: 'Entry not found for current user' });
    return;
  }

  const parsed = entryTiebreakerSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  await ensureEntryTiebreakersTable();
  await query(
    `insert into entry_tiebreakers (entry_id, week, prompt, answer, numeric_guess, updated_at)
     values ($1, $2, $3, $4, $5, now())
     on conflict (entry_id, week)
     do update set prompt = excluded.prompt, answer = excluded.answer, numeric_guess = excluded.numeric_guess, updated_at = now()`,
    [req.params.entryId, parsed.data.week, parsed.data.prompt, parsed.data.answer, parsed.data.numericGuess ?? null]
  );

  res.status(201).json({ entryId: req.params.entryId, tiebreaker: parsed.data });
});

entriesRouter.get('/contests/:contestId/entries/:entryId', requireUser, async (req: AuthenticatedRequest, res) => {
  const result = await query(
    `select id, contest_id as "contestId", user_id as "userId", submitted_at as "submittedAt", total_points as "totalPoints"
     from entries
     where id = $1 and contest_id = $2 and user_id = $3`,
    [req.params.entryId, req.params.contestId, req.userId]
  );

  if (!result.rows[0]) {
    res.status(404).json({ error: 'Entry not found for current user' });
    return;
  }

  res.json(result.rows[0]);
});
