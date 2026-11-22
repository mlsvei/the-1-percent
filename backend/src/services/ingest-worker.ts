import { config } from '../config.js';
import { query } from '../db.js';
import { getContestsForIngest, getLastIngestWarnings, syncContestGames, type SyncContestResult } from './game-ingest.js';
import { gradeContests } from './grading.js';

// Poll fast only while a game is live or about to kick off; otherwise poll rarely.
// This is what keeps SportsDataIO call volume sane - most of the week nothing is
// being played, so there is nothing to gain from polling every few minutes.
const ACTIVE_INTERVAL_SECONDS = Math.max(config.ingest.intervalSeconds, 120);
const IDLE_INTERVAL_SECONDS = 3600;
const UPCOMING_LOOKAHEAD_MS = 20 * 60 * 1000;
const POST_KICKOFF_WINDOW_MS = 5 * 60 * 60 * 1000;

type WorkerStatus = {
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
  lastWarnings: string[];
  nextRunAt: string | null;
};

let workerStatus: WorkerStatus = {
  enabled: config.ingest.enabled,
  intervalSeconds: IDLE_INTERVAL_SECONDS,
  running: false,
  lastStartedAt: null,
  lastCompletedAt: null,
  lastSucceededAt: null,
  lastFailedAt: null,
  lastError: null,
  lastSyncedContests: 0,
  lastGradedContests: 0,
  lastChangedEntries: 0,
  lastWarnings: [],
  nextRunAt: null
};

export function getIngestWorkerStatus() {
  return { ...workerStatus };
}

function formatSyncLog(results: SyncContestResult[]): string {
  if (results.length === 0) return 'none';
  return results
    .map((result) => {
      const games = result.changedGameIds.length > 0 ? result.changedGameIds.join(', ') : 'none';
      return `${result.contestName} [${result.contestId}] games=${games}`;
    })
    .join(' | ');
}

function isFinalStatus(status: string): boolean {
  return /final|complete/i.test(status);
}

async function hasLiveOrImminentGame(contestIds: string[]): Promise<boolean> {
  if (contestIds.length === 0) return false;

  const result = await query<{ startTime: string; winner: string | null; status: string }>(
    'select start_time as "startTime", winner, status from games where contest_id = any($1)',
    [contestIds]
  );

  const now = Date.now();
  return result.rows.some((game) => {
    if (game.winner != null || isFinalStatus(game.status)) return false;
    const startMs = new Date(game.startTime).getTime();
    if (!Number.isFinite(startMs)) return false;
    return startMs - now <= UPCOMING_LOOKAHEAD_MS && now - startMs <= POST_KICKOFF_WINDOW_MS;
  });
}

async function getNextIntervalSeconds(): Promise<number> {
  try {
    const contests = await getContestsForIngest();
    const activeContestIds = contests
      .filter((contest) => (contest.scoring_config as { ingestDisabled?: unknown } | null)?.ingestDisabled !== true)
      .map((contest) => contest.id);

    const live = await hasLiveOrImminentGame(activeContestIds);
    return live ? ACTIVE_INTERVAL_SECONDS : IDLE_INTERVAL_SECONDS;
  } catch (error) {
    console.warn('[ingest-worker] failed to determine active contest count, using idle interval:', error);
    return IDLE_INTERVAL_SECONDS;
  }
}

async function runCycle(): Promise<void> {
  const startedAt = new Date().toISOString();
  workerStatus = {
    ...workerStatus,
    running: true,
    lastStartedAt: startedAt,
    lastError: null,
    nextRunAt: null
  };

  const ingestResults = await syncContestGames({
    includeBracketContests: config.ingest.includeBracketAutoIngest
  });
  console.log(
    `[ingest-worker] ${startedAt} synced ${ingestResults.length} contests (includeBracket=${config.ingest.includeBracketAutoIngest}) :: ${formatSyncLog(ingestResults)}`
  );

  const contestIds = ingestResults.map((row) => row.contestId);
  const gradingResults = contestIds.length
    ? await gradeContests({ contestIds, source: 'AUTO_WATCH' })
    : [];
  const changedEntries = gradingResults.reduce((total, row) => total + row.changedEntries, 0);
  const gradingLog = gradingResults.length
    ? gradingResults
        .map((row) => {
          const synced = ingestResults.find((result) => result.contestId === row.contestId);
          const games = synced && synced.changedGameIds.length > 0 ? synced.changedGameIds.join(', ') : 'none';
          return `${synced?.contestName ?? row.contestId} [${row.contestId}] changedEntries=${row.changedEntries} games=${games}`;
        })
        .join(' | ')
    : 'none';
  console.log(`[ingest-worker] ${startedAt} graded ${gradingResults.length} contests; changed entries: ${changedEntries} :: ${gradingLog}`);

  const warnings = getLastIngestWarnings();
  if (warnings.length > 0) {
    console.warn(`[ingest-worker] ${startedAt} blocked suspicious syncs :: ${warnings.join(' | ')}`);
  }

  const completedAt = new Date().toISOString();
  workerStatus = {
    ...workerStatus,
    running: false,
    lastCompletedAt: completedAt,
    lastSucceededAt: completedAt,
    lastSyncedContests: ingestResults.length,
    lastGradedContests: gradingResults.length,
    lastChangedEntries: changedEntries,
    lastWarnings: warnings
  };
}

export function startIngestWorker(): { stop: () => void } {
  if (!config.ingest.enabled) {
    console.log('[ingest-worker] disabled by INGEST_ENABLED=false');
    workerStatus = { ...workerStatus, enabled: false, running: false, nextRunAt: null };
    return { stop: () => undefined };
  }

  let running = false;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const scheduleNext = async () => {
    if (stopped) return;
    const intervalSeconds = await getNextIntervalSeconds();
    const nextRunAt = new Date(Date.now() + intervalSeconds * 1000).toISOString();
    workerStatus = {
      ...workerStatus,
      intervalSeconds,
      nextRunAt
    };
    timer = setTimeout(() => {
      void tick();
    }, intervalSeconds * 1000);
  };

  const tick = async () => {
    if (running || stopped) return;
    running = true;

    try {
      await runCycle();
    } catch (error) {
      const failedAt = new Date().toISOString();
      workerStatus = {
        ...workerStatus,
        running: false,
        lastCompletedAt: failedAt,
        lastFailedAt: failedAt,
        lastError: error instanceof Error ? error.message : String(error)
      };
      console.error('[ingest-worker] cycle failed:', error);
    } finally {
      running = false;
      await scheduleNext();
    }
  };

  console.log(`[ingest-worker] started (activeInterval=${ACTIVE_INTERVAL_SECONDS}s idleInterval=${IDLE_INTERVAL_SECONDS}s)`);
  void tick();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      workerStatus = { ...workerStatus, nextRunAt: null, running: false };
    }
  };
}
