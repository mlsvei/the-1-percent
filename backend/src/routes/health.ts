import { Router } from 'express';
import { dbHealthCheck } from '../db.js';
import { getIngestWorkerStatus } from '../services/ingest-worker.js';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'sports-contest-backend' });
});

healthRouter.get('/health/db', async (_req, res) => {
  const result = await dbHealthCheck();
  res.status(result.ok ? 200 : 503).json(result);
});

healthRouter.get('/health/worker', (_req, res) => {
  res.json(getIngestWorkerStatus());
});
