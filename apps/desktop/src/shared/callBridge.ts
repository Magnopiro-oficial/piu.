/**
 * Ponte da chamada de voz entre o processo principal (onde roda o `CallService`, junto da malha) e o
 * renderer (telas e Web Audio). Puro, testado em test/callBridge.test.ts.
 * - main → renderer: `CallSnapshot` (estado) e `CallAudioCmd` (abrir/fechar microfone, tocar voz).
 * - renderer → main: `CallAct` (o que a pessoa fez) e os quadros codificados do microfone.
 * Tudo que vem do renderer passa por `readCallAct`/`readCallFrame`: a tela só pede o que um botão pede;
 * eventos da rede (`incoming`, `connected`…) nunca entram por aqui.
 */
import type { CallEvent, CallState, LiveRoute } from '../../../mobile/src/calls/callMachine';
import type { Codec } from '../../../mobile/src/calls/callMedia';

export type CallSnapshot = {
  state: CallState;
  /** As 4 palavras da chamada (só com chamada ativa). */
  words: string[] | null;
  latencyMs?: number;
  /** Contatos com caminho ao vivo agora (caixa "pre": ligar ou pedir chamada). */
  routes: Record<string, LiveRoute>;
  /** Chamada recebida tocando e o toque deve soar (Não perturbe e conversa silenciada calam; shared/callNotify.ts). */
  ring: boolean;
};

export type CallAudioCmd =
  | { op: 'start' }
  | { op: 'stop' }
  | { op: 'mute'; on: boolean }
  | { op: 'play'; codec: Codec; payload: Uint8Array; seq: number };

/** Eventos sem dado que a tela despacha direto na máquina. */
const UI_EVENTS = ['closePre', 'mute', 'speaker', 'openWords', 'closeWords', 'wordsMatch', 'minimize', 'restore', 'requestLater'] as const;
type UiEvent = Extract<CallEvent, { type: (typeof UI_EVENTS)[number] }>;

export type CallAct =
  | { a: 'open'; peer: string }
  | { a: 'dial' } | { a: 'sendRequest' } | { a: 'answer' } | { a: 'hangup' } | { a: 'wordsDiffer' } | { a: 'requestNow' }
  | { a: 'decline'; how?: 'message' | 'later' }
  | { a: 'event'; event: UiEvent };

const SIMPLE = new Set(['dial', 'sendRequest', 'answer', 'hangup', 'wordsDiffer', 'requestNow']);
const PEER = /^piu:[0-9a-f]{32}$/;

/** Valida o pedido da tela; `null` = recusado. */
export function readCallAct(x: unknown): CallAct | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (typeof o.a !== 'string') return null;
  if (SIMPLE.has(o.a)) return { a: o.a } as CallAct;
  if (o.a === 'open') return typeof o.peer === 'string' && PEER.test(o.peer) ? { a: 'open', peer: o.peer } : null;
  if (o.a === 'decline') return o.how === undefined ? { a: 'decline' } : o.how === 'message' || o.how === 'later' ? { a: 'decline', how: o.how } : null;
  if (o.a === 'event') {
    const e = o.event as { type?: unknown } | null;
    return e && typeof e === 'object' && (UI_EVENTS as readonly unknown[]).includes(e.type) ? { a: 'event', event: { type: e.type } as UiEvent } : null;
  }
  return null;
}

/** Um pedaço do microfone: Opus de 20 ms cabe folgado em 1 KB. */
export function readCallFrame(codec: unknown, payload: unknown): { codec: Codec; payload: Uint8Array } | null {
  if (codec !== 'opus' && codec !== 'pcmu') return null;
  if (!(payload instanceof Uint8Array) || payload.length === 0 || payload.length > 1024) return null;
  return { codec, payload };
}
