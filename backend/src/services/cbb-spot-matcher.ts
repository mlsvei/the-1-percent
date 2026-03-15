import { fetchCbbGamesByDate, normalizeCbbGame, type NormalizedGame } from '../integrations/sportsdataio.js';

type SpotFactors = {
  away_revenge: number;
  home_lookahead: number;
  home_letdown: number;
  away_dog_value: number;
  home_fatigue: number;
  away_sharp_money: number;
  away_rlm: number;
  away_public_faded: number;
  away_slow_pace: number;
  home_travel_fatigue: number;
};

export type SpotMatchGame = {
  rowId: number;
  gameDate: string;
  awayTeam: string;
  homeTeam: string;
  marketSpread: number;
  score: number;
  qualified: boolean;
  factors: SpotFactors;
  unavailableFactors: string[];
};

export type SpotMatchResponse = {
  from: string;
  to: string;
  days: number;
  threshold: number;
  weights: SpotFactors;
  counts: {
    totalUpcoming: number;
    qualified: number;
    historicalFinalsUsed: number;
  };
  games: SpotMatchGame[];
};

type CbbGameWithRaw = {
  normalized: NormalizedGame;
  raw: Record<string, unknown>;
};

const SPOT_MODEL_WEIGHTS: SpotFactors = {
  away_revenge: 2.3046,
  home_lookahead: 2.4578,
  home_letdown: 1.4895,
  away_dog_value: 0.7955,
  home_fatigue: 1.0238,
  away_sharp_money: 1.1216,
  away_rlm: 1.6674,
  away_public_faded: 0.2132,
  away_slow_pace: 0.0571,
  home_travel_fatigue: 2.4945
};

export const SPOT_MODEL_THRESHOLD = 5.2049;

const DAY_CACHE_TTL_MS = 10 * 60 * 1000;
const RANGE_CACHE_TTL_MS = 2 * 60 * 1000;
const MAX_PARALLEL_DAY_FETCHES = 12;
const DAY_FETCH_TIMEOUT_MS = 5000;

const cbbDayCache = new Map<string, { expiresAt: number; games: CbbGameWithRaw[] }>();
const spotRangeCache = new Map<string, { expiresAt: number; response: SpotMatchResponse }>();

function toDateOnly(iso: string): string {
  return iso.slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function dateRangeInclusive(start: Date, end: Date): string[] {
  const out: string[] = [];
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endDate = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));

  while (cursor.getTime() <= endDate.getTime()) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor = addDays(cursor, 1);
  }

  return out;
}

function isFinalStatus(status: string): boolean {
  const s = status.trim().toLowerCase();
  return s.includes('final') || s.includes('complete') || s === 'closed' || s === 'off';
}

function parseSpread(raw: Record<string, unknown>): number {
  const keys = [
    'PointSpread',
    'pointSpread',
    'HomePointSpread',
    'homePointSpread',
    'Spread',
    'spread',
    'PregameOdds'
  ];

  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'object' && value !== null) {
      const rec = value as Record<string, unknown>;
      const nested = [rec.PointSpreadHome, rec.PointSpreadAway, rec.PointSpread, rec.Spread, rec.spread];
      for (const n of nested) {
        if (typeof n === 'number' && Number.isFinite(n)) {
          return n;
        }
      }
    }
  }

  return 0;
}

function scoreGame(factors: SpotFactors): number {
  return (
    factors.away_revenge * SPOT_MODEL_WEIGHTS.away_revenge +
    factors.home_lookahead * SPOT_MODEL_WEIGHTS.home_lookahead +
    factors.home_letdown * SPOT_MODEL_WEIGHTS.home_letdown +
    factors.away_dog_value * SPOT_MODEL_WEIGHTS.away_dog_value +
    factors.home_fatigue * SPOT_MODEL_WEIGHTS.home_fatigue +
    factors.away_sharp_money * SPOT_MODEL_WEIGHTS.away_sharp_money +
    factors.away_rlm * SPOT_MODEL_WEIGHTS.away_rlm +
    factors.away_public_faded * SPOT_MODEL_WEIGHTS.away_public_faded +
    factors.away_slow_pace * SPOT_MODEL_WEIGHTS.away_slow_pace +
    factors.home_travel_fatigue * SPOT_MODEL_WEIGHTS.home_travel_fatigue
  );
}

function gameMarginForTeam(game: NormalizedGame, team: string): number {
  if (game.homeScore === null || game.awayScore === null) return 0;
  if (team === game.homeTeam) return game.homeScore - game.awayScore;
  if (team === game.awayTeam) return game.awayScore - game.homeScore;
  return 0;
}

function gamesInPastDays(games: NormalizedGame[], team: string, beforeIso: string, days: number): number {
  const beforeMs = new Date(beforeIso).getTime();
  const fromMs = beforeMs - days * 24 * 60 * 60 * 1000;
  return games.filter((g) => {
    if (g.homeTeam !== team && g.awayTeam !== team) return false;
    const t = new Date(g.startTime).getTime();
    return t < beforeMs && t >= fromMs;
  }).length;
}

function findLastTeamGame(games: NormalizedGame[], team: string, beforeIso: string): NormalizedGame | null {
  const beforeMs = new Date(beforeIso).getTime();
  const filtered = games.filter((g) => (g.homeTeam === team || g.awayTeam === team) && new Date(g.startTime).getTime() < beforeMs);
  if (filtered.length === 0) return null;
  filtered.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  return filtered[0] ?? null;
}

function restDays(lastGame: NormalizedGame | null, currentIso: string): number {
  if (!lastGame) return 7;
  const diffMs = new Date(currentIso).getTime() - new Date(lastGame.startTime).getTime();
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)) - 1);
}

function getTeamStrength(finalGames: NormalizedGame[]): Map<string, number> {
  const wins = new Map<string, number>();
  const games = new Map<string, number>();

  for (const g of finalGames) {
    const teams = [g.homeTeam, g.awayTeam];
    for (const t of teams) {
      games.set(t, (games.get(t) ?? 0) + 1);
    }

    if (g.homeScore !== null && g.awayScore !== null) {
      if (g.homeScore > g.awayScore) wins.set(g.homeTeam, (wins.get(g.homeTeam) ?? 0) + 1);
      if (g.awayScore > g.homeScore) wins.set(g.awayTeam, (wins.get(g.awayTeam) ?? 0) + 1);
    }
  }

  const out = new Map<string, number>();
  for (const [team, nGames] of games.entries()) {
    out.set(team, nGames === 0 ? 0.5 : (wins.get(team) ?? 0) / nGames);
  }

  return out;
}

function findNextTeamGame(games: NormalizedGame[], team: string, afterIso: string): NormalizedGame | null {
  const afterMs = new Date(afterIso).getTime();
  const filtered = games.filter((g) => (g.homeTeam === team || g.awayTeam === team) && new Date(g.startTime).getTime() > afterMs);
  if (filtered.length === 0) return null;
  filtered.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  return filtered[0] ?? null;
}

function findLastHeadToHead(finalGames: NormalizedGame[], awayTeam: string, homeTeam: string, beforeIso: string): NormalizedGame | null {
  const beforeMs = new Date(beforeIso).getTime();
  const filtered = finalGames.filter((g) => {
    const matchup = (g.homeTeam === homeTeam && g.awayTeam === awayTeam) || (g.homeTeam === awayTeam && g.awayTeam === homeTeam);
    return matchup && new Date(g.startTime).getTime() < beforeMs;
  });

  if (filtered.length === 0) return null;
  filtered.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  return filtered[0] ?? null;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function cloneGames(games: CbbGameWithRaw[]): CbbGameWithRaw[] {
  return games.map((g) => ({
    normalized: { ...g.normalized },
    raw: { ...g.raw }
  }));
}

function cloneSpotResponse(response: SpotMatchResponse): SpotMatchResponse {
  return {
    ...response,
    weights: { ...response.weights },
    counts: { ...response.counts },
    games: response.games.map((g) => ({
      ...g,
      factors: { ...g.factors },
      unavailableFactors: [...g.unavailableFactors]
    }))
  };
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return [];
  const size = Math.max(1, Math.min(limit, items.length));
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const idx = nextIndex;
      nextIndex += 1;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx]);
    }
  }

  await Promise.all(Array.from({ length: size }, () => runWorker()));
  return results;
}

async function fetchCbbDay(date: string): Promise<CbbGameWithRaw[]> {
  const now = Date.now();
  const cached = cbbDayCache.get(date);
  if (cached && cached.expiresAt > now) {
    return cloneGames(cached.games);
  }

  const rawItems = await withTimeout(fetchCbbGamesByDate(date), DAY_FETCH_TIMEOUT_MS, `fetchCbbGamesByDate(${date})`);
  const games = rawItems.map((rawItem) => {
    const rawRec = rawItem as unknown as Record<string, unknown>;
    const normalized = normalizeCbbGame(rawItem as any);
    return { normalized, raw: rawRec } as CbbGameWithRaw;
  });

  cbbDayCache.set(date, {
    expiresAt: now + DAY_CACHE_TTL_MS,
    games: cloneGames(games)
  });

  return games;
}

async function fetchCbbRange(start: Date, end: Date): Promise<CbbGameWithRaw[]> {
  const days = dateRangeInclusive(start, end);
  const perDay = await mapWithConcurrency(days, MAX_PARALLEL_DAY_FETCHES, async (day) => {
    try {
      return await fetchCbbDay(day);
    } catch (error) {
      console.warn('[spot-matcher] skipping day fetch after failure:', day, error);
      return [];
    }
  });
  const out = perDay.flat();

  const deduped = new Map<string, CbbGameWithRaw>();
  for (const game of out) {
    const key = `${game.normalized.providerGameId}::${toDateOnly(game.normalized.startTime)}`;
    deduped.set(key, game);
  }

  return [...deduped.values()];
}

export async function buildUpcomingSpotMatches(params: { from: string; days: number; historyDays: number }): Promise<SpotMatchResponse> {
  const rangeKey = `${params.from}::${params.days}::${params.historyDays}`;
  const now = Date.now();
  const cachedRange = spotRangeCache.get(rangeKey);
  if (cachedRange && cachedRange.expiresAt > now) {
    return cloneSpotResponse(cachedRange.response);
  }

  const fromDate = new Date(`${params.from}T00:00:00.000Z`);
  const toDate = addDays(fromDate, params.days - 1);
  const fetchStart = addDays(fromDate, -Math.max(0, params.historyDays));
  const fetchEnd = addDays(toDate, 4);

  const allGames = await fetchCbbRange(fetchStart, fetchEnd);
  const normalizedAll = allGames.map((g) => g.normalized);

  const finals = normalizedAll.filter((g) => isFinalStatus(g.status));
  const strength = getTeamStrength(finals);

  const upcoming = allGames
    .filter((g) => {
      if (isFinalStatus(g.normalized.status)) return false;
      const day = toDateOnly(g.normalized.startTime);
      return day >= params.from && day <= toDateOnly(toDate.toISOString());
    })
    .sort((a, b) => new Date(a.normalized.startTime).getTime() - new Date(b.normalized.startTime).getTime());

  const games: SpotMatchGame[] = upcoming.map((game, index) => {
    const g = game.normalized;
    const spread = parseSpread(game.raw);

    const h2h = findLastHeadToHead(finals, g.awayTeam, g.homeTeam, g.startTime);
    const awayRevenge = h2h ? gameMarginForTeam(h2h, g.awayTeam) <= -8 ? 1 : 0 : 0;

    const nextHomeGame = findNextTeamGame(normalizedAll, g.homeTeam, g.startTime);
    const gapMs = nextHomeGame ? new Date(nextHomeGame.startTime).getTime() - new Date(g.startTime).getTime() : Number.POSITIVE_INFINITY;
    const currentOppStrength = strength.get(g.awayTeam) ?? 0.5;
    const nextOpp = nextHomeGame ? (nextHomeGame.homeTeam === g.homeTeam ? nextHomeGame.awayTeam : nextHomeGame.homeTeam) : '';
    const nextOppStrength = strength.get(nextOpp) ?? 0.5;
    const homeLookahead = nextHomeGame && gapMs <= 3 * 24 * 60 * 60 * 1000 && nextOppStrength - currentOppStrength >= 0.08 ? 1 : 0;

    const lastHomeGame = findLastTeamGame(finals, g.homeTeam, g.startTime);
    const homeLetdown = lastHomeGame ? gameMarginForTeam(lastHomeGame, g.homeTeam) >= 10 ? 1 : 0 : 0;

    const homeFatigue = gamesInPastDays(finals, g.homeTeam, g.startTime, 7) >= 3 ? 1 : 0;

    const awayLastGame = findLastTeamGame(finals, g.awayTeam, g.startTime);
    const awayRest = restDays(awayLastGame, g.startTime);
    const homeTravelFatigue = awayLastGame && awayLastGame.awayTeam === g.awayTeam && awayRest <= 1 ? 1 : 0;

    const factors: SpotFactors = {
      away_revenge: awayRevenge,
      home_lookahead: homeLookahead ? 1 : 0,
      home_letdown: homeLetdown,
      away_dog_value: spread > 0 ? 1 : 0,
      home_fatigue: homeFatigue,
      away_sharp_money: 0,
      away_rlm: 0,
      away_public_faded: 0,
      away_slow_pace: 0,
      home_travel_fatigue: homeTravelFatigue
    };

    const unavailableFactors = ['away_sharp_money', 'away_rlm', 'away_public_faded', 'away_slow_pace'];
    const score = scoreGame(factors);

    return {
      rowId: index + 1,
      gameDate: toDateOnly(g.startTime),
      awayTeam: g.awayTeam,
      homeTeam: g.homeTeam,
      marketSpread: spread,
      score,
      qualified: score >= SPOT_MODEL_THRESHOLD,
      factors,
      unavailableFactors
    };
  });

  const qualified = games.filter((g) => g.qualified).length;

  const response: SpotMatchResponse = {
    from: params.from,
    to: toDateOnly(toDate.toISOString()),
    days: params.days,
    threshold: SPOT_MODEL_THRESHOLD,
    weights: SPOT_MODEL_WEIGHTS,
    counts: {
      totalUpcoming: games.length,
      qualified,
      historicalFinalsUsed: finals.length
    },
    games
  };

  spotRangeCache.set(rangeKey, {
    expiresAt: now + RANGE_CACHE_TTL_MS,
    response: cloneSpotResponse(response)
  });

  return response;
}
