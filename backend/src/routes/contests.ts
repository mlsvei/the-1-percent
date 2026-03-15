import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { gradeContest } from '../services/grading.js';
import { refreshContestStatuses } from '../services/contest-status.js';
import { buildUpcomingSpotMatches } from '../services/cbb-spot-matcher.js';
import { requireContestCreator } from '../middleware/require-contest-creator.js';
import { requireUser } from '../middleware/require-user.js';

export const contestsRouter = Router();

const createContestSchema = z.object({
  name: z.string().min(2),
  type: z.enum(['PICKEM_NFL', 'PICKEM_NBA', 'PICKEM_NHL', 'BRACKET_NCAAM']),
  season: z.number().int().min(2020),
  startsAt: z.string().datetime(),
  lockMode: z.enum(['PER_GAME', 'FULL_BRACKET', 'PER_ROUND']),
  scoringConfig: z.record(z.unknown()),
  groupIds: z.array(z.string().uuid()).default([]),
  status: z.enum(['DRAFT', 'OPEN']).default('DRAFT')
});

const cloneContestSchema = z.object({
  name: z.string().min(2),
  season: z.number().int().min(2020),
  startsAt: z.string().datetime(),
  includeGames: z.boolean().optional(),
  status: z.enum(['DRAFT', 'OPEN']).default('DRAFT')
});

const adminGameSchema = z.object({
  providerGameId: z.string().min(1),
  sport: z.enum(['NFL', 'NBA', 'NCAAM', 'NHL']).default('NBA'),
  homeTeam: z.string().min(1),
  awayTeam: z.string().min(1),
  startTime: z.string().datetime(),
  status: z.string().min(1).default('Scheduled'),
  homeScore: z.number().int().nullable().optional(),
  awayScore: z.number().int().nullable().optional(),
  winner: z.string().nullable().optional()
});

const bulkGamesSchema = z.object({
  games: z.array(adminGameSchema).min(1)
});

const setContestStatusSchema = z.object({
  status: z.enum(['DRAFT', 'OPEN'])
});

const overrideGameResultSchema = z
  .object({
    status: z.string().min(1).optional(),
    homeScore: z.number().int().nullable().optional(),
    awayScore: z.number().int().nullable().optional(),
    winner: z.string().min(1).nullable().optional()
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to override'
  });

const upcomingSpotQuerySchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  days: z.coerce.number().int().min(1).max(14).default(7),
  historyDays: z.coerce.number().int().min(0).max(180).default(14)
});


contestsRouter.post('/contests', requireUser, requireContestCreator, async (req, res) => {
  const parsed = createContestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const contestId = randomUUID();
  const { groupIds, status, ...contest } = parsed.data;

  await query(
    `insert into contests (id, name, type, season, starts_at, lock_mode, scoring_config, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      contestId,
      contest.name,
      contest.type,
      contest.season,
      contest.startsAt,
      contest.lockMode,
      JSON.stringify(contest.scoringConfig),
      status
    ]
  );

  for (const groupId of groupIds) {
    await query(
      'insert into group_contests (group_id, contest_id) values ($1, $2) on conflict do nothing',
      [groupId, contestId]
    );
  }

  res.status(201).json({ id: contestId, status });
});

contestsRouter.post('/contests/:contestId/clone', requireUser, requireContestCreator, async (req, res) => {
  const parsed = cloneContestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const sourceResult = await query<{
    id: string;
    type: 'PICKEM_NFL' | 'PICKEM_NBA' | 'PICKEM_NHL' | 'BRACKET_NCAAM';
    lock_mode: 'PER_GAME' | 'FULL_BRACKET' | 'PER_ROUND';
    scoring_config: Record<string, unknown>;
    starts_at: string;
  }>(
    'select id, type, lock_mode, scoring_config, starts_at from contests where id = $1',
    [req.params.contestId]
  );

  const source = sourceResult.rows[0];
  if (!source) {
    res.status(404).json({ error: 'Source contest not found' });
    return;
  }

  const cloneId = randomUUID();
  const includeGames = parsed.data.includeGames === true;
  const sourceStartMs = new Date(source.starts_at).getTime();
  const cloneStartMs = new Date(parsed.data.startsAt).getTime();
  const shiftMs = cloneStartMs - sourceStartMs;

  const cloneScoringConfig: Record<string, unknown> = {
    ...(source.scoring_config ?? {}),
    ingestDisabled: includeGames ? false : true
  };

  await query(
    `insert into contests (id, name, type, season, starts_at, lock_mode, scoring_config, status)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
    [
      cloneId,
      parsed.data.name,
      source.type,
      parsed.data.season,
      parsed.data.startsAt,
      source.lock_mode,
      JSON.stringify(cloneScoringConfig),
      parsed.data.status
    ]
  );

  if (includeGames) {
    const games = await query<{
      provider_game_id: string;
      sport: string;
      home_team: string;
      away_team: string;
      start_time: string;
    }>(
      `select provider_game_id, sport, home_team, away_team, start_time
       from games
       where contest_id = $1
       order by start_time asc`,
      [req.params.contestId]
    );

    for (const game of games.rows) {
      const shiftedStart = new Date(new Date(game.start_time).getTime() + shiftMs).toISOString();
      await query(
        `insert into games (id, contest_id, provider_game_id, sport, home_team, away_team, start_time, status, home_score, away_score, winner)
         values ($1, $2, $3, $4, $5, $6, $7, 'Scheduled', null, null, null)`,
        [randomUUID(), cloneId, game.provider_game_id, game.sport, game.home_team, game.away_team, shiftedStart]
      );
    }
  }

  res.status(201).json({
    id: cloneId,
    sourceContestId: req.params.contestId,
    includeGames,
    status: parsed.data.status
  });
});

contestsRouter.post('/contests/:contestId/games/bulk', requireUser, requireContestCreator, async (req, res) => {
  const parsed = bulkGamesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const contestResult = await query<{ id: string }>('select id from contests where id = $1', [req.params.contestId]);
  if (!contestResult.rows[0]) {
    res.status(404).json({ error: 'Contest not found' });
    return;
  }

  for (const game of parsed.data.games) {
    await query(
      `insert into games (id, contest_id, provider_game_id, sport, home_team, away_team, start_time, status, home_score, away_score, winner)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (contest_id, provider_game_id)
       do update set
         sport = excluded.sport,
         home_team = excluded.home_team,
         away_team = excluded.away_team,
         start_time = excluded.start_time,
         status = excluded.status,
         home_score = excluded.home_score,
         away_score = excluded.away_score,
         winner = excluded.winner`,
      [
        randomUUID(),
        req.params.contestId,
        game.providerGameId,
        game.sport,
        game.homeTeam,
        game.awayTeam,
        game.startTime,
        game.status,
        game.homeScore ?? null,
        game.awayScore ?? null,
        game.winner ?? null
      ]
    );
  }

  await gradeContest(req.params.contestId, 'ADMIN_GAME_BULK');

  res.status(201).json({ ok: true, count: parsed.data.games.length });
});

contestsRouter.patch('/contests/:contestId/games/:providerGameId/result', requireUser, requireContestCreator, async (req, res) => {
  const parsed = overrideGameResultSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const contestResult = await query<{ id: string }>('select id from contests where id = $1', [req.params.contestId]);
  if (!contestResult.rows[0]) {
    res.status(404).json({ error: 'Contest not found' });
    return;
  }

  const payload = parsed.data;
  const hasStatus = Object.prototype.hasOwnProperty.call(payload, 'status');
  const hasHomeScore = Object.prototype.hasOwnProperty.call(payload, 'homeScore');
  const hasAwayScore = Object.prototype.hasOwnProperty.call(payload, 'awayScore');
  const hasWinner = Object.prototype.hasOwnProperty.call(payload, 'winner');

  const updated = await query<{
    id: string;
    providerGameId: string;
    status: string;
    homeScore: number | null;
    awayScore: number | null;
    winner: string | null;
  }>(
    'update games ' +
      'set status = case when $3 then $4 else status end, ' +
      'home_score = case when $5 then $6 else home_score end, ' +
      'away_score = case when $7 then $8 else away_score end, ' +
      'winner = case when $9 then $10 else winner end ' +
      'where contest_id = $1 and provider_game_id = $2 ' +
      'returning id, provider_game_id as "providerGameId", status, home_score as "homeScore", away_score as "awayScore", winner',
    [
      req.params.contestId,
      req.params.providerGameId,
      hasStatus,
      payload.status ?? null,
      hasHomeScore,
      payload.homeScore ?? null,
      hasAwayScore,
      payload.awayScore ?? null,
      hasWinner,
      payload.winner ?? null
    ]
  );

  if (!updated.rows[0]) {
    res.status(404).json({ error: 'Game not found for contest' });
    return;
  }

  await gradeContest(req.params.contestId, 'ADMIN_GAME_OVERRIDE');

  res.json({ ok: true, game: updated.rows[0] });
});

contestsRouter.post('/contests/:contestId/grade', requireUser, requireContestCreator, async (req, res) => {
  const contestResult = await query<{ id: string }>('select id from contests where id = $1', [req.params.contestId]);
  if (!contestResult.rows[0]) {
    res.status(404).json({ error: 'Contest not found' });
    return;
  }

  const result = await gradeContest(req.params.contestId, 'ADMIN_MANUAL_GRADE');
  res.json({ ok: true, ...result });
});

contestsRouter.get('/cbb/spot-matches/upcoming', async (req, res) => {
  const parsed = upcomingSpotQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const from = parsed.data.from ?? new Date().toISOString().slice(0, 10);

  try {
    const result = await buildUpcomingSpotMatches({
      from,
      days: parsed.data.days,
      historyDays: parsed.data.historyDays
    });

    res.json(result);
  } catch (error) {
    res.status(502).json({ error: (error as Error).message || 'Failed to fetch upcoming CBB spot matches' });
  }
});

contestsRouter.get('/contests/admin', requireUser, requireContestCreator, async (_req, res) => {
  await refreshContestStatuses();

  const result = await query(
    `select c.id,
            c.name,
            c.type,
            c.season,
            c.starts_at as "startsAt",
            c.lock_mode as "lockMode",
            c.status,
            coalesce(min(g.start_time), c.starts_at) as "startTime",
            case
              when c.lock_mode = 'PER_GAME' then coalesce(max(g.start_time), c.starts_at)
              else coalesce(min(g.start_time), c.starts_at)
            end as "lockAt",
            coalesce(max(g.start_time), c.starts_at) as "endAt"
     from contests c
     left join games g on g.contest_id = c.id
     group by c.id, c.name, c.type, c.season, c.starts_at, c.lock_mode, c.status
     order by c.starts_at asc`
  );

  res.json({ contests: result.rows });
});

contestsRouter.patch('/contests/:contestId/status', requireUser, requireContestCreator, async (req, res) => {
  const parsed = setContestStatusSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const current = await query<{ id: string; status: 'DRAFT' | 'OPEN' | 'LOCKED' | 'COMPLETE' }>(
    'select id, status from contests where id = $1',
    [req.params.contestId]
  );
  const row = current.rows[0];

  if (!row) {
    res.status(404).json({ error: 'Contest not found' });
    return;
  }

  if (row.status === 'LOCKED' || row.status === 'COMPLETE') {
    res.status(409).json({ error: 'Cannot change status for locked or complete contests' });
    return;
  }

  await query('update contests set status = $2 where id = $1', [req.params.contestId, parsed.data.status]);
  res.json({ id: req.params.contestId, status: parsed.data.status });
});

contestsRouter.get('/contests', async (_req, res) => {
  await refreshContestStatuses();

  const result = await query(
    `select c.id,
            c.name,
            c.type,
            c.season,
            c.starts_at as "startsAt",
            c.lock_mode as "lockMode",
            c.status,
            coalesce(min(g.start_time), c.starts_at) as "startTime",
            case
              when c.lock_mode = 'PER_GAME' then coalesce(max(g.start_time), c.starts_at)
              else coalesce(min(g.start_time), c.starts_at)
            end as "lockAt",
            coalesce(max(g.start_time), c.starts_at) as "endAt"
     from contests c
     left join games g on g.contest_id = c.id
     group by c.id, c.name, c.type, c.season, c.starts_at, c.lock_mode, c.status
     order by c.starts_at asc`
  );

  res.json({ contests: result.rows });
});

contestsRouter.get('/contests/:contestId/games', async (req, res) => {
  const result = await query(
    `select id, provider_game_id as "providerGameId", sport, home_team as "homeTeam", away_team as "awayTeam",
            start_time as "startTime", status, home_score as "homeScore", away_score as "awayScore", winner
     from games
     where contest_id = $1
     order by start_time asc`,
    [req.params.contestId]
  );

  res.json({ contestId: req.params.contestId, games: result.rows });
});

contestsRouter.get('/contests/:contestId/leaderboard', requireUser, async (req, res) => {
  await refreshContestStatuses(req.params.contestId);

  const contestResult = await query<{ id: string; name: string; status: string }>(
    'select id, name, status from contests where id = $1',
    [req.params.contestId]
  );
  const contest = contestResult.rows[0];

  if (!contest) {
    res.status(404).json({ error: 'Contest not found' });
    return;
  }

  const rows = await query<{
    userId: string;
    displayName: string;
    totalPoints: number;
    submittedAt: string | null;
  }>(
    `select e.user_id as "userId", u.display_name as "displayName", e.total_points as "totalPoints", e.submitted_at as "submittedAt"
     from entries e
     join users u on u.id = e.user_id
     where e.contest_id = $1
     order by e.total_points desc, e.submitted_at asc nulls last`,
    [req.params.contestId]
  );

  res.json({
    contestId: req.params.contestId,
    contestName: contest.name,
    contestStatus: contest.status,
    leaderboard: rows.rows
  });
});

contestsRouter.get('/contests/:contestId/pick-percentages', async (req, res) => {
  const contestResult = await query<{ id: string; type: 'PICKEM_NFL' | 'PICKEM_NBA' | 'PICKEM_NHL' | 'BRACKET_NCAAM' }>(
    'select id, type from contests where id = $1',
    [req.params.contestId]
  );
  const contest = contestResult.rows[0];

  if (!contest) {
    res.status(404).json({ error: 'Contest not found' });
    return;
  }

  let rows: Array<{ gameKey: string; team: string; picks: number }> = [];

  if (contest.type === 'PICKEM_NFL' || contest.type === 'PICKEM_NBA' || contest.type === 'PICKEM_NHL') {
    const pickRows = await query<{ gameKey: string; team: string; picks: number }>(
      `select p.game_id as "gameKey", p.picked_winner as team, count(*)::int as picks
       from picks p
       join entries e on e.id = p.entry_id
       where e.contest_id = $1
       group by p.game_id, p.picked_winner`,
      [req.params.contestId]
    );
    rows = pickRows.rows;
  } else {
    const bracketRows = await query<{ gameKey: string; team: string; picks: number }>(
      `select bp.game_slot as "gameKey", bp.picked_team as team, count(*)::int as picks
       from bracket_picks bp
       join entries e on e.id = bp.entry_id
       where e.contest_id = $1
       group by bp.game_slot, bp.picked_team`,
      [req.params.contestId]
    );
    rows = bracketRows.rows;
  }

  const totalsByKey = new Map<string, number>();
  for (const row of rows) {
    totalsByKey.set(row.gameKey, (totalsByKey.get(row.gameKey) ?? 0) + row.picks);
  }

  const withPercentages = rows.map((row) => {
    const totalPicks = totalsByKey.get(row.gameKey) ?? 0;
    const percent = totalPicks > 0 ? Math.round((row.picks / totalPicks) * 1000) / 10 : 0;
    return {
      gameKey: row.gameKey,
      team: row.team,
      picks: row.picks,
      totalPicks,
      percent
    };
  });

  res.json({ contestId: req.params.contestId, type: contest.type, rows: withPercentages });
});

contestsRouter.get('/leaderboards/top-one', requireUser, async (_req, res) => {
  const rows = await query<{
    userId: string;
    displayName: string;
    topOneCount: number;
    contestsEntered: number;
  }>(
    `with ordered as (
       select e.contest_id, e.user_id, e.total_points, e.submitted_at,
              row_number() over (partition by e.contest_id order by e.total_points desc, e.submitted_at asc nulls last) as rn,
              count(*) over (partition by e.contest_id) as n
       from entries e
     ),
     cutoffs as (
       select contest_id, greatest(1, ceil((n * 0.01)::numeric))::int as top_count
       from ordered
       group by contest_id, n
     ),
     cutoff_points as (
       select o.contest_id, min(o.total_points) as cutoff_points
       from ordered o
       join cutoffs c on c.contest_id = o.contest_id
       where o.rn <= c.top_count
       group by o.contest_id
     ),
     top_entries as (
       select o.contest_id, o.user_id
       from ordered o
       join cutoff_points cp on cp.contest_id = o.contest_id
       where o.total_points >= cp.cutoff_points
       group by o.contest_id, o.user_id
     ),
     counts as (
       select te.user_id, count(*)::int as top_one_count
       from top_entries te
       group by te.user_id
     ),
     entered as (
       select e.user_id, count(distinct e.contest_id)::int as contests_entered
       from entries e
       group by e.user_id
     )
     select u.id as "userId",
            u.display_name as "displayName",
            coalesce(c.top_one_count, 0)::int as "topOneCount",
            en.contests_entered as "contestsEntered"
     from entered en
     join users u on u.id = en.user_id
     left join counts c on c.user_id = en.user_id
     order by "topOneCount" desc, "contestsEntered" desc, "displayName" asc`
  );

  res.json({ leaderboard: rows.rows });
});
