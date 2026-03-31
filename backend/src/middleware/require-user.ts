import type { NextFunction, Response } from 'express';
import { verifyAuthToken } from '../services/auth.js';
import type { AuthenticatedRequest } from '../types.js';

export function requireUser(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.header('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    try {
      const payload = verifyAuthToken(token);
      req.userId = payload.sub;
      req.userEmail = payload.email;
      next();
      return;
    } catch (error) {
      res.status(401).json({ error: (error as Error).message || 'Invalid auth token' });
      return;
    }
  }

  res.status(401).json({ error: 'Missing bearer token' });
}
