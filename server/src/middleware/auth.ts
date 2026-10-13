import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';

export type AuthUser = {
  userId: string;
  accountId: string;
};

function getJwtSecret() {
  return process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'dev-secret');
}

declare global {
  // eslint-disable-next-line no-var
  var __authTypes: unknown;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthUser;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = String(req.headers.authorization || '').trim();
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!token) return res.status(401).json({ error: 'Missing token' });

  try {
    const secret = getJwtSecret();
    if (!secret) return res.status(500).json({ error: 'Server misconfigured: JWT_SECRET missing' });
    const payload = jwt.verify(token, secret, {
      issuer: process.env.JWT_ISSUER || 'accounting',
      audience: process.env.JWT_AUDIENCE || 'accounting-web',
    }) as any;

    const userId = String(payload?.userId || '').trim();
    const accountId = String(payload?.accountId || '').trim();
    if (!userId || !accountId) return res.status(401).json({ error: 'Invalid token' });

    req.auth = { userId, accountId };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid/expired token' });
  }
}
