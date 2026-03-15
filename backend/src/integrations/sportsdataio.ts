import { config } from '../config.js';

type AnyRecord = Record<string, unknown>;

type NflScheduleItem = {
  GameID?: number;
  HomeTeam?: string;
  AwayTeam?: string;
  DateTime?: string;
  Status?: string;
  HomeScore?: number;
  AwayScore?: number;
  WinningTeam?: string;
} & AnyRecord;

type NbaGameItem = {
  GameID?: number;
  HomeTeam?: string;
  AwayTeam?: string;
  DateTime?: string;
  Status?: string;
  HomeTeamScore?: number;
  AwayTeamScore?: number;
} & AnyRecord;

type CbbGameItem = {
  GameID?: number;
  HomeTeam?: string;
  AwayTeam?: string;
  DateTime?: string;
  Status?: string;
  HomeTeamScore?: number;
  AwayTeamScore?: number;
} & AnyRecord;

type NhlGameItem = {
  GameID?: number;
  HomeTeam?: string;
  AwayTeam?: string;
  DateTime?: string;
  DateTimeUTC?: string;
  Status?: string;
  HomeTeamScore?: number;
  AwayTeamScore?: number;
  WinningTeam?: string;
} & AnyRecord;

type SoccerGameItem = {
  GameID?: number;
  HomeTeam?: string;
  AwayTeam?: string;
  HomeTeamName?: string;
  AwayTeamName?: string;
  DateTime?: string;
  DateTimeUTC?: string;
  Status?: string;
  HomeTeamScore?: number;
  AwayTeamScore?: number;
  WinningTeam?: string;
} & AnyRecord;

type EspnSoccerGameItem = SoccerGameItem;

function withTemplate(template: string, values: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(values)) {
    result = result.replaceAll(`{${key}}`, value);
  }
  return result;
}

function asRecord(value: unknown): AnyRecord {
  return typeof value === 'object' && value !== null ? (value as AnyRecord) : {};
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function pickNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function teamNameFrom(value: unknown): string | undefined {
  const rec = asRecord(value);
  return pickString(rec.name, rec.Name, rec.code, rec.Code, rec.abbreviation, rec.Abbreviation);
}

function extractTeams(item: AnyRecord): { homeTeam?: string; awayTeam?: string } {
  const teams = asRecord(item.teams);
  const homeObj = asRecord(teams.home);
  const visitorsObj = asRecord(teams.visitors);
  const awayObj = asRecord(teams.away);

  const homeTeam = pickString(item.HomeTeam, teamNameFrom(homeObj), teamNameFrom(asRecord(item.homeTeam)));
  const awayTeam = pickString(item.AwayTeam, teamNameFrom(visitorsObj), teamNameFrom(awayObj), teamNameFrom(asRecord(item.awayTeam)));

  return { homeTeam, awayTeam };
}

function scoreFromNode(scoreNode: unknown): number | undefined {
  const rec = asRecord(scoreNode);
  return pickNumber(rec.points, rec.total, rec.score, rec.Points, rec.Total, rec.Score);
}

function extractScores(item: AnyRecord): { homeScore: number | null; awayScore: number | null } {
  const scores = asRecord(item.scores);
  const homeScore = pickNumber(
    item.HomeScore,
    item.HomeTeamScore,
    scoreFromNode(scores.home),
    scoreFromNode(scores.visitors),
    scoreFromNode(scores.away)
  );
  const awayScore = pickNumber(
    item.AwayScore,
    item.AwayTeamScore,
    scoreFromNode(scores.away),
    scoreFromNode(scores.visitors)
  );

  return {
    homeScore: homeScore ?? null,
    awayScore: awayScore ?? null
  };
}

function toIsoString(raw: string, assumeUtc: boolean): string {
  const hasOffset = /(?:Z|[+\-]\d{2}:?\d{2})$/i.test(raw);
  const value = assumeUtc && !hasOffset ? `${raw}Z` : raw;
  return new Date(value).toISOString();
}

function extractDateTime(item: AnyRecord): string {
  const dateNode = item.date;
  const dateRec = asRecord(dateNode);

  const rawUtc = pickString(
    item.DateTimeUTC,
    item.dateTimeUTC as string,
    item.DateUtc as string,
    item.dateUtc as string,
    dateRec.utc,
    dateRec.UTC,
    dateRec.startUTC,
    dateRec.StartUTC
  );

  const raw = pickString(
    item.DateTime,
    item.date as string,
    dateRec.start,
    dateRec.Start,
    item.startTime as string,
    item.StartTime as string
  );

  if (rawUtc) {
    return toIsoString(rawUtc, true);
  }

  return raw ? toIsoString(raw, false) : new Date(0).toISOString();
}

function extractStatus(item: AnyRecord): string {
  const statusRec = asRecord(item.status);
  return pickString(item.Status, statusRec.long, statusRec.short, statusRec.Long, statusRec.Short) ?? 'Scheduled';
}

function inferWinnerFromScores(homeTeam: string | undefined, awayTeam: string | undefined, homeScore: number | null, awayScore: number | null): string | null {
  if (!homeTeam || !awayTeam) return null;
  if (typeof homeScore !== 'number' || typeof awayScore !== 'number') return null;
  if (homeScore === awayScore) return null;
  return homeScore > awayScore ? homeTeam : awayTeam;
}

const NBA_TEAM_ALIASES: Record<string, string> = {
  'LA Clippers': 'Los Angeles Clippers',
  'LA Lakers': 'Los Angeles Lakers',
  'NY Knicks': 'New York Knicks',
  'GS Warriors': 'Golden State Warriors',
  'NO Pelicans': 'New Orleans Pelicans',
  'SA Spurs': 'San Antonio Spurs'
};

function canonicalizeNbaTeamName(name: string): string {
  return NBA_TEAM_ALIASES[name] ?? name;
}

const NHL_TEAM_CODE_ALIASES: Record<string, string> = {
  NJD: 'NJ',
  WSH: 'WAS',
  TBL: 'TB',
  VGK: 'VEG',
  SJS: 'SJ',
  LAK: 'LA',
  MTL: 'MON',
  MON: 'MON',
  UHC: 'UTA',
  UTAH: 'UTA'
};

function canonicalizeNhlTeamCode(code: string): string {
  const upper = code.trim().toUpperCase();
  return NHL_TEAM_CODE_ALIASES[upper] ?? upper;
}

function isLikelyFinalStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return (
    normalized.includes('final') ||
    normalized === 'off' ||
    normalized.startsWith('f/') ||
    normalized.startsWith('f ') ||
    normalized.includes('complete')
  );
}

const SOCCER_TEAM_ALIASES: Record<string, string> = {
  'Atlético Madrid': 'Atletico Madrid',
  'Bodø/Glimt': 'Bodo/Glimt',
  'FC Barcelona': 'Barcelona',
  PSG: 'Paris Saint-Germain'
};

function canonicalizeSoccerTeamName(name: string): string {
  return SOCCER_TEAM_ALIASES[name] ?? name;
}

function unwrapArrayPayload<T>(json: unknown): T[] {
  if (Array.isArray(json)) return json as T[];

  const body = asRecord(json);
  if (Array.isArray(body.response)) return body.response as T[];
  if (Array.isArray(body.data)) return body.data as T[];
  if (Array.isArray(body.games)) return body.games as T[];

  return [];
}

async function getJsonArray<T>(url: string): Promise<T[]> {
  if (!config.sportsDataIo.apiKey) {
    throw new Error('SPORTSDATAAPI_KEY (or SPORTSDATAIO_API_KEY) is required for ingest');
  }

  const response = await fetch(url, {
    headers: {
      // SportsDataAPI
      'x-apisports-key': config.sportsDataIo.apiKey,
      // SportsDataIO (backward compatible)
      'Ocp-Apim-Subscription-Key': config.sportsDataIo.apiKey
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Sports feed request failed: ${response.status} ${response.statusText} - ${text}`);
  }

  const body = (await response.json()) as unknown;
  return unwrapArrayPayload<T>(body);
}

export async function fetchNflSchedules(season: number): Promise<NflScheduleItem[]> {
  const url = withTemplate(config.sportsDataIo.nflSchedulesUrlTemplate, { season: String(season) });
  return getJsonArray<NflScheduleItem>(url);
}

async function fetchEspnNbaGamesByDate(date: string): Promise<NbaGameItem[]> {
  const yyyymmdd = date.replaceAll('-', '');
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${yyyymmdd}`;

  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ESPN NBA request failed: ${response.status} ${response.statusText} - ${text}`);
  }

  const body = asRecord((await response.json()) as unknown);
  const events = Array.isArray(body.events) ? (body.events as AnyRecord[]) : [];

  return events.map((event) => {
    const competition = Array.isArray(event.competitions) ? asRecord(event.competitions[0]) : {};
    const competitors = Array.isArray(competition.competitors) ? (competition.competitors as AnyRecord[]) : [];

    const home = competitors.find((team) => String(team.homeAway ?? '').toLowerCase() === 'home') ?? {};
    const away = competitors.find((team) => String(team.homeAway ?? '').toLowerCase() === 'away') ?? {};

    const homeName = pickString(asRecord(home.team).displayName, asRecord(home.team).name, home.displayName, home.name) ?? 'Unknown Home';
    const awayName = pickString(asRecord(away.team).displayName, asRecord(away.team).name, away.displayName, away.name) ?? 'Unknown Away';

    const homeScore = Number.isFinite(Number(home.score)) ? Number(home.score) : undefined;
    const awayScore = Number.isFinite(Number(away.score)) ? Number(away.score) : undefined;

    const statusObj = asRecord(competition.status);
    const statusType = asRecord(statusObj.type);
    const status = pickString(statusObj.type as string, statusType.detail, statusType.description, statusType.state) ?? 'Scheduled';

    return {
      id: pickString(event.id, competition.id) ?? `${awayName}-${homeName}-${date}`,
      HomeTeam: homeName,
      AwayTeam: awayName,
      DateTime: pickString(competition.date, event.date) ?? new Date(0).toISOString(),
      Status: status,
      HomeTeamScore: homeScore,
      AwayTeamScore: awayScore
    } as NbaGameItem;
  });
}

async function fetchEspnCbbGamesByDate(date: string): Promise<CbbGameItem[]> {
  const yyyymmdd = date.replaceAll('-', '');
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${yyyymmdd}`;

  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ESPN CBB request failed: ${response.status} ${response.statusText} - ${text}`);
  }

  const body = asRecord((await response.json()) as unknown);
  const events = Array.isArray(body.events) ? (body.events as AnyRecord[]) : [];

  return events.map((event) => {
    const competition = Array.isArray(event.competitions) ? asRecord(event.competitions[0]) : {};
    const competitors = Array.isArray(competition.competitors) ? (competition.competitors as AnyRecord[]) : [];

    const home = competitors.find((team) => String(team.homeAway ?? '').toLowerCase() === 'home') ?? {};
    const away = competitors.find((team) => String(team.homeAway ?? '').toLowerCase() === 'away') ?? {};

    const homeName = pickString(asRecord(home.team).displayName, asRecord(home.team).name, home.displayName, home.name) ?? 'Unknown Home';
    const awayName = pickString(asRecord(away.team).displayName, asRecord(away.team).name, away.displayName, away.name) ?? 'Unknown Away';

    const homeScore = Number.isFinite(Number(home.score)) ? Number(home.score) : undefined;
    const awayScore = Number.isFinite(Number(away.score)) ? Number(away.score) : undefined;

    const statusObj = asRecord(competition.status);
    const statusType = asRecord(statusObj.type);
    const status = pickString(statusObj.type as string, statusType.detail, statusType.description, statusType.state) ?? 'Scheduled';

    return {
      GameID: Number(pickString(event.id, competition.id) ?? String(Date.now())),
      HomeTeam: homeName,
      AwayTeam: awayName,
      DateTime: pickString(competition.date, event.date) ?? new Date(0).toISOString(),
      Status: status,
      HomeTeamScore: homeScore,
      AwayTeamScore: awayScore
    } as CbbGameItem;
  });
}

export async function fetchNbaGamesByDate(date: string): Promise<NbaGameItem[]> {
  if (config.sportsDataIo.apiKey) {
    const url = withTemplate(config.sportsDataIo.nbaGamesByDateUrlTemplate, { date });
    return getJsonArray<NbaGameItem>(url);
  }

  return fetchEspnNbaGamesByDate(date);
}

export async function fetchCbbGamesByDate(date: string): Promise<CbbGameItem[]> {
  // ESPN is more reliable for public CBB scoreboard data in this environment.
  try {
    const espn = await fetchEspnCbbGamesByDate(date);
    if (espn.length > 0) return espn;
  } catch (error) {
    console.warn('[espn] CBB feed failed, trying SportsData fallback:', error);
  }

  if (config.sportsDataIo.apiKey) {
    const url = withTemplate(config.sportsDataIo.cbbGamesByDateUrlTemplate, { date });
    return getJsonArray<CbbGameItem>(url);
  }

  return [];
}

async function fetchEspnSoccerGamesByDate(date: string): Promise<EspnSoccerGameItem[]> {
  const yyyymmdd = date.replaceAll('-', '');
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/scoreboard?dates=${yyyymmdd}`;

  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ESPN soccer request failed: ${response.status} ${response.statusText} - ${text}`);
  }

  const body = asRecord((await response.json()) as unknown);
  const events = Array.isArray(body.events) ? (body.events as AnyRecord[]) : [];

  return events.map((event) => {
    const competition = Array.isArray(event.competitions) ? asRecord(event.competitions[0]) : {};
    const competitors = Array.isArray(competition.competitors) ? (competition.competitors as AnyRecord[]) : [];

    const home = competitors.find((team) => String(team.homeAway ?? '').toLowerCase() === 'home') ?? {};
    const away = competitors.find((team) => String(team.homeAway ?? '').toLowerCase() === 'away') ?? {};

    const homeName = pickString(asRecord(home.team).displayName, asRecord(home.team).name, home.displayName, home.name) ?? 'Unknown Home';
    const awayName = pickString(asRecord(away.team).displayName, asRecord(away.team).name, away.displayName, away.name) ?? 'Unknown Away';

    const homeScore = Number.isFinite(Number(home.score)) ? Number(home.score) : undefined;
    const awayScore = Number.isFinite(Number(away.score)) ? Number(away.score) : undefined;

    const statusObj = asRecord(competition.status);
    const statusType = asRecord(statusObj.type);
    const status = pickString(statusObj.type as string, statusType.detail, statusType.description, statusType.state) ?? 'Scheduled';

    const winner =
      String(asRecord(home).winner ?? '').toLowerCase() === 'true'
        ? homeName
        : String(asRecord(away).winner ?? '').toLowerCase() === 'true'
          ? awayName
          : undefined;

    return {
      GameID: Number(pickString(event.id, competition.id) ?? String(Date.now())),
      HomeTeam: homeName,
      AwayTeam: awayName,
      DateTime: pickString(competition.date, event.date) ?? new Date(0).toISOString(),
      Status: status,
      HomeTeamScore: homeScore,
      AwayTeamScore: awayScore,
      WinningTeam: winner
    } as EspnSoccerGameItem;
  });
}

export async function fetchSoccerGamesByDate(date: string): Promise<SoccerGameItem[]> {
  if (config.sportsDataIo.apiKey) {
    try {
      // Use CompetitionDetails/UCL because this key has access to that endpoint.
      const url = 'https://api.sportsdata.io/v4/soccer/scores/json/CompetitionDetails/UCL';
      const response = await fetch(url, {
        headers: {
          'x-apisports-key': config.sportsDataIo.apiKey,
          'Ocp-Apim-Subscription-Key': config.sportsDataIo.apiKey
        }
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error('Sports feed request failed: ' + response.status + ' ' + response.statusText + ' - ' + text);
      }

      const body = asRecord((await response.json()) as unknown);
      const games = Array.isArray(body.Games) ? (body.Games as SoccerGameItem[]) : [];
      const filtered = games.filter((game) => {
        const rec = asRecord(game);
        const dt = pickString(rec.DateTime, rec.DateTimeUTC);
        if (!dt) return false;
        return new Date(dt).toISOString().slice(0, 10) === date;
      });

      if (filtered.length > 0) return filtered;
    } catch (error) {
      console.warn('[sportsdataio] soccer feed failed, trying ESPN fallback:', error);
    }
  }

  return fetchEspnSoccerGamesByDate(date);
}

type NhlOfficialNormalized = {
  awayTeam: string;
  homeTeam: string;
  awayScore: number | null;
  homeScore: number | null;
  status: string;
  winner: string | null;
  startTimeUtc: string | null;
};

async function fetchNhlOfficialByDate(date: string): Promise<NhlOfficialNormalized[]> {
  const url =     'https://api-web.nhle.com/v1/score/' + encodeURIComponent(date);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`NHL official request failed: ${response.status} ${response.statusText}`);
  }

  const body = asRecord((await response.json()) as unknown);
  const games = Array.isArray(body.games) ? (body.games as AnyRecord[]) : [];

  return games.map((game) => {
    const away = asRecord(game.awayTeam);
    const home = asRecord(game.homeTeam);
    const awayTeam = canonicalizeNhlTeamCode(String(pickString(away.abbrev, away.abbreviation) ?? ''));
    const homeTeam = canonicalizeNhlTeamCode(String(pickString(home.abbrev, home.abbreviation) ?? ''));

    const awayScoreRaw = pickNumber(away.score);
    const homeScoreRaw = pickNumber(home.score);
    const awayScore = awayScoreRaw ?? null;
    const homeScore = homeScoreRaw ?? null;

    const gameState = String(pickString(game.gameState, game.gameScheduleState) ?? 'Scheduled');
    const status = isLikelyFinalStatus(gameState) ? 'Final' : gameState;

    const winner =
      typeof awayScore === 'number' && typeof homeScore === 'number'
        ? awayScore === homeScore
          ? null
          : awayScore > homeScore
            ? awayTeam
            : homeTeam
        : null;

    return {
      awayTeam,
      homeTeam,
      awayScore,
      homeScore,
      status,
      winner,
      startTimeUtc: pickString(game.startTimeUTC, game.startTimeUtc) ?? null
    };
  });
}

export async function fetchNhlGamesByDate(date: string): Promise<NhlGameItem[]> {
  const url = withTemplate(config.sportsDataIo.nhlGamesByDateUrlTemplate, { date });
  const primary = await getJsonArray<NhlGameItem>(url);

  let officialByMatch = new Map<string, NhlOfficialNormalized>();
  try {
    const official = await fetchNhlOfficialByDate(date);
    officialByMatch = new Map(
      official.map((game) => [`${game.awayTeam}@${game.homeTeam}`, game])
    );
  } catch (error) {
    console.warn('[sportsdataio] NHL official fallback unavailable:', error);
  }

  return primary.map((item) => {
    const awayTeam = canonicalizeNhlTeamCode(String(item.AwayTeam ?? ''));
    const homeTeam = canonicalizeNhlTeamCode(String(item.HomeTeam ?? ''));
    const key = `${awayTeam}@${homeTeam}`;
    const official = officialByMatch.get(key);

    if (!official) {
      return {
        ...item,
        AwayTeam: awayTeam || item.AwayTeam,
        HomeTeam: homeTeam || item.HomeTeam
      };
    }

    const next: NhlGameItem = {
      ...item,
      AwayTeam: awayTeam || item.AwayTeam,
      HomeTeam: homeTeam || item.HomeTeam
    };

    const primaryHasMeaningfulScore =
      typeof item.AwayTeamScore === 'number' &&
      typeof item.HomeTeamScore === 'number' &&
      (item.AwayTeamScore !== 0 || item.HomeTeamScore !== 0);

    if (!primaryHasMeaningfulScore && (official.awayScore !== null || official.homeScore !== null)) {
      next.AwayTeamScore = official.awayScore ?? next.AwayTeamScore;
      next.HomeTeamScore = official.homeScore ?? next.HomeTeamScore;
    }

    if (!next.WinningTeam && official.winner) {
      next.WinningTeam = official.winner;
    }

    if ((String(next.Status ?? '').trim().toLowerCase() === 'scheduled' || !next.Status) && official.status) {
      next.Status = official.status;
    }

    if (!next.DateTimeUTC && official.startTimeUtc) {
      next.DateTimeUTC = official.startTimeUtc;
    }

    return next;
  });
}

export type NormalizedGame = {
  providerGameId: string;
  sport: 'NFL' | 'NBA' | 'NCAAM' | 'NHL' | 'SOCCER';
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  winner: string | null;
};

function normalizeCommonGame(item: AnyRecord): {
  providerGameId: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  winner: string | null;
} {
  const { homeTeam, awayTeam } = extractTeams(item);
  const { homeScore, awayScore } = extractScores(item);

  const providerGameId = String(
    pickString(item.GameID as string, item.id as string, asRecord(item.game).id as string, item.fixture_id as string) ??
      pickNumber(item.GameID, item.id, asRecord(item.game).id, item.fixture_id) ??
      `${homeTeam ?? 'HOME'}-${awayTeam ?? 'AWAY'}-${extractDateTime(item)}`
  );

  const winner =
    pickString(item.WinningTeam, item.winner as string, teamNameFrom(asRecord(item.winnerTeam)), teamNameFrom(asRecord(asRecord(item.teams).winner))) ??
    inferWinnerFromScores(homeTeam, awayTeam, homeScore, awayScore);

  return {
    providerGameId,
    homeTeam: homeTeam ?? 'Unknown Home',
    awayTeam: awayTeam ?? 'Unknown Away',
    startTime: extractDateTime(item),
    status: extractStatus(item),
    homeScore,
    awayScore,
    winner
  };
}

export function normalizeNflSchedule(item: NflScheduleItem): NormalizedGame {
  const normalized = normalizeCommonGame(asRecord(item));
  return { ...normalized, sport: 'NFL' };
}

export function normalizeNbaGame(item: NbaGameItem): NormalizedGame {
  const normalized = normalizeCommonGame(asRecord(item));
  const homeTeam = canonicalizeNbaTeamName(normalized.homeTeam);
  const awayTeam = canonicalizeNbaTeamName(normalized.awayTeam);
  let winner = normalized.winner;
  if (winner) {
    winner = canonicalizeNbaTeamName(winner);
  }
  return { ...normalized, sport: 'NBA', homeTeam, awayTeam, winner };
}

export function normalizeCbbGame(item: CbbGameItem): NormalizedGame {
  const normalized = normalizeCommonGame(asRecord(item));
  return { ...normalized, sport: 'NCAAM' };
}

export function normalizeNhlGame(item: NhlGameItem): NormalizedGame {
  const normalized = normalizeCommonGame(asRecord(item));
  return { ...normalized, sport: 'NHL' };
}

export function normalizeSoccerGame(item: SoccerGameItem): NormalizedGame {
  const record = asRecord(item);
  const merged: AnyRecord = {
    ...record,
    HomeTeam: pickString(record.HomeTeam, record.HomeTeamName),
    AwayTeam: pickString(record.AwayTeam, record.AwayTeamName),
    DateTimeUTC: pickString(record.DateTimeUTC, record.DateTime)
  };

  const normalized = normalizeCommonGame(merged);
  const homeTeam = canonicalizeSoccerTeamName(normalized.homeTeam);
  const awayTeam = canonicalizeSoccerTeamName(normalized.awayTeam);
  const winner = normalized.winner ? canonicalizeSoccerTeamName(normalized.winner) : null;
  return { ...normalized, sport: 'SOCCER', homeTeam, awayTeam, winner };
}
