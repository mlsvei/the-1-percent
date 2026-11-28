import { randomUUID } from 'node:crypto';
import { query } from '../db.js';
import type { NormalizedGame } from '../integrations/sportsdataio.js';

let streakSchemaEnsured = false;

export async function ensureStreakSchema() {
  if (streakSchemaEnsured) return;

  const constraint = await query<{ def: string }>(
    `select pg_get_constraintdef(oid) as def
       from pg_constraint
      where conrelid = 'contests'::regclass and conname = 'contests_type_check'`
  );
  if (!constraint.rows[0]?.def.includes('STREAK')) {
    await query('alter table contests drop constraint if exists contests_type_check');
    await query(
      `alter table contests add constraint contests_type_check
         check (type in ('PICKEM_NFL','PICKEM_NBA','PICKEM_NHL','BRACKET_NCAAM','STREAK'))`
    );
  }

  await query('alter table entries add column if not exists current_streak int not null default 0');
  await query('alter table entries add column if not exists best_streak int not null default 0');

  await query(`
    create table if not exists streak_picks (
      id uuid primary key,
      entry_id uuid not null references entries(id),
      game_id uuid not null references games(id),
      picked_winner text not null,
      status text not null check (status in ('ACTIVE','WON','LOST','FORFEITED')),
      streak_before int not null,
      created_at timestamptz not null default now(),
      resolved_at timestamptz
    )
  `);
  await query(
    `create unique index if not exists streak_picks_one_active_per_entry
       on streak_picks (entry_id) where status = 'ACTIVE'`
  );

  await query(`
    create table if not exists streak_props (
      id uuid primary key,
      game_id uuid not null references games(id),
      prop_type text not null check (prop_type in ('FIRST_TD','PLAYER_STAT_OU')),
      label text not null,
      option_a_key text not null,
      option_a_label text not null,
      option_b_key text not null,
      option_b_label text not null,
      stat_line numeric,
      player_name text,
      stat_key text,
      status text not null check (status in ('OPEN','GRADED','VOID')) default 'OPEN',
      result_key text,
      created_at timestamptz not null default now(),
      graded_at timestamptz
    )
  `);
  await query('create index if not exists streak_props_game_id_idx on streak_props (game_id)');
  await query('alter table streak_picks add column if not exists prop_id uuid references streak_props(id)');
  await query('alter table streak_props add column if not exists stat_category text');

  streakSchemaEnsured = true;
}

// Only NFL/NBA/NCAAM/Soccer games are reliably traceable back to a real ESPN
// event id in this app's ingest (see game-ingest.ts/sportsdataio.ts) - NHL
// never goes through ESPN, and NBA/NCAAM/Soccer silently fall back to a
// SportsDataIO id on days ESPN's feed fails. Returns null when the id can't
// be trusted as an ESPN event id, so prop creation/grading can fail safely
// instead of guessing.
export function resolveEspnGameId(providerGameId: string, sport: NormalizedGame['sport']): string | null {
  if (sport === 'NHL') return null;
  if (providerGameId.startsWith('ESPN-')) return providerGameId.slice('ESPN-'.length);
  if (/^\d+$/.test(providerGameId)) return providerGameId;
  return null;
}

export const ESPN_PROP_LEAGUE_PATH: Partial<Record<NormalizedGame['sport'], string>> = {
  NFL: 'football/nfl',
  NBA: 'basketball/nba',
  NCAAM: 'basketball/mens-college-basketball',
  SOCCER: 'soccer/uefa.champions'
};

type EspnSummary = {
  scoringPlays?: Array<{
    type?: { text?: string };
    team?: { displayName?: string; abbreviation?: string };
  }>;
  boxscore?: {
    players?: Array<{
      statistics?: Array<{
        name?: string;
        labels?: string[];
        keys?: string[];
        athletes?: Array<{ athlete?: { displayName?: string }; stats?: string[] }>;
      }>;
    }>;
  };
  header?: {
    competitions?: Array<{
      competitors?: Array<{ homeAway?: string; team?: { displayName?: string; abbreviation?: string } }>;
    }>;
  };
  leaders?: Array<{
    team?: { displayName?: string; abbreviation?: string };
    leaders?: Array<{
      name?: string;
      leaders?: Array<{ value?: number; athlete?: { displayName?: string } }>;
    }>;
  }>;
};

// Different sports in this app store team names differently (NFL: full display
// name like "Detroit Lions"; NBA/NCAAM: short abbreviation like "NY") - accept
// either ESPN field so the match works regardless of sport.
function teamMatches(storedName: string, team: { displayName?: string; abbreviation?: string } | undefined): boolean {
  if (!team) return false;
  return team.displayName === storedName || team.abbreviation === storedName;
}

export async function fetchEspnSummary(sport: NormalizedGame['sport'], espnGameId: string): Promise<EspnSummary> {
  const leaguePath = ESPN_PROP_LEAGUE_PATH[sport];
  if (!leaguePath) {
    throw new Error(`Props are not supported for sport ${sport}`);
  }
  const url = `https://site.api.espn.com/apis/site/v2/sports/${leaguePath}/summary?event=${espnGameId}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`ESPN summary request failed: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as EspnSummary;
}

type GameForProp = {
  id: string;
  providerGameId: string;
  sport: NormalizedGame['sport'];
  homeTeam: string;
  awayTeam: string;
  status: string;
};

// Confirms a game is really backed by ESPN data (not a SportsDataIO-fallback
// or synthetic id) before a prop is ever attached to it - lets prop creation
// fail loudly and immediately instead of a prop silently never grading.
export async function verifyEspnTraceable(game: GameForProp): Promise<void> {
  const espnGameId = resolveEspnGameId(game.providerGameId, game.sport);
  if (!espnGameId) {
    throw new Error(
      game.sport === 'NHL'
        ? 'Props are not supported for NHL games yet.'
        : "This game isn't sourced from ESPN play-by-play (it was likely ingested via the SportsDataIO fallback) and can't support props."
    );
  }

  let summary: EspnSummary;
  try {
    summary = await fetchEspnSummary(game.sport, espnGameId);
  } catch (error) {
    throw new Error(`Could not reach ESPN play-by-play data for this game: ${(error as Error).message}`);
  }

  const competitors = summary.header?.competitions?.[0]?.competitors ?? [];
  const matchesHome = competitors.some((c) => teamMatches(game.homeTeam, c.team));
  const matchesAway = competitors.some((c) => teamMatches(game.awayTeam, c.team));
  if (!matchesHome || !matchesAway) {
    throw new Error('ESPN play-by-play data for this event does not match this game\'s teams.');
  }
}

function findStatValue(summary: EspnSummary, playerName: string, statKey: string, category?: string | null): number | null {
  const groups = summary.boxscore?.players ?? [];
  for (const group of groups) {
    for (const cat of group.statistics ?? []) {
      if (category && cat.name !== category) continue;
      const labelIndex = (cat.labels ?? []).findIndex((label) => label.toLowerCase() === statKey.toLowerCase());
      const keyIndex = (cat.keys ?? []).findIndex((key) => key.toLowerCase() === statKey.toLowerCase());
      const index = labelIndex >= 0 ? labelIndex : keyIndex;
      if (index < 0) continue;
      for (const athlete of cat.athletes ?? []) {
        if (athlete.athlete?.displayName?.toLowerCase() === playerName.toLowerCase()) {
          // ESPN lists an inactive/DNP player with an empty stats array -
          // that's 0 of everything, not "unknown", so grade it as 0 rather
          // than leaving the prop stuck open forever.
          if ((athlete.stats?.length ?? 0) === 0) return 0;
          const raw = athlete.stats?.[index];
          const value = raw != null ? Number(raw) : NaN;
          if (!Number.isNaN(value)) return value;
        }
      }
    }
  }
  return null;
}

type OpenProp = {
  id: string;
  propType: 'FIRST_TD' | 'PLAYER_STAT_OU';
  optionAKey: string;
  optionBKey: string;
  statLine: number | null;
  playerName: string | null;
  statKey: string | null;
  statCategory: string | null;
  gameId: string;
  providerGameId: string;
  sport: NormalizedGame['sport'];
  gameStatus: string;
  homeTeam: string;
  awayTeam: string;
};

// Grades every still-OPEN prop for a contest against live ESPN data, one
// ESPN fetch per distinct game (only games that actually have an attached
// prop, never the whole day's slate). Rides the same per-cycle cadence the
// ingest worker already uses for game grading - no new scheduling.
export async function gradeOpenStreakProps(contestId: string): Promise<void> {
  const open = await query<OpenProp>(
    `select sp.id, sp.prop_type as "propType", sp.option_a_key as "optionAKey", sp.option_b_key as "optionBKey",
            sp.stat_line as "statLine", sp.player_name as "playerName", sp.stat_key as "statKey",
            sp.stat_category as "statCategory",
            g.id as "gameId", g.provider_game_id as "providerGameId", g.sport, g.status as "gameStatus",
            g.home_team as "homeTeam", g.away_team as "awayTeam"
       from streak_props sp
       join games g on g.id = sp.game_id
      where sp.status = 'OPEN' and g.contest_id = $1`,
    [contestId]
  );
  if (open.rows.length === 0) return;

  const byGame = new Map<string, OpenProp[]>();
  for (const prop of open.rows) {
    const list = byGame.get(prop.gameId) ?? [];
    list.push(prop);
    byGame.set(prop.gameId, list);
  }

  for (const [, props] of byGame) {
    const { providerGameId, sport, gameStatus, homeTeam, awayTeam } = props[0];
    const espnGameId = resolveEspnGameId(providerGameId, sport);
    if (!espnGameId) continue;

    let summary: EspnSummary;
    try {
      summary = await fetchEspnSummary(sport, espnGameId);
    } catch (error) {
      console.warn(`[streak-props] ESPN summary fetch failed for game ${providerGameId}:`, error);
      continue;
    }

    const isFinal = /final/i.test(gameStatus) || gameStatus.trim().toLowerCase() === 'ft';

    for (const prop of props) {
      if (prop.propType === 'FIRST_TD') {
        const firstTd = (summary.scoringPlays ?? []).find((play) => (play.type?.text ?? '').toLowerCase().includes('touchdown'));
        if (firstTd) {
          const resultKey = teamMatches(homeTeam, firstTd.team) ? homeTeam : teamMatches(awayTeam, firstTd.team) ? awayTeam : null;
          if (resultKey) {
            await query("update streak_props set status = 'GRADED', result_key = $1, graded_at = now() where id = $2", [resultKey, prop.id]);
          } else if (isFinal) {
            await query("update streak_props set status = 'VOID', graded_at = now() where id = $1", [prop.id]);
          }
        } else if (isFinal) {
          await query("update streak_props set status = 'VOID', graded_at = now() where id = $1", [prop.id]);
        }
        continue;
      }

      if (prop.propType === 'PLAYER_STAT_OU' && prop.playerName && prop.statKey && prop.statLine != null) {
        const value = findStatValue(summary, prop.playerName, prop.statKey, prop.statCategory);
        if (value == null) {
          console.warn(`[streak-props] Could not find stat "${prop.statKey}" for player "${prop.playerName}" in game ${providerGameId}`);
          continue;
        }
        if (value > prop.statLine) {
          await query("update streak_props set status = 'GRADED', result_key = $1, graded_at = now() where id = $2", [prop.optionAKey, prop.id]);
        } else if (isFinal) {
          await query("update streak_props set status = 'GRADED', result_key = $1, graded_at = now() where id = $2", [prop.optionBKey, prop.id]);
        }
      }
    }
  }
}

// Stable, deterministic ~50/50 split that never changes for a given game id -
// no extra bookkeeping needed to remember which games already got a prop vs
// stayed a plain game-winner pick.
function stableHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function shouldGetProp(gameId: string): boolean {
  return stableHash(gameId) % 2 === 0;
}

const NBA_STAT_CATEGORIES = [
  { leaderName: 'pointsPerGame', statKey: 'PTS', label: 'Points' },
  { leaderName: 'reboundsPerGame', statKey: 'REB', label: 'Rebounds' },
  { leaderName: 'assistsPerGame', statKey: 'AST', label: 'Assists' }
] as const;

// Scans every team's leader list for a given stat and returns whichever
// player has the higher season average - the more notable name in this
// specific matchup.
function findTopLeader(summary: EspnSummary, leaderName: string): { value: number; playerName: string } | null {
  let best: { value: number; playerName: string } | null = null;
  for (const teamGroup of summary.leaders ?? []) {
    const category = (teamGroup.leaders ?? []).find((c) => c.name === leaderName);
    const top = category?.leaders?.[0];
    if (top?.athlete?.displayName && typeof top.value === 'number' && !Number.isNaN(top.value)) {
      if (!best || top.value > best.value) {
        best = { value: top.value, playerName: top.athlete.displayName };
      }
    }
  }
  return best;
}

function roundDownToHalf(value: number): number {
  return Math.floor(value) + 0.5;
}

type AutoPropGame = {
  id: string;
  providerGameId: string;
  sport: NormalizedGame['sport'];
  homeTeam: string;
  awayTeam: string;
  week: number | null;
};

async function insertFirstTdProp(game: AutoPropGame): Promise<void> {
  await query(
    `insert into streak_props (id, game_id, prop_type, label, option_a_key, option_a_label, option_b_key, option_b_label, status)
     values ($1, $2, 'FIRST_TD', 'First Team to Score a TD', $3, $3, $4, $4, 'OPEN')`,
    [randomUUID(), game.id, game.homeTeam, game.awayTeam]
  );
}

async function insertPlayerStatProp(
  game: AutoPropGame,
  playerName: string,
  label: string,
  statKey: string,
  statCategory: string | null,
  line: number
): Promise<void> {
  await query(
    `insert into streak_props
       (id, game_id, prop_type, label, option_a_key, option_a_label, option_b_key, option_b_label, stat_line, player_name, stat_key, stat_category, status)
     values ($1, $2, 'PLAYER_STAT_OU', $3, 'OVER', $4, 'UNDER', $5, $6, $7, $8, $9, 'OPEN')`,
    [randomUUID(), game.id, `${playerName} - ${label}`, `Over ${line}`, `Under ${line}`, line, playerName, statKey, statCategory]
  );
}

async function generateAutoPropForGame(game: AutoPropGame): Promise<void> {
  const espnGameId = resolveEspnGameId(game.providerGameId, game.sport);
  if (!espnGameId) return;

  let summary: EspnSummary;
  try {
    summary = await fetchEspnSummary(game.sport, espnGameId);
  } catch (error) {
    console.warn(`[streak-props] auto-prop ESPN fetch failed for game ${game.providerGameId}:`, error);
    return;
  }

  if (game.sport === 'NFL') {
    const wantsFirstTd = stableHash(`${game.id}|type`) % 2 === 0;
    if (wantsFirstTd) {
      await insertFirstTdProp(game);
      return;
    }

    const leader = findTopLeader(summary, 'passingYards');
    if (!leader || !game.week || game.week <= 0) return;
    const perGame = leader.value / game.week;
    if (!Number.isFinite(perGame) || perGame <= 0) return;
    await insertPlayerStatProp(game, leader.playerName, 'Passing Yards', 'YDS', 'passing', roundDownToHalf(perGame));
    return;
  }

  // NBA / NCAAM
  const pick = NBA_STAT_CATEGORIES[stableHash(`${game.id}|stat`) % NBA_STAT_CATEGORIES.length];
  const leader = findTopLeader(summary, pick.leaderName);
  if (!leader || leader.value <= 0) return;
  await insertPlayerStatProp(game, leader.playerName, pick.label, pick.statKey, null, roundDownToHalf(leader.value));
}

// Automatically fills roughly half of a contest's current NFL/NBA/NCAAM slate
// with a prop instead of a plain game-winner pick - no admin action needed.
// Soccer/NHL games are left as game-winner picks only (see resolveEspnGameId).
export async function generateAutoPropsForContest(contestId: string): Promise<void> {
  const candidates = await query<AutoPropGame & { hasProp: boolean }>(
    `select g.id, g.provider_game_id as "providerGameId", g.sport, g.home_team as "homeTeam", g.away_team as "awayTeam", g.week,
            exists(select 1 from streak_props sp where sp.game_id = g.id) as "hasProp"
       from games g
      where g.contest_id = $1 and g.sport in ('NFL','NBA','NCAAM')`,
    [contestId]
  );

  for (const game of candidates.rows) {
    if (game.hasProp) continue;
    if (!shouldGetProp(game.id)) continue;
    await generateAutoPropForGame(game);
  }
}
