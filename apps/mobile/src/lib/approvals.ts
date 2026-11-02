/**
 * Aprovar no celular as transferências pedidas pelo painel do provider (design: "Assinar no celular").
 * Mesma conta do piu-node (apps/piu-node/src/security/approval.ts):
 * - `piup:` QR de pareamento com o segredo (32 bytes) → este celular mostra um código de 6 dígitos;
 * - `piut:` QR do pedido (valor, destino, validade) → mesmo código de conferência nas duas telas;
 *   depois da biometria, o código de aprovação = HMAC(segredo, pedido) em 16 caracteres.
 * O segredo fica só neste aparelho (armazenamento cifrado do app).
 */
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { unb64url } from '../messaging/card';

export const PAIR_PREFIX = 'piup:';
export const REQUEST_PREFIX = 'piut:';
const B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const te = new TextEncoder();

export interface PairedNode { phoneId: string; secret: string; node: string; operator: string; at: number }
export interface TransferRequest { raw: string; txId: string; amount: number; to: string; phoneId: string; expiresAt: number; node: string }

const u32 = (b: Uint8Array) => ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0;
const six = (n: number) => String(n % 1_000_000).padStart(6, '0');
const json = (s: string) => JSON.parse(new TextDecoder().decode(unb64url(s))) as Record<string, unknown>;

export function parsePair(text: string, now = Date.now()): PairedNode {
  const t = text.trim();
  if (!t.startsWith(PAIR_PREFIX)) throw new Error('Isto não é um QR de pareamento do painel.');
  let j: Record<string, unknown>;
  try { j = json(t.slice(PAIR_PREFIX.length)); } catch { throw new Error('QR incompleto ou corrompido.'); }
  const secret = typeof j.s === 'string' ? j.s : '';
  if (j.v !== 1 || typeof j.i !== 'string' || unb64url(secret).length !== 32) throw new Error('QR de pareamento inválido.');
  return { phoneId: j.i, secret, node: String(j.n ?? 'piu-node').slice(0, 40), operator: String(j.o ?? '').slice(0, 40), at: now };
}

/** Código de 6 dígitos que este celular mostra ao parear (o operador digita no painel). */
export const pairCode = (p: PairedNode) => six(u32(hmac(sha256, unb64url(p.secret), te.encode('piu/v0/phone-pair'))));

export function parseRequest(text: string): TransferRequest {
  const t = text.trim();
  if (!t.startsWith(REQUEST_PREFIX)) throw new Error('Isto não é um pedido de transferência do painel.');
  let j: Record<string, unknown>;
  try { j = json(t.slice(REQUEST_PREFIX.length)); } catch { throw new Error('Pedido incompleto ou corrompido.'); }
  if (j.v !== 1 || typeof j.i !== 'string' || typeof j.a !== 'number' || !(j.a > 0) || typeof j.t !== 'string' || typeof j.p !== 'string' || typeof j.x !== 'number') throw new Error('Pedido inválido.');
  if (j.t !== 'personal' && !/^lunes:[1-9A-HJ-NP-Za-km-z]{26,44}$/.test(j.t)) throw new Error('Destino inválido.');
  return { raw: t, txId: j.i, amount: j.a, to: j.t, phoneId: j.p, expiresAt: j.x * 1000, node: String(j.n ?? 'piu-node').slice(0, 40) };
}

/** Código de conferência (igual no painel): 6 dígitos do SHA-256 do pedido. */
export const checkCode = (r: TransferRequest) => six(u32(sha256(te.encode(r.raw))));

/** Código de aprovação (16 caracteres), só depois de conferir e autenticar. */
export function approvalCode(p: PairedNode, r: TransferRequest): string {
  const h = hmac(sha256, unb64url(p.secret), new Uint8Array([...te.encode('piu/v0/approve\n'), ...te.encode(r.raw)]));
  let bits = 0, acc = 0, out = '';
  for (const byte of h) {
    acc = ((acc << 8) | byte) & 0xffff; bits += 8;
    while (bits >= 5 && out.length < 16) { out += B32[(acc >> (bits - 5)) & 31]; bits -= 5; }
    if (out.length >= 16) break;
  }
  return out;
}
