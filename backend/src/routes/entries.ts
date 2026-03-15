import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { requireUser } from '../middleware/require-user.js';
import type { AuthenticatedRequest } from '../types.js';

export const entriesRouter = Router();

const createEntrySchema = z.object({
  submittedAt: z.string().datetime().optional()
});

const entryTiebreakerSchema = z.object({
  prompt: z.string().min(1),
  answer: z.string().min(1),
  numericGuess: z.number().int().nullable().optional()
});

async function ensureEntryTiebreakersTable() {
  await query(`
    create table if not exists entry_tiebreakers (
      entry_id uuid primary key references entries(id) on delete cascade,
      prompt text not null,
      answer text not null,
      numeric_guess int,
      updated_at timestamptz not null default now()
    )
  `);
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
  const result = await query(
    `with game_counts as (
       select contest_id, count(*)::int as game_count
       from games
       group by contest_id
     ),
     pick_counts as (
       select e.id as entry_id, count(p.id)::int as pick_count
       from entries e
       left join picks p on p.entry_id = e.id
       where e.user_id = $1
       group by e.id
     ),
     bracket_counts as (
       select e.id as entry_id, count(bp.id)::int as bracket_pick_count
       from entries e
       left join bracket_picks bp on bp.entry_id = e.id
       where e.user_id = $1
       group by e.id
     )
     select e.id,
            e.contest_id as "contestId",
            e.user_id as "userId",
            e.submitted_at as "submittedAt",
            e.total_points as "totalPoints",
            case
              when c.type in ('PICKEM_NFL', 'PICKEM_NBA', 'PICKEM_NHL')
                then coalesce(pc.pick_count, 0) >= greatest(coalesce(gc.game_count, 0), 1)
              when c.type = 'BRACKET_NCAAM'
                then coalesce(bc.bracket_pick_count, 0) >= greatest(coalesce(gc.game_count, 0), 1)
              else false
            end as "isComplete"
     from entries e
     join contests c on c.id = e.contest_id
     left join game_counts gc on gc.contest_id = e.contest_id
     left join pick_counts pc on pc.entry_id = e.id
     left join bracket_counts bc on bc.entry_id = e.id
     where e.user_id = $1
     order by e.submitted_at desc`,
    [req.userId]
  );

  res.json({ entries: result.rows });
});

entriesRouter.get('/contests/:contestId/users/:targetUserId/entry', requireUser, async (req: AuthenticatedRequest, res) => {
  const contestResult = await query<{ id: string; type: 'PICKEM_NFL' | 'PICKEM_NBA' | 'PICKEM_NHL' | 'BRACKET_NCAAM' }>(
    'select id, type from contests where id = $1',
    [req.params.contestId]
  );
  const contest = contestResult.rows[0];

  if (!contest) {
    res.status(404).json({ error: 'Contest not found' });
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
    prompt: string;
    answer: string;
    numericGuess: number | null;
  }>(
    `select prompt, answer, numeric_guess as "numericGuess"
     from entry_tiebreakers
     where entry_id = $1`,
    [entry.id]
  );
  const tiebreaker = tiebreakerResult.rows[0] ?? null;

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
    }>(
      `select p.game_id as "gameId",
              p.picked_winner as "pickedWinner",
              p.confidence_points as "confidencePoints",
              p.is_correct as "isCorrect",
              p.points_awarded as "pointsAwarded",
              g.home_team as "homeTeam",
              g.away_team as "awayTeam",
              g.start_time as "startTime"
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
      tiebreaker
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
    tiebreaker
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
  const result = await query<{
    prompt: string;
    answer: string;
    numericGuess: number | null;
  }>(
    `select prompt, answer, numeric_guess as "numericGuess"
     from entry_tiebreakers
     where entry_id = $1`,
    [req.params.entryId]
  );

  res.json({ entryId: req.params.entryId, tiebreaker: result.rows[0] ?? null });
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
    `insert into entry_tiebreakers (entry_id, prompt, answer, numeric_guess, updated_at)
     values ($1, $2, $3, $4, now())
     on conflict (entry_id)
     do update set prompt = excluded.prompt, answer = excluded.answer, numeric_guess = excluded.numeric_guess, updated_at = now()`,
    [req.params.entryId, parsed.data.prompt, parsed.data.answer, parsed.data.numericGuess ?? null]
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
