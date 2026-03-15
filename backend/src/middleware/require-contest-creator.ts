import type { NextFunction, Response } from 'express';
import { config } from '../config.js';
import { query } from '../db.js';
import type { AuthenticatedRequest } from '../types.js';

export async function requireContestCreator(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.userId) {
    res.status(401).json({ error: 'Missing authenticated user' });
    return;
  }

  if (config.creatorEmails.length === 0) {
    res.status(503).json({
      error: 'Contest creation is disabled. Set APP_CREATOR_EMAILS in backend .env to enable creator access.'
    });
    return;
  }

  const result = await query<{ email: string }>('select email from users where id = $1', [req.userId]);
  const email = result.rows[0]?.email?.toLowerCase();

  if (!email) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  if (!config.creatorEmails.includes(email)) {
    res.status(403).json({ error: 'Only the app creator can create contests' });
    return;
  }

  next();
}
