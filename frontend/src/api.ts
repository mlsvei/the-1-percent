const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

export type ApiError = { error?: string; detail?: string };

async function request<T>(path: string, options: RequestInit = {}, userId?: string): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined)
  };

  if (userId) {
    headers['x-user-id'] = userId;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers
    });
  } catch {
    throw new Error('Backend unavailable. Make sure the frontend and backend dev servers are both running.');
  }

  const text = await response.text();

  let body: unknown = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      const hint = text.trim().startsWith('<')
        ? 'Server returned HTML instead of JSON. Check frontend/backend dev servers and API base URL.'
        : 'Server returned a non-JSON response.';
      throw new Error(hint);
    }
  }

  if (!response.ok) {
    const message = (body as ApiError).error ?? response.statusText;
    throw new Error(message);
  }

  return body as T;
}

export type Contest = {
  id: string;
  name: string;
  type: 'PICKEM_NFL' | 'PICKEM_NBA' | 'PICKEM_NHL' | 'BRACKET_NCAAM';
  season: number;
  startsAt: string;
  lockMode: 'PER_GAME' | 'FULL_BRACKET' | 'PER_ROUND';
  status: string;
  startTime?: string;
  lockAt?: string;
  endAt?: string;
};

export type Group = {
  id: string;
  contestId?: string;
  name: string;
  visibility: 'PUBLIC' | 'PRIVATE';
  joinCode: string | null;
  role: string;
};

export type PublicGroupRow = {
  id: string;
  contestId: string;
  name: string;
  visibility: 'PUBLIC';
  memberCount: number;
  isMember: boolean;
};

export type PrivateGroupNameRow = {
  name: string;
};

export type Entry = {
  id: string;
  contestId: string;
  userId: string;
  submittedAt: string;
  totalPoints: number;
  isComplete: boolean;
};

export type Game = {
  id: string;
  providerGameId: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  winner: string | null;
};

export type CbbSpotMatchGame = {
  rowId: number;
  gameDate: string;
  awayTeam: string;
  homeTeam: string;
  marketSpread: number;
  score: number;
  qualified: boolean;
  factors: Record<string, number>;
  unavailableFactors: string[];
};

export type CbbSpotMatchesResponse = {
  from: string;
  to: string;
  days: number;
  threshold: number;
  weights: Record<string, number>;
  counts: {
    totalUpcoming: number;
    qualified: number;
    historicalFinalsUsed: number;
  };
  games: CbbSpotMatchGame[];
};

export type LeaderboardRow = {
  userId: string;
  displayName: string;
  totalPoints: number;
  submittedAt: string | null;
};

export type PickPercentageRow = {
  gameKey: string;
  team: string;
  picks: number;
  totalPicks: number;
  percent: number;
};

export type TopOneAggregateRow = {
  userId: string;
  displayName: string;
  topOneCount: number;
  contestsEntered: number;
};

export type ParticipantEntryPickemPick = {
  gameId: string;
  pickedWinner: string;
  confidencePoints: number | null;
  isCorrect: boolean | null;
  pointsAwarded: number;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
};

export type ParticipantEntryBracketPick = {
  gameSlot: string;
  pickedTeam: string;
  round: number;
  isCorrect: boolean | null;
  pointsAwarded: number;
};

export type EntryTiebreaker = {
  prompt: string;
  answer: string;
  numericGuess: number | null;
};

export type ParticipantContestEntry = {
  contestId: string;
  contestType: Contest['type'];
  entry: {
    id: string;
    contestId: string;
    userId: string;
    displayName: string;
    submittedAt: string;
    totalPoints: number;
  };
  picks: Array<ParticipantEntryPickemPick | ParticipantEntryBracketPick>;
  tiebreaker?: EntryTiebreaker | null;
};

export type UserStatsYearRow = {
  year: number;
  contestsEntered: number;
  contestsWon: number;
  topOneFinishes: number;
  totalPoints: number;
  avgPercentile: number;
  bestPercentile: number;
};

export type UserStatsContestRow = {
  contestId: string;
  contestName: string;
  contestStatus: string;
  startsAt: string;
  year: number;
  totalPoints: number;
  rank: number;
  percentile: number;
  isWin: boolean;
  isTopOne: boolean;
};

export type SystemDbHealth = {
  ok: boolean;
  host: string;
  latencyMs: number;
  mode: string;
  error?: string;
};

export type SystemWorkerHealth = {
  enabled: boolean;
  intervalSeconds: number;
  running: boolean;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastSucceededAt: string | null;
  lastFailedAt: string | null;
  lastError: string | null;
  lastSyncedContests: number;
  lastGradedContests: number;
  lastChangedEntries: number;
};

export type UserStatsProfile = {
  userId: string;
  displayName: string;
  lifetime: {
    contestsEntered: number;
    contestsWon: number;
    topOneFinishes: number;
    totalPoints: number;
    avgPercentile: number;
    bestPercentile: number;
  };
  byYear: UserStatsYearRow[];
  recentContests: UserStatsContestRow[];
};

export const api = {
  async login(email: string, displayName: string, timezone = 'America/New_York') {
    return request<{ userId: string }>('/auth/dev-login', {
      method: 'POST',
      body: JSON.stringify({ email, displayName, timezone })
    });
  },

  async me(userId: string) {
    return request<{ id: string; email: string; displayName: string }>('/auth/me', {}, userId);
  },

  async contests() {
    return request<{ contests: Contest[] }>('/contests');
  },

  async adminContests(userId: string) {
    return request<{ contests: Contest[] }>('/contests/admin', {}, userId);
  },

  async cbbUpcomingSpotMatches(params?: { from?: string; days?: number; historyDays?: number }) {
    const qp = new URLSearchParams();
    if (params?.from) qp.set('from', params.from);
    if (typeof params?.days === 'number') qp.set('days', String(params.days));
    if (typeof params?.historyDays === 'number') qp.set('historyDays', String(params.historyDays));
    const suffix = qp.toString() ? `?${qp.toString()}` : '';
    return request<CbbSpotMatchesResponse>(`/cbb/spot-matches/upcoming${suffix}`);
  },

  async createContest(
    userId: string,
    payload: {
      name: string;
      type: 'PICKEM_NFL' | 'PICKEM_NBA' | 'PICKEM_NHL' | 'BRACKET_NCAAM';
      season: number;
      startsAt: string;
      lockMode: 'PER_GAME' | 'FULL_BRACKET' | 'PER_ROUND';
      scoringConfig: Record<string, unknown>;
      groupIds: string[];
      status?: 'DRAFT' | 'OPEN';
    }
  ) {
    return request('/contests', { method: 'POST', body: JSON.stringify(payload) }, userId);
  },
  async cloneContest(
    userId: string,
    contestId: string,
    payload: { name: string; season: number; startsAt: string; includeGames: boolean; status?: 'DRAFT' | 'OPEN' }
  ) {
    return request<{ id: string; status: string }>(
      '/contests/' + contestId + '/clone',
      { method: 'POST', body: JSON.stringify(payload) },
      userId
    );
  },

  async contestGames(contestId: string) {
    return request<{ contestId: string; games: Game[] }>(`/contests/${contestId}/games`);
  },

  async contestPickPercentages(contestId: string) {
    return request<{ contestId: string; type: 'PICKEM_NFL' | 'PICKEM_NBA' | 'PICKEM_NHL' | 'BRACKET_NCAAM'; rows: PickPercentageRow[] }>(
      `/contests/${contestId}/pick-percentages`
    );
  },

  async contestLeaderboard(userId: string, contestId: string) {
    return request<{
      contestId: string;
      contestName: string;
      contestStatus: string;
      leaderboard: LeaderboardRow[];
    }>(`/contests/${contestId}/leaderboard`, {}, userId);
  },

  async topOneLeaderboard(userId: string) {
    return request<{ leaderboard: TopOneAggregateRow[] }>(`/leaderboards/top-one`, {}, userId);
  },

  async groups(userId: string, contestId?: string) {
    const query = contestId ? `?contestId=${encodeURIComponent(contestId)}` : '';
    return request<{ groups: Group[] }>(`/groups${query}`, {}, userId);
  },

  async publicGroups(userId: string, contestId: string) {
    return request<{ groups: PublicGroupRow[] }>(
      `/groups/public?contestId=${encodeURIComponent(contestId)}`,
      {},
      userId
    );
  },

  async privateGroupNames(userId: string, contestId: string) {
    return request<{ groups: PrivateGroupNameRow[] }>(
      `/groups/private-names?contestId=${encodeURIComponent(contestId)}`,
      {},
      userId
    );
  },

  async createGroup(userId: string, contestId: string, name: string, visibility: 'PUBLIC' | 'PRIVATE', password?: string) {
    return request('/groups', { method: 'POST', body: JSON.stringify({ contestId, name, visibility, password }) }, userId);
  },

  async joinGroup(userId: string, contestId: string, groupId: string) {
    return request(`/groups/${groupId}/join`, { method: 'POST', body: JSON.stringify({ contestId }) }, userId);
  },

  async joinPrivateGroup(userId: string, contestId: string, name: string, password: string) {
    return request('/groups/private/join', { method: 'POST', body: JSON.stringify({ contestId, name, password }) }, userId);
  },

  async groupLeaderboard(userId: string, groupId: string, contestId: string) {
    return request<{ leaderboard: Array<{ userId: string; displayName: string; totalPoints: number }> }>(
      `/groups/${groupId}/leaderboard?contestId=${encodeURIComponent(contestId)}`,
      {},
      userId
    );
  },

  async entriesMe(userId: string) {
    return request<{ entries: Entry[] }>('/entries/me', {}, userId);
  },

  async createEntry(userId: string, contestId: string) {
    return request<Entry>(`/contests/${contestId}/entries`, { method: 'POST', body: JSON.stringify({}) }, userId);
  },

  async submitPicks(
    userId: string,
    contestId: string,
    picks: Array<{ gameId: string; pickedWinner: string; confidencePoints?: number }>
  ) {
    return request(`/contests/${contestId}/picks`, { method: 'POST', body: JSON.stringify({ picks }) }, userId);
  },

  async getPicks(userId: string, contestId: string, entryId: string) {
    return request<{ picks: Array<{ gameId: string; pickedWinner: string; pointsAwarded: number; isCorrect: boolean | null }> }>(
      `/contests/${contestId}/entries/${entryId}/picks`,
      {},
      userId
    );
  },

  async submitBracket(
    userId: string,
    contestId: string,
    picks: Array<{ gameSlot: string; pickedTeam: string; round: number }>
  ) {
    return request(`/contests/${contestId}/bracket-picks`, { method: 'POST', body: JSON.stringify({ picks }) }, userId);
  },

  async getBracket(userId: string, contestId: string, entryId: string) {
    return request<{ picks: Array<{ gameSlot: string; pickedTeam: string; pointsAwarded: number; isCorrect: boolean | null }> }>(
      `/contests/${contestId}/entries/${entryId}/bracket-picks`,
      {},
      userId
    );
  },

  async getEntryTiebreaker(userId: string, contestId: string, entryId: string) {
    return request<{ tiebreaker: EntryTiebreaker | null }>(
      `/contests/${contestId}/entries/${entryId}/tiebreaker`,
      {},
      userId
    );
  },

  async saveEntryTiebreaker(userId: string, contestId: string, entryId: string, payload: EntryTiebreaker) {
    return request<{ tiebreaker: EntryTiebreaker }>(
      `/contests/${contestId}/entries/${entryId}/tiebreaker`,
      { method: 'POST', body: JSON.stringify(payload) },
      userId
    );
  },

  async setContestStatus(userId: string, contestId: string, status: 'DRAFT' | 'OPEN') {
    return request<{ id: string; status: string }>(
      '/contests/' + contestId + '/status',
      { method: 'PATCH', body: JSON.stringify({ status }) },
      userId
    );
  },

  async overrideGameResult(
    userId: string,
    contestId: string,
    providerGameId: string,
    payload: { status?: string; homeScore?: number | null; awayScore?: number | null; winner?: string | null }
  ) {
    return request<{ ok: boolean; game: Game }>(
      `/contests/${contestId}/games/${encodeURIComponent(providerGameId)}/result`,
      { method: 'PATCH', body: JSON.stringify(payload) },
      userId
    );
  },

  async runContestGrading(userId: string, contestId: string) {
    return request<{ ok: boolean; contestId: string; changedEntries: number }>(
      `/contests/${contestId}/grade`,
      { method: 'POST' },
      userId
    );
  },

  async contestantEntry(userId: string, contestId: string, targetUserId: string) {
    return request<ParticipantContestEntry>(`/contests/${contestId}/users/${targetUserId}/entry`, {}, userId);
  },

  async backendHealth() {
    return request<{ ok: boolean; service: string }>(`/health`);
  },

  async dbHealth() {
    return request<SystemDbHealth>(`/health/db`);
  },

  async workerHealth() {
    return request<SystemWorkerHealth>(`/health/worker`);
  },

  async userStats(userId: string, targetUserId: string) {
    return request<UserStatsProfile>(`/users/${targetUserId}/stats`, {}, userId);
  }
};
