/**
 * Roda a máquina de estados (./callMachine) de verdade: guarda o estado, executa os efeitos pelas
 * portas do aparelho (sinal pela sessão do contato, registro na conversa, áudio, aviso) e cuida dos
 * timers. O celular e o Desktop criam um controlador cada, com as suas portas.
 */
import { IDLE, reduce, type CallEvent, type CallRecord, type CallState, type Effect, type Signal } from './callMachine';

export type CallPorts = {
  now(): number;
  /** Id novo e imprevisível (chamada ou pedido). */
  newId(): string;
  send(peer: string, signal: Signal): void;
  record(rec: CallRecord): void;
  media(on: boolean, state: CallState): void;
  toast?(text: Extract<Effect, { kind: 'toast' }>['text'], peer?: string): void;
  draft?(peer: string): void;
  /** Lembrete de ligar para `peer` daqui a `ms` (celular: notificação local; sem isto, só o aviso). */
  remind?(peer: string, ms: number): void;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(h: unknown): void;
};

type TimerName = Extract<Effect, { kind: 'timer' }>['name'];

export class CallController {
  private s: CallState = IDLE;
  private listeners = new Set<(s: CallState) => void>();
  private timers = new Map<TimerName, unknown>();

  constructor(private readonly ports: CallPorts) {}

  get state(): CallState { return this.s; }

  subscribe(fn: (s: CallState) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  dispatch(e: CallEvent): void {
    const { state, effects } = reduce(this.s, e);
    const changed = state !== this.s;
    this.s = state;
    for (const fx of effects) this.run(fx);
    if (changed) for (const fn of this.listeners) fn(this.s);
  }

  /** Atalhos com o relógio e os ids das portas. */
  open(peer: string, route: CallState['preRoute']) { this.dispatch({ type: 'open', peer, route: route ?? null }); }
  dial() { this.dispatch({ type: 'dial', callId: this.ports.newId(), now: this.ports.now() }); }
  sendRequest() { this.dispatch({ type: 'sendRequest', requestId: this.ports.newId() }); }
  answer() { this.dispatch({ type: 'answer', now: this.ports.now() }); }
  decline(how?: 'message' | 'later') { this.dispatch({ type: 'decline', now: this.ports.now(), how }); }
  hangup() { this.dispatch({ type: 'hangup', now: this.ports.now() }); }
  wordsDiffer() { this.dispatch({ type: 'wordsDiffer', now: this.ports.now() }); }
  requestNow() { this.dispatch({ type: 'requestNow', callId: this.ports.newId(), now: this.ports.now() }); }

  dispose() {
    for (const h of this.timers.values()) this.clear(h);
    this.timers.clear();
    this.listeners.clear();
  }

  private run(fx: Effect) {
    const p = this.ports;
    switch (fx.kind) {
      case 'send': if (fx.peer) p.send(fx.peer, fx.signal); break;
      case 'record': p.record(fx.record); break;
      case 'media': p.media(fx.on, this.s); break;
      case 'toast': p.toast?.(fx.text, fx.peer); break;
      case 'draft': p.draft?.(fx.peer); break;
      case 'remind': p.remind?.(fx.peer, fx.ms); break;
      case 'timer': {
        const old = this.timers.get(fx.name);
        if (old !== undefined) this.clear(old);
        const set = p.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
        this.timers.set(fx.name, set(() => {
          this.timers.delete(fx.name);
          this.dispatch(fx.name === 'endDone' ? { type: 'endDone' } : { type: fx.name, now: p.now() });
        }, fx.ms));
        break;
      }
      case 'cancelTimer': {
        const h = this.timers.get(fx.name);
        if (h !== undefined) { this.clear(h); this.timers.delete(fx.name); }
        break;
      }
    }
  }

  private clear(h: unknown) { (this.ports.clearTimer ?? ((x: unknown) => clearTimeout(x as ReturnType<typeof setTimeout>)))(h); }
}
