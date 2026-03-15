import dotenv from 'dotenv';
import { pool } from '../src/db.js';
import { syncContestGames } from '../src/services/game-ingest.js';
import { gradeContests } from '../src/services/grading.js';

dotenv.config();

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) {
    return undefined;
  }
  return process.argv[index + 1];
}

async function main() {
  const contestId = readArg('contestId');
  const bracketFromDate = readArg('from');
  const bracketToDate = readArg('to');

  const ingestResults = await syncContestGames({ contestId, bracketFromDate, bracketToDate });
  const gradingResults = await gradeContests({
    contestIds: ingestResults.map((result) => result.contestId),
    source: 'INGEST_SYNC'
  });

  console.log(JSON.stringify({ ok: true, ingestResults, gradingResults }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
