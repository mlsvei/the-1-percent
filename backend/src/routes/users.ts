import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { requireUser } from '../middleware/require-user.js';
import type { AuthenticatedRequest } from '../types.js';

export const usersRouter = Router();

const createUserSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1),
  timezone: z.string().default('America/New_York')
});

type ContestEntryRow = {
  contestId: string;
  contestName: string;
  contestStatus: string;
  startsAt: string;
  userId: string;
  totalPoints: number;
  submittedAt: string | null;
};

type ContestUserMetric = {
  contestId: string;
  contestName: string;
  contestStatus: string;
  startsAt: string;
  year: number;
  totalPoints: number;
  rank: number;
  percentile: number;
  isWin: boolean;
  isTopOne: boolean;
};

function rankFromPoints(rows: Array<{ totalPoints: number }>, index: number): number {
  if (index === 0) return 1;
  let rank = 1;
  for (let i = 1; i <= index; i += 1) {
    if (rows[i].totalPoints < rows[i - 1].totalPoints) {
      rank = i + 1;
    }
  }
  return rank;
}

function percentileFromRank(totalEntries: number, rank: number): number {
  if (totalEntries <= 1) return 100;
  const percentile = ((totalEntries - rank) / (totalEntries - 1)) * 100;
  return Math.max(0, Math.min(100, percentile));
}

function topOneCutoffPoints(rows: Array<{ totalPoints: number }>): number {
  if (rows.length === 0) return Number.POSITIVE_INFINITY;
  const topCount = Math.max(1, Math.ceil(rows.length * 0.01));
  return rows[Math.min(rows.length - 1, topCount - 1)].totalPoints;
}

usersRouter.post('/users', async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const id = randomUUID();
  const { email, displayName, timezone } = parsed.data;

  try {
    await query(
      'insert into users (id, email, display_name, timezone) values ($1, $2, $3, $4)',
      [id, email, displayName, timezone]
    );
    res.status(201).json({ id, email, displayName, timezone });
  } catch (error) {
    res.status(409).json({ error: 'User already exists', detail: `${error}` });
  }
});

usersRouter.get('/users/:id', async (req, res) => {
  const result = await query(
    'select id, email, display_name as "displayName", timezone, created_at as "createdAt" from users where id = $1',
    [req.params.id]
  );

  if (!result.rows[0]) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json(result.rows[0]);
});

usersRouter.get('/users/:id/stats', requireUser, async (req: AuthenticatedRequest, res) => {
  const userResult = await query<{ id: string; displayName: string }>(
    'select id, display_name as "displayName" from users where id = $1',
    [req.params.id]
  );
  const targetUser = userResult.rows[0];

  if (!targetUser) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const entryRows = await query<ContestEntryRow>(
    `select e.contest_id as "contestId",
            c.name as "contestName",
            c.status as "contestStatus",
            c.starts_at as "startsAt",
            e.user_id as "userId",
            e.total_points as "totalPoints",
            e.submitted_at as "submittedAt"
     from entries e
     join contests c on c.id = e.contest_id
     order by c.starts_at desc, e.contest_id asc, e.total_points desc, e.submitted_at asc nulls last`
  );

  const byContest = new Map<string, ContestEntryRow[]>();
  for (const row of entryRows.rows) {
    const list = byContest.get(row.contestId) ?? [];
    list.push(row);
    byContest.set(row.contestId, list);
  }

  const targetResults: ContestUserMetric[] = [];

  for (const rows of byContest.values()) {
    rows.sort((a, b) => {
      if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;

      const aSubmitted = a.submittedAt ? Date.parse(a.submittedAt) : Number.POSITIVE_INFINITY;
      const bSubmitted = b.submittedAt ? Date.parse(b.submittedAt) : Number.POSITIVE_INFINITY;
      return aSubmitted - bSubmitted;
    });

    const topCutoff = topOneCutoffPoints(rows);
    const totalEntries = rows.length;

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (row.userId !== targetUser.id) continue;

      const rank = rankFromPoints(rows, i);
      const percentile = percentileFromRank(totalEntries, rank);
      const year = Number.isFinite(Date.parse(row.startsAt)) ? new Date(row.startsAt).getUTCFullYear() : 0;

      targetResults.push({
        contestId: row.contestId,
        contestName: row.contestName,
        contestStatus: row.contestStatus,
        startsAt: row.startsAt,
        year,
        totalPoints: row.totalPoints,
        rank,
        percentile,
        isWin: rank === 1,
        isTopOne: row.totalPoints >= topCutoff
      });
    }
  }

  const makeAggregate = () => ({
    contestsEntered: 0,
    contestsWon: 0,
    topOneFinishes: 0,
    totalPoints: 0,
    percentileSum: 0,
    bestPercentile: 0
  });

  const lifetime = makeAggregate();
  const yearly = new Map<number, ReturnType<typeof makeAggregate>>();

  for (const result of targetResults) {
    lifetime.contestsEntered += 1;
    lifetime.totalPoints += result.totalPoints;
    lifetime.percentileSum += result.percentile;
    lifetime.bestPercentile = Math.max(lifetime.bestPercentile, result.percentile);
    if (result.isWin) lifetime.contestsWon += 1;
    if (result.isTopOne) lifetime.topOneFinishes += 1;

    const bucket = yearly.get(result.year) ?? makeAggregate();
    bucket.contestsEntered += 1;
    bucket.totalPoints += result.totalPoints;
    bucket.percentileSum += result.percentile;
    bucket.bestPercentile = Math.max(bucket.bestPercentile, result.percentile);
    if (result.isWin) bucket.contestsWon += 1;
    if (result.isTopOne) bucket.topOneFinishes += 1;
    yearly.set(result.year, bucket);
  }

  const lifetimeAvgPercentile =
    lifetime.contestsEntered > 0 ? lifetime.percentileSum / lifetime.contestsEntered : 0;

  const byYear = Array.from(yearly.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([year, agg]) => ({
      year,
      contestsEntered: agg.contestsEntered,
      contestsWon: agg.contestsWon,
      topOneFinishes: agg.topOneFinishes,
      totalPoints: agg.totalPoints,
      avgPercentile: agg.contestsEntered > 0 ? agg.percentileSum / agg.contestsEntered : 0,
      bestPercentile: agg.bestPercentile
    }));

  const recentContests = [...targetResults]
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt))
    .slice(0, 20);

  res.json({
    userId: targetUser.id,
    displayName: targetUser.displayName,
    lifetime: {
      contestsEntered: lifetime.contestsEntered,
      contestsWon: lifetime.contestsWon,
      topOneFinishes: lifetime.topOneFinishes,
      totalPoints: lifetime.totalPoints,
      avgPercentile: lifetimeAvgPercentile,
      bestPercentile: lifetime.bestPercentile
    },
    byYear,
    recentContests
  });
});
