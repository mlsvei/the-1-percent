import type { NextFunction, Response } from 'express';
import type { AuthenticatedRequest } from '../types.js';

export function requireUser(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const userId = req.header('x-user-id');
  if (!userId) {
    res.status(401).json({ error: 'Missing x-user-id header' });
    return;
  }

  req.userId = userId;
  next();
}
