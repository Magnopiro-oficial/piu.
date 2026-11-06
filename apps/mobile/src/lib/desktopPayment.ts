import { parseLunesAmount } from './paymentRequest';
import { decodeSs58 } from './ss58';

export interface DesktopPaymentRequest { id: string; expectedFrom: string; dest: string; amount: string; token: number; expiresAt: number }
export type DesktopPaymentStatus = 'review' | 'cancelled' | 'signed' | 'submitted' | 'included' | 'finalized' | 'failed' | 'error';
export const validPaymentId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
/** Untrusted encrypted input is still validated: the peer controls its contents. */
export function parseDesktopPayment(raw: unknown, token: number, now: number): DesktopPaymentRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  if (v.t !== 'payment_request' || !validPaymentId(v.id) || typeof v.expectedFrom !== 'string' || typeof v.dest !== 'string' || typeof v.amount !== 'string') return null;
  if (v.expectedFrom.length > 60 || v.dest.length > 60 || !decodeSs58(v.expectedFrom).ok || !decodeSs58(v.dest).ok) return null;
  if (!/^(?:0|[1-9]\d{0,9})(?:,\d{1,8})?$/.test(v.amount) || parseLunesAmount(v.amount) === null) return null;
  return { id: v.id, expectedFrom: v.expectedFrom, dest: v.dest, amount: v.amount, token, expiresAt: now + 120_000 };
}
export function canDesktopSend(chat: { group?: string; owner?: boolean }): boolean { return !chat.group || !!chat.owner; }
