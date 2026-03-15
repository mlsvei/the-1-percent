import { query } from '../db.js';

type ContestStatus = 'DRAFT' | 'OPEN' | 'LOCKED' | 'COMPLETE';

type ContestAggregate = {
  id: string;
  status: ContestStatus;
  starts_at: string;
  lock_mode: 'PER_GAME' | 'FULL_BRACKET' | 'PER_ROUND';
  game_count: number;
  final_count: number;
  earliest_start: string | null;
  latest_start: string | null;
};

function isFinalLikeStatus(status: string | null): boolean {
  if (!status) return false;
  const normalized = status.trim().toLowerCase();
  return (
    normalized.includes('final') ||
    normalized === 'off' ||
    normalized.startsWith('f/') ||
    normalized.startsWith('f ') ||
    normalized.includes('complete')
  );
}

function nextContestStatus(contest: ContestAggregate, now: Date): ContestStatus {
  if (contest.status === 'DRAFT') return 'DRAFT';

  if (contest.game_count > 0 && contest.final_count >= contest.game_count) {
    return 'COMPLETE';
  }

  if (contest.game_count > 0) {
    const lockAtRaw =
      contest.lock_mode === 'PER_GAME'
        ? contest.latest_start
        : contest.earliest_start;

    if (lockAtRaw && new Date(lockAtRaw) <= now) {
      return 'LOCKED';
    }
  }

  return 'OPEN';
}

export async function refreshContestStatuses(contestId?: string): Promise<void> {
  const params: string[] = [];
  const where = contestId ? 'where c.id = $1' : '';
  if (contestId) params.push(contestId);

  const aggregates = await query<ContestAggregate>(
    `select
       c.id,
       c.status,
       c.starts_at,
       c.lock_mode,
       count(g.id)::int as game_count,
       count(*) filter (
         where g.id is not null and (
           g.winner is not null
           or lower(coalesce(g.status, '')) like '%final%'
           or lower(coalesce(g.status, '')) = 'off'
           or lower(coalesce(g.status, '')) like 'f/%'
           or lower(coalesce(g.status, '')) like 'f %'
           or lower(coalesce(g.status, '')) like '%complete%'
         )
       )::int as final_count,
       min(g.start_time) as earliest_start,
       max(g.start_time) as latest_start
     from contests c
     left join games g on g.contest_id = c.id
     ${where}
     group by c.id, c.status, c.starts_at, c.lock_mode`,
    params
  );

  const now = new Date();

  for (const contest of aggregates.rows) {
    let effectiveFinalCount = contest.final_count;

    if (effectiveFinalCount < contest.game_count) {
      const statusRows = await query<{ status: string | null }>(
        'select status from games where contest_id = $1',
        [contest.id]
      );
      effectiveFinalCount = statusRows.rows.filter((row) => isFinalLikeStatus(row.status)).length;
    }

    const next = nextContestStatus({ ...contest, final_count: effectiveFinalCount }, now);
    if (next !== contest.status) {
      await query('update contests set status = $2 where id = $1', [contest.id, next]);
    }
  }
}
