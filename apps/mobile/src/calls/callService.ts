/**
 * Serviço da chamada de um aparelho: liga a máquina (./callController) aos sinais pela sessão do
 * contato (./callSignals), à troca de chaves efêmeras e às 4 palavras (./callCrypto), à voz pelos
 * enlaces (./callMedia) e ao motor de áudio do aparelho (celular: módulo nativo; Desktop: Web Audio).
 * O mesmo código roda no celular e no Desktop; cada um passa as suas portas.
 */
import { b64url, unb64url as fromB64url } from '../messaging/card';
import { callKeys, newCallKeypair, voiceTag, type CallKeys } from './callCrypto';
import { CallController } from './callController';
import type { CallRecord, CallState, LiveRoute, Signal } from './callMachine';
import { VoiceLink, type Codec } from './callMedia';
import { isLiveSignal, readCallWire, callWire, type WireCall } from './callSignals';
import type { RequestStep } from './callView';
import type { Medium } from '../transport/types';

/** Motor de áudio do aparelho (captura codificada, reprodução, níveis). */
export interface AudioEngine {
  /** Abre o microfone; cada pedaço de ~20 ms codificado sai em `onFrame`. */
  start(onFrame: (codec: Codec, payload: Uint8Array) => void): Promise<void>;
  stop(): void;
  play(codec: Codec, payload: Uint8Array, seq: number): void;
  setMuted(muted: boolean): void;
  setSpeaker?(on: boolean): void;
  /** Níveis 0..1 do meu microfone e da voz que chega. */
  levels(): { mine: number; theirs: number };
}

export type CallServicePorts = {
  now(): number;
  newId(): string;
  /** Sinal pela sessão cifrada do contato. `live`: só vale ao vivo (sem fila); senão vai pela fila da malha. Devolve false se não saiu. */
  sendSignal(peer: string, wire: WireCall, live: boolean): boolean;
  record(rec: CallRecord): void;
  /** Cartão "Pedido de chamada" na conversa. */
  requestUpdate(peer: string, requestId: string, step: RequestStep, dir: 'out' | 'in'): void;
  toast?(text: 'verified' | 'remindLater' | 'requestLater', peer?: string): void;
  draft?(peer: string): void;
  /** Há caminho ao vivo até o contato agora? (vizinho direto recente e o meio). */
  liveRouteTo(peer: string): LiveRoute | null;
  links(): { peerId: string; medium: Medium }[];
  sendFrame(peerId: string, frame: Uint8Array): void;
  isPoint?(peerId: string): boolean;
  audio: AudioEngine;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(h: unknown): void;
  setInterval?(fn: () => void, ms: number): unknown;
  clearInterval?(h: unknown): void;
};

/** Pedido aceito por quem recebeu, esperando um caminho ao vivo para ligar (até 10 min). */
const ACCEPTED_WAIT_MS = 10 * 60_000;
const TICK_MS = 250;

export class CallService {
  readonly controller: CallController;
  private mine?: { callId: string; sk: Uint8Array; pk: Uint8Array };
  private theirKey = new Map<string, Uint8Array>();
  private keys?: CallKeys;
  private link?: VoiceLink;
  private ticker?: unknown;
  private waiting = new Map<string, { peer: string; until: number }>();
  private listeners = new Set<() => void>();

  constructor(private readonly p: CallServicePorts) {
    this.controller = new CallController({
      now: p.now, newId: p.newId, setTimer: p.setTimer, clearTimer: p.clearTimer,
      send: (peer, s) => this.send(peer, s),
      record: r => p.record(r),
      media: (on, s) => (on ? this.startMedia(s) : this.stopMedia()),
      toast: (text, peer) => p.toast?.(text, peer),
      draft: peer => p.draft?.(peer),
    });
    // Mudo e alto-falante na hora (não esperam o tique): mudo é privacidade.
    this.controller.subscribe(() => { if (this.link) this.syncAudio(); this.emit(); });
  }

  get state(): CallState { return this.controller.state; }
  /** As 4 palavras (depois de conectar). */
  get words(): string[] | null { return this.keys?.words ?? null; }
  get latencyMs(): number | undefined { return this.link?.latencyMs; }
  levels() { return this.link ? this.p.audio.levels() : { mine: 0, theirs: 0 }; }

  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit() { for (const fn of this.listeners) fn(); }

  /** Botão ligar: abre a folha com o caminho ao vivo de agora (ou em modo malha). */
  open(peer: string) { this.controller.open(peer, this.p.liveRouteTo(peer)); }

  /** Quadro de um vizinho: `true` se era voz desta chamada (não vai para o mensageiro). */
  onFrame(peerId: string, medium: Medium, frame: Uint8Array): boolean {
    if (!voiceTag(frame)) return false;
    return this.link?.receive(peerId, medium, frame) ?? true;
  }

  /** Sinal `{ t: 'cl' }` que chegou da sessão do contato `peer`. */
  onSignal(peer: string, payload: unknown): void {
    const got = readCallWire(payload);
    if (!got) return;
    const { signal: s, key } = got;
    const st = this.controller.state, now = this.p.now();
    switch (s.t) {
      case 'invite': {
        if (!key) return;
        this.theirKey.set(s.callId, fromB64url(key));
        this.controller.dispatch({ type: 'incoming', callId: s.callId, peer, route: this.p.liveRouteTo(peer) ?? s.route, now, requestId: s.requestId });
        break;
      }
      case 'ringing': if (st.peer === peer) this.controller.dispatch({ type: 'peerRinging', callId: s.callId }); break;
      case 'accept': {
        if (st.peer !== peer || st.callId !== s.callId || !key || !this.mine || this.mine.callId !== s.callId) return;
        this.keys = callKeys({ callId: s.callId, role: 'caller', mySk: this.mine.sk, myPk: this.mine.pk, theirPk: fromB64url(key) });
        this.controller.dispatch({ type: 'connected', callId: s.callId, now });
        break;
      }
      case 'decline': if (st.peer === peer) this.controller.dispatch({ type: 'remoteDecline', callId: s.callId, reason: s.reason, now }); break;
      case 'cancel': if (st.peer === peer) this.controller.dispatch({ type: 'remoteCancel', callId: s.callId, rangMs: s.rangMs, now }); break;
      case 'end': if (st.peer === peer) this.controller.dispatch({ type: 'remoteEnd', callId: s.callId, reason: s.reason, now }); break;
      case 'request':
        this.p.requestUpdate(peer, s.requestId, 'delivered', 'in');
        this.controller.dispatch({ type: 'requestIn', requestId: s.requestId, peer });
        break;
      case 'requestAnswer':
        this.p.requestUpdate(peer, s.requestId, s.ok ? 'accepted' : 'declined', 'out');
        if (s.ok) { this.waiting.set(s.requestId, { peer, until: now + ACCEPTED_WAIT_MS }); this.tryWaiting(); }
        break;
    }
  }

  /** Chamar quando os vizinhos mudam: um pedido aceito liga assim que houver caminho ao vivo. */
  tryWaiting() {
    const now = this.p.now();
    for (const [requestId, w] of this.waiting) {
      if (now > w.until) { this.waiting.delete(requestId); this.p.requestUpdate(w.peer, requestId, 'expired', 'out'); continue; }
      const route = this.p.liveRouteTo(w.peer);
      if (!route || this.controller.state.phase !== 'idle') continue;
      this.waiting.delete(requestId);
      this.controller.dispatch({ type: 'requestAccepted', requestId, peer: w.peer, route, callId: this.p.newId(), now });
    }
  }

  private send(peer: string, s: Signal) {
    let key: string | undefined;
    if (s.t === 'invite') {
      const kp = newCallKeypair();
      this.mine = { callId: s.callId, ...kp };
      key = b64url(kp.pk);
    } else if (s.t === 'accept') {
      const theirs = this.theirKey.get(s.callId);
      if (!theirs) return;
      const kp = newCallKeypair();
      this.keys = callKeys({ callId: s.callId, role: 'callee', mySk: kp.sk, myPk: kp.pk, theirPk: theirs });
      kp.sk.fill(0);
      key = b64url(kp.pk);
    } else if (s.t === 'request') {
      this.p.requestUpdate(peer, s.requestId, 'traveling', 'out');
    }
    this.p.sendSignal(peer, callWire(s, key), isLiveSignal(s));
  }

  private startMedia(s: CallState) {
    if (!this.keys) return;
    const a = this.p.audio;
    this.link = new VoiceLink(this.keys, {
      now: this.p.now, links: this.p.links, send: this.p.sendFrame, isPoint: this.p.isPoint,
      onAudio: (codec, payload, seq) => a.play(codec, payload, seq),
      onRoute: route => {
        const st = this.controller.state;
        if (st.phase !== 'active') return;
        if (route === null) this.controller.dispatch({ type: 'routeLost', now: this.p.now() });
        else if (route !== st.route || st.switching) this.controller.dispatch({ type: 'routeFound', route });
        this.emit();
      },
    });
    this.lastMuted = this.lastSpeaker = undefined;
    void a.start((codec, payload) => this.link?.sendAudio(codec, payload)).catch(() => this.controller.hangup());
    const every = this.p.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
    this.syncAudio();
    this.ticker = every(() => { this.link?.tick(); this.syncAudio(); }, TICK_MS);
  }

  private lastMuted?: boolean;
  private lastSpeaker?: boolean;
  private syncAudio() {
    const s = this.controller.state;
    if (s.muted !== this.lastMuted) { this.lastMuted = s.muted; this.p.audio.setMuted(s.muted); }
    if (s.speaker !== this.lastSpeaker) { this.lastSpeaker = s.speaker; this.p.audio.setSpeaker?.(s.speaker); }
  }

  private stopMedia() {
    if (this.ticker !== undefined) (this.p.clearInterval ?? ((h: unknown) => clearInterval(h as ReturnType<typeof setInterval>)))(this.ticker);
    this.ticker = undefined;
    this.link?.close();
    this.link = undefined;
    this.p.audio.stop();
    this.keys = undefined;
    this.mine?.sk.fill(0);
    this.mine = undefined;
    this.theirKey.clear();
    this.lastMuted = this.lastSpeaker = undefined;
  }

  dispose() { this.stopMedia(); this.controller.dispose(); this.listeners.clear(); }
}
