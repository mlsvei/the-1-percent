import { randomUUID } from 'node:crypto';
import { pool, query } from '../db.js';

type ContestRow = {
  id: string;
  type: 'PICKEM_NFL' | 'PICKEM_NBA' | 'PICKEM_NHL' | 'BRACKET_NCAAM';
  scoring_config: Record<string, unknown>;
};

type PickRow = {
  id: string;
  entry_id: string;
  game_id: string;
  picked_winner: string;
  confidence_points: number | null;
  points_awarded: number;
  winner: string | null;
};

type BracketPickRow = {
  id: string;
  entry_id: string;
  game_slot: string;
  picked_team: string;
  round: number;
  points_awarded: number;
  winner: string | null;
};

type EntryRow = {
  id: string;
  user_id: string;
  total_points: number;
  submitted_at: string | null;
};

function readPickemBasePoints(scoringConfig: Record<string, unknown>): number {
  const raw = (scoringConfig.pickem as { basePoints?: number } | undefined)?.basePoints;
  return typeof raw === 'number' && raw > 0 ? Math.floor(raw) : 1;
}

function readPickemUseConfidence(scoringConfig: Record<string, unknown>): boolean {
  const raw = (scoringConfig.pickem as { useConfidence?: boolean } | undefined)?.useConfidence;
  return raw === true;
}

function readBracketRoundPoints(scoringConfig: Record<string, unknown>): Record<number, number> {
  const defaults: Record<number, number> = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16, 6: 32 };
  const raw = (scoringConfig.bracket as { roundPoints?: Record<string, number> } | undefined)?.roundPoints;
  if (!raw || typeof raw !== 'object') {
    return defaults;
  }

  const parsed: Record<number, number> = { ...defaults };
  for (const [k, v] of Object.entries(raw)) {
    const round = Number(k);
    if (Number.isInteger(round) && typeof v === 'number' && v > 0) {
      parsed[round] = Math.floor(v);
    }
  }
  return parsed;
}

async function getContestsForGrading(contestId?: string): Promise<ContestRow[]> {
  if (contestId) {
    const result = await query<ContestRow>(
      `select id, type, scoring_config
       from contests
       where id = $1`,
      [contestId]
    );
    return result.rows;
  }

  const result = await query<ContestRow>(
    `select id, type, scoring_config
     from contests
     where status in ('OPEN', 'LOCKED', 'COMPLETE')`
  );
  return result.rows;
}

async function recalcPickemForContest(contest: ContestRow): Promise<Map<string, number>> {
  const picksResult = await query<PickRow>(
    `select p.id, p.entry_id, p.game_id, p.picked_winner, p.confidence_points, p.points_awarded, g.winner
     from picks p
     join entries e on e.id = p.entry_id
     join games g on g.id = p.game_id
     where e.contest_id = $1`,
    [contest.id]
  );

  const basePoints = readPickemBasePoints(contest.scoring_config);
  const useConfidence = readPickemUseConfidence(contest.scoring_config);
  const entryPointTotals = new Map<string, number>();

  const client = await pool.connect();
  try {
    await client.query('begin');

    for (const pick of picksResult.rows) {
      let isCorrect: boolean | null = null;
      let nextPoints = 0;

      if (pick.winner) {
        isCorrect = pick.picked_winner === pick.winner;
        if (isCorrect) {
          nextPoints = useConfidence ? (pick.confidence_points ?? basePoints) : basePoints;
        }
      }

      await client.query(
        `update picks
         set is_correct = $1,
             points_awarded = $2
         where id = $3`,
        [isCorrect, nextPoints, pick.id]
      );

      entryPointTotals.set(pick.entry_id, (entryPointTotals.get(pick.entry_id) ?? 0) + nextPoints);
    }

    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }

  return entryPointTotals;
}

async function recalcBracketForContest(contest: ContestRow): Promise<Map<string, number>> {
  const bracketResult = await query<BracketPickRow>(
    `select bp.id, bp.entry_id, bp.game_slot, bp.picked_team, bp.round, bp.points_awarded, g.winner
     from bracket_picks bp
     join entries e on e.id = bp.entry_id
     left join games g on g.contest_id = e.contest_id and g.provider_game_id = bp.game_slot
     where e.contest_id = $1`,
    [contest.id]
  );

  const roundPoints = readBracketRoundPoints(contest.scoring_config);
  const entryPointTotals = new Map<string, number>();

  const client = await pool.connect();
  try {
    await client.query('begin');

    for (const pick of bracketResult.rows) {
      let isCorrect: boolean | null = null;
      let nextPoints = 0;

      if (pick.winner) {
        isCorrect = pick.picked_team === pick.winner;
        if (isCorrect) {
          nextPoints = roundPoints[pick.round] ?? 0;
        }
      }

      await client.query(
        `update bracket_picks
         set is_correct = $1,
             points_awarded = $2
         where id = $3`,
        [isCorrect, nextPoints, pick.id]
      );

      entryPointTotals.set(pick.entry_id, (entryPointTotals.get(pick.entry_id) ?? 0) + nextPoints);
    }

    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }

  return entryPointTotals;
}

async function refreshLeaderboardSnapshots(contestId: string): Promise<void> {
  const globalRows = await query<{ userId: string; displayName: string; totalPoints: number; submittedAt: string | null }>(
    `select e.user_id as "userId", u.display_name as "displayName", e.total_points as "totalPoints", e.submitted_at as "submittedAt"
     from entries e
     join users u on u.id = e.user_id
     where e.contest_id = $1
     order by e.total_points desc, e.submitted_at asc nulls last`,
    [contestId]
  );

  await query('delete from leaderboard_snapshots where contest_id = $1 and group_id is null', [contestId]);
  await query(
    `insert into leaderboard_snapshots (id, contest_id, group_id, payload)
     values ($1, $2, null, $3::jsonb)`,
    [
      randomUUID(),
      contestId,
      JSON.stringify({ type: 'CONTEST', contestId, generatedAt: new Date().toISOString(), rows: globalRows.rows })
    ]
  );

  const groups = await query<{ group_id: string }>('select group_id from group_contests where contest_id = $1', [contestId]);

  for (const group of groups.rows) {
    const groupRows = await query<{
      userId: string;
      displayName: string;
      totalPoints: number;
      submittedAt: string | null;
    }>(
      `select e.user_id as "userId", u.display_name as "displayName", e.total_points as "totalPoints", e.submitted_at as "submittedAt"
       from entries e
       join users u on u.id = e.user_id
       join group_members gm on gm.user_id = e.user_id
       where e.contest_id = $1 and gm.group_id = $2
       order by e.total_points desc, e.submitted_at asc nulls last`,
      [contestId, group.group_id]
    );

    await query('delete from leaderboard_snapshots where contest_id = $1 and group_id = $2', [contestId, group.group_id]);
    await query(
      `insert into leaderboard_snapshots (id, contest_id, group_id, payload)
       values ($1, $2, $3, $4::jsonb)`,
      [
        randomUUID(),
        contestId,
        group.group_id,
        JSON.stringify({
          type: 'GROUP',
          contestId,
          groupId: group.group_id,
          generatedAt: new Date().toISOString(),
          rows: groupRows.rows
        })
      ]
    );
  }
}

async function applyEntryTotalsAndEmitEvents(args: {
  contestId: string;
  entryTotals: Map<string, number>;
  source: string;
}): Promise<number> {
  const entries = await query<EntryRow>('select id, user_id, total_points, submitted_at from entries where contest_id = $1', [
    args.contestId
  ]);

  const client = await pool.connect();
  let changeCount = 0;

  try {
    await client.query('begin');

    for (const entry of entries.rows) {
      const nextTotal = args.entryTotals.get(entry.id) ?? 0;
      const delta = nextTotal - entry.total_points;

      if (delta !== 0) {
        changeCount += 1;

        await client.query(
          `insert into score_events (id, contest_id, entry_id, source, event_type, delta, metadata)
           values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
          [
            randomUUID(),
            args.contestId,
            entry.id,
            args.source,
            'RECALC',
            delta,
            JSON.stringify({ previousTotal: entry.total_points, nextTotal })
          ]
        );
      }

      await client.query('update entries set total_points = $1 where id = $2', [nextTotal, entry.id]);
    }

    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }

  return changeCount;
}

export async function gradeContest(contestId: string, source = 'INGEST'): Promise<{ contestId: string; changedEntries: number }> {
  const contests = await getContestsForGrading(contestId);
  const contest = contests[0];
  if (!contest) {
    throw new Error(`Contest not found: ${contestId}`);
  }

  const pickemTotals = await recalcPickemForContest(contest);
  const bracketTotals = await recalcBracketForContest(contest);
  const mergedTotals = new Map<string, number>();

  for (const [entryId, points] of pickemTotals.entries()) {
    mergedTotals.set(entryId, (mergedTotals.get(entryId) ?? 0) + points);
  }
  for (const [entryId, points] of bracketTotals.entries()) {
    mergedTotals.set(entryId, (mergedTotals.get(entryId) ?? 0) + points);
  }

  const changedEntries = await applyEntryTotalsAndEmitEvents({ contestId: contest.id, entryTotals: mergedTotals, source });
  await refreshLeaderboardSnapshots(contest.id);

  return { contestId: contest.id, changedEntries };
}

export async function gradeContests(args: {
  contestIds?: string[];
  source?: string;
}): Promise<Array<{ contestId: string; changedEntries: number }>> {
  const source = args.source ?? 'INGEST';
  const contests = args.contestIds?.length
    ? await Promise.all(args.contestIds.map((contestId) => getContestsForGrading(contestId))).then((rows) => rows.flat())
    : await getContestsForGrading();

  const uniqueIds = [...new Set(contests.map((contest) => contest.id))];
  const results: Array<{ contestId: string; changedEntries: number }> = [];

  for (const contestId of uniqueIds) {
    results.push(await gradeContest(contestId, source));
  }

  return results;
}
