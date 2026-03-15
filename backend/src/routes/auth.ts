import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { requireUser } from '../middleware/require-user.js';
import type { AuthenticatedRequest } from '../types.js';

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1),
  timezone: z.string().default('America/New_York')
});

authRouter.post('/auth/dev-login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { email, displayName, timezone } = parsed.data;

  const existing = await query<{ id: string }>(
    'select id from users where email = $1 limit 1',
    [email]
  );

  let userId = existing.rows[0]?.id;
  if (!userId) {
    userId = randomUUID();
    await query(
      'insert into users (id, email, display_name, timezone) values ($1, $2, $3, $4)',
      [userId, email, displayName, timezone]
    );
  } else {
    await query(
      'update users set display_name = $2, timezone = $3 where id = $1',
      [userId, displayName, timezone]
    );
  }

  res.json({ userId, tokenType: 'dev-header', usage: 'Send x-user-id header on protected routes' });
});

authRouter.get('/auth/me', requireUser, async (req: AuthenticatedRequest, res) => {
  const result = await query(
    'select id, email, display_name as "displayName", timezone, created_at as "createdAt" from users where id = $1',
    [req.userId]
  );

  if (!result.rows[0]) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json(result.rows[0]);
});
