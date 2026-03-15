import { randomUUID } from 'node:crypto';
import { pool, query } from '../db.js';
import {
  fetchCbbGamesByDate,
  fetchNbaGamesByDate,
  fetchNflSchedules,
  fetchNhlGamesByDate,
  fetchSoccerGamesByDate,
  normalizeCbbGame,
  normalizeNbaGame,
  normalizeNflSchedule,
  normalizeNhlGame,
  normalizeSoccerGame,
  type NormalizedGame
} from '../integrations/sportsdataio.js';

type ContestRow = {
  id: string;
  name: string;
  type: 'PICKEM_NFL' | 'PICKEM_NBA' | 'PICKEM_NHL' | 'BRACKET_NCAAM';
  season: number;
  starts_at: string;
  status: 'OPEN' | 'LOCKED' | 'DRAFT' | 'COMPLETE';
  scoring_config: Record<string, unknown> | null;
};

export type SyncContestResult = {
  contestId: string;
  contestName: string;
  syncedGames: number;
  changedGameIds: string[];
};

type ConferenceChampionSlot = {
  conference: string;
  slot: string;
  teams: string[];
};

const CONFERENCE_CHAMPION_SLOTS: ConferenceChampionSlot[] = [
  { conference: 'America East', slot: 'CONF_AE', teams: ['Albany', 'Binghamton', 'Bryant', 'Maine', 'NJIT', 'UMass Lowell', 'New Hampshire', 'UMBC', 'Vermont'] },
  { conference: 'American Athletic', slot: 'CONF_AAC', teams: ['Charlotte', 'East Carolina', 'Florida Atlantic', 'Memphis', 'North Texas', 'Rice', 'South Florida', 'Temple', 'Tulane', 'Tulsa', 'UAB', 'UTSA'] },
  { conference: 'Atlantic 10', slot: 'CONF_A10', teams: ['Davidson', 'Dayton', 'Duquesne', 'Fordham', 'George Mason', 'George Washington', 'La Salle', 'Loyola Chicago', 'Massachusetts', "Saint Joseph's", 'Saint Louis', 'St. Bonaventure', 'Rhode Island', 'Richmond', 'VCU'] },
  { conference: 'ACC', slot: 'CONF_ACC', teams: ['Boston College', 'California', 'Clemson', 'Duke', 'Florida State', 'Georgia Tech', 'Louisville', 'Miami (FL)', 'NC State', 'North Carolina', 'Notre Dame', 'Pittsburgh', 'SMU', 'Stanford', 'Syracuse', 'Virginia', 'Virginia Tech', 'Wake Forest'] },
  { conference: 'ASUN', slot: 'CONF_ASUN', teams: ['Austin Peay', 'Bellarmine', 'Central Arkansas', 'Eastern Kentucky', 'Florida Gulf Coast', 'Jacksonville', 'Jacksonville State', 'Kennesaw State', 'Lipscomb', 'North Alabama', 'North Florida', 'Queens', 'Stetson', 'West Georgia'] },
  { conference: 'Big 12', slot: 'CONF_B12', teams: ['Arizona', 'Arizona State', 'Baylor', 'BYU', 'Cincinnati', 'Colorado', 'Houston', 'Iowa State', 'Kansas', 'Kansas State', 'Oklahoma State', 'TCU', 'Texas Tech', 'UCF', 'Utah', 'West Virginia'] },
  { conference: 'Big East', slot: 'CONF_BE', teams: ['Butler', 'Creighton', 'DePaul', 'Georgetown', 'Marquette', 'Providence', "St. John's", 'Seton Hall', 'UConn', 'Villanova', 'Xavier'] },
  { conference: 'Big Sky', slot: 'CONF_BSKY', teams: ['Eastern Washington', 'Idaho', 'Idaho State', 'Montana', 'Montana State', 'Northern Arizona', 'Northern Colorado', 'Portland State', 'Sacramento State', 'Weber State'] },
  { conference: 'Big South', slot: 'CONF_BSOUTH', teams: ['Charleston Southern', 'Gardner-Webb', 'High Point', 'Longwood', 'Presbyterian', 'Radford', 'South Carolina Upstate', 'UNC Asheville', 'Winthrop'] },
  { conference: 'Big Ten', slot: 'CONF_B10', teams: ['Illinois', 'Indiana', 'Iowa', 'Maryland', 'Michigan', 'Michigan State', 'Minnesota', 'Nebraska', 'Northwestern', 'Ohio State', 'Oregon', 'Penn State', 'Purdue', 'Rutgers', 'UCLA', 'USC', 'Washington', 'Wisconsin'] },
  { conference: 'Big West', slot: 'CONF_BWEST', teams: ['Cal Poly', 'CSUN', 'Hawaii', 'Long Beach State', 'UC Davis', 'UC Irvine', 'UC Riverside', 'UC San Diego', 'UC Santa Barbara'] },
  { conference: 'CAA', slot: 'CONF_CAA', teams: ['Campbell', 'Charleston', 'Delaware', 'Drexel', 'Elon', 'Hampton', 'Hofstra', 'Monmouth', 'UNC Wilmington', 'Northeastern', 'Stony Brook', 'Towson'] },
  { conference: 'Conference USA', slot: 'CONF_CUSA', teams: ['FIU', 'Jacksonville State', 'Kennesaw State', 'Liberty', 'Louisiana Tech', 'Middle Tennessee', 'New Mexico State', 'Sam Houston', 'UTEP', 'Western Kentucky'] },
  { conference: 'Horizon League', slot: 'CONF_HORIZON', teams: ['Cleveland State', 'Detroit Mercy', 'Green Bay', 'IU Indianapolis', 'Milwaukee', 'Northern Kentucky', 'Oakland', 'Purdue Fort Wayne', 'Robert Morris', 'Wright State', 'Youngstown State'] },
  { conference: 'Ivy League', slot: 'CONF_IVY', teams: ['Brown', 'Columbia', 'Cornell', 'Dartmouth', 'Harvard', 'Penn', 'Princeton', 'Yale'] },
  { conference: 'MAAC', slot: 'CONF_MAAC', teams: ['Canisius', 'Fairfield', 'Iona', 'Manhattan', 'Marist', 'Merrimack', "Mount St. Mary's", 'Niagara', 'Quinnipiac', "Saint Peter's", 'Siena'] },
  { conference: 'MAC', slot: 'CONF_MAC', teams: ['Akron', 'Ball State', 'Bowling Green', 'Buffalo', 'Central Michigan', 'Eastern Michigan', 'Kent State', 'Miami (OH)', 'Northern Illinois', 'Ohio', 'Toledo', 'Western Michigan'] },
  { conference: 'MEAC', slot: 'CONF_MEAC', teams: ['Coppin State', 'Delaware State', 'Howard', 'Maryland Eastern Shore', 'Morgan State', 'Norfolk State', 'North Carolina Central', 'South Carolina State'] },
  { conference: 'Missouri Valley', slot: 'CONF_MVC', teams: ['Belmont', 'Bradley', 'Drake', 'Evansville', 'Illinois State', 'Indiana State', 'Murray State', 'Northern Iowa', 'Southern Illinois', 'UIC', 'Valparaiso'] },
  { conference: 'Mountain West', slot: 'CONF_MW', teams: ['Air Force', 'Boise State', 'Colorado State', 'Fresno State', 'Nevada', 'New Mexico', 'San Diego State', 'San Jose State', 'UNLV', 'Utah State', 'Wyoming'] },
  { conference: 'NEC', slot: 'CONF_NEC', teams: ['Central Connecticut', 'Chicago State', 'Fairleigh Dickinson', 'Le Moyne', 'LIU', 'Mercyhurst', 'Sacred Heart', 'Saint Francis', 'Stonehill', 'Wagner'] },
  { conference: 'OVC', slot: 'CONF_OVC', teams: ['Eastern Illinois', 'Little Rock', 'Lindenwood', 'Morehead State', 'SIUE', 'Southeast Missouri State', 'Southern Indiana', 'Tennessee State', 'Tennessee Tech', 'UT Martin', 'Western Illinois'] },
  { conference: 'Patriot League', slot: 'CONF_PAT', teams: ['American', 'Army', 'Boston University', 'Bucknell', 'Colgate', 'Holy Cross', 'Lafayette', 'Lehigh', 'Loyola Maryland', 'Navy'] },
  { conference: 'SEC', slot: 'CONF_SEC', teams: ['Alabama', 'Arkansas', 'Auburn', 'Florida', 'Georgia', 'Kentucky', 'LSU', 'Mississippi State', 'Missouri', 'Oklahoma', 'Ole Miss', 'South Carolina', 'Tennessee', 'Texas', 'Texas A&M', 'Vanderbilt'] },
  { conference: 'SoCon', slot: 'CONF_SOCON', teams: ['Chattanooga', 'The Citadel', 'ETSU', 'Furman', 'Mercer', 'Samford', 'UNC Greensboro', 'VMI', 'Western Carolina', 'Wofford'] },
  { conference: 'Southland', slot: 'CONF_SLAND', teams: ['Houston Christian', 'Incarnate Word', 'Lamar', 'McNeese', 'New Orleans', 'Nicholls', 'Northwestern State', 'Southeastern Louisiana', 'Stephen F. Austin', 'Texas A&M-Corpus Christi', 'UT Rio Grande Valley'] },
  { conference: 'SWAC', slot: 'CONF_SWAC', teams: ['Alabama A&M', 'Alabama State', 'Alcorn State', 'Arkansas-Pine Bluff', 'Bethune-Cookman', 'Florida A&M', 'Grambling', 'Jackson State', 'Mississippi Valley State', 'Prairie View A&M', 'Southern', 'Texas Southern'] },
  { conference: 'Summit League', slot: 'CONF_SUMMIT', teams: ['Denver', 'Kansas City', 'North Dakota', 'North Dakota State', 'Omaha', 'Oral Roberts', 'South Dakota', 'South Dakota State', 'St. Thomas'] },
  { conference: 'Sun Belt', slot: 'CONF_SUN', teams: ['App State', 'Arkansas State', 'Coastal Carolina', 'Georgia Southern', 'Georgia State', 'James Madison', 'Louisiana', 'Louisiana-Monroe', 'Marshall', 'Old Dominion', 'South Alabama', 'Southern Miss', 'Texas State', 'Troy'] },
  { conference: 'WCC', slot: 'CONF_WCC', teams: ['Gonzaga', 'Loyola Marymount', 'Pacific', 'Pepperdine', 'Portland', "Saint Mary's", 'San Diego', 'San Francisco', 'Santa Clara', 'Washington State', 'Oregon State'] },
  { conference: 'WAC', slot: 'CONF_WAC', teams: ['Abilene Christian', 'California Baptist', 'Grand Canyon', 'Seattle U', 'Southern Utah', 'Tarleton State', 'UT Arlington', 'Utah Tech'] }
];

const CBB_TEAM_ALIASES: Record<string, string[]> = {
  "Saint Joseph's": ['Saint Josephs', 'St Josephs', "St. Joseph's", "St Joseph's"],
  'Saint Louis': ['St Louis', 'St. Louis'],
  'St. Bonaventure': ['St Bonaventure', 'Saint Bonaventure'],
  "St. John's": ['St Johns', 'Saint Johns', 'St. Johns'],
  'UConn': ['Connecticut'],
  'UIC': ['Illinois Chicago'],
  'SIUE': ['SIU Edwardsville', 'Southern Illinois Edwardsville', 'Southern Illinois-Edwardsville'],
  'UT Martin': ['Tennessee Martin', 'Tennessee-Martin'],
  'Florida Gulf Coast': ['FGCU'],
  'South Carolina Upstate': ['USC Upstate'],
  'IU Indianapolis': ['IUPUI', 'IU Indy'],
  "Mount St. Mary's": ["Mount Saint Mary's", 'Mt St Marys', 'Mount St Marys'],
  "Saint Peter's": ['Saint Peters', 'St Peters', "St. Peter's"],
  'App State': ['Appalachian State'],
  'Louisiana-Monroe': ['ULM'],
  'Southern Miss': ['Southern Mississippi'],
  "Saint Mary's": ["Saint Mary's (CA)", 'Saint Marys', 'Saint Marys CA', "St. Mary's", 'St Marys'],
  'Little Rock': ['Arkansas Little Rock', 'Arkansas-Little Rock', 'UALR'],
  'UT Rio Grande Valley': ['UTRGV'],
  'Texas A&M-Corpus Christi': ['Texas A&M Corpus Christi', 'TAMU CC', 'TAMU-CC'],
  'Kansas City': ['UMKC'],
  'Omaha': ['Nebraska Omaha', 'Nebraska-Omaha'],
  'Miami (FL)': ['Miami'],
  'Miami (OH)': ['Miami Ohio', 'Miami (Ohio)']
};

function normalizeTeamKey(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[.'’]/g, '')
    .replace(/[()/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function buildConferenceTeamMatcher(teams: string[]): Map<string, string> {
  const matcher = new Map<string, string>();

  for (const team of teams) {
    const variants = new Set<string>([team]);
    for (const alias of CBB_TEAM_ALIASES[team] ?? []) variants.add(alias);

    const stripped = team.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
    if (stripped && stripped !== team) variants.add(stripped);

    for (const variant of variants) {
      const key = normalizeTeamKey(variant);
      if (!matcher.has(key)) matcher.set(key, team);
    }
  }

  return matcher;
}

export async function getContestsForIngest(contestId?: string): Promise<ContestRow[]> {
  if (contestId) {
    const result = await query<ContestRow>(
      `select id, name, type, season, starts_at, status, scoring_config
       from contests
       where id = $1`,
      [contestId]
    );
    return result.rows;
  }

  const result = await query<ContestRow>(
    `select id, name, type, season, starts_at, status, scoring_config
     from contests
     where status in ('OPEN', 'LOCKED')`
  );
  return result.rows;
}

function eachDateIso(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);

  for (let d = start; d <= end; d = new Date(d.getTime() + 24 * 60 * 60 * 1000)) {
    dates.push(d.toISOString().slice(0, 10));
  }

  return dates;
}

function inferWinner(status: string, game: NormalizedGame): string | null {
  const normalized = status.trim().toLowerCase();
  const isFinal =
    normalized.includes('final') ||
    normalized === 'off' ||
    normalized.startsWith('f/') ||
    normalized.startsWith('f ') ||
    normalized.includes('complete');

  if (!isFinal) {
    return null;
  }

  return game.winner;
}
function matchConferenceTeam(matcher: Map<string, string>, rawTeam: string): string | null {
  return matcher.get(normalizeTeamKey(rawTeam)) ?? null;
}

async function syncConferenceChampionsContest(contest: ContestRow): Promise<{ syncedGames: number; changedGameIds: string[] }> {
  const existing = await query<{
    id: string;
    provider_game_id: string;
    home_team: string;
    away_team: string;
    start_time: string;
    status: string;
    winner: string | null;
  }>(
    `select id, provider_game_id, home_team, away_team, start_time, status, winner
     from games
     where contest_id = $1
     order by provider_game_id`,
    [contest.id]
  );

  if (existing.rows.length === 0) return { syncedGames: 0, changedGameIds: [] };

  const bySlot = new Map(existing.rows.map((row) => [row.provider_game_id, row]));
  const changedGameIds = new Set<string>();
  const startDate = new Date(contest.starts_at);
  const endDate = new Date(startDate.getTime() + 16 * 24 * 60 * 60 * 1000);
  const today = new Date();
  const toDate = endDate < today ? endDate : today;
  const dates = eachDateIso(startDate.toISOString().slice(0, 10), toDate.toISOString().slice(0, 10));

  const sourceGames: NormalizedGame[] = [];
  for (const date of dates) {
    try {
      const daily = await fetchCbbGamesByDate(date);
      for (const game of daily) {
        sourceGames.push(normalizeCbbGame(game));
      }
    } catch (error) {
      console.warn('[game-ingest] conference feed unavailable for', date, error);
    }
  }

  let updated = 0;

  for (const conference of CONFERENCE_CHAMPION_SLOTS) {
    const slot = bySlot.get(conference.slot);
    if (!slot) continue;

    const matcher = buildConferenceTeamMatcher(conference.teams);
    const conferenceGames = sourceGames
      .map((game) => {
        const awayTeam = matchConferenceTeam(matcher, game.awayTeam);
        const homeTeam = matchConferenceTeam(matcher, game.homeTeam);
        if (!awayTeam || !homeTeam) return null;
        return {
          ...game,
          awayTeam,
          homeTeam,
          winner: game.winner ? matchConferenceTeam(matcher, game.winner) ?? game.winner : null
        };
      })
      .filter((game): game is NormalizedGame => game !== null)
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    if (conferenceGames.length === 0) continue;

    const finalGames = conferenceGames.filter((game) => inferWinner(game.status, game));
    if (finalGames.length === 0) continue;

    const latestFinal = finalGames[finalGames.length - 1];
    const latestFinalTime = new Date(latestFinal.startTime).getTime();
    const hasLaterPendingGame = conferenceGames.some(
      (game) => new Date(game.startTime).getTime() > latestFinalTime && inferWinner(game.status, game) === null
    );
    if (hasLaterPendingGame) continue;

    const winner = inferWinner(latestFinal.status, latestFinal);
    if (!winner) continue;

    const nextStatus = 'Final';
    const nextStartTime = latestFinal.startTime;
    if (slot.winner === winner && slot.status === nextStatus && slot.start_time === nextStartTime) {
      continue;
    }

    await query(
      `update games
       set away_team = $2,
           home_team = $3,
           start_time = $4,
           status = $5,
           home_score = $6,
           away_score = $7,
           winner = $8
       where id = $1`,
      [
        slot.id,
        latestFinal.awayTeam,
        latestFinal.homeTeam,
        latestFinal.startTime,
        nextStatus,
        latestFinal.homeScore,
        latestFinal.awayScore,
        winner
      ]
    );

    updated += 1;
    changedGameIds.add(slot.provider_game_id);
  }

  return { syncedGames: updated, changedGameIds: [...changedGameIds] };
}

function canonicalizeSoccerTeam(name: string): string {
  const normalized = name.trim();
  if (normalized === 'Atlético Madrid') return 'Atletico Madrid';
  if (normalized === 'Bodø/Glimt') return 'Bodo/Glimt';
  if (normalized === 'FC Barcelona') return 'Barcelona';
  if (normalized === 'PSG') return 'Paris Saint-Germain';
  return normalized;
}

function isPlaceholderTeam(name: string): boolean {
  const n = name.trim().toLowerCase();
  return n.startsWith('winner ') || n.startsWith('loser ');
}

async function upsertContestGames(contestId: string, games: NormalizedGame[]): Promise<{ syncedGames: number; changedGameIds: string[] }> {
  const client = await pool.connect();
  const changedGameIds: string[] = [];

  try {
    await client.query('begin');

    for (const game of games) {
      const winner = inferWinner(game.status, game);

      const existingByMatchup = await client.query<{ id: string }>(
        `select id
         from games
         where contest_id = $1
           and home_team = $2
           and away_team = $3
           and date(start_time at time zone 'UTC') = date($4::timestamptz at time zone 'UTC')
         order by start_time asc
         limit 1`,
        [contestId, game.homeTeam, game.awayTeam, game.startTime]
      );

      if (existingByMatchup.rows[0]) {
        await client.query(
          `update games
           set sport = $2,
               home_team = $3,
               away_team = $4,
               start_time = $5,
               status = $6,
               home_score = $7,
               away_score = $8,
               winner = $9
           where id = $1`,
          [
            existingByMatchup.rows[0].id,
            game.sport,
            game.homeTeam,
            game.awayTeam,
            game.startTime,
            game.status,
            game.homeScore,
            game.awayScore,
            winner
          ]
        );
        changedGameIds.push(game.providerGameId);
        continue;
      }

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
          randomUUID(),
          contestId,
          game.providerGameId,
          game.sport,
          game.homeTeam,
          game.awayTeam,
          game.startTime,
          game.status,
          game.homeScore,
          game.awayScore,
          winner
        ]
      );
      changedGameIds.push(game.providerGameId);
    }

    await client.query('commit');
    return { syncedGames: games.length, changedGameIds: [...new Set(changedGameIds)] };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function syncNflContest(contest: ContestRow): Promise<{ syncedGames: number; changedGameIds: string[] }> {
  const schedule = await fetchNflSchedules(contest.season);
  const normalized = schedule.map(normalizeNflSchedule);
  return upsertContestGames(contest.id, normalized);
}

async function syncNbaContest(contest: ContestRow): Promise<{ syncedGames: number; changedGameIds: string[] }> {
  const existingDatesResult = await query<{ gameDate: string }>(
    `select distinct to_char(start_time at time zone 'America/New_York', 'YYYY-MM-DD') as "gameDate"
     from games
     where contest_id = $1
     order by 1 asc`,
    [contest.id]
  );

  const dates = existingDatesResult.rows.length > 0
    ? existingDatesResult.rows.map((row) => row.gameDate)
    : [new Date(contest.starts_at).toISOString().slice(0, 10)];

  const all: NormalizedGame[] = [];
  for (const date of dates) {
    const games = await fetchNbaGamesByDate(date);
    for (const game of games) {
      all.push(normalizeNbaGame(game));
    }
  }

  return upsertContestGames(contest.id, all);
}

async function syncNhlContest(contest: ContestRow): Promise<{ syncedGames: number; changedGameIds: string[] }> {
  const existingDatesResult = await query<{ gameDate: string }>(
    `select distinct to_char(start_time at time zone 'America/New_York', 'YYYY-MM-DD') as "gameDate"
     from games
     where contest_id = $1
     order by 1 asc`,
    [contest.id]
  );

  const dates = existingDatesResult.rows.length > 0
    ? existingDatesResult.rows.map((row) => row.gameDate)
    : [new Date(contest.starts_at).toISOString().slice(0, 10)];

  const all: NormalizedGame[] = [];
  for (const date of dates) {
    const games = await fetchNhlGamesByDate(date);
    for (const game of games) {
      all.push(normalizeNhlGame(game));
    }
  }

  return upsertContestGames(contest.id, all);
}

async function syncBracketContest(contest: ContestRow, fromDate: string, toDate: string): Promise<{ syncedGames: number; changedGameIds: string[] }> {
  const dates = eachDateIso(fromDate, toDate);
  const all: NormalizedGame[] = [];

  for (const date of dates) {
    const daily = await fetchCbbGamesByDate(date);
    for (const game of daily) {
      all.push(normalizeCbbGame(game));
    }
  }

  return upsertContestGames(contest.id, all);
}

async function syncUefaBracketContest(contest: ContestRow): Promise<{ syncedGames: number; changedGameIds: string[] }> {
  const existing = await query<{
    id: string;
    provider_game_id: string;
    home_team: string;
    away_team: string;
    start_time: string;
    winner: string | null;
  }>(
    `select id, provider_game_id, home_team, away_team, start_time, winner
     from games
     where contest_id = $1
     order by provider_game_id`,
    [contest.id]
  );

  if (existing.rows.length === 0) return { syncedGames: 0, changedGameIds: [] };

  const bySlot = new Map(existing.rows.map((row) => [row.provider_game_id, row]));
  const changedGameIds = new Set<string>();
  const uefaSlotSources: Record<string, [string, string]> = {
    QF1: ['R16-1', 'R16-2'],
    QF2: ['R16-3', 'R16-4'],
    QF3: ['R16-5', 'R16-6'],
    QF4: ['R16-7', 'R16-8'],
    SF1: ['QF1', 'QF2'],
    SF2: ['QF3', 'QF4'],
    FINAL: ['SF1', 'SF2']
  };

  for (const [slot, [fromA, fromB]] of Object.entries(uefaSlotSources)) {
    const row = bySlot.get(slot);
    const srcA = bySlot.get(fromA);
    const srcB = bySlot.get(fromB);
    if (!row || !srcA || !srcB) continue;
    if (!srcA.winner || !srcB.winner) continue;

    const nextAway = canonicalizeSoccerTeam(srcA.winner);
    const nextHome = canonicalizeSoccerTeam(srcB.winner);

    if (row.away_team === nextAway && row.home_team === nextHome) continue;

    await query(
      `update games set away_team = $2, home_team = $3 where id = $1`,
      [row.id, nextAway, nextHome]
    );
    changedGameIds.add(row.provider_game_id);

    row.away_team = nextAway;
    row.home_team = nextHome;
  }

  const dates = Array.from(
    new Set(existing.rows.map((row) => new Date(row.start_time).toISOString().slice(0, 10)))
  );

  const sourceGames: NormalizedGame[] = [];
  for (const date of dates) {
    try {
      const daily = await fetchSoccerGamesByDate(date);
      for (const game of daily) {
        sourceGames.push(normalizeSoccerGame(game));
      }
    } catch (error) {
      console.warn('[game-ingest] soccer feed unavailable for', date, error);
    }
  }

  const byTeamsAndDay = new Map<string, NormalizedGame>();
  for (const game of sourceGames) {
    const home = canonicalizeSoccerTeam(game.homeTeam);
    const away = canonicalizeSoccerTeam(game.awayTeam);
    const day = new Date(game.startTime).toISOString().slice(0, 10);
    byTeamsAndDay.set(`${away}@@${home}@@${day}`, game);
    byTeamsAndDay.set(`${home}@@${away}@@${day}`, game);
  }

  let updated = 0;
  for (const slot of existing.rows) {
    if (isPlaceholderTeam(slot.home_team) || isPlaceholderTeam(slot.away_team)) {
      continue;
    }

    const home = canonicalizeSoccerTeam(slot.home_team);
    const away = canonicalizeSoccerTeam(slot.away_team);
    const day = new Date(slot.start_time).toISOString().slice(0, 10);
    const matched = byTeamsAndDay.get(`${away}@@${home}@@${day}`) ?? byTeamsAndDay.get(`${home}@@${away}@@${day}`);

    if (!matched) continue;

    const winner = inferWinner(matched.status, matched);

    await query(
      `update games
       set sport = $2,
           home_team = $3,
           away_team = $4,
           start_time = $5,
           status = $6,
           home_score = $7,
           away_score = $8,
           winner = $9
       where id = $1`,
      [
        slot.id,
        'SOCCER',
        canonicalizeSoccerTeam(matched.homeTeam),
        canonicalizeSoccerTeam(matched.awayTeam),
        matched.startTime,
        matched.status,
        matched.homeScore,
        matched.awayScore,
        winner
      ]
    );

    updated += 1;
    changedGameIds.add(slot.provider_game_id);
  }

  return { syncedGames: updated, changedGameIds: [...changedGameIds] };
}

export async function syncContestGames(args: {
  contestId?: string;
  bracketFromDate?: string;
  bracketToDate?: string;
  includeBracketContests?: boolean;
}): Promise<SyncContestResult[]> {
  const includeBracketContests = args.includeBracketContests ?? true;
  const contests = await getContestsForIngest(args.contestId);
  const results: SyncContestResult[] = [];

  for (const contest of contests) {
    try {
      const ingestDisabled = (contest.scoring_config as { ingestDisabled?: unknown } | null)?.ingestDisabled === true;
      if (ingestDisabled) {
        continue;
      }
      if (contest.type === 'PICKEM_NFL') {
        const synced = await syncNflContest(contest);
        results.push({ contestId: contest.id, contestName: contest.name, syncedGames: synced.syncedGames, changedGameIds: synced.changedGameIds });
        continue;
      }

      if (contest.type === 'PICKEM_NBA') {
        const synced = await syncNbaContest(contest);
        results.push({ contestId: contest.id, contestName: contest.name, syncedGames: synced.syncedGames, changedGameIds: synced.changedGameIds });
        continue;
      }

      if (contest.type === 'PICKEM_NHL') {
        const synced = await syncNhlContest(contest);
        results.push({ contestId: contest.id, contestName: contest.name, syncedGames: synced.syncedGames, changedGameIds: synced.changedGameIds });
        continue;
      }

      const lowerName = contest.name.trim().toLowerCase();
      if (lowerName.includes('conference tournament champions')) {
        const synced = await syncConferenceChampionsContest(contest);
        results.push({ contestId: contest.id, contestName: contest.name, syncedGames: synced.syncedGames, changedGameIds: synced.changedGameIds });
        continue;
      }

      if (!includeBracketContests) {
        continue;
      }
      if (lowerName.includes('uefa') || lowerName.includes('champions league')) {
        const synced = await syncUefaBracketContest(contest);
        results.push({ contestId: contest.id, contestName: contest.name, syncedGames: synced.syncedGames, changedGameIds: synced.changedGameIds });
        continue;
      }

      if (lowerName.includes('olympic') && lowerName.includes('hockey')) {
        continue;
      }


      const year = new Date(contest.starts_at).getUTCFullYear();
      const bracketFromDate = args.bracketFromDate ?? `${year}-03-01`;
      const bracketToDate = args.bracketToDate ?? `${year}-04-15`;
      const synced = await syncBracketContest(contest, bracketFromDate, bracketToDate);
      results.push({ contestId: contest.id, contestName: contest.name, syncedGames: synced.syncedGames, changedGameIds: synced.changedGameIds });
    } catch (error) {
      console.error(`[game-ingest] Failed syncing contest ${contest.id}:`, error);
    }
  }

  return results;
}
