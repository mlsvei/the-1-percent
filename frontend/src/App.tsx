import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  Contest,
  Entry,
  Game,
  Group,
  PublicGroupRow,
  PrivateGroupNameRow,
  LeaderboardRow,
  TopOneAggregateRow,
  ParticipantContestEntry,
  ParticipantEntryBracketPick,
  ParticipantEntryPickemPick,
  UserStatsProfile
} from './api';

type PickDraft = Record<string, { pickedWinner: string; confidencePoints: string }>;

type BracketDraftRow = {
  gameSlot: string;
  pickedTeam: string;
  round: string;
};

type OlympicBracketTeam = {
  name: string;
  flag: string;
  seed?: number;
  sourceSlot?: string;
  sourceKind?: 'winner' | 'loser';
};

type OlympicBracketGame = {
  slot: string;
  round: number;
  stage: string;
  dateLabel: string;
  teams: [OlympicBracketTeam, OlympicBracketTeam];
};

const USER_KEY = 'sports_contest_user_id';
const CREATOR_EMAIL = 'mlsvei2121@gmail.com';
const LEADERBOARD_TOP_ONE_OPTION = '__TOP_ONE_ALL__';

const PLANNED_UPCOMING_CONTESTS = [] as const;

const NCAAB_CONFERENCE_TEAMS: Array<{ conference: string; slot: string; teams: string[] }> = [
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

const NBA_TEAM_ABBR: Record<string, string> = {
  'Atlanta Hawks': 'atl',
  'Boston Celtics': 'bos',
  'Brooklyn Nets': 'bkn',
  'Charlotte Hornets': 'cha',
  'Chicago Bulls': 'chi',
  'Cleveland Cavaliers': 'cle',
  'Dallas Mavericks': 'dal',
  'Denver Nuggets': 'den',
  'Detroit Pistons': 'det',
  'Golden State Warriors': 'gs',
  'Houston Rockets': 'hou',
  'Indiana Pacers': 'ind',
  'Los Angeles Clippers': 'lac',
  'Los Angeles Lakers': 'lal',
  'Memphis Grizzlies': 'mem',
  'Miami Heat': 'mia',
  'Milwaukee Bucks': 'mil',
  'Minnesota Timberwolves': 'min',
  'New Orleans Pelicans': 'no',
  'New York Knicks': 'ny',
  'Oklahoma City Thunder': 'okc',
  'Orlando Magic': 'orl',
  'Philadelphia 76ers': 'phi',
  'Phoenix Suns': 'phx',
  'Portland Trail Blazers': 'por',
  'Sacramento Kings': 'sac',
  'San Antonio Spurs': 'sa',
  'Toronto Raptors': 'tor',
  'Utah Jazz': 'utah',
  'Washington Wizards': 'wsh'
};

const NBA_TEAM_ALIAS_ABBR: Record<string, string> = {
  ATL: 'atl',
  BOS: 'bos',
  BKN: 'bkn',
  BRK: 'bkn',
  CHA: 'cha',
  CHI: 'chi',
  CLE: 'cle',
  DAL: 'dal',
  DEN: 'den',
  DET: 'det',
  GS: 'gs',
  GSW: 'gs',
  HOU: 'hou',
  IND: 'ind',
  LAC: 'lac',
  LAL: 'lal',
  MEM: 'mem',
  MIA: 'mia',
  MIL: 'mil',
  MIN: 'min',
  NO: 'no',
  NOP: 'no',
  NY: 'ny',
  NYK: 'ny',
  OKC: 'okc',
  ORL: 'orl',
  PHI: 'phi',
  PHX: 'phx',
  PHO: 'phx',
  POR: 'por',
  SAC: 'sac',
  SA: 'sa',
  SAS: 'sa',
  TOR: 'tor',
  UTA: 'utah',
  WAS: 'wsh',
  WSH: 'wsh'
};

const NHL_TEAM_ABBR: Record<string, string> = {
  'Anaheim Ducks': 'ana',
  'Boston Bruins': 'bos',
  'Buffalo Sabres': 'buf',
  'Calgary Flames': 'cgy',
  'Carolina Hurricanes': 'car',
  'Chicago Blackhawks': 'chi',
  'Colorado Avalanche': 'col',
  'Columbus Blue Jackets': 'cbj',
  'Dallas Stars': 'dal',
  'Detroit Red Wings': 'det',
  'Edmonton Oilers': 'edm',
  'Florida Panthers': 'fla',
  'Los Angeles Kings': 'la',
  'Minnesota Wild': 'min',
  'Montreal Canadiens': 'mtl',
  'Nashville Predators': 'nsh',
  'New Jersey Devils': 'nj',
  'New York Islanders': 'nyi',
  'New York Rangers': 'nyr',
  'Ottawa Senators': 'ott',
  'Philadelphia Flyers': 'phi',
  'Pittsburgh Penguins': 'pit',
  'San Jose Sharks': 'sj',
  'Seattle Kraken': 'sea',
  'St. Louis Blues': 'stl',
  'Tampa Bay Lightning': 'tb',
  'Toronto Maple Leafs': 'tor',
  'Utah Hockey Club': 'utah',
  'Vancouver Canucks': 'van',
  'Vegas Golden Knights': 'vgk',
  VEG: 'vgk',
  'Washington Capitals': 'wsh',
  'Winnipeg Jets': 'wpg',
  ANA: 'ana',
  BOS: 'bos',
  BUF: 'buf',
  CGY: 'cgy',
  CAR: 'car',
  CHI: 'chi',
  COL: 'col',
  CBJ: 'cbj',
  DAL: 'dal',
  DET: 'det',
  EDM: 'edm',
  FLA: 'fla',
  LA: 'la',
  MIN: 'min',
  MTL: 'mtl',
  NSH: 'nsh',
  NJ: 'nj',
  NYI: 'nyi',
  NYR: 'nyr',
  OTT: 'ott',
  PHI: 'phi',
  PIT: 'pit',
  SJ: 'sj',
  SEA: 'sea',
  STL: 'stl',
  TB: 'tb',
  TOR: 'tor',
  UTA: 'utah',
  VAN: 'van',
  VGK: 'vgk',
  WAS: 'wsh',
  WPG: 'wpg'
};

const OLYMPIC_TEAM_FLAGS: Record<string, string> = {
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

const OLYMPIC_TEAM_SEEDS: Record<string, number> = {
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

const OLYMPIC_STAGE_ORDER = [
  'Qualification play-offs',
  'Quarter-finals',
  'Semi-finals',
  'Gold medal game',
  'Bronze medal game'
] as const;

const OLYMPIC_STAGE_COLUMNS: Array<Array<(typeof OLYMPIC_STAGE_ORDER)[number]>> = [
  ['Qualification play-offs'],
  ['Quarter-finals'],
  ['Semi-finals'],
  ['Gold medal game', 'Bronze medal game']
];

const OLYMPIC_ROUND_BY_SLOT: Record<string, number> = {
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

const OLYMPIC_BASE_GAMES: OlympicBracketGame[] = [
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

const UEFA_STAGE_COLUMNS = [
  ['Round of 16'],
  ['Quarter-finals'],
  ['Semi-finals'],
  ['Final']
] as const;

const UEFA_ROUND_BY_SLOT: Record<string, number> = {
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

const UEFA_BASE_GAMES: OlympicBracketGame[] = [
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

const UEFA_TEAM_LOGOS: Record<string, string> = {
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

const UEFA_OFFICIAL_TIME_SLOTS = new Set(['R16-1', 'R16-2', 'R16-3', 'R16-4', 'R16-5', 'R16-6', 'R16-7', 'R16-8', 'FINAL']);

function uefaTeamLogoUrl(teamName: string): string | null {
  return UEFA_TEAM_LOGOS[teamName] ?? null;
}

function isOfficialUefaKickoff(slot: string): boolean {
  return UEFA_OFFICIAL_TIME_SLOTS.has(slot);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function fmtDateEastern(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(iso));
}

function toLocalDateTimeValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return String(d.getFullYear()) + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function countdownWithin24h(iso: string | undefined, nowMs: number): string | null {
  if (!iso) return null;

  const targetMs = new Date(iso).getTime();
  if (!Number.isFinite(targetMs)) return null;

  const deltaMs = targetMs - nowMs;
  if (deltaMs <= 0 || deltaMs > 24 * 60 * 60 * 1000) return null;

  const totalMinutes = Math.floor(deltaMs / (60 * 1000));
  if (totalMinutes <= 0) return 'in <1m';

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return 'in ' + minutes + 'm';
  return 'in ' + hours + 'h ' + minutes + 'm';
}

type ContestSportFilter = 'ALL' | 'Basketball' | 'Olympics' | 'Football' | 'Hockey' | 'Baseball' | 'Soccer';
type MarchRegionView = 'WEST' | 'EAST' | 'NORTH' | 'SOUTH' | 'FINAL_FOUR';

function contestTypeLabel(contest: Pick<Contest, 'type' | 'name'>): string {
  if (contest.type === 'PICKEM_NFL') return "NFL Pick'em";
  if (contest.type === 'PICKEM_NBA') return "NBA Pick'em";
  if (contest.type === 'PICKEM_NHL') return "NHL Pick'em";
  if (contest.name.toLowerCase().includes('uefa') || contest.name.toLowerCase().includes('champions league')) return 'UEFA Champions League Bracket';
  if (contest.name.toLowerCase().includes('olympic hockey')) return 'Olympic Hockey Bracket';
  if (contest.name.toLowerCase().includes('conference tournament champions')) return "Conference Champions Pick'em";
  return 'Bracket';
}

function contestMatchesSportFilter(contest: Pick<Contest, 'type' | 'name'>, filter: ContestSportFilter): boolean {
  if (filter === 'ALL') return true;

  const name = contest.name.toLowerCase();
  const isBasketball = contest.type === 'PICKEM_NBA' || name.includes('nba') || name.includes('basketball') || name.includes('ncaam');
  const isOlympics = name.includes('olympic');
  const isFootball = contest.type === 'PICKEM_NFL' || name.includes('nfl') || name.includes('football');
  const isHockey = contest.type === 'PICKEM_NHL' || name.includes('hockey') || name.includes('nhl');
  const isBaseball = name.includes('baseball') || name.includes('mlb');
  const isSoccer = name.includes('soccer') || name.includes('fifa') || name.includes('epl') || name.includes('premier league') || name.includes('uefa') || name.includes('champions league');

  if (filter === 'Basketball') return isBasketball;
  if (filter === 'Olympics') return isOlympics;
  if (filter === 'Football') return isFootball;
  if (filter === 'Hockey') return isHockey;
  if (filter === 'Baseball') return isBaseball;
  if (filter === 'Soccer') return isSoccer;

  return true;
}

function nbaLogoUrl(teamName: string): string | null {
  const key = teamName.trim();
  const abbr = NBA_TEAM_ABBR[key] ?? NBA_TEAM_ALIAS_ABBR[key.toUpperCase()];
  return abbr ? `/api/assets/logo/nba/${abbr}` : null;
}

function nhlLogoUrl(teamName: string): string | null {
  const key = teamName.trim();
  const abbr = NHL_TEAM_ABBR[key] ?? NHL_TEAM_ABBR[key.toUpperCase()];
  return abbr ? `/api/assets/logo/nhl/${abbr}` : null;
}

function teamDisplayName(team: OlympicBracketTeam): string {
  return team.seed ? `${team.seed} ${team.name}` : team.name;
}

function renderBracketTeamIcon(team: OlympicBracketTeam, logoUrl: string | null) {
  if (!logoUrl) {
    return <span className="flagBadge" aria-hidden="true">{team.flag}</span>;
  }

  return (
    <>
      <img
        className="flagLogo"
        src={logoUrl}
        alt={team.name + ' logo'}
        loading="lazy"
        onError={(event) => {
          const img = event.currentTarget;
          img.style.display = 'none';
          const fallback = img.nextElementSibling as HTMLElement | null;
          if (fallback) {
            fallback.style.display = 'grid';
          }
        }}
      />
      <span className="flagBadge teamIconFallback" aria-hidden="true">{team.flag}</span>
    </>
  );
}

function renderUefaTeamIcon(team: OlympicBracketTeam, logoUrl: string | null) {
  if (!logoUrl) {
    return <span className="flagBadge" aria-hidden="true">⚽</span>;
  }

  return (
    <>
      <img
        className="flagLogo"
        src={logoUrl}
        alt={team.name + ' logo'}
        loading="lazy"
        onError={(event) => {
          const img = event.currentTarget;
          img.style.display = 'none';
          const fallback = img.nextElementSibling as HTMLElement | null;
          if (fallback) fallback.style.display = 'grid';
        }}
      />
      <span className="flagBadge teamIconFallback" aria-hidden="true">⚽</span>
    </>
  );
}

function resolveFromSource(
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

function pickWinnerOf(slot: string, picks: Map<string, string>, gamesBySlot: Map<string, OlympicBracketGame>): OlympicBracketTeam | null {
  const game = gamesBySlot.get(slot);
  if (!game) return null;

  const pickedName = picks.get(slot);
  if (!pickedName) return null;

  return game.teams.find((team) => team.name === pickedName) ?? null;
}

function resolveOlympicBracketGames(picks: Map<string, string>): OlympicBracketGame[] {
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

function resolveUefaBracketGames(picks: Map<string, string>): OlympicBracketGame[] {
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

type SpotModelRow = {
  row_id: number;
  game_date: string;
  away_team: string;
  home_team: string;
  market_spread: number;
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

const SPOT_MODEL_WEIGHTS: Record<
  keyof Omit<SpotModelRow, 'row_id' | 'game_date' | 'away_team' | 'home_team' | 'market_spread'>,
  number
> = {
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

const SPOT_MODEL_THRESHOLD = 5.2049;

const SPOT_REQUIRED_COLUMNS = [
  'away_revenge',
  'home_lookahead',
  'home_letdown',
  'away_dog_value',
  'home_fatigue',
  'away_sharp_money',
  'away_rlm',
  'away_public_faded',
  'away_slow_pace',
  'home_travel_fatigue'
] as const;

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function parseSpotCsv(text: string): SpotModelRow[] {
  const lines = text.replace(/\r/g, '').split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

  for (const col of SPOT_REQUIRED_COLUMNS) {
    if (!(col in idx)) {
      throw new Error(`Missing required factor column: ${col}`);
    }
  }

  return lines.slice(1).map((line, i) => {
    const cols = splitCsvLine(line);
    const num = (k: string) => {
      const v = Number(cols[idx[k]] ?? 0);
      return Number.isFinite(v) ? v : 0;
    };
    const txt = (k: string, fallback = '') => (idx[k] !== undefined ? (cols[idx[k]] ?? '').trim() : fallback);

    return {
      row_id: idx.row_id !== undefined ? num('row_id') : i + 1,
      game_date: txt('game_date', txt('date', '')),
      away_team: txt('away_team', txt('team', `Away ${i + 1}`)),
      home_team: txt('home_team', txt('opponent', `Home ${i + 1}`)),
      market_spread: num('market_spread'),
      away_revenge: num('away_revenge'),
      home_lookahead: num('home_lookahead'),
      home_letdown: num('home_letdown'),
      away_dog_value: num('away_dog_value'),
      home_fatigue: num('home_fatigue'),
      away_sharp_money: num('away_sharp_money'),
      away_rlm: num('away_rlm'),
      away_public_faded: num('away_public_faded'),
      away_slow_pace: num('away_slow_pace'),
      home_travel_fatigue: num('home_travel_fatigue')
    };
  });
}

function spotScore(row: SpotModelRow): number {
  let total = 0;
  for (const key of SPOT_REQUIRED_COLUMNS) {
    total += row[key] * SPOT_MODEL_WEIGHTS[key];
  }
  return total;
}

function toCsvValue(value: string | number): string {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export default function App() {
  const [userId, setUserId] = useState<string>(localStorage.getItem(USER_KEY) ?? '');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [currentUserEmail, setCurrentUserEmail] = useState('');

  const [status, setStatus] = useState('Ready.');
  const [error, setError] = useState('');
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const [contests, setContests] = useState<Contest[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);

  const [selectedContestId, setSelectedContestId] = useState('');
  const [contestPageId, setContestPageId] = useState('');
  const [activeTopPage, setActiveTopPage] = useState<'home' | 'entries' | 'contest' | 'leaderboards' | 'groups' | 'user-stats'>('home');
  const [marchBracketZoom, setMarchBracketZoom] = useState(100);
  const [marchRegionView, setMarchRegionView] = useState<MarchRegionView>('WEST');
  const [games, setGames] = useState<Game[]>([]);
  const [isGamesLoading, setIsGamesLoading] = useState(false);
  const [pickDraft, setPickDraft] = useState<PickDraft>({});
  const [bracketDraft, setBracketDraft] = useState<BracketDraftRow[]>([{ gameSlot: '', pickedTeam: '', round: '1' }]);
  const [savedPicks, setSavedPicks] = useState<
    Array<{ gameId: string; pickedWinner: string; pointsAwarded: number; isCorrect: boolean | null }>
  >([]);
  const [savedBracket, setSavedBracket] = useState<
    Array<{ gameSlot: string; pickedTeam: string; pointsAwarded: number; isCorrect: boolean | null }>
  >([]);
  const [isSavedLoading, setIsSavedLoading] = useState(false);
  const [pickPercentagesByKey, setPickPercentagesByKey] = useState<Record<string, Record<string, number>>>({});

  const [groupName, setGroupName] = useState('');
  const [groupVisibility, setGroupVisibility] = useState<'PUBLIC' | 'PRIVATE'>('PUBLIC');
  const [groupPassword, setGroupPassword] = useState('');
  const [publicGroupName, setPublicGroupName] = useState('');
  const [privateGroupName, setPrivateGroupName] = useState('');
  const [privateGroupPassword, setPrivateGroupPassword] = useState('');
  const [popularPublicGroups, setPopularPublicGroups] = useState<PublicGroupRow[]>([]);
  const [privateGroupNames, setPrivateGroupNames] = useState<PrivateGroupNameRow[]>([]);
  const [isPopularGroupsLoading, setIsPopularGroupsLoading] = useState(false);

  const [overrideProviderGameId, setOverrideProviderGameId] = useState('');
  const [overrideStatus, setOverrideStatus] = useState('');
  const [overrideHomeScore, setOverrideHomeScore] = useState('');
  const [overrideAwayScore, setOverrideAwayScore] = useState('');
  const [overrideWinner, setOverrideWinner] = useState('');
  const [cloneName, setCloneName] = useState('');
  const [cloneSeason, setCloneSeason] = useState('');
  const [cloneStartsAt, setCloneStartsAt] = useState('');
  const [cloneIncludeGames, setCloneIncludeGames] = useState(true);
  const [tiebreakerGuess, setTiebreakerGuess] = useState('');
  const [backendHealth, setBackendHealth] = useState<{ ok: boolean; service: string } | null>(null);
  const [databaseHealth, setDatabaseHealth] = useState<import('./api').SystemDbHealth | null>(null);
  const [workerHealth, setWorkerHealth] = useState<import('./api').SystemWorkerHealth | null>(null);

  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [selectedGroupContestId, setSelectedGroupContestId] = useState('');
  const [leaderboardRows, setLeaderboardRows] = useState<Array<{ userId: string; displayName: string; totalPoints: number }>>([]);
  const [isGroupLeaderboardLoading, setIsGroupLeaderboardLoading] = useState(false);
  const [contestLeaderboards, setContestLeaderboards] = useState<Record<string, LeaderboardRow[]>>({});
  const [isContestLeaderboardsLoading, setIsContestLeaderboardsLoading] = useState(false);
  const [topOneAggregateRows, setTopOneAggregateRows] = useState<TopOneAggregateRow[]>([]);
  const [isTopOneAggregateLoading, setIsTopOneAggregateLoading] = useState(false);
  const [contestSportFilter, setContestSportFilter] = useState<ContestSportFilter>('ALL');
  const [priorContestSportFilter, setPriorContestSportFilter] = useState<ContestSportFilter>('ALL');
  const [leaderboardSportFilter, setLeaderboardSportFilter] = useState<ContestSportFilter>('ALL');
  const [selectedLeaderboardContestId, setSelectedLeaderboardContestId] = useState('');
  const [leaderboardTopOneOnly, setLeaderboardTopOneOnly] = useState(false);
  const [selectedLeaderboardEntry, setSelectedLeaderboardEntry] = useState<ParticipantContestEntry | null>(null);
  const [leaderboardEntryContestId, setLeaderboardEntryContestId] = useState('');
  const [isLeaderboardEntryLoading, setIsLeaderboardEntryLoading] = useState(false);
  const [selectedUserStats, setSelectedUserStats] = useState<UserStatsProfile | null>(null);
  const [isUserStatsLoading, setIsUserStatsLoading] = useState(false);
  const [statsUserId, setStatsUserId] = useState('');
  const marchBracketScrollerRef = useRef<HTMLDivElement | null>(null);
  const [statsReturnPage, setStatsReturnPage] = useState<'home' | 'entries' | 'contest' | 'leaderboards' | 'groups'>('leaderboards');
  const [contestViewEntry, setContestViewEntry] = useState<ParticipantContestEntry | null>(null);

  const selectedContest = useMemo(
    () => contests.find((contest) => contest.id === selectedContestId),
    [contests, selectedContestId]
  );
  const selectedGroupContest = useMemo(
    () => contests.find((contest) => contest.id === selectedGroupContestId),
    [contests, selectedGroupContestId]
  );

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.contestId === selectedContestId),
    [entries, selectedContestId]
  );
  const visibleEntries = useMemo(
    () => (contestPageId ? entries.filter((entry) => entry.contestId === contestPageId) : entries),
    [entries, contestPageId]
  );
  const selectedContestLeaderboardRows = useMemo(
    () => (selectedContestId ? (contestLeaderboards[selectedContestId] ?? []) : []),
    [contestLeaderboards, selectedContestId]
  );
  const displayedEntryUserId = contestViewEntry?.entry.userId ?? selectedEntry?.userId ?? '';
  const displayedEntryPoints = contestViewEntry?.entry.totalPoints ?? selectedEntry?.totalPoints ?? 0;
  const displayedEntryRank = displayedEntryUserId
    ? rankForUserByPoints(selectedContestLeaderboardRows, displayedEntryUserId)
    : null;
  const displayedEntryPercentile = displayedEntryRank
    ? percentileFromRank(selectedContestLeaderboardRows.length, displayedEntryRank)
    : null;
  const activeEntries = useMemo(() => {
    const contestById = new Map(contests.map((contest) => [contest.id, contest]));
    return entries.filter((entry) => {
      const contest = contestById.get(entry.contestId);
      if (!contest) return true;
      const normalized = contest.status.toUpperCase();
      return normalized !== 'COMPLETE' && normalized !== 'COMPLETED';
    });
  }, [entries, contests]);
  const priorEntries = useMemo(() => {
    const contestById = new Map(contests.map((contest) => [contest.id, contest]));
    return entries.filter((entry) => {
      const contest = contestById.get(entry.contestId);
      if (!contest) return false;
      const normalized = contest.status.toUpperCase();
      return normalized === 'COMPLETE' || normalized === 'COMPLETED';
    });
  }, [entries, contests]);
  const filteredContests = useMemo(
    () => contests.filter((contest) => contestMatchesSportFilter(contest, contestSportFilter)),
    [contests, contestSportFilter]
  );
  const upcomingDraftContests = useMemo(() => {
    return filteredContests.filter((contest) => contest.status.toUpperCase() === 'DRAFT');
  }, [filteredContests]);
  const activeContests = useMemo(() => {
    return filteredContests.filter((contest) => {
      const normalized = contest.status.toUpperCase();
      return normalized !== 'DRAFT' && normalized !== 'COMPLETE' && normalized !== 'COMPLETED';
    });
  }, [filteredContests]);
  const filteredPriorEntries = useMemo(() => {
    const contestById = new Map(contests.map((contest) => [contest.id, contest]));
    return priorEntries.filter((entry) => {
      const contest = contestById.get(entry.contestId);
      if (!contest) return false;
      return contestMatchesSportFilter(contest, priorContestSportFilter);
    });
  }, [priorEntries, contests, priorContestSportFilter]);
  const entryByContestId = useMemo(() => {
    const map = new Map<string, Entry>();
    for (const entry of entries) {
      if (!map.has(entry.contestId)) {
        map.set(entry.contestId, entry);
      }
    }
    return map;
  }, [entries]);
  const filteredLeaderboardContests = useMemo(
    () => contests.filter((contest) => contestMatchesSportFilter(contest, leaderboardSportFilter)),
    [contests, leaderboardSportFilter]
  );
  const leaderboardContestsToRender = useMemo(() => {
    if (!selectedLeaderboardContestId || selectedLeaderboardContestId === LEADERBOARD_TOP_ONE_OPTION) return [];
    return filteredLeaderboardContests.filter((contest) => contest.id === selectedLeaderboardContestId);
  }, [filteredLeaderboardContests, selectedLeaderboardContestId]);

  const isNbaContest = selectedContest?.type === 'PICKEM_NBA';
  const isNhlContest = selectedContest?.type === 'PICKEM_NHL';
  const isStraightPickemContest = isNbaContest || isNhlContest;
  const isPickemContest = selectedContest?.type === 'PICKEM_NFL' || selectedContest?.type === 'PICKEM_NBA' || selectedContest?.type === 'PICKEM_NHL';
  const isContestCreator = currentUserEmail.trim().toLowerCase() === CREATOR_EMAIL;
  const isOlympicBracketContest =
    selectedContest?.type === 'BRACKET_NCAAM' &&
    ((selectedContest.name.toLowerCase().includes('olympic') && selectedContest.name.toLowerCase().includes('hockey')) ||
      selectedContest.name.toLowerCase().includes("men's hockey"));
  const isUefaBracketContest =
    selectedContest?.type === 'BRACKET_NCAAM' &&
    (selectedContest.name.toLowerCase().includes('uefa') || selectedContest.name.toLowerCase().includes('champions league'));
  const isConferenceChampionsContest =
    selectedContest?.type === 'BRACKET_NCAAM' &&
    selectedContest.name.toLowerCase().includes('conference tournament champions');
  const isMarchMadnessStandardContest =
    selectedContest?.type === 'BRACKET_NCAAM' &&
    selectedContest.name.toLowerCase().includes('march madness') &&
    selectedContest.name.toLowerCase().includes('standard');
  const savedPickRowByGame = useMemo(() => new Map(savedPicks.map((pick) => [pick.gameId, pick])), [savedPicks]);
  const savedBracketBySlot = useMemo(() => new Map(savedBracket.map((pick) => [pick.gameSlot, pick.pickedTeam])), [savedBracket]);
  const savedBracketRowBySlot = useMemo(() => new Map(savedBracket.map((pick) => [pick.gameSlot, pick])), [savedBracket]);
  const olympicGames = useMemo(() => resolveOlympicBracketGames(savedBracketBySlot), [savedBracketBySlot]);
  const uefaGames = useMemo(() => resolveUefaBracketGames(savedBracketBySlot), [savedBracketBySlot]);
  const contestGameByProviderId = useMemo(() => new Map(games.map((game) => [game.providerGameId, game])), [games]);
  const selectedOverrideGame = useMemo(
    () => games.find((game) => game.providerGameId === overrideProviderGameId),
    [games, overrideProviderGameId]
  );
  const marchMadnessGamesByRound = useMemo(() => {
    function slotNum(providerGameId: string): number {
      const parts = providerGameId.split('-');
      return Number(parts[1] ?? 0);
    }
    const byPrefix = (prefix: string) => games
      .filter((game) => game.providerGameId.startsWith(prefix))
      .sort((a, b) => slotNum(a.providerGameId) - slotNum(b.providerGameId));

    return {
      r64: byPrefix('R64-'),
      r32: byPrefix('R32-'),
      s16: byPrefix('S16-'),
      e8: byPrefix('E8-'),
      f4: byPrefix('F4-'),
      champ: byPrefix('CHAMP-')
    };
  }, [games]);
  const marchRoundsForView = useMemo(() => {
    if (marchRegionView === 'FINAL_FOUR') {
      return [
        { key: 'f4', label: 'Final Four', rows: marchMadnessGamesByRound.f4 },
        { key: 'champ', label: 'Championship', rows: marchMadnessGamesByRound.champ }
      ];
    }

    const regionIdx = marchRegionIndex(marchRegionView);
    const takeSlice = (rows: Game[], perRegion: number) => rows.slice(regionIdx * perRegion, (regionIdx + 1) * perRegion);

    return [
      { key: 'r64', label: 'Round of 64', rows: takeSlice(marchMadnessGamesByRound.r64, 8) },
      { key: 'r32', label: 'Round of 32', rows: takeSlice(marchMadnessGamesByRound.r32, 4) },
      { key: 's16', label: 'Sweet 16', rows: takeSlice(marchMadnessGamesByRound.s16, 2) },
      { key: 'e8', label: 'Elite 8', rows: takeSlice(marchMadnessGamesByRound.e8, 1) }
    ];
  }, [marchMadnessGamesByRound, marchRegionView]);

  const marchJumpRounds = useMemo(
    () => marchRoundsForView.map((round) => ({ key: round.key, label: round.key.toUpperCase().replace('CHAMP', 'FINAL') })),
    [marchRoundsForView]
  );

  const isViewingContestParticipantEntry = useMemo(
    () => !!contestViewEntry && contestViewEntry.contestId === selectedContestId,
    [contestViewEntry, selectedContestId]
  );

  function formatStatusTimestamp(value: string | null | undefined): string {
    if (!value) return 'Never';
    return new Date(value).toLocaleString();
  }

  function formatPickPercent(value: number | undefined): string {
    if (value === undefined) return '0% picked';
    const rounded = Math.abs(value - Math.round(value)) < 0.05 ? Math.round(value) : Math.round(value * 10) / 10;
    return `${rounded}% picked`;
  }

  function pickPercentFor(gameKey: string, team: string): string {
    return formatPickPercent(pickPercentagesByKey[gameKey]?.[team]);
  }

  function formatPickResult(isCorrect: boolean | null): string {
    if (isCorrect === true) return 'Correct';
    if (isCorrect === false) return 'Wrong';
    return 'Pending';
  }

  function getOlympicGame(slot: string): OlympicBracketGame | undefined {
    return olympicGames.find((game) => game.slot === slot) ?? OLYMPIC_BASE_GAMES.find((game) => game.slot === slot);
  }


  function renderOlympicClassicGame(game: OlympicBracketGame, index: number) {
    const [teamA, teamB] = game.teams;
    const savedWinner = savedBracketBySlot.get(game.slot);
    const savedBracketRow = savedBracketRowBySlot.get(game.slot);
    const teamAResultIcon =
      savedBracketRow?.pickedTeam === teamA.name && savedBracketRow.isCorrect !== null
        ? savedBracketRow.isCorrect
          ? <span className="saveCheck" aria-label="Correct">✓</span>
          : <span className="saveMiss" aria-label="Wrong">✕</span>
        : null;
    const teamBResultIcon =
      savedBracketRow?.pickedTeam === teamB.name && savedBracketRow.isCorrect !== null
        ? savedBracketRow.isCorrect
          ? <span className="saveCheck" aria-label="Correct">✓</span>
          : <span className="saveMiss" aria-label="Wrong">✕</span>
        : null;

    const gameStart = contestGameByProviderId.get(game.slot)?.startTime;
    const kickoffLabel = gameStart ? fmtDateEastern(gameStart) + ' ET' : game.dateLabel;

    return (
      <article key={game.slot} className="pickRow olympicGameCard" data-game-index={index}>
        <div className="muted olympicMeta">{kickoffLabel}</div>
        <div className="olympicTeamButtons">
          <button
            type="button"
            className={'teamPickBtn ' + (savedWinner === teamA.name ? 'selected' : '')}
            onClick={() => onSelectOlympicBracketTeam(game.slot, game.round, teamA.name)}
            disabled={isSavedLoading || isViewingContestParticipantEntry}
          >
            {renderBracketTeamIcon(teamA, null)}
            <span>{teamDisplayName(teamA)}</span>
            <span className="pickPct">{pickPercentFor(game.slot, teamA.name)}</span>
            {teamAResultIcon}
          </button>

          <button
            type="button"
            className={'teamPickBtn ' + (savedWinner === teamB.name ? 'selected' : '')}
            onClick={() => onSelectOlympicBracketTeam(game.slot, game.round, teamB.name)}
            disabled={isSavedLoading || isViewingContestParticipantEntry}
          >
            {renderBracketTeamIcon(teamB, null)}
            <span>{teamDisplayName(teamB)}</span>
            <span className="pickPct">{pickPercentFor(game.slot, teamB.name)}</span>
            {teamBResultIcon}
          </button>
        </div>
      </article>
    );
  }

  function getUefaGame(slot: string): OlympicBracketGame | undefined {
    return uefaGames.find((game) => game.slot === slot) ?? UEFA_BASE_GAMES.find((game) => game.slot === slot);
  }

  function renderUefaClassicGame(game: OlympicBracketGame, round: 'r16' | 'qf' | 'sf' | 'final', index: number) {
    const [teamA, teamB] = game.teams;
    const savedWinner = savedBracketBySlot.get(game.slot);
    const savedBracketRow = savedBracketRowBySlot.get(game.slot);
    const teamAResultIcon =
      savedBracketRow?.pickedTeam === teamA.name && savedBracketRow.isCorrect !== null
        ? savedBracketRow.isCorrect
          ? <span className="saveCheck" aria-label="Correct">✓</span>
          : <span className="saveMiss" aria-label="Wrong">✕</span>
        : null;
    const teamBResultIcon =
      savedBracketRow?.pickedTeam === teamB.name && savedBracketRow.isCorrect !== null
        ? savedBracketRow.isCorrect
          ? <span className="saveCheck" aria-label="Correct">✓</span>
          : <span className="saveMiss" aria-label="Wrong">✕</span>
        : null;

    const gameStart = contestGameByProviderId.get(game.slot)?.startTime;
    const kickoffLabel = isOfficialUefaKickoff(game.slot) && gameStart ? `${fmtDateEastern(gameStart)} ET` : `${game.dateLabel} · TBD`;
    const teamALogo = uefaTeamLogoUrl(teamA.name);
    const teamBLogo = uefaTeamLogoUrl(teamB.name);

    const gridRow = round === 'r16' ? 2 + index * 2 : round === 'qf' ? 3 + index * 4 : round === 'sf' ? 5 + index * 8 : 9;
    const roundClass = round === 'r16' ? 'uefaRound-r16' : round === 'qf' ? 'uefaRound-qf' : round === 'sf' ? 'uefaRound-sf' : 'uefaRound-final';
    const hasRightStub = round !== 'final';
    const hasLeftStub = round !== 'r16';
    const joinClass = round === 'final' ? '' : index % 2 === 0 ? 'uefaJoinTop' : 'uefaJoinBottom';

    return (
      <article
        key={game.slot}
        className={`pickRow olympicGameCard uefaIsoGame ${roundClass} ${hasLeftStub ? 'uefaHasLeftStub' : ''} ${hasRightStub ? 'uefaHasRightStub' : ''}`}
        data-round={round}
        data-game-index={index}
        style={{ gridRow: String(gridRow) }}
      >
        <div className="muted olympicMeta">{kickoffLabel} · {game.slot}</div>
        <div className="olympicTeamButtons">
          <button
            type="button"
            className={`teamPickBtn ${savedWinner === teamA.name ? 'selected' : ''}`}
            onClick={() => onSelectOlympicBracketTeam(game.slot, game.round, teamA.name)}
            disabled={isSavedLoading || isViewingContestParticipantEntry}
          >
            {renderUefaTeamIcon(teamA, teamALogo)}
            <span className="uefaTeamName">{teamDisplayName(teamA)}</span>
            <span className="pickPct">{pickPercentFor(game.slot, teamA.name)}</span>
            {teamAResultIcon}
          </button>

          <button
            type="button"
            className={`teamPickBtn ${savedWinner === teamB.name ? 'selected' : ''}`}
            onClick={() => onSelectOlympicBracketTeam(game.slot, game.round, teamB.name)}
            disabled={isSavedLoading || isViewingContestParticipantEntry}
          >
            {renderUefaTeamIcon(teamB, teamBLogo)}
            <span className="uefaTeamName">{teamDisplayName(teamB)}</span>
            <span className="pickPct">{pickPercentFor(game.slot, teamB.name)}</span>
            {teamBResultIcon}
          </button>
        </div>
        {joinClass ? <span className={`uefaJoin ${joinClass}`} aria-hidden="true" /> : null}
      </article>
    );
  }


  function marchResolveTeamName(teamName: string): string {
    const match = /^Winner\s+([A-Z0-9-]+)$/i.exec(teamName.trim());
    if (!match) return teamName;

    const sourceSlot = match[1].toUpperCase();
    return savedBracketBySlot.get(sourceSlot) ?? teamName;
  }

  function marchRegionIndex(region: MarchRegionView): number {
    if (region === 'WEST') return 0;
    if (region === 'EAST') return 1;
    if (region === 'NORTH') return 2;
    if (region === 'SOUTH') return 3;
    return 0;
  }

  function marchRoundStage(roundKey: string): number {
    if (roundKey === 'r64') return 0;
    if (roundKey === 'r32') return 1;
    if (roundKey === 's16') return 2;
    if (roundKey === 'e8') return 3;
    if (roundKey === 'f4') return 4;
    return 5;
  }

  function marchGridRow(roundKey: string, index: number): number {
    const stage = marchRoundStage(roundKey);
    return (2 ** stage) + (index * (2 ** (stage + 1))) + 1;
  }

  function marchGridRowForView(roundKey: string, index: number, view: MarchRegionView): number {
    if (view === 'FINAL_FOUR') {
      const localStage = roundKey === 'f4' ? 0 : 1;
      return (2 ** localStage) + (index * (2 ** (localStage + 1))) + 1;
    }

    return marchGridRow(roundKey, index);
  }

  function jumpToMarchRound(roundKey: string) {
    const scroller = marchBracketScrollerRef.current;
    const roundNode = document.getElementById('march-round-' + roundKey);
    if (!scroller || !roundNode) return;

    const targetLeft = roundNode.offsetLeft - scroller.offsetLeft - 12;
    scroller.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
  }

  function isCurrentUser(rowUserId: string): boolean {
    return rowUserId.trim().toLowerCase() === userId.trim().toLowerCase();
  }

  function leaderboardDisplayName(row: LeaderboardRow): string {
    return row.displayName;
  }

  function rankFromPoints(rows: Array<{ totalPoints: number }>, index: number): number {
    if (index === 0) return 1;
    let rank = 1;
    for (let i = 1; i <= index; i += 1) {
      if (rows[i].totalPoints < rows[i - 1].totalPoints) {
        rank = i + 1;
      }
    }
    return rank;
  }

  function rankFromTopOneCount(rows: Array<{ topOneCount: number }>, index: number): number {
    if (index === 0) return 1;
    let rank = 1;
    for (let i = 1; i <= index; i += 1) {
      if (rows[i].topOneCount < rows[i - 1].topOneCount) {
        rank = i + 1;
      }
    }
    return rank;
  }

  function rankForUserByPoints(rows: Array<{ userId: string; totalPoints: number }>, rowUserId: string): number | null {
    const index = rows.findIndex((row) => row.userId.trim().toLowerCase() === rowUserId.trim().toLowerCase());
    if (index < 0) return null;
    return rankFromPoints(rows, index);
  }

  function percentileFromRank(totalEntries: number, rank: number): number {
    if (totalEntries <= 1) return 100;
    const percentile = ((totalEntries - rank) / (totalEntries - 1)) * 100;
    return Math.max(0, Math.min(100, percentile));
  }

  function topOneCutoffPoints(rows: Array<{ totalPoints: number }>): number {
    if (rows.length === 0) return Number.POSITIVE_INFINITY;
    const topCount = Math.max(1, Math.ceil(rows.length * 0.01));
    return rows[Math.min(rows.length - 1, topCount - 1)].totalPoints;
  }

  function isTopOnePercentEntry(rows: Array<{ totalPoints: number }>, row: { totalPoints: number }): boolean {
    const cutoff = topOneCutoffPoints(rows);
    return row.totalPoints >= cutoff;
  }

  async function openParticipantContestEntry(contestId: string, participantUserId: string) {
    if (!userId) return;

    setError('');
    setLeaderboardEntryContestId(contestId);
    setIsLeaderboardEntryLoading(true);

    try {
      const data = await api.contestantEntry(userId, contestId, participantUserId);
      setContestViewEntry(data);
      setSelectedContestId(contestId);
      setContestPageId(contestId);
      setActiveTopPage('contest');
      setSelectedGroupId('');
      setLeaderboardRows([]);

      const params = new URLSearchParams(window.location.search);
      params.set('contestId', contestId);
      const next = window.location.pathname + '?' + params.toString();
      window.history.pushState({}, '', next);

      setStatus('Participant entry loaded.');
      setTimeout(() => scrollToSection('contest-detail'), 0);
    } catch (err) {
      setContestViewEntry(null);
      setError((err as Error).message);
    } finally {
      setIsLeaderboardEntryLoading(false);
    }
  }

  function onLeaderboardNameClick(contestId: string, rowUserId: string) {
    if (isCurrentUser(rowUserId)) {
      setSelectedLeaderboardEntry(null);
      setLeaderboardEntryContestId('');
      openContestPage(contestId);
      return;
    }
    void openParticipantContestEntry(contestId, rowUserId);
  }

  async function refreshPickPercentages(contestId: string) {
    const data = await api.contestPickPercentages(contestId);
    const next: Record<string, Record<string, number>> = {};

    for (const row of data.rows) {
      if (!next[row.gameKey]) next[row.gameKey] = {};
      next[row.gameKey][row.team] = row.percent;
    }

    setPickPercentagesByKey(next);
  }

  async function refreshPopularGroups(contestId: string) {
    if (!contestId) {
      setPopularPublicGroups([]);
      setPrivateGroupNames([]);
      return;
    }

    setIsPopularGroupsLoading(true);
    try {
      const [publicData, privateData] = await Promise.all([
        api.publicGroups(userId, contestId),
        api.privateGroupNames(userId, contestId)
      ]);
      setPopularPublicGroups(publicData.groups);
      setPrivateGroupNames(privateData.groups);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsPopularGroupsLoading(false);
    }
  }

  async function refreshAll(activeUserId = userId, contestId: string | null = selectedContestId || null) {
    if (!activeUserId) return;

    const me = await api.me(activeUserId);
    const isCreator = me.email.trim().toLowerCase() === CREATOR_EMAIL;

    const [contestData, groupData, entryData] = await Promise.all([
      isCreator ? api.adminContests(activeUserId) : api.contests(),
      api.groups(activeUserId, contestId ?? undefined),
      api.entriesMe(activeUserId)
    ]);

    setContests(contestData.contests);
    setGroups(groupData.groups);
    setEntries(entryData.entries);
    setCurrentUserEmail(me.email);
  }

  useEffect(() => {
    if (!userId) return;
    refreshAll().catch((err: Error) => setError(err.message));
  }, [userId]);


  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const applyFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const contestId = params.get('contestId') ?? '';
      if (contestId) {
        setContestPageId(contestId);
        setSelectedContestId(contestId);
        setActiveTopPage('contest');
      } else {
        setContestPageId('');
        setActiveTopPage('home');
      }
    };

    applyFromUrl();
    window.addEventListener('popstate', applyFromUrl);
    return () => window.removeEventListener('popstate', applyFromUrl);
  }, []);

  useEffect(() => {
    let active = true;

    if (
      !userId ||
      activeTopPage !== 'leaderboards' ||
      !selectedLeaderboardContestId ||
      selectedLeaderboardContestId === LEADERBOARD_TOP_ONE_OPTION
    ) {
      setIsContestLeaderboardsLoading(false);
      return () => {
        active = false;
      };
    }

    setIsContestLeaderboardsLoading(true);

    api
      .contestLeaderboard(userId, selectedLeaderboardContestId)
      .then((data) => {
        if (!active) return;
        setContestLeaderboards((prev) => ({
          ...prev,
          [selectedLeaderboardContestId]: data.leaderboard
        }));
      })
      .catch((err: Error) => {
        if (!active) return;
        setError(err.message);
      })
      .finally(() => {
        if (!active) return;
        setIsContestLeaderboardsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [userId, activeTopPage, selectedLeaderboardContestId]);


  useEffect(() => {
    const contestIdForPublicGroups = activeTopPage === 'groups' ? selectedGroupContestId : activeTopPage === 'contest' ? selectedContestId : '';

    if (!userId || !contestIdForPublicGroups) {
      setPopularPublicGroups([]);
      setPrivateGroupNames([]);
      setIsPopularGroupsLoading(false);
      return;
    }

    void refreshPopularGroups(contestIdForPublicGroups);
  }, [userId, activeTopPage, selectedGroupContestId, selectedContestId]);

  useEffect(() => {
    let active = true;

    if (!userId || activeTopPage !== 'contest' || !selectedContestId) {
      return () => {
        active = false;
      };
    }

    api
      .contestLeaderboard(userId, selectedContestId)
      .then((data) => {
        if (!active) return;
        setContestLeaderboards((prev) => ({ ...prev, [selectedContestId]: data.leaderboard }));
      })
      .catch((err: Error) => {
        if (!active) return;
        setError(err.message);
      });

    return () => {
      active = false;
    };
  }, [userId, activeTopPage, selectedContestId]);

  useEffect(() => {
    let active = true;

    if (!userId || activeTopPage !== 'leaderboards') {
      setIsTopOneAggregateLoading(false);
      return () => {
        active = false;
      };
    }

    setIsTopOneAggregateLoading(true);

    api
      .topOneLeaderboard(userId)
      .then((data) => {
        if (!active) return;
        setTopOneAggregateRows(data.leaderboard);
      })
      .catch((err: Error) => {
        if (!active) return;
        setError(err.message);
      })
      .finally(() => {
        if (!active) return;
        setIsTopOneAggregateLoading(false);
      });

    return () => {
      active = false;
    };
  }, [userId, activeTopPage]);

  useEffect(() => {
    if (activeTopPage !== 'leaderboards') {
      setSelectedLeaderboardEntry(null);
      setLeaderboardEntryContestId('');
      setIsLeaderboardEntryLoading(false);
    }
  }, [activeTopPage]);

  useEffect(() => {
    if (!selectedContest) return;

    const nextYear = selectedContest.season + 1;
    const defaultName = selectedContest.name.includes(String(selectedContest.season))
      ? selectedContest.name.replace(String(selectedContest.season), String(nextYear))
      : selectedContest.name + ' ' + String(nextYear);

    const nextStart = new Date(selectedContest.startsAt);
    nextStart.setFullYear(nextStart.getFullYear() + 1);

    setCloneName(defaultName);
    setCloneSeason(String(nextYear));
    setCloneStartsAt(toLocalDateTimeValue(nextStart.toISOString()));
    setCloneIncludeGames(true);
  }, [selectedContest?.id]);

  useEffect(() => {
    if (!selectedLeaderboardContestId) return;
    if (selectedLeaderboardContestId === LEADERBOARD_TOP_ONE_OPTION) return;
    const stillVisible = filteredLeaderboardContests.some((contest) => contest.id === selectedLeaderboardContestId);
    if (!stillVisible) {
      setSelectedLeaderboardContestId('');
      setSelectedLeaderboardEntry(null);
      setLeaderboardEntryContestId('');
    }
  }, [filteredLeaderboardContests, selectedLeaderboardContestId]);

  useEffect(() => {
    let active = true;

    if (!userId) return () => {
      active = false;
    };

    const groupsContestId = activeTopPage === 'groups' ? selectedGroupContestId : selectedContestId;
    if (!groupsContestId) {
      setGroups([]);
      setSelectedGroupId('');
      return () => {
        active = false;
      };
    }

    api
      .groups(userId, groupsContestId)
      .then((data) => {
        if (!active) return;
        const scopedGroups = data.groups.filter((group) => group.contestId === groupsContestId);
        setGroups(scopedGroups);
        if (scopedGroups.every((group) => group.id !== selectedGroupId)) {
          setSelectedGroupId('');
        }
      })
      .catch((err: Error) => {
        if (!active) return;
        setError(err.message);
      });

    return () => {
      active = false;
    };
  }, [userId, selectedContestId, selectedGroupContestId, activeTopPage, selectedGroupId]);

  useEffect(() => {
    if (!userId || activeTopPage !== 'contest' || !contestPageId || !selectedContest || !isContestCreator) {
      setBackendHealth(null);
      setDatabaseHealth(null);
      setWorkerHealth(null);
      return;
    }

    let cancelled = false;
    Promise.allSettled([api.backendHealth(), api.dbHealth(), api.workerHealth()]).then((results) => {
      if (cancelled) return;
      setBackendHealth(results[0].status === 'fulfilled' ? results[0].value : { ok: false, service: 'unreachable' });
      setDatabaseHealth(
        results[1].status === 'fulfilled'
          ? results[1].value
          : { ok: false, host: 'unreachable', latencyMs: 0, mode: 'postgres', error: results[1].reason instanceof Error ? results[1].reason.message : 'Unavailable' }
      );
      setWorkerHealth(
        results[2].status === 'fulfilled'
          ? results[2].value
          : {
              enabled: false,
              intervalSeconds: 0,
              running: false,
              lastStartedAt: null,
              lastCompletedAt: null,
              lastSucceededAt: null,
              lastFailedAt: null,
              lastError: results[2].reason instanceof Error ? results[2].reason.message : 'Unavailable',
              lastSyncedContests: 0,
              lastGradedContests: 0,
              lastChangedEntries: 0
            }
      );
    });

    return () => {
      cancelled = true;
    };
  }, [userId, activeTopPage, contestPageId, selectedContest, isContestCreator, status]);

  useEffect(() => {
    let active = true;

    setGames([]);
    setPickDraft({});
    setPickPercentagesByKey({});

    if (!selectedContestId) {
      setIsGamesLoading(false);
      return () => {
        active = false;
      };
    }

    setIsGamesLoading(true);

    Promise.all([api.contestGames(selectedContestId), api.contestPickPercentages(selectedContestId)])
      .then(([gamesData, percentagesData]) => {
        if (!active) return;

        setGames(gamesData.games);
        const draft: PickDraft = {};
        gamesData.games.forEach((game) => {
          draft[game.id] = { pickedWinner: '', confidencePoints: '' };
        });
        setPickDraft(draft);

        const next: Record<string, Record<string, number>> = {};
        percentagesData.rows.forEach((row) => {
          if (!next[row.gameKey]) next[row.gameKey] = {};
          next[row.gameKey][row.team] = row.percent;
        });
        setPickPercentagesByKey(next);
      })
      .catch((err: Error) => {
        if (!active) return;
        setGames([]);
        setPickDraft({});
        setPickPercentagesByKey({});
        setError(err.message);
      })
      .finally(() => {
        if (!active) return;
        setIsGamesLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selectedContestId]);

  useEffect(() => {
    let active = true;

    setSavedPicks([]);
    setSavedBracket([]);
    setTiebreakerGuess('');

    if (!selectedContestId || !selectedContest) {
      setIsSavedLoading(false);
      return () => {
        active = false;
      };
    }

    if (contestViewEntry && contestViewEntry.contestId === selectedContestId) {
      if (selectedContest.type === 'BRACKET_NCAAM') {
        const rows = (contestViewEntry.picks as ParticipantEntryBracketPick[]).map((pick) => ({
          gameSlot: pick.gameSlot,
          pickedTeam: pick.pickedTeam,
          pointsAwarded: pick.pointsAwarded,
          isCorrect: pick.isCorrect
        }));
        setSavedBracket(rows);
        setTiebreakerGuess(contestViewEntry.tiebreaker?.answer ?? '');
      } else {
        const rows = (contestViewEntry.picks as ParticipantEntryPickemPick[]).map((pick) => ({
          gameId: pick.gameId,
          pickedWinner: pick.pickedWinner,
          pointsAwarded: pick.pointsAwarded,
          isCorrect: pick.isCorrect
        }));
        setSavedPicks(rows);
      }
      setIsSavedLoading(false);
      return () => {
        active = false;
      };
    }

    if (!selectedEntry) {
      setIsSavedLoading(false);
      return () => {
        active = false;
      };
    }

    setIsSavedLoading(true);

    const load = async () => {
      try {
        if (selectedContest.type === 'BRACKET_NCAAM') {
          const [data, tiebreakerData] = await Promise.all([
            api.getBracket(userId, selectedContestId, selectedEntry.id),
            api.getEntryTiebreaker(userId, selectedContestId, selectedEntry.id).catch(() => ({ tiebreaker: null }))
          ]);
          if (!active) return;
          setSavedBracket(data.picks);
          setTiebreakerGuess(tiebreakerData.tiebreaker?.answer ?? '');
          return;
        }

        const data = await api.getPicks(userId, selectedContestId, selectedEntry.id);
        if (!active) return;
        setSavedPicks(data.picks);
      } catch (err) {
        if (!active) return;
        setError((err as Error).message);
      } finally {
        if (!active) return;
        setIsSavedLoading(false);
      }
    };

    load();

    return () => {
      active = false;
    };
  }, [userId, selectedContestId, selectedContest?.type, selectedEntry?.id, contestViewEntry]);

  useEffect(() => {
    if (!isStraightPickemContest || savedPicks.length === 0) return;
    setPickDraft((prev) => {
      const next: PickDraft = { ...prev };
      for (const pick of savedPicks) {
        next[pick.gameId] = {
          ...(next[pick.gameId] ?? { confidencePoints: '' }),
          pickedWinner: pick.pickedWinner
        };
      }
      return next;
    });
  }, [isStraightPickemContest, savedPicks]);

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const login = await api.login(email, displayName);
      localStorage.setItem(USER_KEY, login.userId);
      setUserId(login.userId);
      setStatus('Logged in.');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onCreateGroup(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const contestId = activeContestIdForGroupActions();
      if (!contestId) {
        setError('Select a contest first to create a group.');
        return;
      }
      if (groupVisibility === 'PRIVATE' && groupPassword.trim().length < 4) {
        setError('Private groups require a password with at least 4 characters.');
        return;
      }
      await api.createGroup(userId, contestId, groupName, groupVisibility, groupVisibility === 'PRIVATE' ? groupPassword.trim() : undefined);
      setGroupName('');
      setGroupPassword('');
      await refreshAll(userId, contestId || null);
      await refreshPopularGroups(contestId);
      setStatus(groupVisibility === 'PRIVATE' ? 'Private group created.' : 'Public group created.');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onJoinGroup(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const contestId = activeContestIdForGroupActions();
      if (!contestId) {
        setError('Select a contest first to join a group.');
        return;
      }
      const matchedGroup = popularPublicGroups.find((group) => !group.isMember && group.name.trim().toLowerCase() === publicGroupName.trim().toLowerCase());
      if (!matchedGroup) {
        setError('Enter the exact public group name.');
        return;
      }
      await api.joinGroup(userId, contestId, matchedGroup.id);
      setPublicGroupName('');
      await refreshAll(userId, contestId);
      await refreshPopularGroups(contestId);
      setStatus('Joined public group.');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onJoinPrivateGroup(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const contestId = activeContestIdForGroupActions();
      if (!contestId) {
        setError('Select a contest first to join a group.');
        return;
      }
      if (!privateGroupName.trim()) {
        setError('Enter the private group name.');
        return;
      }
      if (!privateGroupPassword.trim()) {
        setError('Enter the private group password.');
        return;
      }
      await api.joinPrivateGroup(userId, contestId, privateGroupName.trim(), privateGroupPassword.trim());
      setPrivateGroupName('');
      setPrivateGroupPassword('');
      await refreshAll(userId, contestId);
      await refreshPopularGroups(contestId);
      setStatus('Joined private group.');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onSaveUefaTiebreaker() {
    if (!selectedContestId || !selectedEntry || isViewingContestParticipantEntry) return;
    const trimmed = tiebreakerGuess.trim();
    if (!trimmed) {
      setError('Enter a tiebreaker guess.');
      return;
    }
    const numericGuess = Number(trimmed);
    if (!Number.isInteger(numericGuess) || numericGuess < 0) {
      setError('Enter a whole number for the tiebreaker guess.');
      return;
    }

    setError('');
    try {
      await api.saveEntryTiebreaker(userId, selectedContestId, selectedEntry.id, {
        prompt: 'How many combined total goals will be scored in the knockout stage? (15 games)',
        answer: trimmed,
        numericGuess
      });
      setStatus('Tiebreaker saved.');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onJoinPopularGroup(contestId: string, groupId: string) {
    setError('');
    try {
      await api.joinGroup(userId, contestId, groupId);
      await refreshAll(userId, contestId);
      await refreshPopularGroups(contestId);
      setStatus('Joined group.');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function activeContestIdForGroupActions(): string {
    return activeTopPage === 'groups' ? selectedGroupContestId : selectedContestId;
  }

  async function onCreateEntry() {
    if (!selectedContestId) return;
    setError('');
    try {
      await api.createEntry(userId, selectedContestId);
      await refreshAll();
      setStatus('Entry created.');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onSelectNbaTeam(game: Game, pickedWinner: string) {
    if (!selectedContestId || !isStraightPickemContest || isViewingContestParticipantEntry) return;
    setError('');

    const nextDraft: PickDraft = {
      ...pickDraft,
      [game.id]: {
        ...(pickDraft[game.id] ?? { confidencePoints: '' }),
        pickedWinner
      }
    };

    setPickDraft(nextDraft);

    try {
      await api.createEntry(userId, selectedContestId).catch(() => undefined);

      const payload = games
        .filter((g) => nextDraft[g.id]?.pickedWinner)
        .map((g) => ({ gameId: g.id, pickedWinner: nextDraft[g.id].pickedWinner }));

      await api.submitPicks(userId, selectedContestId, payload);
      const entryData = await api.entriesMe(userId);
      setEntries(entryData.entries);
      const entry = entryData.entries.find((e) => e.contestId === selectedContestId);
      if (entry) {
        const saved = await api.getPicks(userId, selectedContestId, entry.id);
        setSavedPicks(saved.picks);
      }
      await refreshPickPercentages(selectedContestId);
      setStatus('Pick saved automatically.');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onSelectOlympicBracketTeam(gameSlot: string, round: number, pickedTeam: string) {
    if (!selectedContestId || isViewingContestParticipantEntry) return;
    setError('');

    try {
      await api.createEntry(userId, selectedContestId).catch(() => undefined);

      const next = new Map(savedBracketBySlot);
      next.set(gameSlot, pickedTeam);

      const validGames = isUefaBracketContest ? resolveUefaBracketGames(next) : resolveOlympicBracketGames(next);
      const roundBySlot = isUefaBracketContest ? UEFA_ROUND_BY_SLOT : OLYMPIC_ROUND_BY_SLOT;
      const validPickSetBySlot = new Map(
        validGames.map((game) => [game.slot, new Set(game.teams.map((team) => team.name))])
      );

      const payload = Array.from(next.entries())
        .filter(([slot, team]) => validPickSetBySlot.get(slot)?.has(team))
        .map(([slot, team]) => ({
          gameSlot: slot,
          pickedTeam: team,
          round: roundBySlot[slot] ?? round
        }));

      await api.submitBracket(userId, selectedContestId, payload);

      const entryData = await api.entriesMe(userId);
      setEntries(entryData.entries);
      const entry = entryData.entries.find((e) => e.contestId === selectedContestId);
      if (entry) {
        const saved = await api.getBracket(userId, selectedContestId, entry.id);
        setSavedBracket(saved.picks);
      }

      await refreshPickPercentages(selectedContestId);
      setStatus('Bracket selection saved automatically.');
    } catch (err) {
      setError((err as Error).message);
    }
  }


  async function onSelectConferenceChampion(slot: string, pickedTeam: string) {
    if (!selectedContestId || !isConferenceChampionsContest || isViewingContestParticipantEntry) return;
    setError('');

    try {
      await api.createEntry(userId, selectedContestId).catch(() => undefined);

      const next = new Map(savedBracketBySlot);
      next.set(slot, pickedTeam);

      const payload = NCAAB_CONFERENCE_TEAMS
        .map((conference) => ({ gameSlot: conference.slot, pickedTeam: next.get(conference.slot) ?? '' }))
        .filter((pick) => pick.pickedTeam)
        .map((pick) => ({ ...pick, round: 1 }));

      if (payload.length === 0) return;

      await api.submitBracket(userId, selectedContestId, payload);

      const entryData = await api.entriesMe(userId);
      setEntries(entryData.entries);
      const entry = entryData.entries.find((e) => e.contestId === selectedContestId);
      if (entry) {
        const saved = await api.getBracket(userId, selectedContestId, entry.id);
        setSavedBracket(saved.picks);
      }

      await refreshPickPercentages(selectedContestId);
      setStatus('Conference champion pick saved.');
    } catch (err) {
      setError((err as Error).message);
    }
  }
  function marchMadnessRoundForSlot(gameSlot: string): number {
    if (gameSlot.startsWith('R64-')) return 1;
    if (gameSlot.startsWith('R32-')) return 2;
    if (gameSlot.startsWith('S16-')) return 3;
    if (gameSlot.startsWith('E8-')) return 4;
    if (gameSlot.startsWith('F4-')) return 5;
    if (gameSlot.startsWith('CHAMP-')) return 6;
    return 1;
  }

  async function onSelectMarchMadnessTeam(gameSlot: string, pickedTeam: string) {
    if (!selectedContestId || !isMarchMadnessStandardContest || isViewingContestParticipantEntry) return;
    setError('');

    try {
      await api.createEntry(userId, selectedContestId).catch(() => undefined);

      const next = new Map(savedBracketBySlot);
      next.set(gameSlot, pickedTeam);

      const gameBySlot = new Map(games.map((game) => [game.providerGameId, game]));

      const payload = Array.from(next.entries())
        .filter(([slot, team]) => {
          const game = gameBySlot.get(slot);
          if (!game) return false;
          return team === game.homeTeam || team === game.awayTeam;
        })
        .map(([slot, team]) => ({
          gameSlot: slot,
          pickedTeam: team,
          round: marchMadnessRoundForSlot(slot)
        }));

      await api.submitBracket(userId, selectedContestId, payload);

      const entryData = await api.entriesMe(userId);
      setEntries(entryData.entries);
      const entry = entryData.entries.find((e) => e.contestId === selectedContestId);
      if (entry) {
        const saved = await api.getBracket(userId, selectedContestId, entry.id);
        setSavedBracket(saved.picks);
      }

      await refreshPickPercentages(selectedContestId);
      setStatus('March Madness pick saved automatically.');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onSubmitPicks(e: FormEvent) {
    e.preventDefault();
    if (!selectedContestId || isViewingContestParticipantEntry) return;
    setError('');
    try {
      const payload = games
        .filter((game) => pickDraft[game.id]?.pickedWinner)
        .map((game) => ({
          gameId: game.id,
          pickedWinner: pickDraft[game.id].pickedWinner,
          confidencePoints:
            selectedContest?.type === 'PICKEM_NFL' && pickDraft[game.id].confidencePoints
              ? Number(pickDraft[game.id].confidencePoints)
              : undefined
        }));

      await api.submitPicks(userId, selectedContestId, payload);
      if (selectedEntry) {
        const saved = await api.getPicks(userId, selectedContestId, selectedEntry.id);
        setSavedPicks(saved.picks);
      }
      await refreshPickPercentages(selectedContestId);
      setStatus('Picks submitted.');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onSubmitBracket(e: FormEvent) {
    e.preventDefault();
    if (!selectedContestId || isViewingContestParticipantEntry) return;
    setError('');
    try {
      await api.submitBracket(
        userId,
        selectedContestId,
        bracketDraft
          .filter((row) => row.gameSlot && row.pickedTeam && row.round)
          .map((row) => ({ gameSlot: row.gameSlot, pickedTeam: row.pickedTeam, round: Number(row.round) }))
      );
      if (selectedEntry) {
        const saved = await api.getBracket(userId, selectedContestId, selectedEntry.id);
        setSavedBracket(saved.picks);
      }
      await refreshPickPercentages(selectedContestId);
      setStatus('Bracket picks submitted.');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onCloneContest(e: FormEvent) {
    e.preventDefault();
    if (!selectedContestId) return;

    const season = Number(cloneSeason);
    if (!cloneName.trim() || !Number.isInteger(season) || season < 2020 || !cloneStartsAt) {
      setError('Enter valid clone name, season, and start date/time.');
      return;
    }

    setError('');
    try {
      const startsAtIso = new Date(cloneStartsAt).toISOString();
      const created = await api.cloneContest(userId, selectedContestId, {
        name: cloneName.trim(),
        season,
        startsAt: startsAtIso,
        includeGames: cloneIncludeGames
      });

      await refreshAll(userId, created.id);
      setStatus('Contest cloned.');
      openContestPage(created.id);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onSetContestStatus(nextStatus: 'DRAFT' | 'OPEN') {
    if (!selectedContestId) return;

    setError('');
    try {
      await api.setContestStatus(userId, selectedContestId, nextStatus);
      await refreshAll(userId, selectedContestId);
      setStatus(nextStatus === 'OPEN' ? 'Contest published.' : 'Contest moved to draft (hidden from users).');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onRunContestGrading() {
    if (!selectedContestId) return;

    setError('');
    try {
      const result = await api.runContestGrading(userId, selectedContestId);
      await refreshAll(userId, selectedContestId);

      if (selectedEntry) {
        if (selectedContest?.type === 'BRACKET_NCAAM') {
          const saved = await api.getBracket(userId, selectedContestId, selectedEntry.id);
          setSavedBracket(saved.picks);
        } else {
          const saved = await api.getPicks(userId, selectedContestId, selectedEntry.id);
          setSavedPicks(saved.picks);
        }
      }

      setStatus(`Contest regraded. Changed entries: ${result.changedEntries}.`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onOverrideGameResult(e: FormEvent) {
    e.preventDefault();
    if (!selectedContestId || !overrideProviderGameId) return;

    const payload: { status?: string; homeScore?: number | null; awayScore?: number | null; winner?: string | null } = {};

    if (overrideStatus.trim()) payload.status = overrideStatus.trim();
    if (overrideHomeScore.trim() !== '') payload.homeScore = Number(overrideHomeScore);
    if (overrideAwayScore.trim() !== '') payload.awayScore = Number(overrideAwayScore);
    if (overrideWinner.trim()) payload.winner = overrideWinner.trim();

    if (Object.keys(payload).length === 0) {
      setError('Enter at least one override field (status, score, or winner).');
      return;
    }

    setError('');

    try {
      await api.overrideGameResult(userId, selectedContestId, overrideProviderGameId, payload);

      const [gamesData, percentagesData] = await Promise.all([
        api.contestGames(selectedContestId),
        api.contestPickPercentages(selectedContestId)
      ]);

      setGames(gamesData.games);

      const next: Record<string, Record<string, number>> = {};
      for (const row of percentagesData.rows) {
        if (!next[row.gameKey]) next[row.gameKey] = {};
        next[row.gameKey][row.team] = row.percent;
      }
      setPickPercentagesByKey(next);

      await refreshAll(userId, selectedContestId);

      if (selectedEntry) {
        if (selectedContest?.type === 'BRACKET_NCAAM') {
          const saved = await api.getBracket(userId, selectedContestId, selectedEntry.id);
          setSavedBracket(saved.picks);
        } else {
          const saved = await api.getPicks(userId, selectedContestId, selectedEntry.id);
          setSavedPicks(saved.picks);
        }
      }

      setStatus('Game result override saved and contest regraded.');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function loadLeaderboard(groupId: string = selectedGroupId, contestId: string = selectedGroupContestId || selectedContestId) {
    if (!contestId || !groupId) return;
    setError('');
    setIsGroupLeaderboardLoading(true);
    try {
      const [groupData, contestData] = await Promise.all([
        api.groupLeaderboard(userId, groupId, contestId),
        api.contestLeaderboard(userId, contestId)
      ]);
      setSelectedGroupId(groupId);
      setSelectedGroupContestId(contestId);
      setLeaderboardRows(groupData.leaderboard);
      setContestLeaderboards((prev) => ({ ...prev, [contestId]: contestData.leaderboard }));
      setStatus('Leaderboard loaded.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsGroupLeaderboardLoading(false);
    }
  }

  function openGroupPage(groupId: string) {
    if (!selectedContestId) return;
    setActiveTopPage('groups');
    setSelectedGroupId(groupId);
    setSelectedGroupContestId(selectedContestId);
    setTimeout(() => scrollToSection('groups-page'), 0);
    void loadLeaderboard(groupId, selectedContestId);
  }

  async function onOpenUserStats(targetUserId: string) {
    if (!userId) return;

    const currentPage = activeTopPage === 'user-stats' ? statsReturnPage : activeTopPage;
    setStatsReturnPage(currentPage as 'home' | 'entries' | 'contest' | 'leaderboards' | 'groups');

    setError('');
    setStatsUserId(targetUserId);
    setIsUserStatsLoading(true);
    setActiveTopPage('user-stats');

    try {
      const data = await api.userStats(userId, targetUserId);
      setSelectedUserStats(data);
      setStatus('User stats loaded.');
      setTimeout(() => scrollToSection('user-stats-page'), 0);
    } catch (err) {
      setError((err as Error).message);
      setSelectedUserStats(null);
    } finally {
      setIsUserStatsLoading(false);
    }
  }

  async function onViewParticipantEntry(contestId: string, participantUserId: string) {
    if (!userId) return;

    setError('');
    setLeaderboardEntryContestId(contestId);
    setIsLeaderboardEntryLoading(true);

    try {
      const data = await api.contestantEntry(userId, contestId, participantUserId);
      setSelectedLeaderboardEntry(data);
      setStatus('Participant entry loaded.');
    } catch (err) {
      setSelectedLeaderboardEntry(null);
      setError((err as Error).message);
    } finally {
      setIsLeaderboardEntryLoading(false);
    }
  }

  function logout() {
    localStorage.removeItem(USER_KEY);
    setUserId('');
    setCurrentUserEmail('');
    setContests([]);
    setGroups([]);
    setEntries([]);
    setGames([]);
    setTopOneAggregateRows([]);
    setStatus('Logged out.');
  }

  function scrollToSection(id: string) {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function openContestPage(contestId: string) {
    setContestViewEntry(null);
    setSelectedContestId(contestId);
    setContestPageId(contestId);
    setActiveTopPage('contest');
    setSelectedGroupId('');
    setLeaderboardRows([]);

    const params = new URLSearchParams(window.location.search);
    params.set('contestId', contestId);
    const next = `${window.location.pathname}?${params.toString()}`;
    window.history.pushState({}, '', next);

    setTimeout(() => scrollToSection('contest-detail'), 0);
  }

  function openContestLeaderboard(contestId: string) {
    setSelectedLeaderboardContestId(contestId);
    setSelectedLeaderboardEntry(null);
    setLeaderboardEntryContestId('');
    setActiveTopPage('leaderboards');
    setTimeout(() => scrollToSection('leaderboards-page'), 0);
  }

  function closeUserStats() {
    setSelectedUserStats(null);
    setStatsUserId('');
    setActiveTopPage(statsReturnPage);
  }

  function closeContestPage() {
    setContestViewEntry(null);
    closeUserStats();
    setContestPageId('');
    setActiveTopPage('home');
    setSelectedGroupId('');
    setLeaderboardRows([]);

    const params = new URLSearchParams(window.location.search);
    params.delete('contestId');
    const query = params.toString();
    window.history.pushState({}, '', query ? `${window.location.pathname}?${query}` : window.location.pathname);

    setTimeout(() => scrollToSection('contests-page'), 0);
  }

  return (
    <div className="page">
      <header className="hero" id="home">
        <div className="wordmark">The 1%</div>
        <nav className="topNav" aria-label="Primary">
          <button className="navBtn" onClick={() => { if (contestPageId) { closeContestPage(); } else { setActiveTopPage('home'); setTimeout(() => scrollToSection('home'), 0); } }}>Home</button>
          <button className="navBtn" onClick={() => { setActiveTopPage('entries'); setTimeout(() => scrollToSection('my-entries-page'), 0); }}>My Entry's</button>
          <button className="navBtn" onClick={() => { setSelectedLeaderboardContestId(''); setSelectedLeaderboardEntry(null); setLeaderboardEntryContestId(''); setActiveTopPage('leaderboards'); setTimeout(() => scrollToSection('leaderboards-page'), 0); }}>Leaderboards</button>
          <button className="navBtn" onClick={() => { setSelectedGroupContestId(selectedContestId || ''); setActiveTopPage('groups'); setTimeout(() => scrollToSection('groups-page'), 0); }}>Groups</button>
          <button className="navBtn" onClick={() => { if (contestPageId) { closeContestPage(); } else { setActiveTopPage('home'); setTimeout(() => scrollToSection('my-1'), 0); } }}>My 1%</button>
        </nav>
      </header>

      {!userId ? (
        <section className="card lift">
          <h2>Sign In</h2>
          <form onSubmit={onLogin} className="grid">
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name" required />
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" required />
            <button type="submit">Enter App</button>
          </form>
        </section>
      ) : (
        <>
          <section className="card row between" id="my-1">
            <div>
              <h2>Control Desk</h2>
              <p>Signed in as <strong>{currentUserEmail || userId.slice(0, 8)}</strong></p>
            </div>
            <div className="row gap">
              <button onClick={() => refreshAll()} className="secondary">Refresh</button>
              <button onClick={logout} className="secondary">Logout</button>
            </div>
          </section>

          {activeTopPage === 'entries' ? (
            <section className="card lift" id="my-entries-page">
              <h2>My Active Entries</h2>
              <p className="muted">All of your currently active contest entries.</p>
              {activeEntries.length === 0 ? (
                <p className="muted">No active entries yet.</p>
              ) : (
                <ul className="list">
                  {activeEntries.map((entry) => {
                    const contest = contests.find((c) => c.id === entry.contestId);
                    return (
                      <li key={entry.id}>
                        <strong>{contest?.name ?? entry.contestId}</strong>
                        <span>{contest ? `${contestTypeLabel(contest)} · ${contest.status}` : 'Contest'} · {entry.totalPoints} pts</span>
                        <button type="button" className="secondary" onClick={() => openContestPage(entry.contestId)}>Open Contest</button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ) : activeTopPage === 'groups' ? (
            <section className="card lift" id="groups-page">
              <h2>Groups</h2>
              <div className="grid two">
                <p className="muted">Select contest</p>
                <select
                  value={selectedGroupContestId}
                  onChange={(e) => {
                    setSelectedGroupContestId(e.target.value);
                    setSelectedGroupId('');
                    setLeaderboardRows([]);
                  }}
                >
                  <option value="">Select contest</option>
                  {contests.map((contest) => (
                    <option key={contest.id} value={contest.id}>{contest.name}</option>
                  ))}
                </select>
              </div>

              {!selectedGroupContestId ? (
                <p className="muted">Choose a contest to view its groups and leaderboard.</p>
              ) : (
                <>
                  <h3>{selectedGroupContest?.name ?? 'Contest'}</h3>
                  <section className="card lift" id="groups-controls">
                    <h3>Group Actions</h3>
                    <div className="grid two">
                      <form className="stack" onSubmit={onCreateGroup}>
                        <h4>Create a Group</h4>
                        <input
                          value={groupName}
                          onChange={(e) => setGroupName(e.target.value)}
                          placeholder="Group name"
                        />
                        <select value={groupVisibility} onChange={(e) => setGroupVisibility(e.target.value as 'PUBLIC' | 'PRIVATE')}>
                          <option value="PUBLIC">Public</option>
                          <option value="PRIVATE">Private</option>
                        </select>
                        {groupVisibility === 'PRIVATE' ? (
                          <input
                            value={groupPassword}
                            onChange={(e) => setGroupPassword(e.target.value)}
                            placeholder="Group password"
                          />
                        ) : null}
                        <button type="submit">Create Group</button>
                      </form>

                      <div className="stack">
                        <form className="stack" onSubmit={onJoinGroup}>
                          <h4>Join a Public Group</h4>
                          <input
                            value={publicGroupName}
                            onChange={(e) => setPublicGroupName(e.target.value)}
                            placeholder="Public group name"
                            list="public-group-names"
                          />
                          <datalist id="public-group-names">
                            {popularPublicGroups
                              .filter((group) => !group.isMember)
                              .map((group) => (
                                <option key={group.id} value={group.name}>
                                  {group.memberCount} members
                                </option>
                              ))}
                          </datalist>
                          <button type="submit">Join Public Group</button>
                        </form>

                        <form className="stack" onSubmit={onJoinPrivateGroup}>
                          <h4>Join a Private Group</h4>
                          <input
                            value={privateGroupName}
                            onChange={(e) => setPrivateGroupName(e.target.value)}
                            placeholder="Private group name"
                            list="private-group-names"
                          />
                          <datalist id="private-group-names">
                            {privateGroupNames.map((group) => (
                              <option key={group.name} value={group.name} />
                            ))}
                          </datalist>
                          <input
                            value={privateGroupPassword}
                            onChange={(e) => setPrivateGroupPassword(e.target.value)}
                            placeholder="Group password"
                          />
                          <button type="submit">Join Private Group</button>
                        </form>
                      </div>
                    </div>
                  </section>
                  <div className="grid two groupSelectRow">
                    <p className="muted">Select group</p>
                    <select
                      value={selectedGroupId}
                      onChange={(e) => {
                        const nextGroupId = e.target.value;
                        setSelectedGroupId(nextGroupId);
                        setLeaderboardRows([]);
                        if (nextGroupId && selectedGroupContestId) {
                          void loadLeaderboard(nextGroupId, selectedGroupContestId);
                        }
                      }}
                    >
                      <option value="">Select group</option>
                      {groups
                  .filter((group) => !!selectedGroupContestId && group.contestId === selectedGroupContestId)
                  .map((group) => (
                        <option key={group.id} value={group.id}>{group.name}</option>
                      ))}
                    </select>
                  </div>

                  {!selectedGroupId ? (
                    <>
                      <h3>Popular Public Groups</h3>
                      {isPopularGroupsLoading ? <p className="muted">Loading public groups...</p> : null}
                      {!isPopularGroupsLoading && popularPublicGroups.length === 0 ? (
                        <p className="muted">No public groups available for this contest yet.</p>
                      ) : null}
                      {popularPublicGroups.length > 0 ? (
                        <ul className="list">
                          {popularPublicGroups.map((group) => (
                            <li key={group.id}>
                              <strong>{group.name}</strong>
                              <span>{group.memberCount} member{group.memberCount === 1 ? '' : 's'}</span>
                              <button
                                type="button"
                                className="secondary"
                                onClick={() => void onJoinPopularGroup(group.contestId, group.id)}
                                disabled={group.isMember}
                              >
                                {group.isMember ? 'Joined' : 'Join'}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </>
                  ) : null}

                  {isGroupLeaderboardLoading ? <p className="muted">Loading group leaderboard...</p> : null}
                  {!isGroupLeaderboardLoading && selectedGroupId && leaderboardRows.length === 0 ? (
                    <p className="muted">No entries yet in this group.</p>
                  ) : null}
                  {leaderboardRows.length > 0 ? (
                    <>
                      {(() => {
                        const contestRowsForPercentile = selectedGroupContestId ? (contestLeaderboards[selectedGroupContestId] ?? []) : [];
                        return (
                          <>
                      <div className="leaderboardHeader">
                        <span>Rank</span>
                        <span>User name</span>
                        <span>Percentile</span>
                        <span>Points</span>
                      </div>
                      <ol className="list leaderboardList">
                      {leaderboardRows.map((row, index) => {
                        const rank = rankFromPoints(leaderboardRows, index);
                        const overallIndex = contestRowsForPercentile.findIndex(
                          (contestRow) => contestRow.userId.trim().toLowerCase() === row.userId.trim().toLowerCase()
                        );
                        const overallRank = rankForUserByPoints(contestRowsForPercentile, row.userId);
                        const percentile = overallRank ? percentileFromRank(contestRowsForPercentile.length, overallRank) : 0;
                        const overallRow = overallIndex >= 0 ? contestRowsForPercentile[overallIndex] : null;
                        const isTopOne = overallRow ? isTopOnePercentEntry(contestRowsForPercentile, overallRow) : false;
                        return (
                          <li key={row.userId} className="leaderboardRow">
                            <span className="leaderboardRank">{rank}</span>
                            <div className="leaderboardNameCell">
                              <button
                                type="button"
                                className="contestNameLink"
                                onClick={() => {
                                  if (!selectedGroupContestId) return;
                                  onLeaderboardNameClick(selectedGroupContestId, row.userId);
                                }}
                              >
                                {row.displayName}
                                {isTopOne ? <span className="topOneBadge">Top 1%</span> : null}
                              </button>
                              <button type="button" className="secondary miniBtn" onClick={() => void onOpenUserStats(row.userId)}>Stats</button>
                            </div>
                            <span className="leaderboardPercentile">{percentile.toFixed(2)}%</span>
                            <span>{row.totalPoints} pts</span>
                          </li>
                        );
                      })}
                    </ol>
                          </>
                        );
                      })()}
                    </>
                  ) : null}

                  {selectedGroupContestId && isLeaderboardEntryLoading && leaderboardEntryContestId === selectedGroupContestId ? (
                    <p className="muted">Loading selected entry...</p>
                  ) : null}
                  {selectedGroupContestId && selectedLeaderboardEntry && leaderboardEntryContestId === selectedGroupContestId ? (
                    <div className="card">
                      <div className="row between gap">
                        <h3>{selectedLeaderboardEntry.entry.displayName}'s Entry</h3>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => {
                            setSelectedLeaderboardEntry(null);
                            setLeaderboardEntryContestId('');
                          }}
                        >
                          Close
                        </button>
                      </div>
                      <p className="muted">{selectedLeaderboardEntry.entry.totalPoints} pts</p>
                      {selectedLeaderboardEntry.contestType === 'PICKEM_NFL' || selectedLeaderboardEntry.contestType === 'PICKEM_NBA' || selectedLeaderboardEntry.contestType === 'PICKEM_NHL' ? (
                        <ul className="list">
                          {(selectedLeaderboardEntry.picks as ParticipantEntryPickemPick[]).map((pick) => (
                            <li key={pick.gameId}>
                              <span>{pick.awayTeam} at {pick.homeTeam}</span>
                              <span>
                                <strong>{pick.pickedWinner}</strong>
                                {' · '}
                                {formatPickResult(pick.isCorrect)}
                                {' · '}
                                {pick.pointsAwarded} pts
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <ul className="list">
                          {(selectedLeaderboardEntry.picks as ParticipantEntryBracketPick[]).map((pick) => (
                            <li key={pick.gameSlot}>
                              <span>{pick.gameSlot}</span>
                              <span>
                                <strong>{pick.pickedTeam}</strong>
                                {' · '}
                                {formatPickResult(pick.isCorrect)}
                                {' · '}
                                {pick.pointsAwarded} pts
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : null}
                </>
              )}
            </section>
                    ) : activeTopPage === 'user-stats' ? (
            <section className="card lift" id="user-stats-page">
              {isUserStatsLoading ? <p className="muted">Loading user stats...</p> : null}
              {!isUserStatsLoading && !selectedUserStats ? <p className="muted">Select a user from a leaderboard to view stats.</p> : null}
              {selectedUserStats ? (
                <>
                  <div className="row between gap">
                    <div>
                      <h2>{selectedUserStats.displayName} - User Stats</h2>
                                          </div>
                    <button type="button" className="secondary" onClick={closeUserStats}>Back</button>
                  </div>

                  <div className="statsGrid">
                    <article className="statsTile"><span className="muted">Contests Entered</span><strong>{selectedUserStats.lifetime.contestsEntered}</strong></article>
                    <article className="statsTile"><span className="muted">Contests Won</span><strong>{selectedUserStats.lifetime.contestsWon}</strong></article>
                    <article className="statsTile"><span className="muted">Top 1% Finishes</span><strong>{selectedUserStats.lifetime.topOneFinishes}</strong></article>
                                        <article className="statsTile"><span className="muted">Avg Percentile</span><strong>{selectedUserStats.lifetime.avgPercentile.toFixed(2)}%</strong></article>
                    <article className="statsTile"><span className="muted">Best Percentile</span><strong>{selectedUserStats.lifetime.bestPercentile.toFixed(2)}%</strong></article>
                  </div>

                  <h3>Yearly Stats</h3>
                  {selectedUserStats.byYear.length === 0 ? (
                    <p className="muted">No yearly stats yet.</p>
                  ) : (
                    <div className="tableWrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Year</th><th>Entered</th><th>Wins</th><th>Top 1%</th><th>Avg Percentile</th><th>Best Percentile</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedUserStats.byYear.map((row) => (
                            <tr key={row.year}>
                              <td>{row.year}</td><td>{row.contestsEntered}</td><td>{row.contestsWon}</td><td>{row.topOneFinishes}</td><td>{row.avgPercentile.toFixed(2)}%</td><td>{row.bestPercentile.toFixed(2)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <h3>Recent Contests</h3>
                  {selectedUserStats.recentContests.length === 0 ? (
                    <p className="muted">No contest history yet.</p>
                  ) : (
                    <div className="tableWrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Contest</th><th>Date</th><th>Status</th><th>Rank</th><th>Percentile</th><th>Points</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedUserStats.recentContests.map((row) => (
                            <tr key={row.contestId}>
                              <td>{row.contestName}</td><td>{fmtDate(row.startsAt)}</td><td>{row.contestStatus}</td><td>{row.rank}</td><td>{row.percentile.toFixed(2)}%</td><td>{row.totalPoints}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              ) : null}
            </section>
                    ) : activeTopPage === 'leaderboards' ? (
            <section className="card lift" id="leaderboards-page">
              <h2>Contest Leaderboards</h2>
              <p className="muted">Rankings for all contests, past and present.</p>
              <div className="grid two">
                <p className="muted">Filter by sport</p>
                <select value={leaderboardSportFilter} onChange={(e) => setLeaderboardSportFilter(e.target.value as ContestSportFilter)}>
                  <option value="ALL">All Sports</option><option value="Basketball">Basketball</option><option value="Olympics">Olympics</option><option value="Football">Football</option><option value="Hockey">Hockey</option><option value="Baseball">Baseball</option><option value="Soccer">Soccer</option>
                </select>
              </div>
              <div className="grid two">
                <p className="muted">Filter by contest</p>
                <select value={selectedLeaderboardContestId} onChange={(e) => setSelectedLeaderboardContestId(e.target.value)}>
                  <option value="">Select contest</option>
                  <option value={LEADERBOARD_TOP_ONE_OPTION}>Top 1% Finishes (All Contests)</option>
                  {filteredLeaderboardContests.map((contest) => (<option key={contest.id} value={contest.id}>{contest.name}</option>))}
                </select>
              </div>
              {selectedLeaderboardContestId === '' ? <p className="muted">Select a contest to view its leaderboard.</p> : null}
              {selectedLeaderboardContestId === LEADERBOARD_TOP_ONE_OPTION ? (
                <article className="card">
                  <h3>Top 1% Finishes (All Contests)</h3>
                  {isTopOneAggregateLoading ? <p className="muted">Loading Top 1% leaderboard...</p> : null}
                  {!isTopOneAggregateLoading && topOneAggregateRows.length > 0 ? (
                    <ol className="list topOneGlobalList">
                      {topOneAggregateRows.map((row, index) => {
                        const rank = rankFromTopOneCount(topOneAggregateRows, index);
                        return (
                          <li key={row.userId} className="topOneGlobalRow">
                            <span className="leaderboardRank">{rank}</span>
                            <div className="leaderboardNameCell"><span>{row.displayName}</span><button type="button" className="secondary miniBtn" onClick={() => void onOpenUserStats(row.userId)}>Stats</button></div>
                            <span>{row.topOneCount}</span>
                          </li>
                        );
                      })}
                    </ol>
                  ) : null}
                </article>
              ) : null}
              {leaderboardContestsToRender.map((contest) => {
                const rows = contestLeaderboards[contest.id] ?? [];
                return (
                  <article className="card lift" key={contest.id}>
                    <div className="row between gap"><h3>{contest.name}</h3><span className="muted">{contest.status}</span></div>
                    {rows.length === 0 ? <p className="muted">No entries yet.</p> : (
                      <ol className="list leaderboardList">
                        {rows.map((row, index) => {
                          const rank = rankFromPoints(rows, index);
                          const percentile = percentileFromRank(rows.length, rank);
                          return (
                            <li key={`${contest.id}-${row.userId}`} className="leaderboardRow">
                              <span className="leaderboardRank">{rank}</span>
                              <div className="leaderboardNameCell">
                                <button type="button" className="contestNameLink" onClick={() => onLeaderboardNameClick(contest.id, row.userId)}>{leaderboardDisplayName(row)}</button>
                                <button type="button" className="secondary miniBtn" onClick={() => void onOpenUserStats(row.userId)}>Stats</button>
                              </div>
                              <span className="leaderboardPercentile">{percentile.toFixed(2)}%</span>
                              <span>{row.totalPoints} pts</span>
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </article>
                );
              })}
            </section>
          ) : (
            <>
              {activeTopPage === 'home' && !contestPageId ? (
                <section className="card lift" id="contests-page">
                  <h2>Active Contests</h2>
                  <ul className="list">
                    {activeContests.map((contest) => {
                      const contestEntry = entryByContestId.get(contest.id);
                      const hasEntered = !!contestEntry;
                      const isComplete = contestEntry?.isComplete === true;
                      const startCountdown = countdownWithin24h(contest.startsAt || contest.startTime, nowMs);
                      const lockCountdown = countdownWithin24h(contest.lockAt, nowMs);
                      const endCountdown = countdownWithin24h(contest.endAt, nowMs);
                      const startLabel = fmtDateEastern(contest.startsAt || contest.startTime || contest.startsAt) + ' ET';
                      const lockLabel = contest.lockAt ? fmtDateEastern(contest.lockAt) + ' ET' : null;
                      const endLabel = contest.endAt ? fmtDateEastern(contest.endAt) + ' ET' : null;

                      return (
                        <li key={contest.id}>
                          <div className="contestListMain">
                            <button type="button" className="contestNameLink" onClick={() => openContestPage(contest.id)}>{contest.name}</button>
                            <span>{contestTypeLabel(contest)} · {contest.status}</span>
                            <span className="contestTimingLine">
                              <span>Start: {startLabel}{startCountdown ? ` (${startCountdown})` : ''}</span>
                              {lockLabel ? <span>Lock: {lockLabel}{lockCountdown ? ` (${lockCountdown})` : ''}</span> : null}
                              {endLabel ? <span>End: {endLabel}{endCountdown ? ` (${endCountdown})` : ''}</span> : null}
                            </span>
                          </div>
                          <span className={isComplete ? 'entryBadge entered' : hasEntered ? 'entryBadge incomplete' : 'entryBadge notEntered'}>{isComplete ? 'Entered' : hasEntered ? 'Entry Not Complete' : 'Not Entered'}</span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ) : null}

              {activeTopPage === 'home' && !contestPageId ? (
                <section className="card lift" id="upcoming-contests-page">
                  <h2>Upcoming Contests</h2>
                  <ul className="list">
                    {upcomingDraftContests.map((contest) => (
                      <li key={contest.id}>
                        {isContestCreator ? <button type="button" className="contestNameLink" onClick={() => openContestPage(contest.id)}>{contest.name}</button> : <strong>{contest.name}</strong>}
                        <span>{contestTypeLabel(contest)} · Draft</span>
                      </li>
                    ))}
                    {PLANNED_UPCOMING_CONTESTS.map((name) => (
                      <li key={name}><strong>{name}</strong><span className="muted">Planned</span></li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {activeTopPage === 'home' && !contestPageId ? (
                <section className="card lift" id="prior-contests-page">
                  <h2>Prior Contests</h2>
                  <ul className="list">
                    {filteredPriorEntries.map((entry) => {
                      const contest = contests.find((c) => c.id === entry.contestId);
                      return (
                        <li key={entry.id}>
                          <strong>{contest?.name ?? entry.contestId}</strong>
                          <span>{entry.totalPoints} pts</span>
                          <button type="button" className="secondary" onClick={() => openContestPage(entry.contestId)}>Open Contest</button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ) : null}

              {activeTopPage === 'contest' && contestPageId && selectedContest ? (
                <section className="card lift" id="contest-detail">
                  <div className="row between gap">
                    <div>
                      <h2>{selectedContest.name}</h2>
                      <p className="muted">Contest page: your entry, groups, and leaderboard for this contest.</p>
                      <div className="entryStatsBar">
                        <div className="entryStat">
                          <span className="entryStatLabel">Points</span>
                          <span className="entryStatValue">{displayedEntryPoints}</span>
                        </div>
                        <span className="entryStatDivider" aria-hidden="true" />
                        <div className="entryStat">
                          <span className="entryStatLabel">Rank</span>
                          <span className="entryStatValue">{displayedEntryRank ?? '-'}</span>
                        </div>
                        <span className="entryStatDivider" aria-hidden="true" />
                        <div className="entryStat">
                          <span className="entryStatLabel">Percentile</span>
                          <span className="entryStatValue">{displayedEntryPercentile !== null ? `${displayedEntryPercentile.toFixed(2)}%` : '-'}</span>
                        </div>
                      </div>
                    </div>
                    <div className="row gap">
                      {isContestCreator ? (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => void onSetContestStatus(selectedContest.status === 'DRAFT' ? 'OPEN' : 'DRAFT')}
                        >
                          {selectedContest.status === 'DRAFT' ? 'Publish' : 'Send to Draft'}
                        </button>
                      ) : null}
                      <button type="button" onClick={() => openContestLeaderboard(selectedContest.id)}>Leaderboard</button>
                      <button type="button" className="secondary" onClick={closeContestPage}>Back to all contests</button>
                    </div>
                  </div>
                </section>
              ) : null}



              {activeTopPage === 'contest' && contestPageId && selectedContest && isContestCreator ? (
                <section className="card lift adminStatusCard" id="contest-admin-status">
                  <h3>System Status</h3>
                  <div className="adminStatusGrid">
                    <article className="adminStatusItem">
                      <span className="adminStatusLabel">Backend</span>
                      <strong className={backendHealth?.ok ? 'adminStatusOk' : 'adminStatusBad'}>{backendHealth?.ok ? 'Online' : 'Offline'}</strong>
                      <span className="muted">{backendHealth?.service ?? 'Unavailable'}</span>
                    </article>
                    <article className="adminStatusItem">
                      <span className="adminStatusLabel">Database</span>
                      <strong className={databaseHealth?.ok ? 'adminStatusOk' : 'adminStatusBad'}>{databaseHealth?.ok ? 'Connected' : 'Disconnected'}</strong>
                      <span className="muted">{databaseHealth ? databaseHealth.host + ' · ' + databaseHealth.latencyMs + 'ms' : 'Unavailable'}</span>
                    </article>
                    <article className="adminStatusItem">
                      <span className="adminStatusLabel">Last Auto-Grading Run</span>
                      <strong className={workerHealth?.lastError ? 'adminStatusWarn' : 'adminStatusOk'}>{formatStatusTimestamp(workerHealth?.lastCompletedAt)}</strong>
                      <span className="muted">{workerHealth ? 'Synced ' + workerHealth.lastSyncedContests + ' · Graded ' + workerHealth.lastGradedContests + ' · Changed ' + workerHealth.lastChangedEntries : 'Unavailable'}</span>
                    </article>
                  </div>
                  {databaseHealth?.error ? <p className="error">DB: {databaseHealth.error}</p> : null}
                  {workerHealth?.lastError ? <p className="error">Worker: {workerHealth.lastError}</p> : null}
                </section>
              ) : null}

              {activeTopPage === 'contest' && contestPageId && selectedContest && isContestCreator ? (
                <section className="card lift" id="contest-admin-tools">
                  <h3>Admin Tools</h3>
                  <div className="grid two">
                    <form className="stack" onSubmit={onCloneContest}>
                      <h4>Clone Contest</h4>
                      <input
                        value={cloneName}
                        onChange={(e) => setCloneName(e.target.value)}
                        placeholder="Cloned contest name"
                      />
                      <input
                        value={cloneSeason}
                        onChange={(e) => setCloneSeason(e.target.value)}
                        placeholder="Season"
                        inputMode="numeric"
                      />
                      <input
                        type="datetime-local"
                        value={cloneStartsAt}
                        onChange={(e) => setCloneStartsAt(e.target.value)}
                      />
                      <label className="row gap">
                        <input
                          type="checkbox"
                          checked={cloneIncludeGames}
                          onChange={(e) => setCloneIncludeGames(e.target.checked)}
                        />
                        <span>Copy games from source contest</span>
                      </label>
                      <button type="submit">Clone Contest</button>
                    </form>

                    <div className="stack">
                      <h4>Run Grading Now</h4>
                      <p className="muted">Force a contest regrade immediately using the latest saved game results.</p>
                      <button type="button" onClick={() => void onRunContestGrading()}>Run Grading Now</button>
                    </div>

                    <form className="stack" onSubmit={onOverrideGameResult}>
                      <h4>Admin Result Override</h4>
                      <select value={overrideProviderGameId} onChange={(e) => setOverrideProviderGameId(e.target.value)}>
                        <option value="">Select game</option>
                        {games.map((game) => (
                          <option key={game.providerGameId} value={game.providerGameId}>
                            {game.providerGameId} - {game.awayTeam} vs {game.homeTeam}
                          </option>
                        ))}
                      </select>
                      <input
                        value={overrideStatus}
                        onChange={(e) => setOverrideStatus(e.target.value)}
                        placeholder="Status (e.g. FINAL)"
                      />
                      <div className="grid two">
                        <input
                          value={overrideAwayScore}
                          onChange={(e) => setOverrideAwayScore(e.target.value)}
                          placeholder="Away score"
                          inputMode="numeric"
                        />
                        <input
                          value={overrideHomeScore}
                          onChange={(e) => setOverrideHomeScore(e.target.value)}
                          placeholder="Home score"
                          inputMode="numeric"
                        />
                      </div>
                      <input
                        value={overrideWinner}
                        onChange={(e) => setOverrideWinner(e.target.value)}
                        placeholder={selectedOverrideGame ? `Winner (${selectedOverrideGame.awayTeam} or ${selectedOverrideGame.homeTeam})` : 'Winner'}
                      />
                      <button type="submit">Save Override</button>
                    </form>
                  </div>
                </section>
              ) : null}

              {activeTopPage === 'contest' && contestPageId && selectedContest ? (
                <section className="card lift" id="contest-workspace">
                  <h3>{selectedContest.type === 'BRACKET_NCAAM' ? 'Bracket Workspace' : 'Contest Workspace'}</h3>
                  {isGamesLoading ? <p className="muted">Loading contest games...</p> : null}
                  {!isGamesLoading && games.length === 0 ? <p className="muted">No games loaded for this contest yet.</p> : null}

                  {!isGamesLoading && isMarchMadnessStandardContest ? (
                    <section className="uefaClassicBoard march64Board">
                      <div className="march64Toolbar">
                        <div className="march64ControlGroup">
                          <span className="muted">View</span>
                          <select value={marchRegionView} onChange={(event) => setMarchRegionView(event.target.value as MarchRegionView)}>
                            <option value="WEST">West Region</option>
                            <option value="EAST">East Region</option>
                            <option value="NORTH">North Region</option>
                            <option value="SOUTH">South Region</option>
                            <option value="FINAL_FOUR">Final Four</option>
                          </select>
                        </div>
                        <div className="march64ControlGroup">
                          <span className="muted">Zoom</span>
                          {[75, 100, 125].map((zoom) => (
                            <button
                              key={zoom}
                              type="button"
                              className={zoom === marchBracketZoom ? 'secondary miniBtn' : 'miniBtn'}
                              onClick={() => setMarchBracketZoom(zoom)}
                            >
                              {zoom}%
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="march64Scroller" ref={marchBracketScrollerRef}>
                        <div
                          className={`march64Grid ${marchRegionView === 'FINAL_FOUR' ? 'march64GridFinal' : 'march64GridRegion'}`}
                          style={{ zoom: marchBracketZoom + '%' }}
                        >
                          {marchRoundsForView.map((round, roundIndex) => (
                            <article key={round.key} id={'march-round-' + round.key} className="march64Col">
                              <h4 className="olympicStage march64Stage">{round.label}</h4>
                              {round.rows.map((game, gameIndex) => {
                                const awayName = marchResolveTeamName(game.awayTeam);
                                const homeName = marchResolveTeamName(game.homeTeam);
                                const savedWinner = savedBracketBySlot.get(game.providerGameId);
                                const savedRow = savedBracketRowBySlot.get(game.providerGameId);
                                const awayResult =
                                  savedRow?.pickedTeam === game.awayTeam && savedRow.isCorrect !== null
                                    ? savedRow.isCorrect
                                      ? <span className="saveCheck" aria-label="Correct">✓</span>
                                      : <span className="saveMiss" aria-label="Wrong">✕</span>
                                    : null;
                                const homeResult =
                                  savedRow?.pickedTeam === game.homeTeam && savedRow.isCorrect !== null
                                    ? savedRow.isCorrect
                                      ? <span className="saveCheck" aria-label="Correct">✓</span>
                                      : <span className="saveMiss" aria-label="Wrong">✕</span>
                                    : null;
                                const joinClass = roundIndex === marchRoundsForView.length - 1 ? '' : gameIndex % 2 === 0 ? 'marchJoinTop' : 'marchJoinBottom';

                                return (
                                  <article
                                    key={game.id}
                                    className={`pickRow olympicGameCard uefaClassicGame marchGame marchRound-${round.key}`}
                                    data-stage={marchRoundStage(round.key)}
                                    data-game-index={gameIndex}
                                    style={{ gridRow: String(marchGridRowForView(round.key, gameIndex, marchRegionView)) }}
                                  >
                                    <div className="muted olympicMeta">{fmtDateEastern(game.startTime)} ET · {game.providerGameId}</div>
                                    <div className="olympicTeamButtons">
                                      <button
                                        type="button"
                                        className={'teamPickBtn ' + (savedWinner === game.awayTeam ? 'selected' : '')}
                                        onClick={() => onSelectMarchMadnessTeam(game.providerGameId, game.awayTeam)}
                                        disabled={isSavedLoading || isViewingContestParticipantEntry}
                                      >
                                        <span>{awayName}</span>
                                        <span className="pickPct">{pickPercentFor(game.providerGameId, game.awayTeam)}</span>
                                        {awayResult}
                                      </button>
                                      <button
                                        type="button"
                                        className={'teamPickBtn ' + (savedWinner === game.homeTeam ? 'selected' : '')}
                                        onClick={() => onSelectMarchMadnessTeam(game.providerGameId, game.homeTeam)}
                                        disabled={isSavedLoading || isViewingContestParticipantEntry}
                                      >
                                        <span>{homeName}</span>
                                        <span className="pickPct">{pickPercentFor(game.providerGameId, game.homeTeam)}</span>
                                        {homeResult}
                                      </button>
                                    </div>
                                    {joinClass ? <span className={`marchJoin ${joinClass}`} aria-hidden="true" /> : null}
                                  </article>
                                );
                              })}
                            </article>
                          ))}
                        </div>
                      </div>
                    </section>
                  ) : null}

                  {!isGamesLoading && isOlympicBracketContest ? (
                    <section className="olympicBracketBoard">
                      <div className="olympicBracketGrid">
                        {OLYMPIC_STAGE_COLUMNS.map((stageColumn, columnIndex) => (
                          <article key={stageColumn.join('-')} className="olympicColumn" data-stage={columnIndex}>
                            {stageColumn.map((stageName) => (
                              <div key={stageName}>
                                <h4 className={'olympicStage ' + (stageName === 'Bronze medal game' ? 'subStage' : '')}>{stageName}</h4>
                                {olympicGames
                                  .filter((game) => game.stage === stageName)
                                  .map((game, gameIndex) => renderOlympicClassicGame(game, gameIndex))}
                              </div>
                            ))}
                          </article>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {!isGamesLoading && isUefaBracketContest ? (
                    <section className="uefaIsoBoard">
                      <div className="uefaIsoBracket">
                        <article className="uefaIsoCol" data-stage="r16">
                          <h4 className="olympicStage">Round of 16</h4>
                          {['R16-1', 'R16-2', 'R16-3', 'R16-4', 'R16-5', 'R16-6', 'R16-7', 'R16-8'].flatMap((slot, index) => {
                            const game = getUefaGame(slot);
                            return game ? [renderUefaClassicGame(game, 'r16', index)] : [];
                          })}
                        </article>
                        <article className="uefaIsoCol" data-stage="qf">
                          <h4 className="olympicStage">Quarter-finals</h4>
                          {['QF1', 'QF2', 'QF3', 'QF4'].flatMap((slot, index) => {
                            const game = getUefaGame(slot);
                            return game ? [renderUefaClassicGame(game, 'qf', index)] : [];
                          })}
                        </article>
                        <article className="uefaIsoCol" data-stage="sf">
                          <h4 className="olympicStage">Semi-finals</h4>
                          {['SF1', 'SF2'].flatMap((slot, index) => {
                            const game = getUefaGame(slot);
                            return game ? [renderUefaClassicGame(game, 'sf', index)] : [];
                          })}
                        </article>
                        <article className="uefaIsoCol" data-stage="final">
                          <h4 className="olympicStage">Final</h4>
                          {['FINAL'].flatMap((slot, index) => {
                            const game = getUefaGame(slot);
                            return game ? [renderUefaClassicGame(game, 'final', index)] : [];
                          })}
                        </article>
                      </div>
                    </section>
                  ) : null}

                  {!isGamesLoading && isUefaBracketContest ? (
                    <section className="card uefaTiebreakerCard">
                      <h3>Tiebreaker</h3>
                      <p className="muted">How many combined total goals will be scored in the knockout stage? (15 games)</p>
                      <div className="row gap">
                        <input
                          value={tiebreakerGuess}
                          onChange={(e) => setTiebreakerGuess(e.target.value.replace(/[^0-9]/g, ''))}
                          placeholder="Enter your guess"
                          inputMode="numeric"
                          disabled={isViewingContestParticipantEntry}
                        />
                        {!isViewingContestParticipantEntry ? (
                          <button type="button" onClick={() => void onSaveUefaTiebreaker()}>Save Tiebreaker</button>
                        ) : null}
                      </div>
                    </section>
                  ) : null}

                  {!isGamesLoading && isConferenceChampionsContest ? (
                    <section className="conferenceChampionsBoard">
                      {NCAAB_CONFERENCE_TEAMS.map((conference) => {
                        const selectedTeam = savedBracketBySlot.get(conference.slot) ?? '';
                        const savedRow = savedBracketRowBySlot.get(conference.slot);
                        const resultIcon =
                          savedRow?.isCorrect === null || savedRow?.isCorrect === undefined
                            ? null
                            : savedRow.isCorrect
                              ? <span className="saveCheck" aria-label="Correct">✓</span>
                              : <span className="saveMiss" aria-label="Wrong">✕</span>;

                        return (
                          <article key={conference.slot} className="pickRow conferenceChampionRow">
                            <div className="conferenceHeaderRow">
                              <strong>{conference.conference}</strong>
                              <span className="muted">1 point</span>
                            </div>
                            <div className="conferenceSelectRow">
                              <select
                                value={selectedTeam}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  if (!value) return;
                                  void onSelectConferenceChampion(conference.slot, value);
                                }}
                                disabled={isSavedLoading || isViewingContestParticipantEntry}
                              >
                                <option value="">Select champion...</option>
                                {conference.teams.map((team) => (
                                  <option key={team} value={team}>{team}</option>
                                ))}
                              </select>
                              {resultIcon}
                            </div>
                          </article>
                        );
                      })}
                    </section>
                  ) : null}

                  {!isGamesLoading && games.length > 0 && !isMarchMadnessStandardContest && !isOlympicBracketContest && !isUefaBracketContest && !isConferenceChampionsContest ? (
                    <div className="tableWrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Slot</th>
                            <th>Matchup</th>
                            <th>Start (ET)</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {games.map((game) => (
                            <tr key={game.id}>
                              <td>{game.providerGameId}</td>
                              <td>{game.awayTeam} vs {game.homeTeam}</td>
                              <td>{fmtDateEastern(game.startTime)} ET</td>
                              <td>{game.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </section>
              ) : null}

              {activeTopPage === 'contest' && contestPageId ? (
                <>
                  <section className="card lift" id="my-groups">
                    <h3>My Groups</h3>
                    <ul className="list">
                      {groups.filter((group) => !!selectedContestId && group.contestId === selectedContestId).map((group) => (
                        <li key={group.id}>
                          <strong>{group.name}</strong>
                          <span>{group.visibility} · {group.role}</span>
                          <button type="button" className="secondary" onClick={() => openGroupPage(group.id)}>Open Group</button>
                        </li>
                      ))}
                    </ul>
                  </section>
                </>
              ) : null}
            </>
          )}
        </>
      )}

      <footer className="statusBar">
        <span>{status}</span>
        {error ? <span className="error">{error}</span> : null}
      </footer>
    </div>
  );
}
