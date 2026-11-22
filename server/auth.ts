import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { User, UserRole } from './types.ts';
import {
  appendAuditLog,
  isCloudHydratedOnce,
  isCloudSyncConfigured,
  readDb,
  recordSessionEvent,
  writeDb,
} from './db.ts';

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  crypto
    .createHash('sha256')
    .update(`trendy-unisex-salon-${process.env.APP_URL || 'local-busia-uganda'}`)
    .digest('hex');

export const SESSION_COOKIE_NAME = 'trendy_salon_session';

export interface SessionPayload {
  sessionId?: string;
  userId: string;
  email: string;
  name: string;
  role: UserRole;
  employeeId?: string;
  exp: number;
}

export function getClientContext(req: Request): { ipAddress: string; userAgent: string } {
  const forwarded = req.headers['x-forwarded-for'];
  const rawIp =
    (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : undefined) ||
    req.socket?.remoteAddress ||
    'unknown';
  const ipAddress = rawIp.replace(/^::ffff:/, '');
  const rawUa = req.headers['user-agent']?.toString() || 'Unknown client';
  const userAgent = rawUa.length > 160 ? `${rawUa.slice(0, 157)}...` : rawUa;
  return { ipAddress, userAgent };
}

export function extractSessionToken(req: Request): { token?: string; fromHeader: boolean } {
  const headerToken =
    req.headers['x-session-token']?.toString() ||
    (req.headers.authorization?.startsWith('Salon ')
      ? req.headers.authorization.slice('Salon '.length).trim()
      : undefined);

  if (headerToken) {
    return { token: headerToken, fromHeader: true };
  }

  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies[SESSION_COOKIE_NAME];
  return { token: cookieToken, fromHeader: false };
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, originalHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const original = Buffer.from(originalHex, 'hex');
  if (derived.length !== original.length) return false;
  return crypto.timingSafeEqual(derived, original);
}

export function signSessionToken(user: User, sessionId = crypto.randomUUID()): string {
  const payload: SessionPayload = {
    sessionId,
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    employeeId: user.employeeId,
    exp: Date.now() + 1000 * 60 * 60 * 12, // 12 hours
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionTokenDetailed(token: string): {
  valid: boolean;
  reason?: 'expired' | 'invalid_signature' | 'malformed';
  payload?: SessionPayload;
} {
  try {
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return { valid: false, reason: 'malformed' };
    }
    const [encoded, sig] = parts;
    const expectedSig = crypto
      .createHmac('sha256', SESSION_SECRET)
      .update(encoded)
      .digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { valid: false, reason: 'invalid_signature' };
    }
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (!payload.exp || Date.now() > payload.exp) {
      return { valid: false, reason: 'expired', payload };
    }
    return { valid: true, payload };
  } catch {
    return { valid: false, reason: 'malformed' };
  }
}

export function verifySessionToken(token: string): SessionPayload | null {
  const res = verifySessionTokenDetailed(token);
  return res.valid && res.payload ? res.payload : null;
}

function parseCookies(cookieHeader?: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const key = part.slice(0, idx).trim();
      const val = decodeURIComponent(part.slice(idx + 1).trim());
      cookies[key] = val;
    }
  }
  return cookies;
}

export interface AuthenticatedRequest extends Request {
  sessionUser?: SessionPayload;
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const { token, fromHeader } = extractSessionToken(req);

  if (!token) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }

  const verified = verifySessionTokenDetailed(token);
  if (!verified.valid || !verified.payload) {
    if (verified.reason === 'invalid_signature' || (fromHeader && verified.reason === 'malformed')) {
      const db = readDb();
      const { ipAddress, userAgent } = getClientContext(req);
      recordSessionEvent(db, {
        email: verified.payload?.email || 'unknown',
        userId: verified.payload?.userId,
        userName: verified.payload?.name,
        role: verified.payload?.role,
        authMethod: 'token',
        status: 'suspicious',
        loginAt: new Date().toISOString(),
        ipAddress,
        userAgent,
        reason: `Rejected ${verified.reason === 'invalid_signature' ? 'tampered session token signature' : 'malformed session token'} on ${req.method} ${req.originalUrl}.`,
        suspicious: true,
        suspiciousSeverity: 'high',
      });
      writeDb(db);
    }
    res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
    return;
  }

  const payload = verified.payload;
  const db = readDb();

  if (payload.sessionId) {
    const isEnded = db.sessionHistory.some(
      (s) =>
        s.sessionId === payload.sessionId &&
        (s.status === 'revoked' || s.status === 'signed_out')
    );
    if (isEnded) {
      res.status(401).json({ error: 'Session has ended or been revoked. Please sign in again.' });
      return;
    }
  }

  // Verify user still exists and is active in DB
  const user = db.users.find((u) => u.id === payload.userId);
  if (!user && !isCloudHydratedOnce() && isCloudSyncConfigured(db)) {
    res.setHeader('Retry-After', '2');
    res.status(503).json({
      error: 'Salon records are still loading from cloud storage. Please retry in a moment.',
    });
    return;
  }
  if (!user || !user.active) {
    const { ipAddress, userAgent } = getClientContext(req);
    recordSessionEvent(db, {
      userId: payload.userId,
      userName: payload.name,
      email: payload.email,
      role: payload.role,
      authMethod: 'token',
      status: 'suspicious',
      loginAt: new Date().toISOString(),
      ipAddress,
      userAgent,
      reason: !user
        ? `Deleted user session attempted access (${req.method} ${req.originalUrl}).`
        : `Disabled user account attempted API access (${req.method} ${req.originalUrl}).`,
      suspicious: true,
      suspiciousSeverity: 'high',
    });
    writeDb(db);
    res.status(401).json({ error: 'User account is inactive or no longer exists.' });
    return;
  }

  req.sessionUser = {
    sessionId: payload.sessionId,
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    employeeId: user.employeeId,
    exp: payload.exp,
  };
  next();
}

export function requireRole(allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.sessionUser) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!allowedRoles.includes(req.sessionUser.role)) {
      const db = readDb();
      const { ipAddress, userAgent } = getClientContext(req);
      const details = `Blocked unauthorized ${req.method} ${req.originalUrl} access attempt by ${req.sessionUser.role} (requires ${allowedRoles.join(' or ')}).`;
      recordSessionEvent(db, {
        sessionId: req.sessionUser.sessionId,
        userId: req.sessionUser.userId,
        userName: req.sessionUser.name,
        email: req.sessionUser.email,
        role: req.sessionUser.role,
        authMethod: 'token',
        status: 'suspicious',
        loginAt: new Date().toISOString(),
        ipAddress,
        userAgent,
        reason: details,
        suspicious: true,
        suspiciousSeverity: 'medium',
      });
      appendAuditLog(
        db,
        req.sessionUser,
        'SECURITY_ACCESS_DENIED',
        'Security',
        req.sessionUser.userId,
        details
      );
      writeDb(db);
      res.status(403).json({
        error: `Access denied. Required role: ${allowedRoles.join(' or ')}. Your role: ${req.sessionUser.role}.`,
      });
      return;
    }
    next();
  };
}
