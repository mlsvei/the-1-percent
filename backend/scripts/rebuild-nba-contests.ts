import { randomUUID } from 'node:crypto';
import { pool, query } from '../src/db.js';
import { fetchNbaGamesByDate, normalizeNbaGame, type NormalizedGame } from '../src/integrations/sportsdataio.js';
import { gradeContests } from '../src/services/grading.js';

type ContestPlan = {
  contestId: string;
  dates: string[];
};

type OldPick = {
  entry_id: string;
  picked_winner: string;
  confidence_points: number | null;
  home_team: string;
  away_team: string;
  start_time: string;
};

const CONTESTS: ContestPlan[] = [
  {
    contestId: 'd4e1b7ba-db17-4312-be06-24b7d17ea6b3',
    dates: ['2026-02-19']
  },
  {
    contestId: '0c18655a-bc3b-4c85-bc05-4c09d5c33494',
    dates: ['2026-02-20', '2026-02-21', '2026-02-22']
  }
];

const NBA_TEAM_ALIASES: Record<string, string> = {
  'LA Clippers': 'Los Angeles Clippers',
  'LA Lakers': 'Los Angeles Lakers',
  'NY Knicks': 'New York Knicks',
  'GS Warriors': 'Golden State Warriors',
  'NO Pelicans': 'New Orleans Pelicans',
  'SA Spurs': 'San Antonio Spurs'
};

function canonTeam(name: string): string {
  return NBA_TEAM_ALIASES[name] ?? name;
}

function gameKey(homeTeam: string, awayTeam: string, startTime: string): string {
  const day = new Date(startTime).toISOString().slice(0, 10);
  return `${day}|${canonTeam(homeTeam)}|${canonTeam(awayTeam)}`;
}

function scoreGameRank(game: NormalizedGame): number {
  let score = 0;
  if (/^\d+$/.test(String(game.providerGameId))) score += 10;
  if (String(game.status).toLowerCase().includes('final')) score += 8;
  if (game.winner) score += 5;
  if (typeof game.homeScore === 'number' && typeof game.awayScore === 'number') score += 2;
  return score;
}

async function fetchPlannedGames(dates: string[]): Promise<NormalizedGame[]> {
  const all: NormalizedGame[] = [];

  for (const date of dates) {
    const raw = await fetchNbaGamesByDate(date);
    for (const item of raw) {
      const normalized = normalizeNbaGame(item);
      all.push(normalized);
    }
  }

  const byKey = new Map<string, NormalizedGame[]>();
  for (const game of all) {
    const key = gameKey(game.homeTeam, game.awayTeam, game.startTime);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(game);
  }

  const deduped: NormalizedGame[] = [];
  for (const games of byKey.values()) {
    games.sort((a, b) => scoreGameRank(b) - scoreGameRank(a));
    deduped.push(games[0]);
  }

  return deduped;
}

async function rebuildContest(plan: ContestPlan): Promise<{ contestId: string; games: number; restoredPicks: number; skippedPicks: number }> {
  const contestCheck = await query<{ id: string; type: string }>('select id, type from contests where id = $1', [plan.contestId]);
  const contest = contestCheck.rows[0];
  if (!contest) {
    throw new Error(`Contest not found: ${plan.contestId}`);
  }
  if (contest.type !== 'PICKEM_NBA') {
    throw new Error(`Contest ${plan.contestId} is not PICKEM_NBA`);
  }

  const freshGames = await fetchPlannedGames(plan.dates);

  const client = await pool.connect();
  try {
    await client.query('begin');

    const oldPicks = await client.query<OldPick>(
      `select p.entry_id, p.picked_winner, p.confidence_points, g.home_team, g.away_team, g.start_time
       from picks p
       join games g on g.id = p.game_id
       where g.contest_id = $1`,
      [plan.contestId]
    );

    await client.query(
      `delete from picks
       where game_id in (select id from games where contest_id = $1)`,
      [plan.contestId]
    );

    await client.query('delete from games where contest_id = $1', [plan.contestId]);

    const insertedByKey = new Map<string, { id: string; homeTeam: string; awayTeam: string; startTime: string }>();

    for (const game of freshGames) {
      const id = randomUUID();
      await client.query(
        `insert into games (id, contest_id, provider_game_id, sport, home_team, away_team, start_time, status, home_score, away_score, winner)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          id,
          plan.contestId,
          game.providerGameId,
          game.sport,
          canonTeam(game.homeTeam),
          canonTeam(game.awayTeam),
          game.startTime,
          game.status,
          game.homeScore,
          game.awayScore,
          game.winner ? canonTeam(game.winner) : null
        ]
      );

      insertedByKey.set(gameKey(game.homeTeam, game.awayTeam, game.startTime), {
        id,
        homeTeam: canonTeam(game.homeTeam),
        awayTeam: canonTeam(game.awayTeam),
        startTime: game.startTime
      });
    }

    let restoredPicks = 0;
    let skippedPicks = 0;

    for (const pick of oldPicks.rows) {
      const key = gameKey(pick.home_team, pick.away_team, pick.start_time);
      const mapped = insertedByKey.get(key);
      if (!mapped) {
        skippedPicks += 1;
        continue;
      }

      const pickedWinner = canonTeam(pick.picked_winner);
      if (pickedWinner !== mapped.homeTeam && pickedWinner !== mapped.awayTeam) {
        skippedPicks += 1;
        continue;
      }

      await client.query(
        `insert into picks (id, entry_id, game_id, picked_winner, confidence_points, locked_at, is_correct, points_awarded)
         values ($1, $2, $3, $4, $5, $6, null, 0)
         on conflict (entry_id, game_id)
         do update set picked_winner = excluded.picked_winner,
                       confidence_points = excluded.confidence_points,
                       locked_at = excluded.locked_at,
                       is_correct = null,
                       points_awarded = 0`,
        [randomUUID(), pick.entry_id, mapped.id, pickedWinner, pick.confidence_points, mapped.startTime]
      );

      restoredPicks += 1;
    }

    await client.query('commit');

    return {
      contestId: plan.contestId,
      games: freshGames.length,
      restoredPicks,
      skippedPicks
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const rebuildResults = [] as Array<{ contestId: string; games: number; restoredPicks: number; skippedPicks: number }>;
  for (const plan of CONTESTS) {
    rebuildResults.push(await rebuildContest(plan));
  }

  const gradingResults = await gradeContests({
    contestIds: CONTESTS.map((plan) => plan.contestId),
    source: 'NBA_REBUILD'
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        rebuildResults,
        gradingResults
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
