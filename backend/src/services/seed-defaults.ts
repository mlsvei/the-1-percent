import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { query } from '../db.js';

type CountRow = { count: string };

const NBA_CONTEST_ID = '72890d7e-ec51-42c4-ae6e-1bec24be4175';
const OLYMPIC_CONTEST_ID = '9aaecee7-659f-4972-bc27-4fed939d7c36';

const nbaGames = [
  {
    providerGameId: 'NBA-2026-02-19-1',
    sport: 'NBA',
    homeTeam: 'Boston Celtics',
    awayTeam: 'Milwaukee Bucks',
    startTime: '2026-02-19T23:30:00.000Z'
  },
  {
    providerGameId: 'NBA-2026-02-19-2',
    sport: 'NBA',
    homeTeam: 'Los Angeles Lakers',
    awayTeam: 'Denver Nuggets',
    startTime: '2026-02-20T01:00:00.000Z'
  },
  {
    providerGameId: 'NBA-2026-02-19-3',
    sport: 'NBA',
    homeTeam: 'Phoenix Suns',
    awayTeam: 'Golden State Warriors',
    startTime: '2026-02-20T02:00:00.000Z'
  },
  {
    providerGameId: 'NBA-2026-02-19-4',
    sport: 'NBA',
    homeTeam: 'Miami Heat',
    awayTeam: 'Philadelphia 76ers',
    startTime: '2026-02-19T00:30:00.000Z'
  },
  {
    providerGameId: 'NBA-2026-02-19-5',
    sport: 'NBA',
    homeTeam: 'Dallas Mavericks',
    awayTeam: 'Minnesota Timberwolves',
    startTime: '2026-02-20T01:30:00.000Z'
  }
];

const olympicGames = [
  { providerGameId: 'QPO1', sport: 'NCAAM', homeTeam: 'Czechia', awayTeam: 'Denmark', startTime: '2026-02-17T11:00:00.000Z' },
  { providerGameId: 'QPO2', sport: 'NCAAM', homeTeam: 'Sweden', awayTeam: 'Latvia', startTime: '2026-02-17T14:00:00.000Z' },
  { providerGameId: 'QPO3', sport: 'NCAAM', homeTeam: 'Germany', awayTeam: 'France', startTime: '2026-02-17T17:00:00.000Z' },
  { providerGameId: 'QPO4', sport: 'NCAAM', homeTeam: 'Switzerland', awayTeam: 'Italy', startTime: '2026-02-17T20:00:00.000Z' },
  { providerGameId: 'QF1', sport: 'NCAAM', homeTeam: 'Canada', awayTeam: 'Winner QPO1', startTime: '2026-02-18T11:00:00.000Z' },
  { providerGameId: 'QF2', sport: 'NCAAM', homeTeam: 'United States', awayTeam: 'Winner QPO2', startTime: '2026-02-18T14:00:00.000Z' },
  { providerGameId: 'QF3', sport: 'NCAAM', homeTeam: 'Slovakia', awayTeam: 'Winner QPO3', startTime: '2026-02-18T17:00:00.000Z' },
  { providerGameId: 'QF4', sport: 'NCAAM', homeTeam: 'Finland', awayTeam: 'Winner QPO4', startTime: '2026-02-18T20:00:00.000Z' },
  { providerGameId: 'SF1', sport: 'NCAAM', homeTeam: 'Winner QF1', awayTeam: 'Winner QF2', startTime: '2026-02-20T15:00:00.000Z' },
  { providerGameId: 'SF2', sport: 'NCAAM', homeTeam: 'Winner QF3', awayTeam: 'Winner QF4', startTime: '2026-02-20T19:00:00.000Z' },
  { providerGameId: 'GOLD', sport: 'NCAAM', homeTeam: 'Winner SF1', awayTeam: 'Winner SF2', startTime: '2026-02-22T17:00:00.000Z' },
  { providerGameId: 'BRONZE', sport: 'NCAAM', homeTeam: 'Loser SF1', awayTeam: 'Loser SF2', startTime: '2026-02-21T17:00:00.000Z' }
];

async function upsertGames(contestId: string, games: Array<{ providerGameId: string; sport: string; homeTeam: string; awayTeam: string; startTime: string }>) {
  for (const game of games) {
    await query(
      `insert into games (id, contest_id, provider_game_id, sport, home_team, away_team, start_time, status, home_score, away_score, winner)
       values ($1, $2, $3, $4, $5, $6, $7, 'Scheduled', null, null, null)
       on conflict (contest_id, provider_game_id)
       do update set
         sport = excluded.sport,
         home_team = excluded.home_team,
         away_team = excluded.away_team,
         start_time = excluded.start_time,
         status = excluded.status`,
      [randomUUID(), contestId, game.providerGameId, game.sport, game.homeTeam, game.awayTeam, game.startTime]
    );
  }
}

export async function seedDefaultsIfNeeded(): Promise<void> {
  if (!config.databaseUrl.startsWith('memory://')) {
    return;
  }

  const countResult = await query<CountRow>('select count(*)::text as count from contests');
  const contestCount = Number(countResult.rows[0]?.count ?? '0');
  if (contestCount > 0) {
    return;
  }

  const creatorEmail = config.creatorEmails[0] ?? 'mlsvei2121@gmail.com';
  const userResult = await query<{ id: string }>('select id from users where email = $1 limit 1', [creatorEmail]);
  const userId = userResult.rows[0]?.id ?? randomUUID();

  await query(
    `insert into users (id, email, display_name, timezone)
     values ($1, $2, $3, $4)
     on conflict (email) do nothing`,
    [userId, creatorEmail, 'Michael Sveinson', 'America/New_York']
  );

  await query(
    `insert into contests (id, name, type, season, starts_at, lock_mode, scoring_config, status)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, 'OPEN')
     on conflict (id) do nothing`,
    [
      NBA_CONTEST_ID,
      "NBA Pick’em - Thu Feb 19, 2026",
      'PICKEM_NBA',
      2026,
      '2026-02-19T00:00:00.000Z',
      'PER_GAME',
      JSON.stringify({ pickem: { basePoints: 1, useConfidence: false } })
    ]
  );

  await query(
    `insert into contests (id, name, type, season, starts_at, lock_mode, scoring_config, status)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, 'OPEN')
     on conflict (id) do nothing`,
    [
      OLYMPIC_CONTEST_ID,
      'Olympic Hockey Bracket 2026',
      'BRACKET_NCAAM',
      2026,
      '2026-02-17T11:00:00.000Z',
      'FULL_BRACKET',
      JSON.stringify({ bracket: { roundPoints: { 1: 1, 2: 2, 3: 4, 4: 8 } } })
    ]
  );

  await upsertGames(NBA_CONTEST_ID, nbaGames);
  await upsertGames(OLYMPIC_CONTEST_ID, olympicGames);
}
