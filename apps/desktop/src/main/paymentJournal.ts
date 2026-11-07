/**
 * Diário local da autorização de pagamento pelo celular. A ausência de retorno da rede NÃO é falha:
 * um pedido que pode ter saído continua bloqueando outro envio após reinício. O arquivo é separado
 * do estado geral (que usa fallback vazio em corrupção) justamente para falhar fechado.
 */
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseLunesAmount } from '../../../mobile/src/lib/paymentRequest';
import { decodeSs58 } from '../../../mobile/src/lib/ss58';
import { tm } from './i18n';

import type { DesktopPayment, DesktopPaymentState, DesktopPaymentStatus, IncomingPaymentStatus, PaymentRequestInput, PaymentStatusMessage } from '../shared/paymentTypes';
const MAGIC = Buffer.from('PIUPAY1');
const statuses: DesktopPaymentStatus[] = ['waiting', 'review', 'signed', 'submitted', 'included', 'finalized', 'failed', 'cancelled', 'unknown'];
const terminal: DesktopPaymentStatus[] = ['finalized', 'failed', 'cancelled'];
const incoming: IncomingPaymentStatus[] = ['review', 'cancelled', 'signed', 'submitted', 'included', 'finalized', 'failed', 'error', 'unknown'];
const hashRe = /^0x[0-9a-f]{64}$/i;
const idRe = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const paymentActive = (p: DesktopPayment) => !terminal.includes(p.status);

/** Destino e conta de origem são endereços reais; quantia sempre fica em texto, sem arredondar float. */
export function validatePaymentInput(from: string | null, dest: unknown, amount: unknown): { expectedFrom: string; dest: string; amount: string } {
  const origin = typeof from === 'string' ? from.trim() : '';
  if (!decodeSs58(origin).ok) throw new Error(tm('main.pay.originFirst'));
  if (typeof dest !== 'string' || dest.length > 60 || !decodeSs58(dest.trim()).ok) throw new Error(tm('main.pay.badDest'));
  if (typeof amount !== 'string' || amount.length > 40) throw new Error(tm('main.pay.badAmount'));
  const planck = parseLunesAmount(amount.trim());
  if (planck === null) throw new Error(tm('main.pay.badAmount'));
  const units = planck / 100_000_000n;
  const fraction = (planck % 100_000_000n).toString().padStart(8, '0').replace(/0+$/, '');
  const canonicalAmount = fraction ? `${units},${fraction}` : String(units);
  const d = decodeSs58(dest.trim()), f = decodeSs58(origin);
  if (d.ok && f.ok && d.publicKey.every((b, i) => b === f.publicKey[i])) throw new Error(tm('main.pay.selfDest'));
  return { expectedFrom: origin, dest: dest.trim(), amount: canonicalAmount };
}

/** Validação independente para não tratar dados alterados ou incompletos como fim seguro. */
export function isDesktopPayment(x: unknown): x is DesktopPayment {
  if (!x || typeof x !== 'object') return false;
  const p = x as DesktopPayment;
  try {
    if (!idRe.test(p.id) || !statuses.includes(p.status) || !Number.isSafeInteger(p.createdAt) || p.createdAt < 0 || !Number.isSafeInteger(p.updatedAt) || p.updatedAt < p.createdAt) return false;
    const canonical = validatePaymentInput(p.expectedFrom, p.dest, p.amount);
    if (canonical.expectedFrom !== p.expectedFrom || canonical.dest !== p.dest || canonical.amount !== p.amount) return false;
    if (p.hash !== undefined && (typeof p.hash !== 'string' || !hashRe.test(p.hash))) return false;
    if (p.error !== undefined && (typeof p.error !== 'string' || p.error.length > 300)) return false;
    if (['signed', 'submitted', 'included', 'finalized', 'failed'].includes(p.status) && !p.hash) return false;
    return true;
  } catch { return false; }
}

/** Analisa eventos da sessão autenticada sem confiar no conteúdo vindo do celular. */
export function parsePaymentStatus(x: unknown): PaymentStatusMessage | null {
  if (!x || typeof x !== 'object') return null;
  const m = x as Record<string, unknown>;
  if (m.t !== 'payment_status' || typeof m.id !== 'string' || !idRe.test(m.id) || typeof m.status !== 'string' || !incoming.includes(m.status as IncomingPaymentStatus)) return null;
  if (m.hash !== undefined && (typeof m.hash !== 'string' || !hashRe.test(m.hash))) return null;
  if (m.error !== undefined && (typeof m.error !== 'string' || m.error.length > 300)) return null;
  if (['signed', 'submitted', 'included', 'finalized', 'failed'].includes(m.status) && !m.hash) return null;
  return { t: 'payment_status', id: m.id, status: m.status as IncomingPaymentStatus, ...(typeof m.hash === 'string' ? { hash: m.hash.toLowerCase() } : {}), ...(typeof m.error === 'string' ? { error: m.error } : {}) };
}

/** Só a resposta do pedido atual pode mudar o diário; estado terminal não regride. */
export function applyPaymentStatus(p: DesktopPayment, m: PaymentStatusMessage, now: number): DesktopPayment {
  if (p.id !== m.id || !paymentActive(p)) return p;
  if (p.hash && m.hash && p.hash.toLowerCase() !== m.hash.toLowerCase()) return { ...p, status: 'unknown', error: tm('main.pay.hashMismatch'), updatedAt: Math.max(p.updatedAt, now) };
  // Cancelar só é conclusivo antes de haver qualquer hash. Um aviso tardio é ambíguo.
  if (m.status === 'cancelled' && p.hash) return { ...p, status: 'unknown', error: tm('main.pay.alreadyHash'), updatedAt: Math.max(p.updatedAt, now) };
  const status = m.status === 'error' ? 'unknown' : m.status;
  const hash = m.hash ?? p.hash;
  return { ...p, status, ...(hash ? { hash } : {}), ...(m.error ? { error: m.error } : { error: undefined }), updatedAt: Math.max(p.updatedAt, now) };
}

export class PaymentJournal {
  private current: DesktopPaymentState = { state: 'blocked', reason: tm('main.pay.cantVerify') };
  constructor(private file: string, private key: Buffer) {
    if (key.length !== 32) throw new Error('Chave do diário inválida.');
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    this.load();
  }
  get state(): DesktopPaymentState {
    return this.current.state === 'payment' ? { state: 'payment', payment: { ...this.current.payment } } : { ...this.current };
  }
  private load() {
    let raw: Buffer;
    try { raw = readFileSync(this.file); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') this.current = { state: 'empty' }; return; }
    try {
      if (raw.length < MAGIC.length + 12 + 16 || !raw.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Cabeçalho inválido.');
      const decipher = createDecipheriv('aes-256-gcm', this.key, raw.subarray(MAGIC.length, MAGIC.length + 12));
      decipher.setAAD(MAGIC); decipher.setAuthTag(raw.subarray(raw.length - 16));
      const plain = Buffer.concat([decipher.update(raw.subarray(MAGIC.length + 12, raw.length - 16)), decipher.final()]);
      const p = JSON.parse(plain.toString('utf8'));
      if (!isDesktopPayment(p)) throw new Error('Registro inválido.');
      this.current = { state: 'payment', payment: p };
    } catch { this.current = { state: 'blocked', reason: tm('main.pay.unreadable') }; }
  }
  private write(p: DesktopPayment) {
    if (!isDesktopPayment(p)) throw new Error(tm('main.pay.invalidRecord'));
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv); cipher.setAAD(MAGIC);
    const ct = Buffer.concat([cipher.update(JSON.stringify(p), 'utf8'), cipher.final()]);
    const bytes = Buffer.concat([MAGIC, iv, ct, cipher.getAuthTag()]);
    const temp = `${this.file}.tmp`;
    try {
      const fd = openSync(temp, 'w', 0o600);
      try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temp, this.file);
    } catch (e) {
      try { rmSync(temp, { force: true }); } catch { /* mantém diário anterior */ }
      this.current = { state: 'blocked', reason: tm('main.pay.cantSave') };
      throw e;
    }
    this.current = { state: 'payment', payment: p };
  }
  /** Exige persistência antes do frame sair. */
  create(from: string | null, input: PaymentRequestInput, now = Date.now()): DesktopPayment {
    if (this.current.state === 'blocked') throw new Error(this.current.reason);
    if (this.current.state === 'payment' && paymentActive(this.current.payment)) throw new Error(tm('main.pay.pending'));
    const fields = validatePaymentInput(from, input.dest, input.amount);
    const p: DesktopPayment = { id: randomUUID(), ...fields, status: 'waiting', createdAt: now, updatedAt: now };
    this.write(p); return { ...p };
  }
  update(raw: unknown, now = Date.now()): DesktopPayment | null {
    const msg = parsePaymentStatus(raw);
    if (!msg || this.current.state !== 'payment') return null;
    const prev = this.current.payment, next = applyPaymentStatus(prev, msg, now);
    if (next === prev) return null;
    this.write(next); return { ...next };
  }
  disconnected(now = Date.now()): DesktopPayment | null {
    if (this.current.state !== 'payment' || !paymentActive(this.current.payment)) return null;
    const p = { ...this.current.payment, status: 'unknown' as const, error: tm('main.pay.interrupted'), updatedAt: Math.max(this.current.payment.updatedAt, now) };
    this.write(p); return { ...p };
  }
}
