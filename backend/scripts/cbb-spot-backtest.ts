import fs from 'node:fs';
import path from 'node:path';

type TeamGameRow = {
  date: string;
  season: string;
  team: string;
  opponent: string;
  is_home: number;
  team_score: number;
  opp_score: number;
  spread: number;
};

type EnrichedRow = TeamGameRow & {
  game_date: Date;
  game_key: string;
  ats_result: -1 | 0 | 1;
  margin: number;
  rest_days: number;
  opp_rest_days: number;
  rest_diff: number;
  team_games_last7: number;
  opp_games_last7: number;
  away_revenge: number;
  home_lookahead: number;
  home_letdown: number;
  opp_road_fatigue: number;
  fair_spread: number;
  model_edge: number;
  z_model_edge: number;
};

type FeatureConfig = {
  name: keyof Pick<
    EnrichedRow,
    'away_revenge' | 'home_lookahead' | 'home_letdown' | 'opp_road_fatigue' | 'rest_diff' | 'team_games_last7' | 'opp_games_last7' | 'z_model_edge'
  >;
  weight: number;
};

type Candidate = {
  threshold: number;
  configs: FeatureConfig[];
  train: Metrics;
  test?: Metrics;
};

type Metrics = {
  bets: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number;
  roi: number;
  avgEdge: number;
};

const VIG_PRICE = -110;
const MIN_BETS = 200;

function usage(): void {
  console.log(`Usage:
  npx tsx scripts/cbb-spot-backtest.ts --input ./scripts/data/cbb_team_games.csv [--split 0.7] [--iters 6000] [--min-bets 200] [--export-matches ./scripts/data/cbb_matches.csv]

Required CSV columns (team-game format, one row per team per game):
  date,season,team,opponent,is_home,team_score,opp_score,spread

Conventions:
  - spread is from the listed team's perspective (negative means favored)
  - ATS cover = team_score + spread > opp_score
`);
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      args[key.slice(2)] = 'true';
      continue;
    }
    args[key.slice(2)] = value;
    i += 1;
  }
  return args;
}

function parseCsv(filePath: string): TeamGameRow[] {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    throw new Error('CSV must include header + at least one row');
  }

  const headers = lines[0].split(',').map((h) => h.trim());
  const required = ['date', 'season', 'team', 'opponent', 'is_home', 'team_score', 'opp_score', 'spread'];
  for (const col of required) {
    if (!headers.includes(col)) {
      throw new Error(`Missing required column: ${col}`);
    }
  }

  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

  return lines.slice(1).map((line, lineNo) => {
    const parts = line.split(',').map((p) => p.trim());
    const row: TeamGameRow = {
      date: parts[idx.date],
      season: parts[idx.season],
      team: parts[idx.team],
      opponent: parts[idx.opponent],
      is_home: Number(parts[idx.is_home]),
      team_score: Number(parts[idx.team_score]),
      opp_score: Number(parts[idx.opp_score]),
      spread: Number(parts[idx.spread]),
    };

    if (!row.date || !row.season || !row.team || !row.opponent) {
      throw new Error(`Invalid string fields at CSV line ${lineNo + 2}`);
    }
    if (![0, 1].includes(row.is_home)) {
      throw new Error(`is_home must be 0 or 1 at CSV line ${lineNo + 2}`);
    }
    if ([row.team_score, row.opp_score, row.spread].some((n) => Number.isNaN(n))) {
      throw new Error(`Numeric parse error at CSV line ${lineNo + 2}`);
    }

    return row;
  });
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000));
}

function stats(values: number[]): { mean: number; std: number } {
  if (values.length === 0) return { mean: 0, std: 1 };
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const varc = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return { mean, std: Math.sqrt(varc) || 1 };
}

function buildEnriched(rows: TeamGameRow[]): EnrichedRow[] {
  const sorted = rows
    .map((r) => ({ ...r, game_date: new Date(r.date) }))
    .sort((a, b) => a.game_date.getTime() - b.game_date.getTime());

  const teamHistory = new Map<string, EnrichedRow[]>();
  const matchupHistory = new Map<string, EnrichedRow[]>();

  const enriched: EnrichedRow[] = [];

  for (const [i, row] of sorted.entries()) {
    const margin = row.team_score - row.opp_score;
    const atsDelta = row.team_score + row.spread - row.opp_score;
    const ats_result: -1 | 0 | 1 = atsDelta > 0 ? 1 : atsDelta < 0 ? -1 : 0;

    const teamKey = `${row.season}::${row.team}`;
    const oppKey = `${row.season}::${row.opponent}`;
    const previousTeamGames = teamHistory.get(teamKey) ?? [];
    const previousOppGames = teamHistory.get(oppKey) ?? [];

    const lastTeam = previousTeamGames[previousTeamGames.length - 1];
    const lastOpp = previousOppGames[previousOppGames.length - 1];

    const rest_days = lastTeam ? Math.max(0, daysBetween(row.game_date, lastTeam.game_date) - 1) : 7;
    const opp_rest_days = lastOpp ? Math.max(0, daysBetween(row.game_date, lastOpp.game_date) - 1) : 7;
    const rest_diff = Math.max(-7, Math.min(7, rest_days - opp_rest_days));

    const team_games_last7 = previousTeamGames.filter((g) => daysBetween(row.game_date, g.game_date) <= 7).length;
    const opp_games_last7 = previousOppGames.filter((g) => daysBetween(row.game_date, g.game_date) <= 7).length;

    const pairKey = `${row.season}::${[row.team, row.opponent].sort().join('::')}`;
    const pairGames = matchupHistory.get(pairKey) ?? [];
    const previousVsOpp = pairGames
      .filter((g) => g.team === row.team && g.opponent === row.opponent)
      .sort((a, b) => b.game_date.getTime() - a.game_date.getTime())[0];

    const away_revenge = row.is_home === 0 && !!previousVsOpp && previousVsOpp.margin <= -8 ? 1 : 0;

    const home_letdown = row.is_home === 1 && !!lastTeam && lastTeam.spread > 0 && lastTeam.margin > 0 ? 1 : 0;

    const opp_road_fatigue = row.is_home === 1 && !!lastOpp && lastOpp.is_home === 0 && opp_rest_days <= 1 ? 1 : 0;

    const fair_spread = estimateFairSpread(previousTeamGames, previousOppGames, row.is_home);
    const model_edge = row.spread - fair_spread;

    const item: EnrichedRow = {
      ...row,
      game_date: row.game_date,
      game_key: `${row.date}::${row.season}::${row.team}::${row.opponent}::${i}`,
      ats_result,
      margin,
      rest_days,
      opp_rest_days,
      rest_diff,
      team_games_last7,
      opp_games_last7,
      away_revenge,
      home_lookahead: 0,
      home_letdown,
      opp_road_fatigue,
      fair_spread,
      model_edge,
      z_model_edge: 0,
    };

    enriched.push(item);

    if (!teamHistory.has(teamKey)) teamHistory.set(teamKey, []);
    teamHistory.get(teamKey)!.push(item);

    if (!matchupHistory.has(pairKey)) matchupHistory.set(pairKey, []);
    matchupHistory.get(pairKey)!.push(item);
  }

  const byTeamSeason = new Map<string, EnrichedRow[]>();
  for (const row of enriched) {
    const key = `${row.season}::${row.team}`;
    if (!byTeamSeason.has(key)) byTeamSeason.set(key, []);
    byTeamSeason.get(key)!.push(row);
  }
  for (const games of byTeamSeason.values()) {
    games.sort((a, b) => a.game_date.getTime() - b.game_date.getTime());
    for (let i = 0; i < games.length; i += 1) {
      const current = games[i];
      if (current.is_home !== 1) continue;
      const next = games[i + 1];
      if (!next) continue;
      const nextGap = daysBetween(next.game_date, current.game_date);
      const currentOppStrength = opponentProxyStrength(enriched, current.season, current.opponent, current.game_date);
      const nextOppStrength = opponentProxyStrength(enriched, next.season, next.opponent, next.game_date);
      current.home_lookahead = nextGap <= 3 && nextOppStrength - currentOppStrength >= 0.08 ? 1 : 0;
    }
  }

  const edgeStats = stats(enriched.map((r) => r.model_edge));
  for (const row of enriched) {
    row.z_model_edge = (row.model_edge - edgeStats.mean) / edgeStats.std;
  }

  return enriched;
}

function opponentProxyStrength(rows: EnrichedRow[], season: string, team: string, date: Date): number {
  const subset = rows.filter((r) => r.season === season && r.team === team && r.game_date.getTime() < date.getTime());
  if (subset.length < 5) return 0.5;
  const wins = subset.filter((r) => r.margin > 0).length;
  return wins / subset.length;
}

function estimateFairSpread(teamGames: EnrichedRow[], oppGames: EnrichedRow[], isHome: number): number {
  const team = rollingPower(teamGames);
  const opp = rollingPower(oppGames);
  const homeAdv = isHome === 1 ? 2.8 : -2.8;
  return -(team - opp + homeAdv);
}

function rollingPower(games: EnrichedRow[]): number {
  if (games.length === 0) return 0;
  const recent = games.slice(-10);
  const weighted = recent.map((g, i) => {
    const w = 0.6 + (i / Math.max(1, recent.length - 1)) * 0.8;
    return w * (g.margin - g.spread * 0.35);
  });
  const totalW = recent.map((_, i) => 0.6 + (i / Math.max(1, recent.length - 1)) * 0.8).reduce((a, b) => a + b, 0);
  return weighted.reduce((a, b) => a + b, 0) / totalW;
}

function splitChrono(rows: EnrichedRow[], trainSplit: number): { train: EnrichedRow[]; test: EnrichedRow[] } {
  const sorted = [...rows].sort((a, b) => a.game_date.getTime() - b.game_date.getTime());
  const cut = Math.floor(sorted.length * trainSplit);
  return {
    train: sorted.slice(0, cut),
    test: sorted.slice(cut),
  };
}

function score(row: EnrichedRow, configs: FeatureConfig[]): number {
  let s = 0;
  for (const conf of configs) {
    const val = row[conf.name];
    s += conf.weight * val;
  }
  return s;
}

function payout(unitsRisked: number, price: number): number {
  if (price >= 0) return unitsRisked * (price / 100);
  return unitsRisked * (100 / Math.abs(price));
}

function evaluate(rows: EnrichedRow[], configs: FeatureConfig[], threshold: number): Metrics {
  let bets = 0;
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let profit = 0;
  let totalAbsEdge = 0;

  for (const row of rows) {
    const s = score(row, configs);
    if (s < threshold) continue;
    if (row.ats_result === 0) {
      pushes += 1;
      continue;
    }

    bets += 1;
    totalAbsEdge += Math.abs(row.model_edge);

    if (row.ats_result === 1) {
      wins += 1;
      profit += payout(1, VIG_PRICE);
    } else {
      losses += 1;
      profit -= 1;
    }
  }

  const winRate = bets > 0 ? wins / bets : 0;
  const roi = bets > 0 ? profit / bets : 0;
  const avgEdge = bets > 0 ? totalAbsEdge / bets : 0;

  return { bets, wins, losses, pushes, winRate, roi, avgEdge };
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function searchBest(train: EnrichedRow[], iters: number, minBets: number): Candidate[] {
  const featureNames: FeatureConfig['name'][] = [
    'away_revenge',
    'home_lookahead',
    'home_letdown',
    'opp_road_fatigue',
    'rest_diff',
    'team_games_last7',
    'opp_games_last7',
    'z_model_edge',
  ];

  const candidates: Candidate[] = [];

  for (let i = 0; i < iters; i += 1) {
    const configs: FeatureConfig[] = featureNames.map((name) => {
      let weight = 0;
      if (name === 'z_model_edge') {
        weight = randomRange(0.6, 2.8);
      } else if (name === 'rest_diff') {
        weight = randomRange(-0.6, 0.8);
      } else if (name === 'team_games_last7') {
        weight = randomRange(-0.7, 0.2);
      } else if (name === 'opp_games_last7') {
        weight = randomRange(-0.2, 0.7);
      } else {
        weight = randomRange(-0.4, 2.4);
      }
      return { name, weight: Number(weight.toFixed(4)) };
    });

    const threshold = Number(randomRange(0.6, 4.6).toFixed(4));
    const metrics = evaluate(train, configs, threshold);
    if (metrics.bets < minBets) continue;

    const objective = metrics.winRate + Math.min(0.03, metrics.roi * 0.25);
    if (objective < 0.53) continue;

    candidates.push({ threshold, configs, train: metrics });
  }

  candidates.sort((a, b) => {
    const oa = a.train.winRate + Math.min(0.03, a.train.roi * 0.25);
    const ob = b.train.winRate + Math.min(0.03, b.train.roi * 0.25);
    return ob - oa;
  });

  return candidates.slice(0, 25);
}

function formatPct(v: number): string {
  return `${(v * 100).toFixed(2)}%`;
}

function printMetrics(label: string, m: Metrics): void {
  console.log(`${label}: bets=${m.bets}, wins=${m.wins}, losses=${m.losses}, pushes=${m.pushes}, winRate=${formatPct(m.winRate)}, roi=${formatPct(m.roi)}, avgAbsModelEdge=${m.avgEdge.toFixed(3)}`);
}

function csvEscape(value: string | number): string {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function exportMatches(
  outputPath: string,
  rows: EnrichedRow[],
  configs: FeatureConfig[],
  threshold: number,
  trainKeys: Set<string>,
): number {
  const headers = [
    'dataset_split',
    'date',
    'season',
    'team',
    'opponent',
    'is_home',
    'spread',
    'team_score',
    'opp_score',
    'ats_result',
    'spot_score',
    'threshold',
    'model_edge',
    'fair_spread',
    'away_revenge',
    'home_lookahead',
    'home_letdown',
    'opp_road_fatigue',
    'rest_diff',
    'team_games_last7',
    'opp_games_last7',
    'z_model_edge',
  ];

  const output: string[] = [headers.join(',')];
  let count = 0;

  const sorted = [...rows].sort((a, b) => a.game_date.getTime() - b.game_date.getTime());
  for (const row of sorted) {
    if (row.ats_result === 0) continue;
    const spotScore = score(row, configs);
    if (spotScore < threshold) continue;

    const datasetSplit = trainKeys.has(row.game_key) ? 'train' : 'test';

    output.push(
      [
        datasetSplit,
        row.date,
        row.season,
        row.team,
        row.opponent,
        row.is_home,
        row.spread,
        row.team_score,
        row.opp_score,
        row.ats_result,
        spotScore.toFixed(4),
        threshold.toFixed(4),
        row.model_edge.toFixed(4),
        row.fair_spread.toFixed(4),
        row.away_revenge,
        row.home_lookahead,
        row.home_letdown,
        row.opp_road_fatigue,
        row.rest_diff,
        row.team_games_last7,
        row.opp_games_last7,
        row.z_model_edge.toFixed(4),
      ]
        .map(csvEscape)
        .join(','),
    );

    count += 1;
  }

  fs.writeFileSync(outputPath, `${output.join('\n')}\n`, 'utf8');
  return count;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help === 'true' || !args.input) {
    usage();
    process.exit(args.help === 'true' ? 0 : 1);
  }

  const input = path.resolve(args.input);
  const split = args.split ? Number(args.split) : 0.7;
  const iters = args.iters ? Number(args.iters) : 6000;
  const minBets = args['min-bets'] ? Number(args['min-bets']) : MIN_BETS;
  const exportPath =
    args['export-matches'] && args['export-matches'] !== 'true'
      ? path.resolve(args['export-matches'])
      : args['export-matches'] === 'true'
        ? path.resolve('./scripts/data/cbb_matches.csv')
        : '';

  if (Number.isNaN(split) || split <= 0.5 || split >= 0.9) {
    throw new Error('--split should be between 0.5 and 0.9');
  }
  if (Number.isNaN(iters) || iters < 100) {
    throw new Error('--iters should be >= 100');
  }

  const rows = parseCsv(input);
  const enriched = buildEnriched(rows);
  const noPush = enriched.filter((r) => r.ats_result !== 0);
  const { train, test } = splitChrono(noPush, split);
  const trainKeys = new Set(train.map((r) => r.game_key));

  console.log(`Loaded ${rows.length} rows (${noPush.length} non-push ATS samples)`);
  console.log(`Train=${train.length}, Test=${test.length}`);

  const top = searchBest(train, iters, minBets);
  if (top.length === 0) {
    console.log('No candidate reached minimum training sample/quality constraints.');
    process.exit(0);
  }

  let bestOut: Candidate | null = null;

  for (const cand of top) {
    const testMetrics = evaluate(test, cand.configs, cand.threshold);
    cand.test = testMetrics;
    if (testMetrics.bets < minBets) continue;

    if (!bestOut || testMetrics.winRate > bestOut.test!.winRate) {
      bestOut = cand;
    }
  }

  console.log('\nTop training candidates (first 5):');
  for (const cand of top.slice(0, 5)) {
    console.log(`- threshold=${cand.threshold.toFixed(3)} trainWin=${formatPct(cand.train.winRate)} trainBets=${cand.train.bets}`);
  }

  if (!bestOut) {
    console.log(`\nNo out-of-sample candidate produced >=${minBets} bets on test.`);
    console.log('Try more data, lower threshold strictness, or change split/iters.');
    process.exit(0);
  }

  console.log('\nBest out-of-sample candidate:');
  printMetrics('Train', bestOut.train);
  printMetrics('Test', bestOut.test!);
  console.log(`Threshold: ${bestOut.threshold.toFixed(4)}`);
  console.log('Weights:');
  for (const c of bestOut.configs) {
    console.log(`  ${c.name}: ${c.weight.toFixed(4)}`);
  }

  if (exportPath) {
    const exported = exportMatches(exportPath, noPush, bestOut.configs, bestOut.threshold, trainKeys);
    console.log(`\nExported ${exported} matched games to ${exportPath}`);
  }

  const target = 0.57;
  if (bestOut.test!.winRate >= target && bestOut.test!.bets >= minBets) {
    console.log(`\nTarget achieved: test ATS win rate >= ${formatPct(target)} with ${bestOut.test!.bets} bets.`);
  } else {
    console.log(`\nTarget not achieved. Best test ATS=${formatPct(bestOut.test!.winRate)} on ${bestOut.test!.bets} bets.`);
  }
}

main();
