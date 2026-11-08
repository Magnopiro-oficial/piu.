/**
 * Sinais da chamada no fio: viajam dentro da sessão cifrada do contato como `{ t: 'cl', s, k? }`
 * (mesmo caminho do "digitando"). `k` = chave X25519 efêmera (convite e aceite), em base64url.
 * Tudo o que chega é validado aqui antes de virar evento da máquina (./callMachine).
 */
import type { LiveRoute, Signal } from './callMachine';

export type WireCall = { t: 'cl'; s: Signal; k?: string };

const ID = /^[A-Za-z0-9_-]{8,64}$/;
const B64_32 = /^[A-Za-z0-9_-]{43}$/;
const ROUTES: readonly LiveRoute[] = ['direct', 'bt', 'point'];
const DECLINE = ['declined', 'busy', 'message', 'later'] as const;
const END = ['hangup', 'sas', 'lost', 'handoff'] as const;

/** Sinais que só fazem sentido ao vivo (somem em segundos); o pedido e a resposta ao pedido vão pela fila da malha. */
export const isLiveSignal = (s: Signal) => s.t !== 'request' && s.t !== 'requestAnswer';
/** Validade dos sinais ao vivo na malha e do pedido de chamada. */
export const LIVE_SIGNAL_TTL_SEC = 30;
export const REQUEST_TTL_SEC = 24 * 3600;

const str = (x: unknown): x is string => typeof x === 'string';
const id = (x: unknown): x is string => str(x) && ID.test(x);
const oneOf = <T extends string>(xs: readonly T[], x: unknown): x is T => str(x) && (xs as readonly string[]).includes(x);

/** Lê um sinal recebido; `null` se estiver malformado (descartado em silêncio). */
export function readCallWire(p: unknown): { signal: Signal; key?: string } | null {
  if (!p || typeof p !== 'object') return null;
  const w = p as Record<string, unknown>;
  if (w.t !== 'cl' || !w.s || typeof w.s !== 'object') return null;
  const s = w.s as Record<string, unknown>;
  const key = w.k === undefined ? undefined : str(w.k) && B64_32.test(w.k) ? w.k : null;
  if (key === null) return null;
  let signal: Signal | null = null;
  switch (s.t) {
    case 'invite':
      if (id(s.callId) && oneOf(ROUTES, s.route) && (s.requestId === undefined || id(s.requestId)) && key)
        signal = { t: 'invite', callId: s.callId, route: s.route, ...(s.requestId ? { requestId: s.requestId as string } : {}) };
      break;
    case 'accept': if (id(s.callId) && key) signal = { t: 'accept', callId: s.callId }; break;
    case 'ringing': if (id(s.callId)) signal = { t: 'ringing', callId: s.callId }; break;
    case 'decline': if (id(s.callId) && oneOf(DECLINE, s.reason)) signal = { t: 'decline', callId: s.callId, reason: s.reason }; break;
    case 'cancel':
      if (id(s.callId) && Number.isFinite(s.rangMs) && (s.rangMs as number) >= 0) signal = { t: 'cancel', callId: s.callId, rangMs: Math.min(s.rangMs as number, 3_600_000) };
      break;
    case 'end': if (id(s.callId) && oneOf(END, s.reason)) signal = { t: 'end', callId: s.callId, reason: s.reason }; break;
    case 'request': if (id(s.requestId)) signal = { t: 'request', requestId: s.requestId }; break;
    case 'requestAnswer': if (id(s.requestId) && typeof s.ok === 'boolean') signal = { t: 'requestAnswer', requestId: s.requestId, ok: s.ok }; break;
  }
  return signal ? { signal, ...(key ? { key } : {}) } : null;
}

export const callWire = (signal: Signal, key?: string): WireCall => ({ t: 'cl', s: signal, ...(key ? { k: key } : {}) });
