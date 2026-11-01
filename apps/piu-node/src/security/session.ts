import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Session, Store } from '../store.js';

/** `__Host-`: o navegador só aceita com Secure, Path=/ e sem Domain (cookie preso a esta origem). */
export const SESSION_COOKIE = '__Host-piu_session';
export const IDLE_MS = 30 * 60 * 1000;
export const ABSOLUTE_MS = 12 * 60 * 60 * 1000;
/** Operações sensíveis (transferir LUNES) exigem autenticação recente. */
export const STEP_UP_MS = 15 * 60 * 1000;

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export const cookieOptions = { httpOnly: true, secure: true, sameSite: 'strict' as const, path: '/', maxAge: ABSOLUTE_MS / 1000 };

export function createSession(store: Store, operatorId: string, now: number): { token: string; session: Session } {
  const token = randomBytes(32).toString('base64url');
  const session: Session = { tokenHash: sha(token), operatorId, csrf: randomBytes(32).toString('base64url'), createdAt: now, lastSeen: now, authAt: now };
  store.pruneSessions(s => alive(s, now));
  store.addSession(session);
  return { token, session };
}

const alive = (s: Session, now: number) => now - s.lastSeen <= IDLE_MS && now - s.createdAt <= ABSOLUTE_MS;

/** Sessão válida para o token do cookie (inatividade de 30 min, duração máxima de 12 h). */
export function findSession(store: Store, token: string | undefined, now: number): Session | null {
  if (!token || token.length > 100) return null;
  const s = store.sessionByHash(sha(token));
  if (!s) return null;
  if (!alive(s, now)) { store.removeSession(s.tokenHash); return null; }
  store.touchSession(s.tokenHash, now);
  return s;
}

export const endSession = (store: Store, token: string | undefined) => { if (token) store.removeSession(sha(token)); };

export function csrfMatches(session: Session, header: unknown): boolean {
  if (typeof header !== 'string') return false;
  const a = Buffer.from(header), b = Buffer.from(session.csrf);
  return a.length === b.length && timingSafeEqual(a, b);
}
