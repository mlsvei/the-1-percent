import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { requireUser } from '../middleware/require-user.js';
import { refreshContestStatuses } from '../services/contest-status.js';
import { ensureStreakSchema } from '../services/streak.js';
import type { AuthenticatedRequest } from '../types.js';

export const streakRouter = Router();

const createStreakPickSchema = z.object({
  gameId: z.string().uuid(),
  pickedWinner: z.string().min(1)
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
  if (parsed.data.pickedWinner !== gameRow.homeTeam && parsed.data.pickedWinner !== gameRow.awayTeam) {
    res.status(400).json({ error: 'pickedWinner must be the home or away team' });
    return;
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
      `insert into streak_picks (id, entry_id, game_id, picked_winner, status, streak_before)
       values ($1, $2, $3, $4, 'ACTIVE', $5)`,
      [pickId, entry.id, gameRow.id, parsed.data.pickedWinner, entry.currentStreak]
    );
  } catch (error) {
    res.status(409).json({ error: 'You already have an active pick.' });
    return;
  }

  res.status(201).json({ id: pickId, entryId: entry.id, gameId: gameRow.id, pickedWinner: parsed.data.pickedWinner, status: 'ACTIVE' });
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
  }>(
    `select sp.id, sp.game_id as "gameId", sp.picked_winner as "pickedWinner", sp.status, sp.created_at as "createdAt",
            g.home_team as "homeTeam", g.away_team as "awayTeam", g.start_time as "startTime"
       from streak_picks sp
       join games g on g.id = sp.game_id
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
