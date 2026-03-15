import crypto from 'node:crypto';
import dotenv from 'dotenv';
import pkg from 'pg';

const { Pool } = pkg;
dotenv.config({ path: '/Applications/Codex stuff/backend/.env' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const CONTEST_NAME = "Basketball - NBA Pick'em (Straight) Feb 20th - Feb 22nd";
const CONTEST_TYPE = 'PICKEM_NBA';
const SEASON = 2026;
const STARTS_AT = '2026-02-20T00:00:00.000Z';
const LOCK_MODE = 'PER_GAME';
const STATUS = 'OPEN';

const TEAM_ALIASES = {
  'LA Clippers': 'Los Angeles Clippers',
  'LA Lakers': 'Los Angeles Lakers',
  'NY Knicks': 'New York Knicks',
  'GS Warriors': 'Golden State Warriors',
  'NO Pelicans': 'New Orleans Pelicans',
  'SA Spurs': 'San Antonio Spurs'
};

function canon(name) {
  return TEAM_ALIASES[name] ?? name;
}

function statusFrom(comp) {
  const st = comp?.status?.type;
  return st?.detail || st?.description || st?.state || 'Scheduled';
}

function winnerFrom(comp, homeName, awayName) {
  const competitors = Array.isArray(comp?.competitors) ? comp.competitors : [];
  const home = competitors.find((c) => String(c?.homeAway || '').toLowerCase() === 'home') || {};
  const away = competitors.find((c) => String(c?.homeAway || '').toLowerCase() === 'away') || {};

  const hs = Number.isFinite(Number(home?.score)) ? Number(home.score) : null;
  const as = Number.isFinite(Number(away?.score)) ? Number(away.score) : null;
  if (hs === null || as === null || hs === as) return null;

  return hs > as ? homeName : awayName;
}

async function fetchEspnNbaByDate(dateIso) {
  const yyyymmdd = dateIso.replaceAll('-', '');
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${yyyymmdd}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`ESPN request failed for ${dateIso}: ${res.status} ${res.statusText}`);
  }

  const body = await res.json();
  const events = Array.isArray(body?.events) ? body.events : [];

  return events.map((event) => {
    const comp = Array.isArray(event?.competitions) ? event.competitions[0] : null;
    const competitors = Array.isArray(comp?.competitors) ? comp.competitors : [];
    const home = competitors.find((c) => String(c?.homeAway || '').toLowerCase() === 'home') || {};
    const away = competitors.find((c) => String(c?.homeAway || '').toLowerCase() === 'away') || {};

    const homeName = canon(home?.team?.displayName || home?.team?.name || home?.displayName || 'Unknown Home');
    const awayName = canon(away?.team?.displayName || away?.team?.name || away?.displayName || 'Unknown Away');

    const homeScore = Number.isFinite(Number(home?.score)) ? Number(home.score) : null;
    const awayScore = Number.isFinite(Number(away?.score)) ? Number(away.score) : null;

    const gameId = String(event?.id || comp?.id || `${yyyymmdd}-${awayName}-${homeName}`);

    return {
      providerGameId: gameId,
      sport: 'NBA',
      homeTeam: homeName,
      awayTeam: awayName,
      startTime: new Date(comp?.date || event?.date || `${dateIso}T00:00:00.000Z`).toISOString(),
      status: statusFrom(comp),
      homeScore,
      awayScore,
      winner: winnerFrom(comp, homeName, awayName)
    };
  });
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('begin');

    const existing = await client.query(
      `select id from contests where name = $1 and type = $2 limit 1`,
      [CONTEST_NAME, CONTEST_TYPE]
    );

    let contestId = existing.rows[0]?.id;
    if (!contestId) {
      contestId = crypto.randomUUID();
      await client.query(
        `insert into contests (id, name, type, season, starts_at, lock_mode, scoring_config, status)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [contestId, CONTEST_NAME, CONTEST_TYPE, SEASON, STARTS_AT, LOCK_MODE, JSON.stringify({}), STATUS]
      );
    }

    const dates = ['2026-02-20', '2026-02-21', '2026-02-22'];
    let upserts = 0;
    for (const d of dates) {
      const games = await fetchEspnNbaByDate(d);
      for (const game of games) {
        await client.query(
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
            crypto.randomUUID(),
            contestId,
            game.providerGameId,
            game.sport,
            game.homeTeam,
            game.awayTeam,
            game.startTime,
            game.status,
            game.homeScore,
            game.awayScore,
            game.winner
          ]
        );
        upserts += 1;
      }
    }

    await client.query('commit');

    const countResult = await pool.query('select count(*)::int as c from games where contest_id = $1', [contestId]);
    console.log(JSON.stringify({ ok: true, contestId, upserts, totalGames: countResult.rows[0].c }, null, 2));
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
