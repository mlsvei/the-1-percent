import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { pool, query } from '../db.js';
import { requireUser } from '../middleware/require-user.js';
import { refreshContestStatuses } from '../services/contest-status.js';
import type { AuthenticatedRequest } from '../types.js';

type Contest = {
  id: string;
  type: 'PICKEM_NFL' | 'PICKEM_NBA' | 'PICKEM_NHL' | 'BRACKET_NCAAM';
  status: 'DRAFT' | 'OPEN' | 'LOCKED' | 'COMPLETE';
  starts_at: string;
  lock_mode: 'PER_GAME' | 'FULL_BRACKET' | 'PER_ROUND';
};

export const submissionsRouter = Router();

const pickSchema = z.object({
  gameId: z.string().uuid(),
  pickedWinner: z.string().min(1),
  confidencePoints: z.number().int().min(1).optional()
});

const submitPicksSchema = z.object({
  picks: z.array(pickSchema).min(1)
});

const bracketPickSchema = z.object({
  gameSlot: z.string().min(1),
  pickedTeam: z.string().min(1),
  round: z.number().int().min(1)
});

const submitBracketSchema = z.object({
  picks: z.array(bracketPickSchema).min(1)
});

async function getContest(contestId: string): Promise<Contest | null> {
  const contestResult = await query<Contest>(
    'select id, type, status, starts_at, lock_mode from contests where id = $1',
    [contestId]
  );
  return contestResult.rows[0] ?? null;
}

async function getEntryIdForUser(contestId: string, userId: string): Promise<string | null> {
  const entryResult = await query<{ id: string }>(
    'select id from entries where contest_id = $1 and user_id = $2',
    [contestId, userId]
  );
  return entryResult.rows[0]?.id ?? null;
}

async function getContestLockStart(contestId: string, fallbackStart: string): Promise<Date> {
  const firstGame = await query<{ first_start: string | null }>(
    'select min(start_time) as first_start from games where contest_id = $1',
    [contestId]
  );

  const raw = firstGame.rows[0]?.first_start;
  return raw ? new Date(raw) : new Date(fallbackStart);
}

submissionsRouter.post('/contests/:contestId/picks', requireUser, async (req: AuthenticatedRequest, res) => {
  await refreshContestStatuses(req.params.contestId);

  const parsed = submitPicksSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const contest = await getContest(req.params.contestId);
  if (!contest) {
    res.status(404).json({ error: 'Contest not found' });
    return;
  }
  if (contest.type !== 'PICKEM_NFL' && contest.type !== 'PICKEM_NBA' && contest.type !== 'PICKEM_NHL') {
    res.status(400).json({ error: 'Contest is not a pickem contest' });
    return;
  }
  if (contest.status !== 'OPEN') {
    res.status(409).json({ error: `Contest is not open (status: ${contest.status})` });
    return;
  }

  const duplicateGameIds = new Set<string>();
  const seenGameIds = new Set<string>();
  for (const pick of parsed.data.picks) {
    if (seenGameIds.has(pick.gameId)) {
      duplicateGameIds.add(pick.gameId);
    }
    seenGameIds.add(pick.gameId);
  }
  if (duplicateGameIds.size > 0) {
    res.status(400).json({ error: 'Duplicate gameId values in request', gameIds: [...duplicateGameIds] });
    return;
  }

  const confidenceValues = parsed.data.picks
    .map((pick) => pick.confidencePoints)
    .filter((value): value is number => value !== undefined);
  if (confidenceValues.length > 0 && new Set(confidenceValues).size !== confidenceValues.length) {
    res.status(400).json({ error: 'confidencePoints must be unique when provided' });
    return;
  }

  const entryId = await getEntryIdForUser(req.params.contestId, req.userId!);
  if (!entryId) {
    res.status(409).json({ error: 'Create contest entry first at POST /api/contests/:contestId/entries' });
    return;
  }

  const gameIds = parsed.data.picks.map((pick) => pick.gameId);
  const gamesResult = await query<{
    id: string;
    home_team: string;
    away_team: string;
    start_time: string;
  }>(
    `select id, home_team, away_team, start_time
     from games
     where contest_id = $1`,
    [req.params.contestId]
  );

  const gamesById = new Map(gamesResult.rows.map((row) => [row.id, row]));
  const missing = gameIds.filter((id) => !gamesById.has(id));
  if (missing.length > 0) {
    res.status(400).json({ error: 'Some games do not belong to this contest', missingGameIds: missing });
    return;
  }

  const now = new Date();
  const contestStart = new Date(contest.starts_at);
  if (contest.lock_mode !== 'PER_GAME' && contestStart <= now) {
    res.status(423).json({ error: 'Contest is locked for pick submission' });
    return;
  }

  const lockedGames: string[] = [];
  for (const pick of parsed.data.picks) {
    const game = gamesById.get(pick.gameId)!;
    const gameStart = new Date(game.start_time);
    if (contest.lock_mode === 'PER_GAME' && gameStart <= now) {
      lockedGames.push(pick.gameId);
      continue;
    }
    if (pick.pickedWinner !== game.home_team && pick.pickedWinner !== game.away_team) {
      res.status(400).json({
        error: 'pickedWinner must match one of the teams for each game',
        gameId: pick.gameId,
        allowed: [game.home_team, game.away_team]
      });
      return;
    }
  }

  if (lockedGames.length > 0) {
    res.status(423).json({ error: 'One or more games already locked at kickoff', lockedGameIds: lockedGames });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('begin');

    for (const pick of parsed.data.picks) {
      const game = gamesById.get(pick.gameId)!;
      await client.query(
        `insert into picks (id, entry_id, game_id, picked_winner, confidence_points, locked_at)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (entry_id, game_id)
         do update set picked_winner = excluded.picked_winner, confidence_points = excluded.confidence_points`,
        [randomUUID(), entryId, pick.gameId, pick.pickedWinner, pick.confidencePoints ?? null, game.start_time]
      );
    }

    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }

  res.status(201).json({ ok: true, entryId, count: parsed.data.picks.length });
});

submissionsRouter.get(
  '/contests/:contestId/entries/:entryId/picks',
  requireUser,
  async (req: AuthenticatedRequest, res) => {
    const ownerCheck = await query<{ id: string }>(
      'select id from entries where id = $1 and contest_id = $2 and user_id = $3',
      [req.params.entryId, req.params.contestId, req.userId]
    );
    if (!ownerCheck.rows[0]) {
      res.status(404).json({ error: 'Entry not found for current user' });
      return;
    }

    const result = await query(
      `select p.id, p.game_id as "gameId", p.picked_winner as "pickedWinner", p.confidence_points as "confidencePoints",
              p.is_correct as "isCorrect", p.points_awarded as "pointsAwarded", p.locked_at as "lockedAt"
       from picks p
       where p.entry_id = $1
       order by p.locked_at asc`,
      [req.params.entryId]
    );
    res.json({ entryId: req.params.entryId, picks: result.rows });
  }
);

submissionsRouter.post(
  '/contests/:contestId/bracket-picks',
  requireUser,
  async (req: AuthenticatedRequest, res) => {
    await refreshContestStatuses(req.params.contestId);

    const parsed = submitBracketSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const contest = await getContest(req.params.contestId);
    if (!contest) {
      res.status(404).json({ error: 'Contest not found' });
      return;
    }
    if (contest.type !== 'BRACKET_NCAAM') {
      res.status(400).json({ error: 'Contest is not a bracket contest' });
      return;
    }
    if (contest.status !== 'OPEN') {
      res.status(409).json({ error: `Contest is not open (status: ${contest.status})` });
      return;
    }

    const entryId = await getEntryIdForUser(req.params.contestId, req.userId!);
    if (!entryId) {
      res.status(409).json({ error: 'Create contest entry first at POST /api/contests/:contestId/entries' });
      return;
    }

    const now = new Date();
    const lockStart = await getContestLockStart(req.params.contestId, contest.starts_at);
    if (lockStart <= now) {
      res.status(423).json({ error: 'Bracket is locked' });
      return;
    }

    const duplicateSlots = new Set<string>();
    const seenSlots = new Set<string>();
    for (const pick of parsed.data.picks) {
      if (seenSlots.has(pick.gameSlot)) {
        duplicateSlots.add(pick.gameSlot);
      }
      seenSlots.add(pick.gameSlot);
    }
    if (duplicateSlots.size > 0) {
      res.status(400).json({ error: 'Duplicate gameSlot values in request', gameSlots: [...duplicateSlots] });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('begin');

      for (const pick of parsed.data.picks) {
        await client.query(
          `insert into bracket_picks (id, entry_id, game_slot, picked_team, round)
           values ($1, $2, $3, $4, $5)
           on conflict (entry_id, game_slot)
           do update set picked_team = excluded.picked_team, round = excluded.round`,
          [randomUUID(), entryId, pick.gameSlot, pick.pickedTeam, pick.round]
        );
      }

      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }

    res.status(201).json({ ok: true, entryId, count: parsed.data.picks.length });
  }
);

submissionsRouter.get(
  '/contests/:contestId/entries/:entryId/bracket-picks',
  requireUser,
  async (req: AuthenticatedRequest, res) => {
    const ownerCheck = await query<{ id: string }>(
      'select id from entries where id = $1 and contest_id = $2 and user_id = $3',
      [req.params.entryId, req.params.contestId, req.userId]
    );
    if (!ownerCheck.rows[0]) {
      res.status(404).json({ error: 'Entry not found for current user' });
      return;
    }

    const result = await query(
      `select id, game_slot as "gameSlot", picked_team as "pickedTeam", round,
              is_correct as "isCorrect", points_awarded as "pointsAwarded"
       from bracket_picks
       where entry_id = $1
       order by round asc, game_slot asc`,
      [req.params.entryId]
    );
    res.json({ entryId: req.params.entryId, picks: result.rows });
  }
);
