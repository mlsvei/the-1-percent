import dotenv from 'dotenv';
import { pool } from '../src/db.js';
import { syncContestGames } from '../src/services/game-ingest.js';
import { gradeContests } from '../src/services/grading.js';

dotenv.config();

const intervalSeconds = Number(process.env.INGEST_INTERVAL_SECONDS ?? 30);

async function runCycle() {
  const startedAt = new Date().toISOString();
  const ingestResults = await syncContestGames({});
  const gradingResults = await gradeContests({
    contestIds: ingestResults.map((result) => result.contestId),
    source: 'INGEST_WATCH'
  });
  console.log(JSON.stringify({ startedAt, ingestResults, gradingResults }, null, 2));
}

async function main() {
  await runCycle();
  let running = false;

  const timer = setInterval(() => {
    if (running) {
      return;
    }

    running = true;
    runCycle()
      .catch((error) => {
        console.error('Ingest cycle failed:', error);
      })
      .finally(() => {
        running = false;
      });
  }, intervalSeconds * 1000);

  process.on('SIGINT', async () => {
    clearInterval(timer);
    await pool.end();
    process.exit(0);
  });
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
