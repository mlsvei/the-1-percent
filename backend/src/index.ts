import cors from 'cors';
import express from 'express';
import { config } from './config.js';
import { pool } from './db.js';
import { authRouter } from './routes/auth.js';
import { assetsRouter } from './routes/assets.js';
import { contestsRouter } from './routes/contests.js';
import { entriesRouter } from './routes/entries.js';
import { groupsRouter } from './routes/groups.js';
import { healthRouter } from './routes/health.js';
import { submissionsRouter } from './routes/submissions.js';
import { usersRouter } from './routes/users.js';
import { startIngestWorker } from './services/ingest-worker.js';
import { seedDefaultsIfNeeded } from './services/seed-defaults.js';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api', healthRouter);
app.use('/api', assetsRouter);
app.use('/api', authRouter);
app.use('/api', usersRouter);
app.use('/api', groupsRouter);
app.use('/api', contestsRouter);
app.use('/api', entriesRouter);
app.use('/api', submissionsRouter);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  res.status(500).json({ error: 'Internal server error' });
});

let stopIngestWorker: (() => void) | null = null;

async function start() {
  await seedDefaultsIfNeeded();

  const worker = startIngestWorker();
  stopIngestWorker = worker.stop;

  app.listen(config.port, '127.0.0.1', () => {
    console.log(`Backend listening on http://127.0.0.1:${config.port}`);
  });
}

start().catch((error) => {
  console.error('Startup failed:', error);
  process.exit(1);
});

process.on('SIGINT', async () => {
  stopIngestWorker?.();
  await pool.end();
  process.exit(0);
});
