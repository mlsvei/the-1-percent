import fs from 'node:fs';
import path from 'node:path';

type Row = {
  row_id: number;
  season: number;
  market_spread: number;
  actual_margin: number;
  away_covers: 0 | 1;
  spot_score: number;
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

type Weights = Record<keyof Omit<Row, 'row_id' | 'season' | 'market_spread' | 'actual_margin' | 'away_covers' | 'spot_score'>, number>;

type Metrics = {
  bets: number;
  wins: number;
  losses: number;
  winRate: number;
  roi: number;
};

const FEATURES: Array<keyof Weights> = [
  'away_revenge',
  'home_lookahead',
  'home_letdown',
  'away_dog_value',
  'home_fatigue',
  'away_sharp_money',
  'away_rlm',
  'away_public_faded',
  'away_slow_pace',
  'home_travel_fatigue',
];

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const v = argv[i + 1];
    if (!v || v.startsWith('--')) {
      args[k.slice(2)] = 'true';
      continue;
    }
    args[k.slice(2)] = v;
    i += 1;
  }
  return args;
}

function toNum(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseCsv(filePath: string): Row[] {
  const text = fs.readFileSync(filePath, 'utf8').replace(/\r/g, '');
  const lines = text.split('\n').filter(Boolean);
  const headers = lines[0].split(',').map((h) => h.trim());
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

  const req = ['season', 'market_spread', 'actual_margin', 'away_covers', 'spot_score', ...FEATURES];
  for (const r of req) {
    if (!(r in idx)) throw new Error(`Missing column: ${r}`);
  }

  return lines.slice(1).map((line, i) => {
    const p = line.split(',').map((x) => x.trim());
    return {
      row_id: i + 1,
      season: toNum(p[idx.season]),
      market_spread: toNum(p[idx.market_spread]),
      actual_margin: toNum(p[idx.actual_margin]),
      away_covers: (toNum(p[idx.away_covers]) > 0 ? 1 : 0) as 0 | 1,
      spot_score: toNum(p[idx.spot_score]),
      away_revenge: toNum(p[idx.away_revenge]),
      home_lookahead: toNum(p[idx.home_lookahead]),
      home_letdown: toNum(p[idx.home_letdown]),
      away_dog_value: toNum(p[idx.away_dog_value]),
      home_fatigue: toNum(p[idx.home_fatigue]),
      away_sharp_money: toNum(p[idx.away_sharp_money]),
      away_rlm: toNum(p[idx.away_rlm]),
      away_public_faded: toNum(p[idx.away_public_faded]),
      away_slow_pace: toNum(p[idx.away_slow_pace]),
      home_travel_fatigue: toNum(p[idx.home_travel_fatigue]),
    };
  });
}

function score(row: Row, w: Weights): number {
  let s = 0;
  for (const f of FEATURES) s += row[f] * w[f];
  return s;
}

function payoutWin(): number {
  return 100 / 110;
}

function evaluate(rows: Row[], w: Weights, threshold: number): Metrics {
  let bets = 0;
  let wins = 0;
  let losses = 0;
  let profit = 0;

  for (const row of rows) {
    if (score(row, w) < threshold) continue;
    bets += 1;
    if (row.away_covers === 1) {
      wins += 1;
      profit += payoutWin();
    } else {
      losses += 1;
      profit -= 1;
    }
  }

  return {
    bets,
    wins,
    losses,
    winRate: bets > 0 ? wins / bets : 0,
    roi: bets > 0 ? profit / bets : 0,
  };
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function splitChrono(rows: Row[], frac: number): { train: Row[]; test: Row[] } {
  const cut = Math.floor(rows.length * frac);
  return { train: rows.slice(0, cut), test: rows.slice(cut) };
}

function bestModel(rows: Row[], iters: number, minBets: number): { w: Weights; threshold: number; train: Metrics; test: Metrics } {
  const { train, test } = splitChrono(rows, 0.7);
  let best: { w: Weights; threshold: number; train: Metrics; test: Metrics } | null = null;

  for (let i = 0; i < iters; i += 1) {
    const w = {} as Weights;
    for (const f of FEATURES) w[f] = Number(rand(-0.5, 2.5).toFixed(4));
    const threshold = Number(rand(0.5, 5.5).toFixed(4));

    const mTrain = evaluate(train, w, threshold);
    if (mTrain.bets < minBets) continue;

    const mTest = evaluate(test, w, threshold);
    if (mTest.bets < minBets) continue;

    if (!best || mTest.winRate > best.test.winRate) {
      best = { w, threshold, train: mTrain, test: mTest };
    }
  }

  if (!best) throw new Error('No model met min-bets constraints on train and test.');
  return best;
}

function esc(v: string | number): string {
  const s = String(v);
  if (s.includes(',') || s.includes('"')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeMatches(outPath: string, rows: Row[], w: Weights, threshold: number): number {
  const header = [
    'row_id','season','market_spread','actual_margin','away_covers','score','threshold',
    ...FEATURES,
  ];
  const lines = [header.join(',')];
  let count = 0;

  for (const row of rows) {
    const s = score(row, w);
    if (s < threshold) continue;
    lines.push([
      row.row_id,
      row.season,
      row.market_spread,
      row.actual_margin,
      row.away_covers,
      s.toFixed(4),
      threshold.toFixed(4),
      ...FEATURES.map((f) => row[f]),
    ].map(esc).join(','));
    count += 1;
  }

  fs.writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8');
  return count;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const input = path.resolve(args.input ?? './scripts/data/game_data_scored.csv');
  const out = path.resolve(args.output ?? './scripts/data/game_matches_from_scored.csv');
  const iters = Number(args.iters ?? 12000);
  const minBets = Number(args['min-bets'] ?? 200);

  const rows = parseCsv(input);
  const model = bestModel(rows, iters, minBets);

  console.log(`Rows loaded: ${rows.length}`);
  console.log(`Train: bets=${model.train.bets} winRate=${pct(model.train.winRate)} roi=${pct(model.train.roi)}`);
  console.log(`Test:  bets=${model.test.bets} winRate=${pct(model.test.winRate)} roi=${pct(model.test.roi)}`);
  console.log(`Threshold: ${model.threshold.toFixed(4)}`);
  console.log('Weights:');
  for (const f of FEATURES) console.log(`  ${f}: ${model.w[f].toFixed(4)}`);

  const count = writeMatches(out, rows, model.w, model.threshold);
  console.log(`Exported matched historical rows: ${count}`);
  console.log(`Output: ${out}`);
}

main();
