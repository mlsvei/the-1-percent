export type OlympicBracketTeam = {
  name: string;
  flag: string;
  seed?: number;
  sourceSlot?: string;
  sourceKind?: 'winner' | 'loser';
};

export type OlympicBracketGame = {
  slot: string;
  round: number;
  stage: string;
  dateLabel: string;
  teams: [OlympicBracketTeam, OlympicBracketTeam];
};

export const OLYMPIC_TEAM_FLAGS: Record<string, string> = {
  Canada: '🇨🇦',
  'United States': '🇺🇸',
  Slovakia: '🇸🇰',
  Finland: '🇫🇮',
  Czechia: '🇨🇿',
  Denmark: '🇩🇰',
  Sweden: '🇸🇪',
  Latvia: '🇱🇻',
  Germany: '🇩🇪',
  France: '🇫🇷',
  Switzerland: '🇨🇭',
  Italy: '🇮🇹'
};

export const OLYMPIC_TEAM_SEEDS: Record<string, number> = {
  Canada: 1,
  'United States': 2,
  Slovakia: 3,
  Finland: 4,
  Switzerland: 5,
  Germany: 6,
  Sweden: 7,
  Czechia: 8,
  Denmark: 9,
  Latvia: 10,
  France: 11,
  Italy: 12
};

export const OLYMPIC_STAGE_ORDER = [
  'Qualification play-offs',
  'Quarter-finals',
  'Semi-finals',
  'Gold medal game',
  'Bronze medal game'
] as const;

export const OLYMPIC_STAGE_COLUMNS: Array<Array<(typeof OLYMPIC_STAGE_ORDER)[number]>> = [
  ['Qualification play-offs'],
  ['Quarter-finals'],
  ['Semi-finals'],
  ['Gold medal game', 'Bronze medal game']
];

export const OLYMPIC_ROUND_BY_SLOT: Record<string, number> = {
  QPO1: 1,
  QPO2: 1,
  QPO3: 1,
  QPO4: 1,
  QF1: 2,
  QF2: 2,
  QF3: 2,
  QF4: 2,
  SF1: 3,
  SF2: 3,
  GOLD: 4,
  BRONZE: 3
};

export const OLYMPIC_BASE_GAMES: OlympicBracketGame[] = [
  {
    slot: 'QPO1',
    round: 1,
    stage: 'Qualification play-offs',
    dateLabel: '17 February',
    teams: [
      { name: 'Czechia', flag: OLYMPIC_TEAM_FLAGS.Czechia, seed: OLYMPIC_TEAM_SEEDS.Czechia },
      { name: 'Denmark', flag: OLYMPIC_TEAM_FLAGS.Denmark, seed: OLYMPIC_TEAM_SEEDS.Denmark }
    ]
  },
  {
    slot: 'QPO2',
    round: 1,
    stage: 'Qualification play-offs',
    dateLabel: '17 February',
    teams: [
      { name: 'Sweden', flag: OLYMPIC_TEAM_FLAGS.Sweden, seed: OLYMPIC_TEAM_SEEDS.Sweden },
      { name: 'Latvia', flag: OLYMPIC_TEAM_FLAGS.Latvia, seed: OLYMPIC_TEAM_SEEDS.Latvia }
    ]
  },
  {
    slot: 'QPO3',
    round: 1,
    stage: 'Qualification play-offs',
    dateLabel: '17 February',
    teams: [
      { name: 'Germany', flag: OLYMPIC_TEAM_FLAGS.Germany, seed: OLYMPIC_TEAM_SEEDS.Germany },
      { name: 'France', flag: OLYMPIC_TEAM_FLAGS.France, seed: OLYMPIC_TEAM_SEEDS.France }
    ]
  },
  {
    slot: 'QPO4',
    round: 1,
    stage: 'Qualification play-offs',
    dateLabel: '17 February',
    teams: [
      { name: 'Switzerland', flag: OLYMPIC_TEAM_FLAGS.Switzerland, seed: OLYMPIC_TEAM_SEEDS.Switzerland },
      { name: 'Italy', flag: OLYMPIC_TEAM_FLAGS.Italy, seed: OLYMPIC_TEAM_SEEDS.Italy }
    ]
  },
  {
    slot: 'QF1',
    round: 2,
    stage: 'Quarter-finals',
    dateLabel: '18 February',
    teams: [
      { name: 'Canada', flag: OLYMPIC_TEAM_FLAGS.Canada, seed: OLYMPIC_TEAM_SEEDS.Canada },
      { name: 'Winner QPO1', flag: '🏒', sourceSlot: 'QPO1', sourceKind: 'winner' }
    ]
  },
  {
    slot: 'QF2',
    round: 2,
    stage: 'Quarter-finals',
    dateLabel: '18 February',
    teams: [
      { name: 'United States', flag: OLYMPIC_TEAM_FLAGS['United States'], seed: OLYMPIC_TEAM_SEEDS['United States'] },
      { name: 'Winner QPO2', flag: '🏒', sourceSlot: 'QPO2', sourceKind: 'winner' }
    ]
  },
  {
    slot: 'QF3',
    round: 2,
    stage: 'Quarter-finals',
    dateLabel: '18 February',
    teams: [
      { name: 'Slovakia', flag: OLYMPIC_TEAM_FLAGS.Slovakia, seed: OLYMPIC_TEAM_SEEDS.Slovakia },
      { name: 'Winner QPO3', flag: '🏒', sourceSlot: 'QPO3', sourceKind: 'winner' }
    ]
  },
  {
    slot: 'QF4',
    round: 2,
    stage: 'Quarter-finals',
    dateLabel: '18 February',
    teams: [
      { name: 'Finland', flag: OLYMPIC_TEAM_FLAGS.Finland, seed: OLYMPIC_TEAM_SEEDS.Finland },
      { name: 'Winner QPO4', flag: '🏒', sourceSlot: 'QPO4', sourceKind: 'winner' }
    ]
  }
];

export const UEFA_STAGE_COLUMNS = [
  ['Round of 16'],
  ['Quarter-finals'],
  ['Semi-finals'],
  ['Final']
] as const;

export const UEFA_ROUND_BY_SLOT: Record<string, number> = {
  'R16-1': 1,
  'R16-2': 1,
  'R16-3': 1,
  'R16-4': 1,
  'R16-5': 1,
  'R16-6': 1,
  'R16-7': 1,
  'R16-8': 1,
  QF1: 2,
  QF2: 2,
  QF3: 2,
  QF4: 2,
  SF1: 3,
  SF2: 3,
  FINAL: 4
};

export const UEFA_BASE_GAMES: OlympicBracketGame[] = [
  { slot: 'R16-1', round: 1, stage: 'Round of 16', dateLabel: '10 March', teams: [{ name: 'Paris Saint-Germain', flag: '🇫🇷' }, { name: 'Chelsea', flag: '🏴' }] },
  { slot: 'R16-2', round: 1, stage: 'Round of 16', dateLabel: '10 March', teams: [{ name: 'Galatasaray', flag: '🇹🇷' }, { name: 'Liverpool', flag: '🏴' }] },
  { slot: 'R16-3', round: 1, stage: 'Round of 16', dateLabel: '10 March', teams: [{ name: 'Real Madrid', flag: '🇪🇸' }, { name: 'Manchester City', flag: '🏴' }] },
  { slot: 'R16-4', round: 1, stage: 'Round of 16', dateLabel: '11 March', teams: [{ name: 'Atalanta', flag: '🇮🇹' }, { name: 'Bayern Munich', flag: '🇩🇪' }] },
  { slot: 'R16-5', round: 1, stage: 'Round of 16', dateLabel: '11 March', teams: [{ name: 'Newcastle United', flag: '🏴' }, { name: 'Barcelona', flag: '🇪🇸' }] },
  { slot: 'R16-6', round: 1, stage: 'Round of 16', dateLabel: '11 March', teams: [{ name: 'Atletico Madrid', flag: '🇪🇸' }, { name: 'Tottenham Hotspur', flag: '🏴' }] },
  { slot: 'R16-7', round: 1, stage: 'Round of 16', dateLabel: '11 March', teams: [{ name: 'Bodo/Glimt', flag: '🇳🇴' }, { name: 'Sporting CP', flag: '🇵🇹' }] },
  { slot: 'R16-8', round: 1, stage: 'Round of 16', dateLabel: '11 March', teams: [{ name: 'Bayer Leverkusen', flag: '🇩🇪' }, { name: 'Arsenal', flag: '🏴' }] },
  { slot: 'QF1', round: 2, stage: 'Quarter-finals', dateLabel: '7 April', teams: [{ name: 'Winner R16-1', flag: '⚽', sourceSlot: 'R16-1', sourceKind: 'winner' }, { name: 'Winner R16-2', flag: '⚽', sourceSlot: 'R16-2', sourceKind: 'winner' }] },
  { slot: 'QF2', round: 2, stage: 'Quarter-finals', dateLabel: '7 April', teams: [{ name: 'Winner R16-3', flag: '⚽', sourceSlot: 'R16-3', sourceKind: 'winner' }, { name: 'Winner R16-4', flag: '⚽', sourceSlot: 'R16-4', sourceKind: 'winner' }] },
  { slot: 'QF3', round: 2, stage: 'Quarter-finals', dateLabel: '8 April', teams: [{ name: 'Winner R16-5', flag: '⚽', sourceSlot: 'R16-5', sourceKind: 'winner' }, { name: 'Winner R16-6', flag: '⚽', sourceSlot: 'R16-6', sourceKind: 'winner' }] },
  { slot: 'QF4', round: 2, stage: 'Quarter-finals', dateLabel: '8 April', teams: [{ name: 'Winner R16-7', flag: '⚽', sourceSlot: 'R16-7', sourceKind: 'winner' }, { name: 'Winner R16-8', flag: '⚽', sourceSlot: 'R16-8', sourceKind: 'winner' }] },
  { slot: 'SF1', round: 3, stage: 'Semi-finals', dateLabel: '28 April', teams: [{ name: 'Winner QF1', flag: '⚽', sourceSlot: 'QF1', sourceKind: 'winner' }, { name: 'Winner QF2', flag: '⚽', sourceSlot: 'QF2', sourceKind: 'winner' }] },
  { slot: 'SF2', round: 3, stage: 'Semi-finals', dateLabel: '29 April', teams: [{ name: 'Winner QF3', flag: '⚽', sourceSlot: 'QF3', sourceKind: 'winner' }, { name: 'Winner QF4', flag: '⚽', sourceSlot: 'QF4', sourceKind: 'winner' }] },
  { slot: 'FINAL', round: 4, stage: 'Final', dateLabel: '30 May', teams: [{ name: 'Winner SF1', flag: '⚽', sourceSlot: 'SF1', sourceKind: 'winner' }, { name: 'Winner SF2', flag: '⚽', sourceSlot: 'SF2', sourceKind: 'winner' }] }
];

export const UEFA_TEAM_LOGOS: Record<string, string> = {
  'Paris Saint-Germain': 'https://upload.wikimedia.org/wikipedia/en/thumb/a/a7/Paris_Saint-Germain_F.C..svg/120px-Paris_Saint-Germain_F.C..svg.png',
  PSG: 'https://upload.wikimedia.org/wikipedia/en/thumb/a/a7/Paris_Saint-Germain_F.C..svg/120px-Paris_Saint-Germain_F.C..svg.png',
  Chelsea: 'https://upload.wikimedia.org/wikipedia/en/thumb/c/cc/Chelsea_FC.svg/120px-Chelsea_FC.svg.png',
  Galatasaray: 'https://upload.wikimedia.org/wikipedia/commons/2/20/Galatasaray_Sports_Club_Logo.png',
  Liverpool: 'https://upload.wikimedia.org/wikipedia/en/thumb/0/0c/Liverpool_FC.svg/120px-Liverpool_FC.svg.png',
  'Real Madrid': 'https://upload.wikimedia.org/wikipedia/en/thumb/5/56/Real_Madrid_CF.svg/120px-Real_Madrid_CF.svg.png',
  'Manchester City': 'https://upload.wikimedia.org/wikipedia/en/thumb/e/eb/Manchester_City_FC_badge.svg/120px-Manchester_City_FC_badge.svg.png',
  Atalanta: 'https://upload.wikimedia.org/wikipedia/en/thumb/6/66/Atalanta_BC_logo.svg/120px-Atalanta_BC_logo.svg.png',
  'Bayern Munich': 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1f/FC_Bayern_M%C3%BCnchen_logo_%282017%29.svg/120px-FC_Bayern_M%C3%BCnchen_logo_%282017%29.svg.png',
  'Newcastle United': 'https://upload.wikimedia.org/wikipedia/en/thumb/5/56/Newcastle_United_Logo.svg/120px-Newcastle_United_Logo.svg.png',
  Barcelona: 'https://upload.wikimedia.org/wikipedia/en/thumb/4/47/FC_Barcelona_%28crest%29.svg/120px-FC_Barcelona_%28crest%29.svg.png',
  'FC Barcelona': 'https://upload.wikimedia.org/wikipedia/en/thumb/4/47/FC_Barcelona_%28crest%29.svg/120px-FC_Barcelona_%28crest%29.svg.png',
  'Atletico Madrid': 'https://upload.wikimedia.org/wikipedia/en/thumb/f/f4/Atletico_Madrid_2017_logo.svg/120px-Atletico_Madrid_2017_logo.svg.png',
  'Atlético Madrid': 'https://upload.wikimedia.org/wikipedia/en/thumb/f/f4/Atletico_Madrid_2017_logo.svg/120px-Atletico_Madrid_2017_logo.svg.png',
  'Tottenham Hotspur': 'https://upload.wikimedia.org/wikipedia/en/thumb/b/b4/Tottenham_Hotspur.svg/120px-Tottenham_Hotspur.svg.png',
  'Bodo/Glimt': 'https://upload.wikimedia.org/wikipedia/en/thumb/9/91/FK_Bod%C3%B8-Glimt_logo.svg/120px-FK_Bod%C3%B8-Glimt_logo.svg.png',
  'Bodø/Glimt': 'https://upload.wikimedia.org/wikipedia/en/thumb/9/91/FK_Bod%C3%B8-Glimt_logo.svg/120px-FK_Bod%C3%B8-Glimt_logo.svg.png',
  'Sporting CP': 'https://upload.wikimedia.org/wikipedia/en/thumb/e/e0/Sporting_Clube_de_Portugal_%28Logo%29.svg/120px-Sporting_Clube_de_Portugal_%28Logo%29.svg.png',
  Sporting: 'https://upload.wikimedia.org/wikipedia/en/thumb/e/e0/Sporting_Clube_de_Portugal_%28Logo%29.svg/120px-Sporting_Clube_de_Portugal_%28Logo%29.svg.png',
  'Bayer Leverkusen': 'https://upload.wikimedia.org/wikipedia/en/thumb/5/59/Bayer_04_Leverkusen_logo.svg/120px-Bayer_04_Leverkusen_logo.svg.png',
  Arsenal: 'https://upload.wikimedia.org/wikipedia/en/thumb/5/53/Arsenal_FC.svg/120px-Arsenal_FC.svg.png'
};

export const UEFA_OFFICIAL_TIME_SLOTS = new Set(['R16-1', 'R16-2', 'R16-3', 'R16-4', 'R16-5', 'R16-6', 'R16-7', 'R16-8', 'FINAL']);

export function uefaTeamLogoUrl(teamName: string): string | null {
  return UEFA_TEAM_LOGOS[teamName] ?? null;
}

export function isOfficialUefaKickoff(slot: string): boolean {
  return UEFA_OFFICIAL_TIME_SLOTS.has(slot);
}

export function teamDisplayName(team: OlympicBracketTeam): string {
  return team.seed ? `${team.seed} ${team.name}` : team.name;
}

export function resolveFromSource(
  sourceTeam: OlympicBracketTeam,
  picks: Map<string, string>,
  gamesBySlot: Map<string, OlympicBracketGame>
): OlympicBracketTeam {
  if (!sourceTeam.sourceSlot) return sourceTeam;

  const sourceGame = gamesBySlot.get(sourceTeam.sourceSlot);
  const pickedName = picks.get(sourceTeam.sourceSlot);
  const sourceFallbackFlag = sourceTeam.flag || '🏒';

  if (sourceTeam.sourceKind === 'winner') {
    if (!sourceGame || !pickedName) {
      return { name: `Winner ${sourceTeam.sourceSlot}`, flag: sourceFallbackFlag };
    }
    const pickedTeam = sourceGame.teams.find((team) => team.name === pickedName);
    return pickedTeam ?? { name: pickedName, flag: OLYMPIC_TEAM_FLAGS[pickedName] ?? sourceFallbackFlag, seed: OLYMPIC_TEAM_SEEDS[pickedName] };
  }

  if (!sourceGame || !pickedName) {
    return { name: `Loser ${sourceTeam.sourceSlot}`, flag: sourceFallbackFlag };
  }

  const loserTeam = sourceGame.teams.find((team) => team.name !== pickedName);
  return loserTeam ?? { name: `Loser of ${sourceTeam.sourceSlot}`, flag: sourceFallbackFlag };
}

export function pickWinnerOf(slot: string, picks: Map<string, string>, gamesBySlot: Map<string, OlympicBracketGame>): OlympicBracketTeam | null {
  const game = gamesBySlot.get(slot);
  if (!game) return null;

  const pickedName = picks.get(slot);
  if (!pickedName) return null;

  return game.teams.find((team) => team.name === pickedName) ?? null;
}

export function resolveOlympicBracketGames(picks: Map<string, string>): OlympicBracketGame[] {
  const resolved: OlympicBracketGame[] = [];
  const bySlot = new Map<string, OlympicBracketGame>();

  for (const baseGame of OLYMPIC_BASE_GAMES) {
    const teams: [OlympicBracketTeam, OlympicBracketTeam] = [
      resolveFromSource(baseGame.teams[0], picks, bySlot),
      resolveFromSource(baseGame.teams[1], picks, bySlot)
    ];
    const game: OlympicBracketGame = { ...baseGame, teams };
    resolved.push(game);
    bySlot.set(game.slot, game);
  }

  const qfWinners = ['QF1', 'QF2', 'QF3', 'QF4']
    .map((slot) => pickWinnerOf(slot, picks, bySlot))
    .filter((team): team is OlympicBracketTeam => !!team);

  let sfTeams: [OlympicBracketTeam, OlympicBracketTeam, OlympicBracketTeam, OlympicBracketTeam] | null = null;
  if (qfWinners.length === 4 && qfWinners.every((team) => typeof team.seed === 'number')) {
    const sorted = [...qfWinners].sort((a, b) => (a.seed ?? 99) - (b.seed ?? 99));
    sfTeams = [sorted[0], sorted[3], sorted[1], sorted[2]];
  }

  const sf1: OlympicBracketGame = {
    slot: 'SF1',
    round: 3,
    stage: 'Semi-finals',
    dateLabel: '20 February',
    teams: sfTeams
      ? [sfTeams[0], sfTeams[1]]
      : [
          resolveFromSource({ name: 'Winner QF1', flag: '🏒', sourceSlot: 'QF1', sourceKind: 'winner' }, picks, bySlot),
          resolveFromSource({ name: 'Winner QF2', flag: '🏒', sourceSlot: 'QF2', sourceKind: 'winner' }, picks, bySlot)
        ]
  };

  const sf2: OlympicBracketGame = {
    slot: 'SF2',
    round: 3,
    stage: 'Semi-finals',
    dateLabel: '20 February',
    teams: sfTeams
      ? [sfTeams[2], sfTeams[3]]
      : [
          resolveFromSource({ name: 'Winner QF3', flag: '🏒', sourceSlot: 'QF3', sourceKind: 'winner' }, picks, bySlot),
          resolveFromSource({ name: 'Winner QF4', flag: '🏒', sourceSlot: 'QF4', sourceKind: 'winner' }, picks, bySlot)
        ]
  };

  resolved.push(sf1, sf2);
  bySlot.set(sf1.slot, sf1);
  bySlot.set(sf2.slot, sf2);

  const gold: OlympicBracketGame = {
    slot: 'GOLD',
    round: 4,
    stage: 'Gold medal game',
    dateLabel: '22 February',
    teams: [
      resolveFromSource({ name: 'Winner SF1', flag: '🏒', sourceSlot: 'SF1', sourceKind: 'winner' }, picks, bySlot),
      resolveFromSource({ name: 'Winner SF2', flag: '🏒', sourceSlot: 'SF2', sourceKind: 'winner' }, picks, bySlot)
    ]
  };

  const bronze: OlympicBracketGame = {
    slot: 'BRONZE',
    round: 3,
    stage: 'Bronze medal game',
    dateLabel: '21 February',
    teams: [
      resolveFromSource({ name: 'Loser SF1', flag: '🏒', sourceSlot: 'SF1', sourceKind: 'loser' }, picks, bySlot),
      resolveFromSource({ name: 'Loser SF2', flag: '🏒', sourceSlot: 'SF2', sourceKind: 'loser' }, picks, bySlot)
    ]
  };

  resolved.push(gold, bronze);

  return resolved;
}

export function resolveUefaBracketGames(picks: Map<string, string>): OlympicBracketGame[] {
  const resolved: OlympicBracketGame[] = [];
  const bySlot = new Map<string, OlympicBracketGame>();

  for (const baseGame of UEFA_BASE_GAMES) {
    const teams: [OlympicBracketTeam, OlympicBracketTeam] = [
      resolveFromSource(baseGame.teams[0], picks, bySlot),
      resolveFromSource(baseGame.teams[1], picks, bySlot)
    ];
    const game: OlympicBracketGame = { ...baseGame, teams };
    resolved.push(game);
    bySlot.set(game.slot, game);
  }

  return resolved;
}
