import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  ApiRequestError,
  Contest,
  Entry,
  Game,
  Group,
  GroupPicksGrid,
  PublicGroupRow,
  PrivateGroupNameRow,
  LeaderboardRow,
  TopOneAggregateRow,
  ParticipantContestEntry,
  ParticipantEntryBracketPick,
  ParticipantEntryPickemPick,
  UserStatsProfile
} from './api';
import {
  OlympicBracketTeam,
  OlympicBracketGame,
  OLYMPIC_TEAM_FLAGS,
  OLYMPIC_TEAM_SEEDS,
  OLYMPIC_STAGE_COLUMNS,
  OLYMPIC_ROUND_BY_SLOT,
  OLYMPIC_BASE_GAMES,
  UEFA_ROUND_BY_SLOT,
  UEFA_BASE_GAMES,
  UEFA_TEAM_LOGOS,
  teamDisplayName,
  resolveOlympicBracketGames,
  resolveUefaBracketGames,
  uefaTeamLogoUrl,
  isOfficialUefaKickoff
} from './lib/brackets';
import { renderBracketTeamIcon, renderUefaTeamIcon } from './lib/bracketIcons';
import { MarchRegionView, MARCH_MADNESS_SEEDS, NCAAB_CONFERENCE_TEAMS } from './lib/marchMadness';
import { nbaLogoUrl, nhlLogoUrl, nflLogoUrl } from './lib/teamAssets';
import { ContestSportFilter, fmtDate, fmtDateEastern, toLocalDateTimeValue, countdownWithin24h, contestTypeLabel, contestMatchesSportFilter } from './lib/format';
import {
  leaderboardDisplayName,
  rankFromPoints,
  rankFromTopOneCount,
  rankForUserByPoints,
  percentileFromRank,
  isTopOnePercentEntry
} from './lib/ranking';

type PickDraft = Record<string, { pickedWinner: string; confidencePoints: string }>;

type BracketDraftRow = {
  gameSlot: string;
  pickedTeam: string;
  round: string;
};

type AppPage = 'home' | 'entries' | 'contest' | 'leaderboards' | 'groups' | 'group-detail' | 'user-stats' | 'profile';
type StatsReturnPage = Exclude<AppPage, 'user-stats'>;

function teamLogoUrlForContestType(contestType: string, teamName: string): string | null {
  if (contestType === 'PICKEM_NFL') return nflLogoUrl(teamName);
  if (contestType === 'PICKEM_NBA') return nbaLogoUrl(teamName);
  if (contestType === 'PICKEM_NHL') return nhlLogoUrl(teamName);
  return null;
}

// Streak for the Peak pools games from multiple sports into one contest, so
// logo lookup has to go by each game's own sport rather than the contest's
// type. CBB ("NCAAM") and soccer have no logo source yet - see the known
// limitation called out when this feature was planned.
function teamLogoUrlForSport(sport: string, teamName: string): string | null {
  if (sport === 'NFL') return nflLogoUrl(teamName);
  if (sport === 'NBA') return nbaLogoUrl(teamName);
  if (sport === 'NHL') return nhlLogoUrl(teamName);
  return null;
}

function NavIcon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="navIcon" aria-hidden="true">
      <path d={d} fill="currentColor" />
    </svg>
  );
}

function formatCountdownParts(deltaMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(deltaMs / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days}d ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
  }
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
  }
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function LiveCountdown({ targetIso }: { targetIso: string }) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const targetMs = new Date(targetIso).getTime();
  if (!Number.isFinite(targetMs)) return null;

  const deltaMs = targetMs - nowMs;
  if (deltaMs <= 0) return null;

  return <span className="liveCountdown">{formatCountdownParts(deltaMs)}</span>;
}

const ICON_CONTESTS = 'M12 2 14.5 8.5 21 9.3 16.2 13.7 17.6 20.1 12 16.9 6.4 20.1 7.8 13.7 3 9.3 9.5 8.5 Z';
const ICON_ENTRIES = 'M4 4h16v2H4zM4 11h16v2H4zM4 18h10v2H4z';
const ICON_LEADERBOARD = 'M4 20V10h3v10zm6.5 0V4h3v16zm6.5 0v-7h3v7z';
const ICON_GROUPS = 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-8 2c-2.7 0-6 1.3-6 3.5V19h8v-2.5c0-1 .4-1.9 1.1-2.6A9.6 9.6 0 0 0 8 13Zm8 0c-.6 0-1.3.1-2 .3.7.9 1 1.9 1 2.7V19h7v-2.5c0-2.2-3.3-3.5-6-3.5Z';
const ICON_PROFILE = 'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.4 0-9 2.2-9 6v2h18v-2c0-3.8-4.6-6-9-6Z';
const ICON_REFRESH = 'M17.7 6.3A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.8-4.3L14 10h6V4Z';

const AUTH_TOKEN_KEY = 'sports_contest_auth_token';
const LEGACY_USER_KEY = 'sports_contest_user_id';
const LEADERBOARD_TOP_ONE_OPTION = '__TOP_ONE_ALL__';

const PLANNED_UPCOMING_CONTESTS = [] as const;

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
  const [authToken, setAuthToken] = useState<string>(localStorage.getItem(AUTH_TOKEN_KEY) ?? '');
  const [userId, setUserId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [currentUserEmail, setCurrentUserEmail] = useState('');
  const [isContestCreator, setIsContestCreator] = useState(false);

  const [status, setStatus] = useState('Ready.');
  const [error, setError] = useState('');
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const [contests, setContests] = useState<Contest[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);

  const [selectedContestId, setSelectedContestId] = useState('');
  const [contestPageId, setContestPageId] = useState('');
  const [activeTopPage, setActiveTopPage] = useState<AppPage>('home');
  const [marchBracketZoom, setMarchBracketZoom] = useState(100);
  const [marchRegionView, setMarchRegionView] = useState<MarchRegionView>('WEST');
  const [games, setGames] = useState<Game[]>([]);
  const [isGamesLoading, setIsGamesLoading] = useState(false);
  const [streakState, setStreakState] = useState<import('./api').StreakPickState | null>(null);
  const [isStreakLoading, setIsStreakLoading] = useState(false);
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
  const [newContestName, setNewContestName] = useState('');
  const [newContestType, setNewContestType] = useState<'PICKEM_NFL' | 'PICKEM_NBA' | 'PICKEM_NHL' | 'BRACKET_NCAAM' | 'STREAK'>('STREAK');
  const [newContestSeason, setNewContestSeason] = useState('');
  const [newContestStartsAt, setNewContestStartsAt] = useState('');
  const [tiebreakerGuess, setTiebreakerGuess] = useState('');
  const tiebreakerSavedRef = useRef('');
  const [backendHealth, setBackendHealth] = useState<{ ok: boolean; service: string } | null>(null);
  const [databaseHealth, setDatabaseHealth] = useState<import('./api').SystemDbHealth | null>(null);
  const [workerHealth, setWorkerHealth] = useState<import('./api').SystemWorkerHealth | null>(null);

  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [selectedGroupContestId, setSelectedGroupContestId] = useState('');
  const [leaderboardRows, setLeaderboardRows] = useState<Array<{ userId: string; displayName: string; totalPoints: number }>>([]);
  const [isGroupLeaderboardLoading, setIsGroupLeaderboardLoading] = useState(false);
  const [groupViewMode, setGroupViewMode] = useState<'results' | 'picks'>('results');
  const [groupPicksGrid, setGroupPicksGrid] = useState<GroupPicksGrid | null>(null);
  const [groupPicksWeek, setGroupPicksWeek] = useState<number | null>(null);
  const [isGroupPicksLoading, setIsGroupPicksLoading] = useState(false);
  const [contestLeaderboards, setContestLeaderboards] = useState<Record<string, LeaderboardRow[]>>({});
  const [isContestLeaderboardsLoading, setIsContestLeaderboardsLoading] = useState(false);
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const [topOneAggregateRows, setTopOneAggregateRows] = useState<TopOneAggregateRow[]>([]);
  const [isTopOneAggregateLoading, setIsTopOneAggregateLoading] = useState(false);
  const [contestSportFilter, setContestSportFilter] = useState<ContestSportFilter>('ALL');
  const [priorContestSportFilter, setPriorContestSportFilter] = useState<ContestSportFilter>('ALL');
  const [leaderboardSportFilter, setLeaderboardSportFilter] = useState<ContestSportFilter>('ALL');
  const [leaderboardYearFilter, setLeaderboardYearFilter] = useState('ALL');
  const [selectedLeaderboardContestId, setSelectedLeaderboardContestId] = useState('');
  const [leaderboardTopOneOnly, setLeaderboardTopOneOnly] = useState(false);
  const [selectedLeaderboardEntry, setSelectedLeaderboardEntry] = useState<ParticipantContestEntry | null>(null);
  const [leaderboardEntryContestId, setLeaderboardEntryContestId] = useState('');
  const [isLeaderboardEntryLoading, setIsLeaderboardEntryLoading] = useState(false);
  const [selectedUserStats, setSelectedUserStats] = useState<UserStatsProfile | null>(null);
  const [isUserStatsLoading, setIsUserStatsLoading] = useState(false);
  const [statsUserId, setStatsUserId] = useState('');
  const marchBracketScrollerRef = useRef<HTMLDivElement | null>(null);
  const [statsReturnPage, setStatsReturnPage] = useState<StatsReturnPage>('leaderboards');
  const [contestViewEntry, setContestViewEntry] = useState<ParticipantContestEntry | null>(null);

  const selectedContest = useMemo(
    () => contests.find((contest) => contest.id === selectedContestId),
    [contests, selectedContestId]
  );
  const selectedGroupContest = useMemo(
    () => contests.find((contest) => contest.id === selectedGroupContestId),
    [contests, selectedGroupContestId]
  );
  const groupPicksSupported = Boolean(selectedGroupContest && selectedGroupContest.type !== 'BRACKET_NCAAM');

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
  const openForPicksContests = useMemo(
    () => activeContests.filter((contest) => contest.status.toUpperCase() === 'OPEN'),
    [activeContests]
  );
  const lockedContests = useMemo(
    () => activeContests.filter((contest) => contest.status.toUpperCase() !== 'OPEN'),
    [activeContests]
  );
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
  const leaderboardYearOptions = useMemo(() => {
    const years = new Set(contests.map((contest) => contest.season));
    return Array.from(years).sort((a, b) => b - a);
  }, [contests]);
  const filteredLeaderboardContests = useMemo(
    () =>
      contests.filter(
        (contest) =>
          contestMatchesSportFilter(contest, leaderboardSportFilter) &&
          (leaderboardYearFilter === 'ALL' || contest.season === Number(leaderboardYearFilter))
      ),
    [contests, leaderboardSportFilter, leaderboardYearFilter]
  );
  const leaderboardContestsToRender = useMemo(() => {
    if (!selectedLeaderboardContestId || selectedLeaderboardContestId === LEADERBOARD_TOP_ONE_OPTION) return [];
    return filteredLeaderboardContests.filter((contest) => contest.id === selectedLeaderboardContestId);
  }, [filteredLeaderboardContests, selectedLeaderboardContestId]);

  const isPickemContest = selectedContest?.type === 'PICKEM_NFL' || selectedContest?.type === 'PICKEM_NBA' || selectedContest?.type === 'PICKEM_NHL';
  const isStreakContest = selectedContest?.type === 'STREAK';
  const isNflPickemContest = selectedContest?.type === 'PICKEM_NFL';
  const contestWeeks = useMemo(() => {
    if (!isNflPickemContest) return [];
    const weeks = new Set<number>();
    for (const game of games) {
      if (game.week != null) weeks.add(game.week);
    }
    return Array.from(weeks).sort((a, b) => a - b);
  }, [isNflPickemContest, games]);
  const effectiveWeek = useMemo(() => {
    if (contestWeeks.length === 0) return null;
    const incompleteWeeks = games
      .filter((g) => g.week != null && g.winner == null && !/final|complete/i.test(g.status))
      .map((g) => g.week as number);
    if (incompleteWeeks.length > 0) return Math.min(...incompleteWeeks);
    return Math.max(...contestWeeks);
  }, [contestWeeks, games]);
  const activeWeek = selectedWeek ?? effectiveWeek;
  const weekGames = useMemo(() => {
    if (!isNflPickemContest || activeWeek == null) return games;
    return games.filter((g) => g.week == null || g.week === activeWeek);
  }, [isNflPickemContest, games, activeWeek]);
  const isStraightPickemContest = isPickemContest && selectedContest?.scoringConfig?.pickem?.useConfidence !== true;
  const tiebreakerPrompt = isNflPickemContest
    ? (selectedContest?.scoringConfig?.tiebreakers?.[String(activeWeek ?? 0)] ?? null)
    : (selectedContest?.scoringConfig?.tiebreaker?.prompt ?? null);
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
  const currentWeekPicksMade = useMemo(() => {
    if (!isNflPickemContest) return { made: 0, total: 0 };
    const weekGameIds = new Set(weekGames.map((g) => g.id));
    const made = savedPicks.filter((p) => weekGameIds.has(p.gameId)).length;
    return { made, total: weekGames.length };
  }, [isNflPickemContest, savedPicks, weekGames]);
  const currentWeekRecord = useMemo(() => {
    if (!isNflPickemContest) return { wins: 0, losses: 0 };
    const weekGameIds = new Set(weekGames.map((g) => g.id));
    let wins = 0;
    let losses = 0;
    for (const pick of savedPicks) {
      if (!weekGameIds.has(pick.gameId)) continue;
      if (pick.isCorrect === true) wins += 1;
      else if (pick.isCorrect === false) losses += 1;
    }
    return { wins, losses };
  }, [isNflPickemContest, savedPicks, weekGames]);
  const seasonRecord = useMemo(() => {
    if (!isNflPickemContest) return { wins: 0, losses: 0 };
    let wins = 0;
    let losses = 0;
    for (const pick of savedPicks) {
      if (pick.isCorrect === true) wins += 1;
      else if (pick.isCorrect === false) losses += 1;
    }
    return { wins, losses };
  }, [isNflPickemContest, savedPicks]);
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

  function bracketAutoClearStatus(baseMessage: string, clearedCount: number): string {
    if (clearedCount <= 0) return baseMessage;
    return `${baseMessage} Auto-cleared ${clearedCount} downstream ${clearedCount === 1 ? 'pick' : 'picks'}.`;
  }

  function performLogout(statusMessage: string) {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(LEGACY_USER_KEY);
    setAuthToken('');
    setUserId('');
    setDisplayName('');
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setCurrentUserEmail('');
    setIsContestCreator(false);
    setContests([]);
    setGroups([]);
    setEntries([]);
    setGames([]);
    setSavedPicks([]);
    setSavedBracket([]);
    setTopOneAggregateRows([]);
    setContestLeaderboards({});
    setSelectedLeaderboardEntry(null);
    setLeaderboardEntryContestId('');
    setContestViewEntry(null);
    setSelectedContestId('');
    setContestPageId('');
    setSelectedGroupId('');
    setSelectedGroupContestId('');
    setActiveTopPage('home');
    setError('');
    setStatus(statusMessage);
  }

  function handleAppError(err: unknown) {
    if (err instanceof ApiRequestError && err.status === 401) {
      performLogout('Session expired. Please log in again.');
      return;
    }
    setError(err instanceof Error ? err.message : 'Unexpected error.');
  }

  async function ensureContestEntry(contestId: string): Promise<{ entry: Entry; created: boolean }> {
    const existingEntry = entries.find((entry) => entry.contestId === contestId);
    if (existingEntry) {
      return { entry: existingEntry, created: false };
    }

    let created = false;
    try {
      await api.createEntry(authToken, contestId);
      created = true;
    } catch (err) {
      if (!(err instanceof Error) || !err.message.includes('Entry already exists')) {
        throw err;
      }
    }

    const entryData = await api.entriesMe(authToken);
    setEntries(entryData.entries);
    const entry = entryData.entries.find((candidate) => candidate.contestId === contestId);
    if (!entry) {
      throw new Error('Unable to load your contest entry. Try refreshing and then saving again.');
    }

    return { entry, created };
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


  function marchResolveTeamName(teamName: string, picks = savedBracketBySlot, seenSlots = new Set<string>()): string {
    const match = /^Winner\s+([A-Z0-9-]+)$/i.exec(teamName.trim());
    if (!match) return teamName;

    const sourceSlot = match[1].toUpperCase();
    if (seenSlots.has(sourceSlot)) return teamName;

    const pickedTeam = picks.get(sourceSlot);
    if (!pickedTeam) return teamName;

    const nextSeenSlots = new Set(seenSlots);
    nextSeenSlots.add(sourceSlot);
    return marchResolveTeamName(pickedTeam, picks, nextSeenSlots);
  }

  function resolvedMarchGameTeams(game: Game, picks = savedBracketBySlot): { awayTeam: string; homeTeam: string } {
    return {
      awayTeam: marchResolveTeamName(game.awayTeam, picks),
      homeTeam: marchResolveTeamName(game.homeTeam, picks)
    };
  }

  function pruneInvalidMarchPicks(picks: Map<string, string>, gameBySlot: Map<string, Game>): Map<string, string> {
    const pruned = new Map(picks);
    let changed = true;

    while (changed) {
      changed = false;

      for (const [slot, team] of Array.from(pruned.entries())) {
        const game = gameBySlot.get(slot);
        if (!game) {
          pruned.delete(slot);
          changed = true;
          continue;
        }

        const resolvedTeams = resolvedMarchGameTeams(game, pruned);
        const isValid =
          team === game.homeTeam ||
          team === game.awayTeam ||
          team === resolvedTeams.homeTeam ||
          team === resolvedTeams.awayTeam;

        if (!isValid) {
          pruned.delete(slot);
          changed = true;
        }
      }
    }

    return pruned;
  }

  function formatMarchTeamLabel(teamName: string): string {
    const resolved = marchResolveTeamName(teamName);
    const seed = MARCH_MADNESS_SEEDS[resolved];
    return seed ? `${seed} ${resolved}` : resolved;
  }

  function marchRegionIndex(region: MarchRegionView): number {
    if (region === 'WEST') return 0;
    if (region === 'EAST') return 1;
    if (region === 'MIDWEST') return 2;
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

  async function openParticipantContestEntry(contestId: string, participantUserId: string) {
    if (!authToken) return;

    setError('');
    setLeaderboardEntryContestId(contestId);
    setIsLeaderboardEntryLoading(true);

    try {
      const data = await api.contestantEntry(authToken, contestId, participantUserId);
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
      handleAppError(err);
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

    // A pick save can flip an entry's isComplete flag; re-fetch so the
    // "Entered"/"Incomplete" badges reflect it without a manual refresh.
    const entryData = await api.entriesMe(authToken);
    setEntries(entryData.entries);
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
        api.publicGroups(authToken, contestId),
        api.privateGroupNames(authToken, contestId)
      ]);
      setPopularPublicGroups(publicData.groups);
      setPrivateGroupNames(privateData.groups);
    } catch (err) {
      handleAppError(err);
    } finally {
      setIsPopularGroupsLoading(false);
    }
  }

  async function refreshAll(activeAuthToken = authToken, contestId: string | null = selectedContestId || null) {
    if (!activeAuthToken) return;

    const me = await api.me(activeAuthToken);
    let contestData: { contests: Contest[] };
    let isCreator = false;

    try {
      contestData = await api.adminContests(activeAuthToken);
      isCreator = true;
    } catch (err) {
      if (!(err instanceof ApiRequestError) || err.status !== 403) {
        throw err;
      }
      contestData = await api.contests();
    }

    const [groupData, entryData] = await Promise.all([
      api.groups(activeAuthToken, contestId ?? undefined),
      api.entriesMe(activeAuthToken)
    ]);

    setUserId(me.id);
    setDisplayName(me.displayName);
    setContests(contestData.contests);
    setGroups(groupData.groups);
    setEntries(entryData.entries);
    setCurrentUserEmail(me.email);
    setIsContestCreator(isCreator);
  }

  useEffect(() => {
    if (!authToken) return;
    refreshAll().catch((err: Error) => handleAppError(err));
  }, [authToken]);


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
      !authToken ||
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
      .contestLeaderboard(authToken, selectedLeaderboardContestId)
      .then((data) => {
        if (!active) return;
        setContestLeaderboards((prev) => ({
          ...prev,
          [selectedLeaderboardContestId]: data.leaderboard
        }));
      })
      .catch((err: Error) => {
        if (!active) return;
        handleAppError(err);
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

    if (!authToken || !contestIdForPublicGroups) {
      setPopularPublicGroups([]);
      setPrivateGroupNames([]);
      setIsPopularGroupsLoading(false);
      return;
    }

    void refreshPopularGroups(contestIdForPublicGroups);
  }, [userId, activeTopPage, selectedGroupContestId, selectedContestId]);

  useEffect(() => {
    let active = true;

    if (!authToken || activeTopPage !== 'contest' || !selectedContestId) {
      return () => {
        active = false;
      };
    }

    api
      .contestLeaderboard(authToken, selectedContestId)
      .then((data) => {
        if (!active) return;
        setContestLeaderboards((prev) => ({ ...prev, [selectedContestId]: data.leaderboard }));
      })
      .catch((err: Error) => {
        if (!active) return;
        handleAppError(err);
      });

    return () => {
      active = false;
    };
  }, [userId, activeTopPage, selectedContestId]);

  useEffect(() => {
    setSelectedWeek(null);
  }, [selectedContestId]);

  useEffect(() => {
    let active = true;

    if (!authToken || activeTopPage !== 'leaderboards') {
      setIsTopOneAggregateLoading(false);
      return () => {
        active = false;
      };
    }

    setIsTopOneAggregateLoading(true);

    api
      .topOneLeaderboard(authToken)
      .then((data) => {
        if (!active) return;
        setTopOneAggregateRows(data.leaderboard);
      })
      .catch((err: Error) => {
        if (!active) return;
        handleAppError(err);
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

    if (!authToken) return () => {
      active = false;
    };

    const groupsContestId = activeTopPage === 'groups' || activeTopPage === 'group-detail' ? selectedGroupContestId : selectedContestId;
    if (!groupsContestId) {
      setGroups([]);
      setSelectedGroupId('');
      return () => {
        active = false;
      };
    }

    api
      .groups(authToken, groupsContestId)
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
        handleAppError(err);
      });

    return () => {
      active = false;
    };
  }, [userId, selectedContestId, selectedGroupContestId, activeTopPage, selectedGroupId]);

  useEffect(() => {
    if (!authToken || activeTopPage !== 'contest' || !contestPageId || !selectedContest || !isContestCreator) {
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
              lastChangedEntries: 0,
              lastWarnings: []
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
        handleAppError(err);
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
    setStreakState(null);
    if (!selectedContestId || !isStreakContest || !authToken) return;
    void loadStreakState(selectedContestId);
  }, [selectedContestId, isStreakContest, authToken]);

  useEffect(() => {
    let active = true;

    setSavedPicks([]);
    setSavedBracket([]);
    setTiebreakerGuess('');
    tiebreakerSavedRef.current = '';

    if (!selectedContestId || !selectedContest) {
      setIsSavedLoading(false);
      return () => {
        active = false;
      };
    }

    const tiebreakerWeek = isNflPickemContest ? (activeWeek ?? 0) : 0;

    if (contestViewEntry && contestViewEntry.contestId === selectedContestId) {
      const matchingTiebreaker =
        contestViewEntry.tiebreakers?.find((tb) => (tb.week ?? 0) === tiebreakerWeek) ?? contestViewEntry.tiebreaker;
      if (selectedContest.type === 'BRACKET_NCAAM') {
        const rows = (contestViewEntry.picks as ParticipantEntryBracketPick[]).map((pick) => ({
          gameSlot: pick.gameSlot,
          pickedTeam: pick.pickedTeam,
          pointsAwarded: pick.pointsAwarded,
          isCorrect: pick.isCorrect
        }));
        setSavedBracket(rows);
        setTiebreakerGuess(matchingTiebreaker?.answer ?? '');
        tiebreakerSavedRef.current = matchingTiebreaker?.answer ?? '';
      } else {
        const rows = (contestViewEntry.picks as ParticipantEntryPickemPick[]).map((pick) => ({
          gameId: pick.gameId,
          pickedWinner: pick.pickedWinner,
          pointsAwarded: pick.pointsAwarded,
          isCorrect: pick.isCorrect
        }));
        setSavedPicks(rows);
        setTiebreakerGuess(matchingTiebreaker?.answer ?? '');
        tiebreakerSavedRef.current = matchingTiebreaker?.answer ?? '';
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
            api.getBracket(authToken, selectedContestId, selectedEntry.id),
            api.getEntryTiebreaker(authToken, selectedContestId, selectedEntry.id, tiebreakerWeek).catch(() => ({ tiebreaker: null }))
          ]);
          if (!active) return;
          setSavedBracket(data.picks);
          setTiebreakerGuess(tiebreakerData.tiebreaker?.answer ?? '');
          tiebreakerSavedRef.current = tiebreakerData.tiebreaker?.answer ?? '';
          return;
        }

        const [data, tiebreakerData] = await Promise.all([
          api.getPicks(authToken, selectedContestId, selectedEntry.id),
          api.getEntryTiebreaker(authToken, selectedContestId, selectedEntry.id, tiebreakerWeek).catch(() => ({ tiebreaker: null }))
        ]);
        if (!active) return;
        setSavedPicks(data.picks);
        setTiebreakerGuess(tiebreakerData.tiebreaker?.answer ?? '');
        tiebreakerSavedRef.current = tiebreakerData.tiebreaker?.answer ?? '';
      } catch (err) {
        if (!active) return;
        handleAppError(err);
      } finally {
        if (!active) return;
        setIsSavedLoading(false);
      }
    };

    load();

    return () => {
      active = false;
    };
  }, [userId, selectedContestId, selectedContest?.type, selectedEntry?.id, contestViewEntry, isNflPickemContest, activeWeek]);

  useEffect(() => {
    if (!tiebreakerPrompt || isUefaBracketContest) return;
    if (!selectedContestId || isViewingContestParticipantEntry) return;

    const trimmed = tiebreakerGuess.trim();
    if (!trimmed || trimmed === tiebreakerSavedRef.current) return;

    const numericGuess = Number(trimmed);
    if (!Number.isInteger(numericGuess) || numericGuess < 0) return;

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const { entry } = await ensureContestEntry(selectedContestId);
          await api.saveEntryTiebreaker(authToken, selectedContestId, entry.id, {
            week: isNflPickemContest ? (activeWeek ?? 0) : 0,
            prompt: tiebreakerPrompt,
            answer: trimmed,
            numericGuess
          });
          tiebreakerSavedRef.current = trimmed;
          const entryData = await api.entriesMe(authToken);
          setEntries(entryData.entries);
          setStatus('Tiebreaker saved.');
        } catch (err) {
          handleAppError(err);
        }
      })();
    }, 700);

    return () => window.clearTimeout(timer);
  }, [tiebreakerGuess, tiebreakerPrompt, isUefaBracketContest, selectedContestId, isViewingContestParticipantEntry, isNflPickemContest, activeWeek]);

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
      const normalizedEmail = email.trim().toLowerCase();
      if (!normalizedEmail) {
        setError('Enter your email.');
        return;
      }
      if (!password) {
        setError('Enter your password.');
        return;
      }

      let auth;
      if (authMode === 'register') {
        if (!displayName.trim()) {
          setError('Enter a display name.');
          return;
        }
        if (password.length < 8) {
          setError('Password must be at least 8 characters.');
          return;
        }
        if (password !== confirmPassword) {
          setError('Passwords do not match.');
          return;
        }
        auth = await api.register(normalizedEmail, password, displayName.trim());
      } else {
        auth = await api.login(normalizedEmail, password);
      }

      localStorage.setItem(AUTH_TOKEN_KEY, auth.token);
      localStorage.removeItem(LEGACY_USER_KEY);
      setAuthToken(auth.token);
      setUserId(auth.user.id);
      setDisplayName(auth.user.displayName);
      setCurrentUserEmail(auth.user.email);
      setPassword('');
      setConfirmPassword('');
      setStatus(authMode === 'register' ? 'Account created.' : 'Logged in.');
    } catch (err) {
      handleAppError(err);
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
      const created = await api.createGroup(authToken, contestId, groupName, groupVisibility, groupVisibility === 'PRIVATE' ? groupPassword.trim() : undefined);
      setGroupName('');
      setGroupPassword('');
      await refreshAll(authToken, contestId || null);
      await refreshPopularGroups(contestId);
      await goToGroupDetail(created.id, contestId, groupVisibility === 'PRIVATE' ? 'Private group created.' : 'Public group created.');
    } catch (err) {
      handleAppError(err);
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
      await api.joinGroup(authToken, contestId, matchedGroup.id);
      setPublicGroupName('');
      await refreshAll(authToken, contestId);
      await refreshPopularGroups(contestId);
      setStatus('Joined public group.');
    } catch (err) {
      handleAppError(err);
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
      await api.joinPrivateGroup(authToken, contestId, privateGroupName.trim(), privateGroupPassword.trim());
      setPrivateGroupName('');
      setPrivateGroupPassword('');
      await refreshAll(authToken, contestId);
      await refreshPopularGroups(contestId);
      setStatus('Joined private group.');
    } catch (err) {
      handleAppError(err);
    }
  }

  async function onSaveUefaTiebreaker() {
    if (!selectedContestId || isViewingContestParticipantEntry) return;
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
      const { entry } = await ensureContestEntry(selectedContestId);
      await api.saveEntryTiebreaker(authToken, selectedContestId, entry.id, {
        prompt: 'How many combined total goals will be scored in the knockout stage? (15 games)',
        answer: trimmed,
        numericGuess
      });
      const entryData = await api.entriesMe(authToken);
      setEntries(entryData.entries);
      setStatus('Tiebreaker saved.');
    } catch (err) {
      handleAppError(err);
    }
  }

  async function onJoinPopularGroup(contestId: string, groupId: string) {
    setError('');
    try {
      await api.joinGroup(authToken, contestId, groupId);
      await refreshAll(authToken, contestId);
      await refreshPopularGroups(contestId);
      setStatus('Joined group.');
    } catch (err) {
      handleAppError(err);
    }
  }

  function activeContestIdForGroupActions(): string {
    return activeTopPage === 'groups' ? selectedGroupContestId : selectedContestId;
  }

  async function onCreateEntry() {
    if (!selectedContestId) return;
    setError('');
    try {
      const { created } = await ensureContestEntry(selectedContestId);
      setStatus(created ? 'Entry created.' : 'Entry ready.');
    } catch (err) {
      handleAppError(err);
    }
  }

  function onDraftPickemTeam(gameId: string, pickedWinner: string) {
    if (isViewingContestParticipantEntry) return;
    setPickDraft((prev) => ({
      ...prev,
      [gameId]: { ...(prev[gameId] ?? { confidencePoints: '' }), pickedWinner }
    }));
  }

  function onDraftConfidence(gameId: string, value: string) {
    setPickDraft((prev) => ({
      ...prev,
      [gameId]: { ...(prev[gameId] ?? { pickedWinner: '' }), confidencePoints: value.replace(/[^0-9]/g, '') }
    }));
  }

  async function onSelectStraightPickemTeam(game: Game, pickedWinner: string) {
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
      const { entry } = await ensureContestEntry(selectedContestId);

      const now = Date.now();
      const payload = games
        .filter((g) => nextDraft[g.id]?.pickedWinner && new Date(g.startTime).getTime() > now)
        .map((g) => ({ gameId: g.id, pickedWinner: nextDraft[g.id].pickedWinner }));

      if (payload.length === 0) {
        setStatus('That game has already locked.');
        return;
      }

      await api.submitPicks(authToken, selectedContestId, payload);
      const saved = await api.getPicks(authToken, selectedContestId, entry.id);
      setSavedPicks(saved.picks);
      await refreshPickPercentages(selectedContestId);
      setStatus('Pick saved automatically.');
    } catch (err) {
      handleAppError(err);
    }
  }

  async function loadStreakState(contestId: string) {
    if (!authToken) return;
    setIsStreakLoading(true);
    try {
      const data = await api.getMyStreakPick(authToken, contestId);
      setStreakState(data);
    } catch (err) {
      handleAppError(err);
    } finally {
      setIsStreakLoading(false);
    }
  }

  async function onCreateStreakPick(game: Game, pickedWinner: string) {
    if (!selectedContestId || !isStreakContest) return;
    setError('');
    try {
      await api.createStreakPick(authToken, selectedContestId, game.id, pickedWinner);
      setStatus('Pick locked in.');
      await loadStreakState(selectedContestId);
    } catch (err) {
      handleAppError(err);
    }
  }

  async function onForfeitStreakPick(pickId: string) {
    if (!selectedContestId) return;
    setError('');
    try {
      await api.forfeitStreakPick(authToken, selectedContestId, pickId);
      setStatus('Pick forfeited. Streak reset to 0.');
      await loadStreakState(selectedContestId);
    } catch (err) {
      handleAppError(err);
    }
  }

  async function onSelectOlympicBracketTeam(gameSlot: string, round: number, pickedTeam: string) {
    if (!selectedContestId || isViewingContestParticipantEntry) return;
    setError('');

    try {
      const { entry } = await ensureContestEntry(selectedContestId);

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
      const clearedCount = next.size - payload.length;

      await api.submitBracket(authToken, selectedContestId, payload);
      const saved = await api.getBracket(authToken, selectedContestId, entry.id);
      setSavedBracket(saved.picks);

      await refreshPickPercentages(selectedContestId);
      setStatus(bracketAutoClearStatus('Bracket selection saved automatically.', clearedCount));
    } catch (err) {
      handleAppError(err);
    }
  }


  async function onSelectConferenceChampion(slot: string, pickedTeam: string) {
    if (!selectedContestId || !isConferenceChampionsContest || isViewingContestParticipantEntry) return;
    setError('');

    try {
      const { entry } = await ensureContestEntry(selectedContestId);

      const next = new Map(savedBracketBySlot);
      next.set(slot, pickedTeam);

      const payload = NCAAB_CONFERENCE_TEAMS
        .map((conference) => ({ gameSlot: conference.slot, pickedTeam: next.get(conference.slot) ?? '' }))
        .filter((pick) => pick.pickedTeam)
        .map((pick) => ({ ...pick, round: 1 }));

      if (payload.length === 0) return;

      await api.submitBracket(authToken, selectedContestId, payload);
      const saved = await api.getBracket(authToken, selectedContestId, entry.id);
      setSavedBracket(saved.picks);

      await refreshPickPercentages(selectedContestId);
      setStatus('Conference champion pick saved.');
    } catch (err) {
      handleAppError(err);
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
      const { entry } = await ensureContestEntry(selectedContestId);

      const next = new Map(savedBracketBySlot);
      next.set(gameSlot, pickedTeam);

      const gameBySlot = new Map(games.map((game) => [game.providerGameId, game]));
      const validPicks = pruneInvalidMarchPicks(next, gameBySlot);

      const payload = Array.from(validPicks.entries())
        .map(([slot, team]) => ({
          gameSlot: slot,
          pickedTeam: team,
          round: marchMadnessRoundForSlot(slot)
        }));
      const clearedCount = next.size - validPicks.size;

      await api.submitBracket(authToken, selectedContestId, payload);
      const saved = await api.getBracket(authToken, selectedContestId, entry.id);
      setSavedBracket(saved.picks);

      await refreshPickPercentages(selectedContestId);
      setStatus(bracketAutoClearStatus('March Madness pick saved automatically.', clearedCount));
    } catch (err) {
      handleAppError(err);
    }
  }

  async function onSubmitPicks(e: FormEvent) {
    e.preventDefault();
    if (!selectedContestId || isViewingContestParticipantEntry) return;
    setError('');
    try {
      const { entry } = await ensureContestEntry(selectedContestId);
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

      await api.submitPicks(authToken, selectedContestId, payload);
      const saved = await api.getPicks(authToken, selectedContestId, entry.id);
      setSavedPicks(saved.picks);
      await refreshPickPercentages(selectedContestId);
      setStatus('Picks submitted.');
    } catch (err) {
      handleAppError(err);
    }
  }

  async function onSubmitBracket(e: FormEvent) {
    e.preventDefault();
    if (!selectedContestId || isViewingContestParticipantEntry) return;
    setError('');
    try {
      const { entry } = await ensureContestEntry(selectedContestId);
      await api.submitBracket(
        authToken,
        selectedContestId,
        bracketDraft
          .filter((row) => row.gameSlot && row.pickedTeam && row.round)
          .map((row) => ({ gameSlot: row.gameSlot, pickedTeam: row.pickedTeam, round: Number(row.round) }))
      );
      const saved = await api.getBracket(authToken, selectedContestId, entry.id);
      setSavedBracket(saved.picks);
      await refreshPickPercentages(selectedContestId);
      setStatus('Bracket picks submitted.');
    } catch (err) {
      handleAppError(err);
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
      const created = await api.cloneContest(authToken, selectedContestId, {
        name: cloneName.trim(),
        season,
        startsAt: startsAtIso,
        includeGames: cloneIncludeGames
      });

      await refreshAll(authToken, created.id);
      setStatus('Contest cloned.');
      openContestPage(created.id);
    } catch (err) {
      handleAppError(err);
    }
  }

  async function onCreateContest(e: FormEvent) {
    e.preventDefault();

    const season = Number(newContestSeason);
    if (!newContestName.trim() || !Number.isInteger(season) || season < 2020 || !newContestStartsAt) {
      setError('Enter a valid contest name, season, and start date/time.');
      return;
    }

    setError('');
    try {
      const startsAtIso = new Date(newContestStartsAt).toISOString();
      const created = await api.createContest(authToken, {
        name: newContestName.trim(),
        type: newContestType,
        season,
        startsAt: startsAtIso,
        lockMode: 'PER_GAME',
        scoringConfig: {},
        groupIds: [],
        status: 'DRAFT'
      });

      setNewContestName('');
      setNewContestSeason('');
      setNewContestStartsAt('');
      await refreshAll(authToken, created.id);
      setStatus('Contest created as a draft.');
      openContestPage(created.id);
    } catch (err) {
      handleAppError(err);
    }
  }

  async function onSetContestStatus(nextStatus: 'DRAFT' | 'OPEN') {
    if (!selectedContestId) return;

    setError('');
    try {
      await api.setContestStatus(authToken, selectedContestId, nextStatus);
      await refreshAll(authToken, selectedContestId);
      setStatus(nextStatus === 'OPEN' ? 'Contest published.' : 'Contest moved to draft (hidden from users).');
    } catch (err) {
      handleAppError(err);
    }
  }

  async function onRunContestGrading() {
    if (!selectedContestId) return;

    setError('');
    try {
      const result = await api.runContestGrading(authToken, selectedContestId);
      await refreshAll(authToken, selectedContestId);

      if (selectedEntry) {
        if (selectedContest?.type === 'BRACKET_NCAAM') {
          const saved = await api.getBracket(authToken, selectedContestId, selectedEntry.id);
          setSavedBracket(saved.picks);
        } else {
          const saved = await api.getPicks(authToken, selectedContestId, selectedEntry.id);
          setSavedPicks(saved.picks);
        }
      }

      setStatus(`Contest regraded. Changed entries: ${result.changedEntries}.`);
    } catch (err) {
      handleAppError(err);
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
      await api.overrideGameResult(authToken, selectedContestId, overrideProviderGameId, payload);

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

      await refreshAll(authToken, selectedContestId);

      if (selectedEntry) {
        if (selectedContest?.type === 'BRACKET_NCAAM') {
          const saved = await api.getBracket(authToken, selectedContestId, selectedEntry.id);
          setSavedBracket(saved.picks);
        } else {
          const saved = await api.getPicks(authToken, selectedContestId, selectedEntry.id);
          setSavedPicks(saved.picks);
        }
      }

      setStatus('Game result override saved and contest regraded.');
    } catch (err) {
      handleAppError(err);
    }
  }

  async function loadLeaderboard(groupId: string = selectedGroupId, contestId: string = selectedGroupContestId || selectedContestId) {
    if (!contestId || !groupId) return;
    setError('');
    setIsGroupLeaderboardLoading(true);
    try {
      const [groupData, contestData] = await Promise.all([
        api.groupLeaderboard(authToken, groupId, contestId),
        api.contestLeaderboard(authToken, contestId)
      ]);
      setSelectedGroupId(groupId);
      setSelectedGroupContestId(contestId);
      setLeaderboardRows(groupData.leaderboard);
      setContestLeaderboards((prev) => ({ ...prev, [contestId]: contestData.leaderboard }));
      setStatus('Leaderboard loaded.');
    } catch (err) {
      handleAppError(err);
    } finally {
      setIsGroupLeaderboardLoading(false);
    }
  }

  function openGroupPage(groupId: string) {
    if (!selectedContestId) return;
    void goToGroupDetail(groupId, selectedContestId);
  }

  async function goToGroupDetail(groupId: string, contestId: string, statusMessage?: string) {
    setSelectedGroupId(groupId);
    setSelectedGroupContestId(contestId);
    setLeaderboardRows([]);
    setSelectedLeaderboardEntry(null);
    setLeaderboardEntryContestId('');
    setGroupViewMode('results');
    setGroupPicksGrid(null);
    setGroupPicksWeek(null);
    setActiveTopPage('group-detail');
    setTimeout(() => scrollToSection('group-detail-page'), 0);
    await loadLeaderboard(groupId, contestId);
    if (statusMessage) setStatus(statusMessage);
  }

  async function loadGroupPicksGrid(groupId: string, contestId: string, weekOverride?: number | null) {
    if (!authToken || !groupId || !contestId) return;
    setError('');
    setIsGroupPicksLoading(true);
    try {
      const data = await api.groupPicksGrid(authToken, groupId, contestId, weekOverride ?? null);
      setGroupPicksGrid(data);
      setGroupPicksWeek(data.week);
    } catch (err) {
      handleAppError(err);
    } finally {
      setIsGroupPicksLoading(false);
    }
  }

  async function onOpenUserStats(targetUserId: string) {
    if (!authToken) return;

    const currentPage = activeTopPage === 'user-stats' ? statsReturnPage : activeTopPage;
    setStatsReturnPage(currentPage as StatsReturnPage);

    setError('');
    setStatsUserId(targetUserId);
    setIsUserStatsLoading(true);
    setActiveTopPage('user-stats');

    try {
      const data = await api.userStats(authToken, targetUserId);
      setSelectedUserStats(data);
      setStatus('User stats loaded.');
      setTimeout(() => scrollToSection('user-stats-page'), 0);
    } catch (err) {
      handleAppError(err);
      setSelectedUserStats(null);
    } finally {
      setIsUserStatsLoading(false);
    }
  }

  async function onViewParticipantEntry(contestId: string, participantUserId: string) {
    if (!authToken) return;

    setError('');
    setLeaderboardEntryContestId(contestId);
    setIsLeaderboardEntryLoading(true);

    try {
      const data = await api.contestantEntry(authToken, contestId, participantUserId);
      setSelectedLeaderboardEntry(data);
      setStatus('Participant entry loaded.');
    } catch (err) {
      setSelectedLeaderboardEntry(null);
      handleAppError(err);
    } finally {
      setIsLeaderboardEntryLoading(false);
    }
  }

  function logout() {
    performLogout('Logged out.');
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

  function contestPrimaryAction(contest: Contest): { label: string; tone: 'primary' | 'secondary' } {
    const normalized = contest.status.toUpperCase();
    const entry = entryByContestId.get(contest.id);

    if (normalized === 'DRAFT') {
      return { label: 'Preview', tone: 'secondary' };
    }
    if (normalized === 'OPEN') {
      if (!entry) return { label: 'Make Picks', tone: 'primary' };
      if (!entry.isComplete) return { label: 'Finish Picks', tone: 'primary' };
      return { label: 'Edit Picks', tone: 'primary' };
    }
    if (normalized === 'LOCKED') {
      return { label: entry ? 'View My Picks' : 'View Contest', tone: 'secondary' };
    }
    return { label: entry ? 'View Results' : 'View Leaderboard', tone: 'secondary' };
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

  function goHome() {
    if (contestPageId) {
      closeContestPage();
    } else {
      setActiveTopPage('home');
      setTimeout(() => scrollToSection('home'), 0);
    }
  }

  return (
    <div className="page">
      <header className="appHeader" id="home">
        <button type="button" className="brand" onClick={goHome} aria-label="The 1% home">
          <img src="/logo-the-1-percent.png" alt="" className="brandLogo" />
          <span className="brandWordmark">The 1%</span>
        </button>

        {authToken ? (
          <>
            <nav className="primaryNav" aria-label="Primary">
              <button
                type="button"
                className="navItem"
                aria-current={activeTopPage === 'home' && !contestPageId ? 'page' : undefined}
                onClick={goHome}
              >
                <NavIcon d={ICON_CONTESTS} />
                <span>Contests</span>
              </button>
              <button
                type="button"
                className="navItem"
                aria-current={activeTopPage === 'entries' ? 'page' : undefined}
                onClick={() => { setActiveTopPage('entries'); setTimeout(() => scrollToSection('my-entries-page'), 0); }}
              >
                <NavIcon d={ICON_ENTRIES} />
                <span>Entries</span>
              </button>
              <button
                type="button"
                className="navItem"
                aria-current={activeTopPage === 'leaderboards' ? 'page' : undefined}
                onClick={() => { setSelectedLeaderboardContestId(''); setSelectedLeaderboardEntry(null); setLeaderboardEntryContestId(''); setActiveTopPage('leaderboards'); setTimeout(() => scrollToSection('leaderboards-page'), 0); }}
              >
                <NavIcon d={ICON_LEADERBOARD} />
                <span>Leaderboards</span>
              </button>
              <button
                type="button"
                className="navItem"
                aria-current={activeTopPage === 'groups' || activeTopPage === 'group-detail' ? 'page' : undefined}
                onClick={() => { setSelectedGroupContestId(selectedContestId || ''); setActiveTopPage('groups'); setTimeout(() => scrollToSection('groups-page'), 0); }}
              >
                <NavIcon d={ICON_GROUPS} />
                <span>Groups</span>
              </button>
              <button
                type="button"
                className="navItem"
                aria-current={activeTopPage === 'profile' ? 'page' : undefined}
                onClick={() => { setActiveTopPage('profile'); setTimeout(() => scrollToSection('profile-page'), 0); }}
              >
                <NavIcon d={ICON_PROFILE} />
                <span>Profile</span>
              </button>
            </nav>
            <button type="button" className="iconBtn headerRefresh" onClick={() => refreshAll()} aria-label="Refresh">
              <NavIcon d={ICON_REFRESH} />
            </button>
          </>
        ) : null}
      </header>

      {!authToken ? (
        <section className="card lift">
          <h2>{authMode === 'login' ? 'Sign In' : 'Create Account'}</h2>
          <div className="row gap" style={{ marginBottom: '1rem' }}>
            <button type="button" className={authMode === 'login' ? '' : 'secondary'} onClick={() => { setAuthMode('login'); setError(''); }}>
              Sign In
            </button>
            <button type="button" className={authMode === 'register' ? '' : 'secondary'} onClick={() => { setAuthMode('register'); setError(''); }}>
              Create Account
            </button>
          </div>
          <form onSubmit={onLogin} className="grid">
            {authMode === 'register' ? (
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name" required />
            ) : null}
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" required />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" required />
            {authMode === 'register' ? (
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm password" required />
            ) : null}
            <button type="submit">{authMode === 'login' ? 'Enter App' : 'Create Account'}</button>
          </form>
        </section>
      ) : (
        <>
          {activeTopPage === 'profile' ? (
            <section className="card lift" id="profile-page">
              <div className="profileHeader">
                <div className="profileAvatar" aria-hidden="true">{(displayName || currentUserEmail || '?').slice(0, 1).toUpperCase()}</div>
                <div>
                  <h2>{displayName || currentUserEmail || userId.slice(0, 8)}</h2>
                  {currentUserEmail ? <p className="muted">{currentUserEmail}</p> : null}
                  {isContestCreator ? <span className="entryBadge entered">Contest Creator</span> : null}
                </div>
              </div>
              <div className="row gap profileActions">
                <button type="button" onClick={() => void onOpenUserStats(userId)}>View My Stats</button>
                <button type="button" className="secondary" onClick={() => refreshAll()}>Refresh Data</button>
                <button type="button" className="secondary" onClick={logout}>Logout</button>
              </div>
            </section>
          ) : null}

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
                      <li key={entry.id} className="contestCard">
                        <div className="contestCardMain">
                          <strong>{contest?.name ?? entry.contestId}</strong>
                          <span className="contestMeta">{contest ? `${contestTypeLabel(contest)} · ${contest.status}` : 'Contest'} · {entry.totalPoints} pts</span>
                          <span className={entry.isComplete ? 'entryBadge entered' : 'entryBadge incomplete'}>
                            {entry.isComplete ? 'All Picks Submitted' : 'Picks Incomplete'}
                          </span>
                        </div>
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
                        if (nextGroupId && selectedGroupContestId) {
                          void goToGroupDetail(nextGroupId, selectedGroupContestId);
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
              )}
            </section>
          ) : activeTopPage === 'group-detail' ? (
            <section className="card lift" id="group-detail-page">
              <button
                type="button"
                className="secondary backLink"
                onClick={() => { setActiveTopPage('groups'); setTimeout(() => scrollToSection('groups-page'), 0); }}
              >
                ← Groups
              </button>
              <h2>{groups.find((group) => group.id === selectedGroupId)?.name ?? 'Group'}</h2>
              {(() => {
                const activeGroup = groups.find((group) => group.id === selectedGroupId);
                return activeGroup ? (
                  <p className="muted">{activeGroup.visibility} · {activeGroup.role}</p>
                ) : null;
              })()}

              {groupPicksSupported ? (
                <div className="row gap groupViewToggle">
                  <button
                    type="button"
                    className={groupViewMode === 'results' ? 'ctaBtn' : 'secondary'}
                    onClick={() => setGroupViewMode('results')}
                  >
                    Group Results
                  </button>
                  <button
                    type="button"
                    className={groupViewMode === 'picks' ? 'ctaBtn' : 'secondary'}
                    onClick={() => {
                      setGroupViewMode('picks');
                      if (!groupPicksGrid && selectedGroupId && selectedGroupContestId) {
                        void loadGroupPicksGrid(selectedGroupId, selectedGroupContestId);
                      }
                    }}
                  >
                    Group Picks
                  </button>
                </div>
              ) : null}

              {groupViewMode === 'results' ? (
                <>
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
                      <div className="leaderboardScrollWrap">
                      <div className="leaderboardHeader">
                        <span>Rank</span>
                        <span>User name</span>
                        <span className="leaderboardHeaderMeta"><span>Percentile</span><span>Points</span></span>
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
                            <div className="leaderboardEntryBody">
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
                                </button>
                                {isTopOne ? (
                                  <img
                                    src="/logo-the-1-percent.png"
                                    alt="Top 1%"
                                    title="Top 1% finish"
                                    className="leaderboardTopOneLogo"
                                  />
                                ) : null}
                                <button type="button" className="secondary miniBtn" onClick={() => void onOpenUserStats(row.userId)}>Stats</button>
                              </div>
                              <div className="leaderboardMeta">
                                <span className="leaderboardPercentile">{percentile.toFixed(2)}%</span>
                                <span className="leaderboardPoints">{row.totalPoints} pts</span>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                      </div>
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
              ) : (
                <>
                  {groupPicksGrid && groupPicksGrid.weeks.length > 0 ? (
                    <div className="row gap groupPicksWeekRow">
                      <p className="muted">Week</p>
                      <select
                        value={groupPicksWeek ?? ''}
                        onChange={(e) => {
                          const nextWeek = Number(e.target.value);
                          if (selectedGroupId && selectedGroupContestId) {
                            void loadGroupPicksGrid(selectedGroupId, selectedGroupContestId, nextWeek);
                          }
                        }}
                      >
                        {groupPicksGrid.weeks.map((week) => (
                          <option key={week} value={week}>Week {week}</option>
                        ))}
                      </select>
                    </div>
                  ) : null}

                  {isGroupPicksLoading ? <p className="muted">Loading group picks...</p> : null}
                  {!isGroupPicksLoading && groupPicksGrid && groupPicksGrid.games.length === 0 ? (
                    <p className="muted">No games to show yet.</p>
                  ) : null}
                  {!isGroupPicksLoading && groupPicksGrid && groupPicksGrid.games.length > 0 ? (
                    <div className="groupPicksGridWrap">
                      <table className="groupPicksTable">
                        <thead>
                          <tr>
                            <th className="groupPicksEntryCol">Group Entries</th>
                            <th>Pts</th>
                            {groupPicksGrid.games.map((game) => {
                              const awayLogo = selectedGroupContest ? teamLogoUrlForContestType(selectedGroupContest.type, game.awayTeam) : null;
                              const homeLogo = selectedGroupContest ? teamLogoUrlForContestType(selectedGroupContest.type, game.homeTeam) : null;
                              return (
                                <th key={game.id} className="groupPicksMatchupCol">
                                  <div className="groupPicksMatchup">
                                    {awayLogo ? <img src={awayLogo} alt={game.awayTeam} className="groupPicksLogo" /> : <span>{game.awayTeam}</span>}
                                    <span className="groupPicksAt">@</span>
                                    {homeLogo ? <img src={homeLogo} alt={game.homeTeam} className="groupPicksLogo" /> : <span>{game.homeTeam}</span>}
                                  </div>
                                </th>
                              );
                            })}
                            {groupPicksGrid.rows.some((row) => row.tiebreaker) ? (
                              <th className="groupPicksTiebreakerCol">
                                {groupPicksGrid.rows.find((row) => row.tiebreaker)?.tiebreaker?.prompt ?? 'Tiebreaker'}
                              </th>
                            ) : null}
                          </tr>
                        </thead>
                        <tbody>
                          {groupPicksGrid.rows.map((row, index) => (
                            <tr key={row.userId} className={row.userId === userId ? 'groupPicksOwnRow' : undefined}>
                              <td className="groupPicksEntryCol">
                                <span className="leaderboardRank">{rankFromPoints(groupPicksGrid.rows.map((r) => ({ totalPoints: r.weekPoints })), index)}</span>{' '}
                                <button type="button" className="contestNameLink" onClick={() => void onOpenUserStats(row.userId)}>{row.displayName}</button>
                              </td>
                              <td>{row.weekPoints}</td>
                              {groupPicksGrid.games.map((game) => {
                                const pick = row.picks[game.id];
                                if (!pick) return <td key={game.id} className="groupPicksCell muted">—</td>;
                                const logo = selectedGroupContest ? teamLogoUrlForContestType(selectedGroupContest.type, pick.pickedWinner) : null;
                                const resultClass = pick.isCorrect === true ? 'correct' : pick.isCorrect === false ? 'incorrect' : '';
                                return (
                                  <td key={game.id} className={'groupPicksCell ' + resultClass}>
                                    {logo ? <img src={logo} alt={pick.pickedWinner} className="groupPicksLogo" /> : <span>{pick.pickedWinner}</span>}
                                  </td>
                                );
                              })}
                              {groupPicksGrid.rows.some((r) => r.tiebreaker) ? (
                                <td className="groupPicksTiebreakerCol muted">{row.tiebreaker?.answer ?? '—'}</td>
                              ) : null}
                            </tr>
                          ))}
                        </tbody>
                      </table>
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
                <p className="muted">Filter by year</p>
                <select value={leaderboardYearFilter} onChange={(e) => setLeaderboardYearFilter(e.target.value)}>
                  <option value="ALL">All Time</option>
                  {leaderboardYearOptions.map((year) => (<option key={year} value={year}>{year}</option>))}
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
                    {rows.length === 0 ? <p className="muted">No entries yet.</p> : contest.type === 'STREAK' ? (
                      <div className="leaderboardScrollWrap">
                        <div className="leaderboardHeader">
                          <span>Rank</span>
                          <span>User</span>
                          <span className="leaderboardHeaderMeta">
                            <span>Current</span>
                            <span>Best</span>
                          </span>
                        </div>
                        <ol className="list leaderboardList">
                        {rows.map((row, index) => (
                          <li key={`${contest.id}-${row.userId}`} className="leaderboardRow">
                            <span className="leaderboardRank">{index + 1}</span>
                            <div className="leaderboardEntryBody">
                              <div className="leaderboardNameCell">
                                <button type="button" className="contestNameLink" onClick={() => onLeaderboardNameClick(contest.id, row.userId)}>{leaderboardDisplayName(row)}</button>
                                <button type="button" className="secondary miniBtn" onClick={() => void onOpenUserStats(row.userId)}>Stats</button>
                              </div>
                              <div className="leaderboardMeta">
                                <span className="leaderboardPercentile">{row.currentStreak ?? 0}</span>
                                <span className="leaderboardPoints">{row.bestStreak ?? 0}</span>
                              </div>
                            </div>
                          </li>
                        ))}
                        </ol>
                      </div>
                    ) : (() => {
                      const showRecord = contest.type !== 'BRACKET_NCAAM';
                      return (
                      <>
                        <div className="leaderboardScrollWrap">
                        <div className="leaderboardHeader">
                          <span>Rank</span>
                          <span>User</span>
                          <span className="leaderboardHeaderMeta">
                            {showRecord ? <span className="leaderboardRecordHeader">W-L</span> : null}
                            <span>Percentile</span>
                            <span>Points</span>
                          </span>
                        </div>
                        <ol className="list leaderboardList">
                        {rows.map((row, index) => {
                          const rank = rankFromPoints(rows, index);
                          const percentile = percentileFromRank(rows.length, rank);
                          const isTopOne = isTopOnePercentEntry(rows, row);
                          return (
                            <li key={`${contest.id}-${row.userId}`} className="leaderboardRow">
                              <span className="leaderboardRank">{rank}</span>
                              <div className="leaderboardEntryBody">
                                <div className="leaderboardNameCell">
                                  <button type="button" className="contestNameLink" onClick={() => onLeaderboardNameClick(contest.id, row.userId)}>{leaderboardDisplayName(row)}</button>
                                  {isTopOne ? (
                                    <img
                                      src="/logo-the-1-percent.png"
                                      alt="Top 1%"
                                      title="Top 1% finish"
                                      className="leaderboardTopOneLogo"
                                    />
                                  ) : null}
                                  <button type="button" className="secondary miniBtn" onClick={() => void onOpenUserStats(row.userId)}>Stats</button>
                                </div>
                                <div className="leaderboardMeta">
                                  {showRecord ? <span className="leaderboardRecord">{row.wins}-{row.losses}</span> : null}
                                  <span className="leaderboardPercentile">{percentile.toFixed(2)}%</span>
                                  <span className="leaderboardPoints">{row.totalPoints} pts</span>
                                </div>
                              </div>
                            </li>
                          );
                        })}
                        </ol>
                        </div>
                      </>
                      );
                    })()}
                  </article>
                );
              })}
            </section>
          ) : (
            <>
              {activeTopPage === 'home' && !contestPageId ? (
                <section className="card lift contestsOpenSection" id="contests-page">
                  <h2>Open Now</h2>
                  <p className="muted">Pick now before these lock.</p>
                  {openForPicksContests.length === 0 ? (
                    <p className="muted">No contests open for picks right now.</p>
                  ) : (
                    <ul className="list contestCardList">
                      {openForPicksContests.map((contest) => {
                        const contestEntry = entryByContestId.get(contest.id);
                        const hasEntered = !!contestEntry;
                        const isComplete = contestEntry?.isComplete === true;
                        const lockCountdown = countdownWithin24h(contest.lockAt, nowMs);
                        const lockLabel = contest.lockAt ? fmtDateEastern(contest.lockAt) + ' ET' : null;
                        const nextGameLockIso = contest.nextGameLockAt || (contest.lockMode !== 'PER_GAME' ? contest.startTime || contest.startsAt : null);
                        const action = contestPrimaryAction(contest);

                        return (
                          <li key={contest.id} className="contestCard">
                            <div className="contestCardMain">
                              <button type="button" className="contestNameLink" onClick={() => openContestPage(contest.id)}>{contest.name}</button>
                              <span className="contestMeta">{contestTypeLabel(contest)}</span>
                              {lockLabel ? (
                                <span className="contestTimingLine">
                                  <span>Locks {lockLabel}{lockCountdown ? ` (${lockCountdown})` : ''}</span>
                                </span>
                              ) : null}
                              {nextGameLockIso ? (
                                <span className="contestTimingLine">
                                  <span>Next game locks in <LiveCountdown targetIso={nextGameLockIso} /></span>
                                </span>
                              ) : null}
                              <span className={isComplete ? 'entryBadge entered' : hasEntered ? 'entryBadge incomplete' : 'entryBadge notEntered'}>{isComplete ? 'Entered' : hasEntered ? 'Entry Not Complete' : 'Not Entered'}</span>
                            </div>
                            <button type="button" className="ctaBtn" onClick={() => openContestPage(contest.id)}>{action.label}</button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              ) : null}

              {activeTopPage === 'home' && !contestPageId && lockedContests.length > 0 ? (
                <section className="card lift" id="contests-locked-page">
                  <h2>In Progress</h2>
                  <p className="muted">Picks are locked. Follow along on the leaderboard.</p>
                  <ul className="list contestCardList">
                    {lockedContests.map((contest) => {
                      const contestEntry = entryByContestId.get(contest.id);
                      const hasEntered = !!contestEntry;
                      const endCountdown = countdownWithin24h(contest.endAt, nowMs);
                      const endLabel = contest.endAt ? fmtDateEastern(contest.endAt) + ' ET' : null;
                      const action = contestPrimaryAction(contest);

                      return (
                        <li key={contest.id} className="contestCard contestCardCompact">
                          <div className="contestCardMain">
                            <button type="button" className="contestNameLink" onClick={() => openContestPage(contest.id)}>{contest.name}</button>
                            <span className="contestMeta">{contestTypeLabel(contest)} · {contest.status}</span>
                            {endLabel ? <span className="contestTimingLine"><span>Ends {endLabel}{endCountdown ? ` (${endCountdown})` : ''}</span></span> : null}
                            <span className={hasEntered ? 'entryBadge entered' : 'entryBadge notEntered'}>{hasEntered ? 'Entered' : 'Not Entered'}</span>
                          </div>
                          <button type="button" className="secondary" onClick={() => openContestPage(contest.id)}>{action.label}</button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ) : null}

              {activeTopPage === 'home' && !contestPageId && (upcomingDraftContests.length > 0 || PLANNED_UPCOMING_CONTESTS.length > 0) ? (
                <section className="card lift" id="upcoming-contests-page">
                  <h2>Upcoming</h2>
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

              {activeTopPage === 'home' && !contestPageId && isContestCreator ? (
                <details className="card lift collapsibleCard" id="create-contest-page">
                  <summary><h2>Create Contest</h2></summary>
                  <form className="stack" onSubmit={onCreateContest}>
                    <input
                      value={newContestName}
                      onChange={(e) => setNewContestName(e.target.value)}
                      placeholder="Contest name (e.g. Streak for the Peak - December 2026)"
                    />
                    <select value={newContestType} onChange={(e) => setNewContestType(e.target.value as typeof newContestType)}>
                      <option value="STREAK">Streak</option>
                      <option value="PICKEM_NFL">NFL Pick'em</option>
                      <option value="PICKEM_NBA">NBA Pick'em</option>
                      <option value="PICKEM_NHL">NHL Pick'em</option>
                      <option value="BRACKET_NCAAM">Bracket</option>
                    </select>
                    <input
                      value={newContestSeason}
                      onChange={(e) => setNewContestSeason(e.target.value)}
                      placeholder="Season (e.g. 2026)"
                      inputMode="numeric"
                    />
                    <input
                      type="datetime-local"
                      value={newContestStartsAt}
                      onChange={(e) => setNewContestStartsAt(e.target.value)}
                    />
                    <button type="submit">Create Contest (Draft)</button>
                  </form>
                </details>
              ) : null}

              {activeTopPage === 'home' && !contestPageId && filteredPriorEntries.length > 0 ? (
                <details className="card lift collapsibleCard" id="prior-contests-page">
                  <summary><h2>Completed</h2></summary>
                  <ul className="list">
                    {filteredPriorEntries.map((entry) => {
                      const contest = contests.find((c) => c.id === entry.contestId);
                      const action = contest ? contestPrimaryAction(contest) : { label: 'View Results' };
                      return (
                        <li key={entry.id}>
                          <strong>{contest?.name ?? entry.contestId}</strong>
                          <span>{entry.totalPoints} pts</span>
                          <button type="button" className="secondary" onClick={() => openContestPage(entry.contestId)}>{action.label}</button>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              ) : null}

              {activeTopPage === 'contest' && contestPageId && selectedContest ? (() => {
                const primaryAction = contestPrimaryAction(selectedContest);
                const primaryOnClick = primaryAction.label === 'View Leaderboard'
                  ? () => openContestLeaderboard(selectedContest.id)
                  : () => scrollToSection('contest-workspace');
                const lockCountdown = countdownWithin24h(selectedContest.lockAt, nowMs);
                const lockLabel = selectedContest.lockAt ? fmtDateEastern(selectedContest.lockAt) + ' ET' : null;
                const nextGameLockIso =
                  selectedContest.nextGameLockAt ||
                  (selectedContest.lockMode !== 'PER_GAME' ? selectedContest.startTime || selectedContest.startsAt : null);

                return (
                  <section className="card lift contestDetailHeader" id="contest-detail">
                    <div className="row between gap contestDetailTop">
                      <div>
                        <span className={'statusPill statusPill-' + selectedContest.status.toLowerCase()}>{selectedContest.status}</span>
                        <h2>{selectedContest.name}</h2>
                        <p className="muted">{contestTypeLabel(selectedContest)}{lockLabel ? ` · Locks ${lockLabel}${lockCountdown ? ` (${lockCountdown})` : ''}` : ''}</p>
                        {nextGameLockIso ? (
                          <p className="firstGameLockLine">Next game locks in <LiveCountdown targetIso={nextGameLockIso} /></p>
                        ) : null}
                      </div>
                      <button type="button" className="secondary" onClick={closeContestPage}>Back to Contests</button>
                    </div>

                    {isNflPickemContest ? (
                      <>
                        <div className="entryStatsBar seasonStatsBar">
                          <div className="entryStat">
                            <span className="entryStatLabel">W-L</span>
                            <span className="entryStatValue">{seasonRecord.wins}-{seasonRecord.losses}</span>
                          </div>
                          <span className="entryStatDivider" aria-hidden="true" />
                          <div className="entryStat">
                            <span className="entryStatLabel">Rank</span>
                            <span className="entryStatValue">{displayedEntryRank ?? '-'}</span>
                          </div>
                          <span className="entryStatDivider" aria-hidden="true" />
                          <div className="entryStat">
                            <span className="entryStatLabel">Pct</span>
                            <span className="entryStatValue">{displayedEntryPercentile !== null ? `${displayedEntryPercentile.toFixed(1)}%` : '-'}</span>
                          </div>
                          <span className="entryStatDivider" aria-hidden="true" />
                          <div className="entryStat">
                            <span className="entryStatLabel">Points</span>
                            <span className="entryStatValue">{displayedEntryPoints}</span>
                          </div>
                        </div>

                        <div className="weekProgressRow">
                          <span className="muted">
                            {activeWeek != null ? `Week ${activeWeek}` : selectedContest.name}
                            {currentWeekPicksMade.total > 0 ? `: ${currentWeekRecord.wins}-${currentWeekRecord.losses}` : ''}
                          </span>
                          {currentWeekPicksMade.total > 0 ? (
                            <span className="muted">{currentWeekPicksMade.made}/{currentWeekPicksMade.total} picks made</span>
                          ) : null}
                        </div>
                        {currentWeekPicksMade.total > 0 ? (
                          <div className="weekProgressBar">
                            <div
                              className="weekProgressFill"
                              style={{ width: `${Math.round((currentWeekPicksMade.made / currentWeekPicksMade.total) * 100)}%` }}
                            />
                          </div>
                        ) : null}

                        {contestWeeks.length > 1 ? (
                          <div className="weekTabRow">
                            {contestWeeks.map((week) => (
                              <button
                                key={week}
                                type="button"
                                className={'weekTabBtn ' + (week === activeWeek ? 'active' : '')}
                                onClick={() => setSelectedWeek(week)}
                              >
                                <span>Week {week}</span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </>
                    ) : isStreakContest ? (
                      <div className="entryStatsBar">
                        <div className="entryStat">
                          <span className="entryStatLabel">Current Streak</span>
                          <span className="entryStatValue">{streakState?.currentStreak ?? 0}</span>
                        </div>
                        <span className="entryStatDivider" aria-hidden="true" />
                        <div className="entryStat">
                          <span className="entryStatLabel">Best Streak</span>
                          <span className="entryStatValue">{streakState?.bestStreak ?? 0}</span>
                        </div>
                      </div>
                    ) : (
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
                    )}

                    <div className="row gap contestDetailActions">
                      <button type="button" className="ctaBtn ctaBtnLarge" onClick={primaryOnClick}>{primaryAction.label}</button>
                      <button type="button" className="secondary" onClick={() => openContestLeaderboard(selectedContest.id)}>Leaderboard</button>
                      {isContestCreator ? (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => void onSetContestStatus(selectedContest.status === 'DRAFT' ? 'OPEN' : 'DRAFT')}
                        >
                          {selectedContest.status === 'DRAFT' ? 'Publish' : 'Send to Draft'}
                        </button>
                      ) : null}
                    </div>
                  </section>
                );
              })() : null}



              {activeTopPage === 'contest' && contestPageId && selectedContest && isContestCreator ? (
                <details className="card lift collapsibleCard adminPanel" id="contest-admin-status">
                  <summary><h3>Admin Tools</h3></summary>
                  <h4 className="adminSubheading">System Status</h4>
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
                  {workerHealth?.lastWarnings && workerHealth.lastWarnings.length > 0 ? (
                    <div className="adminWarningList">
                      <p className="muted">Blocked syncs (suspicious game-count growth):</p>
                      {workerHealth.lastWarnings.map((warning, index) => (
                        <p key={index} className="error">{warning}</p>
                      ))}
                    </div>
                  ) : null}

                  <h4 className="adminSubheading">Admin Actions</h4>
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
                </details>
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
                            <option value="MIDWEST">Midwest Region</option>
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
                                const { awayTeam: resolvedAwayTeam, homeTeam: resolvedHomeTeam } = resolvedMarchGameTeams(game);
                                const awayName = formatMarchTeamLabel(game.awayTeam);
                                const homeName = formatMarchTeamLabel(game.homeTeam);
                                const savedWinner = savedBracketBySlot.get(game.providerGameId);
                                const savedRow = savedBracketRowBySlot.get(game.providerGameId);
                                const awayResult =
                                  savedRow?.pickedTeam === resolvedAwayTeam && savedRow.isCorrect !== null
                                    ? savedRow.isCorrect
                                      ? <span className="saveCheck" aria-label="Correct">✓</span>
                                      : <span className="saveMiss" aria-label="Wrong">✕</span>
                                    : null;
                                const homeResult =
                                  savedRow?.pickedTeam === resolvedHomeTeam && savedRow.isCorrect !== null
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
                                        className={'teamPickBtn ' + (savedWinner === resolvedAwayTeam ? 'selected' : '')}
                                        onClick={() => onSelectMarchMadnessTeam(game.providerGameId, resolvedAwayTeam)}
                                        disabled={isSavedLoading || isViewingContestParticipantEntry}
                                      >
                                        <span>{awayName}</span>
                                        <span className="pickPct">{pickPercentFor(game.providerGameId, resolvedAwayTeam)}</span>
                                        {awayResult}
                                      </button>
                                      <button
                                        type="button"
                                        className={'teamPickBtn ' + (savedWinner === resolvedHomeTeam ? 'selected' : '')}
                                        onClick={() => onSelectMarchMadnessTeam(game.providerGameId, resolvedHomeTeam)}
                                        disabled={isSavedLoading || isViewingContestParticipantEntry}
                                      >
                                        <span>{homeName}</span>
                                        <span className="pickPct">{pickPercentFor(game.providerGameId, resolvedHomeTeam)}</span>
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

                  {!isGamesLoading && isPickemContest ? (
                    <form className={'pickemBoard' + (isNflPickemContest ? ' nflPickemBoard' : '')} onSubmit={onSubmitPicks}>
                      {(isNflPickemContest ? weekGames : games).map((game) => {
                        const savedRow = savedPickRowByGame.get(game.id);
                        const draft = pickDraft[game.id];
                        const selectedWinner = draft?.pickedWinner || savedRow?.pickedWinner || '';
                        const awayResult =
                          savedRow?.pickedWinner === game.awayTeam && savedRow.isCorrect !== null
                            ? savedRow.isCorrect
                              ? <span className="saveCheck" aria-label="Correct">✓</span>
                              : <span className="saveMiss" aria-label="Wrong">✕</span>
                            : null;
                        const homeResult =
                          savedRow?.pickedWinner === game.homeTeam && savedRow.isCorrect !== null
                            ? savedRow.isCorrect
                              ? <span className="saveCheck" aria-label="Correct">✓</span>
                              : <span className="saveMiss" aria-label="Wrong">✕</span>
                            : null;

                        if (isNflPickemContest) {
                          const statusLower = game.status.toLowerCase();
                          const isGraded = Boolean(game.winner) || statusLower.includes('final') || statusLower.includes('complete');
                          const isLive = !isGraded && statusLower.includes('progress');
                          const awayWon = isGraded && game.winner === game.awayTeam;
                          const homeWon = isGraded && game.winner === game.homeTeam;
                          const awayLogo = nflLogoUrl(game.awayTeam);
                          const homeLogo = nflLogoUrl(game.homeTeam);
                          const bannerLabel = isGraded ? 'FINAL' : isLive ? 'LIVE' : `${fmtDateEastern(game.startTime)} ET`;
                          const bannerClass = isGraded ? 'final' : isLive ? 'live' : 'upcoming';

                          return (
                            <article key={game.id} className="nflPickCard">
                              <div className={'nflPickBanner ' + bannerClass}>{bannerLabel}</div>
                              <div className="nflPickTeams">
                                <button
                                  type="button"
                                  className={
                                    'nflPickTeamTile ' +
                                    (selectedWinner === game.awayTeam ? 'selected ' : '') +
                                    (isGraded ? (awayWon ? (selectedWinner === game.awayTeam ? 'winner' : '') : 'loser') : '')
                                  }
                                  onClick={() => isStraightPickemContest ? void onSelectStraightPickemTeam(game, game.awayTeam) : onDraftPickemTeam(game.id, game.awayTeam)}
                                  disabled={isSavedLoading || isViewingContestParticipantEntry}
                                >
                                  {awayLogo ? <img className="nflPickTeamLogo" src={awayLogo} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} /> : null}
                                  <span className="nflPickTeamName">{game.awayTeam}</span>
                                  <span className="pickPct">{pickPercentFor(game.id, game.awayTeam)}</span>
                                  {awayResult}
                                </button>
                                <span className="nflPickAt">@</span>
                                <button
                                  type="button"
                                  className={
                                    'nflPickTeamTile ' +
                                    (selectedWinner === game.homeTeam ? 'selected ' : '') +
                                    (isGraded ? (homeWon ? (selectedWinner === game.homeTeam ? 'winner' : '') : 'loser') : '')
                                  }
                                  onClick={() => isStraightPickemContest ? void onSelectStraightPickemTeam(game, game.homeTeam) : onDraftPickemTeam(game.id, game.homeTeam)}
                                  disabled={isSavedLoading || isViewingContestParticipantEntry}
                                >
                                  {homeLogo ? <img className="nflPickTeamLogo" src={homeLogo} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} /> : null}
                                  <span className="nflPickTeamName">{game.homeTeam}</span>
                                  <span className="pickPct">{pickPercentFor(game.id, game.homeTeam)}</span>
                                  {homeResult}
                                </button>
                              </div>
                              {isGraded && game.awayScore !== null && game.homeScore !== null ? (
                                <div className="nflPickScoreBar">
                                  <span className="nflScoreValue">{game.awayScore}</span>
                                  <span className="nflScoreSep">-</span>
                                  <span className="nflScoreValue">{game.homeScore}</span>
                                </div>
                              ) : null}
                              {!isStraightPickemContest ? (
                                <label className="confidenceInputRow">
                                  <span className="muted">Confidence points</span>
                                  <input
                                    value={draft?.confidencePoints ?? ''}
                                    onChange={(e) => onDraftConfidence(game.id, e.target.value)}
                                    inputMode="numeric"
                                    placeholder="e.g. 10"
                                    disabled={isViewingContestParticipantEntry}
                                  />
                                </label>
                              ) : null}
                            </article>
                          );
                        }

                        return (
                          <article key={game.id} className="pickRow pickemGameCard">
                            <div className="muted olympicMeta">{fmtDateEastern(game.startTime)} ET · {game.status}</div>
                            <div className="olympicTeamButtons">
                              <button
                                type="button"
                                className={'teamPickBtn ' + (selectedWinner === game.awayTeam ? 'selected' : '')}
                                onClick={() => isStraightPickemContest ? void onSelectStraightPickemTeam(game, game.awayTeam) : onDraftPickemTeam(game.id, game.awayTeam)}
                                disabled={isSavedLoading || isViewingContestParticipantEntry}
                              >
                                <span>{game.awayTeam}</span>
                                <span className="pickPct">{pickPercentFor(game.id, game.awayTeam)}</span>
                                {awayResult}
                              </button>
                              <button
                                type="button"
                                className={'teamPickBtn ' + (selectedWinner === game.homeTeam ? 'selected' : '')}
                                onClick={() => isStraightPickemContest ? void onSelectStraightPickemTeam(game, game.homeTeam) : onDraftPickemTeam(game.id, game.homeTeam)}
                                disabled={isSavedLoading || isViewingContestParticipantEntry}
                              >
                                <span>{game.homeTeam}</span>
                                <span className="pickPct">{pickPercentFor(game.id, game.homeTeam)}</span>
                                {homeResult}
                              </button>
                            </div>
                            {!isStraightPickemContest ? (
                              <label className="confidenceInputRow">
                                <span className="muted">Confidence points</span>
                                <input
                                  value={draft?.confidencePoints ?? ''}
                                  onChange={(e) => onDraftConfidence(game.id, e.target.value)}
                                  inputMode="numeric"
                                  placeholder="e.g. 10"
                                  disabled={isViewingContestParticipantEntry}
                                />
                              </label>
                            ) : null}
                          </article>
                        );
                      })}
                      {!isStraightPickemContest && !isViewingContestParticipantEntry ? (
                        <button type="submit" className="ctaBtn">Submit Picks</button>
                      ) : null}
                    </form>
                  ) : null}

                  {!isGamesLoading && tiebreakerPrompt && !isUefaBracketContest ? (
                    <section className="card tiebreakerCard">
                      <h3>Tiebreaker</h3>
                      <p className="muted">{tiebreakerPrompt}</p>
                      <div className="row gap">
                        <input
                          value={tiebreakerGuess}
                          onChange={(e) => setTiebreakerGuess(e.target.value.replace(/[^0-9]/g, ''))}
                          placeholder="Enter your answer"
                          inputMode="numeric"
                          disabled={isViewingContestParticipantEntry}
                        />
                      </div>
                      <p className="muted tiebreakerHint">Saves automatically as you type.</p>
                    </section>
                  ) : null}

                  {!isGamesLoading && isStreakContest ? (
                    <section className="streakBoard">
                      <div className="entryStatsBar seasonStatsBar">
                        <div className="entryStat">
                          <span className="entryStatLabel">Current Streak</span>
                          <span className="entryStatValue">{streakState?.currentStreak ?? 0}</span>
                        </div>
                        <span className="entryStatDivider" aria-hidden="true" />
                        <div className="entryStat">
                          <span className="entryStatLabel">Best Streak</span>
                          <span className="entryStatValue">{streakState?.bestStreak ?? 0}</span>
                        </div>
                      </div>

                      {isStreakLoading ? <p className="muted">Loading your streak...</p> : null}

                      {!isStreakLoading && streakState?.activePick ? (
                        <article className="card streakActivePick">
                          <h4>Your Active Pick</h4>
                          <p>
                            <strong>{streakState.activePick.pickedWinner}</strong> to win {streakState.activePick.awayTeam} @ {streakState.activePick.homeTeam}
                          </p>
                          <p className="muted">Starts {fmtDateEastern(streakState.activePick.startTime)} ET</p>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => void onForfeitStreakPick(streakState.activePick!.id)}
                            disabled={isViewingContestParticipantEntry}
                          >
                            Forfeit Pick
                          </button>
                        </article>
                      ) : null}

                      {!isStreakLoading && !streakState?.activePick ? (
                        <>
                          <h4>Pick a Game</h4>
                          {games.filter((g) => new Date(g.startTime).getTime() > nowMs).length === 0 ? (
                            <p className="muted">No upcoming games to pick from right now.</p>
                          ) : null}
                          {games
                            .filter((g) => new Date(g.startTime).getTime() > nowMs)
                            .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
                            .map((game) => {
                              const awayLogo = teamLogoUrlForSport(game.sport, game.awayTeam);
                              const homeLogo = teamLogoUrlForSport(game.sport, game.homeTeam);
                              return (
                                <article key={game.id} className="pickRow pickemGameCard">
                                  <div className="muted olympicMeta">{game.sport} · {fmtDateEastern(game.startTime)} ET</div>
                                  <div className="olympicTeamButtons">
                                    <button
                                      type="button"
                                      className="teamPickBtn"
                                      onClick={() => void onCreateStreakPick(game, game.awayTeam)}
                                      disabled={isViewingContestParticipantEntry}
                                    >
                                      {awayLogo ? <img className="nflPickTeamLogo" src={awayLogo} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} /> : null}
                                      <span>{game.awayTeam}</span>
                                    </button>
                                    <button
                                      type="button"
                                      className="teamPickBtn"
                                      onClick={() => void onCreateStreakPick(game, game.homeTeam)}
                                      disabled={isViewingContestParticipantEntry}
                                    >
                                      {homeLogo ? <img className="nflPickTeamLogo" src={homeLogo} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} /> : null}
                                      <span>{game.homeTeam}</span>
                                    </button>
                                  </div>
                                </article>
                              );
                            })}
                        </>
                      ) : null}

                      {streakState && streakState.history.length > 0 ? (
                        <>
                          <h4>Recent Picks</h4>
                          <ol className="list">
                            {streakState.history.map((pick) => (
                              <li key={pick.id}>
                                <span>{pick.pickedWinner} ({pick.awayTeam} @ {pick.homeTeam})</span>
                                <span className={pick.status === 'WON' ? 'saveCheck' : pick.status === 'LOST' ? 'saveMiss' : 'muted'}>
                                  {pick.status}
                                </span>
                              </li>
                            ))}
                          </ol>
                        </>
                      ) : null}
                    </section>
                  ) : null}

                  {!isGamesLoading && games.length > 0 && !isMarchMadnessStandardContest && !isOlympicBracketContest && !isUefaBracketContest && !isConferenceChampionsContest && !isPickemContest && !isStreakContest ? (
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
        <span key={status} className="statusMessage">{status}</span>
        {error ? <span key={error} className="error statusMessage">{error}</span> : null}
      </footer>
    </div>
  );
}
