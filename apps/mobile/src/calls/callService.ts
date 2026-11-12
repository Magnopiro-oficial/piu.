/**
 * Serviço da chamada de um aparelho: liga a máquina (./callController) aos sinais pela sessão do
 * contato (./callSignals), à troca de chaves efêmeras e às 4 palavras (./callCrypto), à voz pelos
 * enlaces (./callMedia) e ao motor de áudio do aparelho (celular: módulo nativo; Desktop: Web Audio).
 * O mesmo código roda no celular e no Desktop; cada um passa as suas portas.
 */
import { b64url, unb64url as fromB64url } from '../messaging/card';
import { callKeys, newCallKeypair, voiceTag, type CallKeys } from './callCrypto';
import { CallController } from './callController';
import { agree } from '../protocol/suite';
import { splitRoute, type CallRecord, type CallState, type RouteHint, type Signal } from './callMachine';
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
  /** "Em 10 min" ao recusar: lembrete de ligar para `peer` daqui a `ms`. */
  remind?(peer: string, ms: number): void;
  /** Há caminho ao vivo até o contato agora? (vizinho direto recente e o meio; `wifiDirect` = Nearby). */
  liveRouteTo(peer: string): RouteHint | null;
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
/** Pedido que eu mandei vale uma resposta até o prazo máximo de um envelope na malha (7 dias). */
const REQUEST_TTL_MS = 7 * 24 * 3600_000;
/** Tetos das memórias que um contato consegue fazer crescer. */
const MAX_REQUESTS = 16;
const MAX_SEEN_CALLS = 64;
/** Quem liga sem parar: até 5 convites do mesmo contato a cada 10 min; os seguintes ouvem "ocupado" sem tocar. */
const INVITES_PER_WINDOW = 5;
const INVITE_WINDOW_MS = 10 * 60_000;
/** Pedido de chamada sem parar: até 3 pedidos novos do mesmo contato a cada 10 min; os seguintes são ignorados. */
const REQUESTS_PER_WINDOW = 3;
const TICK_MS = 250;

/** Põe no mapa com teto: passando do teto, sai o mais antigo. */
function putCapped<K, V>(m: Map<K, V>, k: K, v: V, max: number) {
  m.delete(k);
  m.set(k, v);
  while (m.size > max) m.delete(m.keys().next().value as K);
}

export class CallService {
  readonly controller: CallController;
  private mine?: { callId: string; sk: Uint8Array; pk: Uint8Array };
  private theirKey = new Map<string, Uint8Array>();
  private keys?: CallKeys;
  private link?: VoiceLink;
  private ticker?: unknown;
  private waiting = new Map<string, { peer: string; until: number }>();
  /** Pedidos que EU mandei (id → contato e prazo): só eles aceitam um "pode ligar". */
  private outgoing = new Map<string, { peer: string; until: number }>();
  /** Ids de chamada já recebidos: quem liga escolhe o id, e o mesmo convite não toca de novo. */
  private seenCalls = new Map<string, true>();
  /** Convites recentes por contato (início da janela e quantos). */
  private invites = new Map<string, { since: number; n: number }>();
  /** Pedidos de chamada já recebidos (contato|id) e quantos cada contato mandou na janela. */
  private seenRequests = new Map<string, true>();
  private requestsIn = new Map<string, { since: number; n: number }>();
  private listeners = new Set<() => void>();

  constructor(private readonly p: CallServicePorts) {
    this.controller = new CallController({
      now: p.now, newId: p.newId, setTimer: p.setTimer, clearTimer: p.clearTimer,
      send: (peer, s) => this.send(peer, s),
      record: r => p.record(r),
      media: (on, s) => (on ? this.startMedia(s) : this.stopMedia()),
      toast: (text, peer) => p.toast?.(text, peer),
      draft: peer => p.draft?.(peer),
      remind: (peer, ms) => p.remind?.(peer, ms),
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
  open(peer: string) {
    const h = this.p.liveRouteTo(peer);
    this.controller.dispatch({ type: 'open', peer, ...(h ? splitRoute(h) : { route: null }) });
  }

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
        const seen = peer + '|' + s.callId;
        if (this.seenCalls.has(seen)) return;
        putCapped(this.seenCalls, seen, true, MAX_SEEN_CALLS);
        if (!this.inviteAllowed(peer, now)) {
          this.p.sendSignal(peer, callWire({ t: 'decline', callId: s.callId, reason: 'busy' }), true);
          return;
        }
        // Chave efêmera de ordem baixa passa no formato mas não dá segredo: recusa já, sem tocar
        // (vindo de um pedido, o aceite sairia dentro do despacho e a troca de chaves lançaria).
        const theirPk = fromB64url(key);
        if (!agree.valid(theirPk)) {
          this.p.sendSignal(peer, callWire({ t: 'decline', callId: s.callId, reason: 'declined' }), true);
          return;
        }
        // A chave precisa estar aqui antes do despacho (o aceite do pedido sai dentro dele); se a
        // máquina não ficou com esta chamada (ocupado), ela sai na hora.
        this.theirKey.set(s.callId, theirPk);
        const h = this.p.liveRouteTo(peer);
        this.controller.dispatch({ type: 'incoming', callId: s.callId, peer, ...(h ? splitRoute(h) : { route: s.route }), now, requestId: s.requestId });
        if (this.controller.state.callId !== s.callId) this.theirKey.delete(s.callId);
        break;
      }
      case 'ringing': if (st.peer === peer) this.controller.dispatch({ type: 'peerRinging', callId: s.callId }); break;
      case 'accept': {
        if (st.peer !== peer || st.callId !== s.callId || !key || !this.mine || this.mine.callId !== s.callId) return;
        const keys = this.deriveKeys({ callId: s.callId, role: 'caller', mySk: this.mine.sk, myPk: this.mine.pk, theirPk: fromB64url(key) });
        // Aceite com chave efêmera inválida: não conecta sem mídia; encerra a chamada.
        if (!keys) { this.controller.hangup(); return; }
        this.keys = keys;
        this.controller.dispatch({ type: 'connected', callId: s.callId, now });
        break;
      }
      case 'decline': if (st.peer === peer) this.controller.dispatch({ type: 'remoteDecline', callId: s.callId, reason: s.reason, now }); break;
      case 'cancel': if (st.peer === peer) this.controller.dispatch({ type: 'remoteCancel', callId: s.callId, rangMs: s.rangMs, now }); break;
      case 'end': if (st.peer === peer) this.controller.dispatch({ type: 'remoteEnd', callId: s.callId, reason: s.reason, now }); break;
      case 'request': {
        // Mesmo pedido repetido não vira outro cartão; e um contato não enche a conversa de pedidos.
        const seen = peer + '|' + s.requestId;
        if (this.seenRequests.has(seen)) return;
        putCapped(this.seenRequests, seen, true, MAX_SEEN_CALLS);
        if (!this.windowAllowed(this.requestsIn, peer, now, REQUESTS_PER_WINDOW)) return;
        this.p.requestUpdate(peer, s.requestId, 'delivered', 'in');
        this.controller.dispatch({ type: 'requestIn', requestId: s.requestId, peer });
        break;
      }
      case 'requestAnswer': {
        // Só a resposta de um pedido que eu mandei a este contato, no prazo, e uma vez só. Sem isto,
        // um contato ao vivo inventava um "pode ligar" e o aparelho ligava sozinho e abria o microfone.
        const mineReq = this.outgoing.get(s.requestId);
        if (!mineReq || mineReq.peer !== peer || now > mineReq.until) return;
        this.outgoing.delete(s.requestId);
        this.p.requestUpdate(peer, s.requestId, s.ok ? 'accepted' : 'declined', 'out');
        if (s.ok) { putCapped(this.waiting, s.requestId, { peer, until: now + ACCEPTED_WAIT_MS }, MAX_REQUESTS); this.tryWaiting(); }
        break;
      }
    }
  }

  /** Conta o convite do contato na janela; falso quando passou do limite. */
  private inviteAllowed(peer: string, now: number): boolean {
    return this.windowAllowed(this.invites, peer, now, INVITES_PER_WINDOW);
  }

  /** Conta um sinal do contato na janela de 10 min; falso quando passou de `max`. */
  private windowAllowed(m: Map<string, { since: number; n: number }>, peer: string, now: number, max: number): boolean {
    const w = m.get(peer);
    const cur = w && now - w.since < INVITE_WINDOW_MS ? w : { since: now, n: 0 };
    cur.n++;
    putCapped(m, peer, cur, MAX_SEEN_CALLS);
    return cur.n <= max;
  }

  /** Chamar quando os vizinhos mudam: um pedido aceito liga assim que houver caminho ao vivo. */
  tryWaiting() {
    const now = this.p.now();
    for (const [requestId, w] of this.waiting) {
      if (now > w.until) { this.waiting.delete(requestId); this.p.requestUpdate(w.peer, requestId, 'expired', 'out'); continue; }
      const h = this.p.liveRouteTo(w.peer);
      if (!h || this.controller.state.phase !== 'idle') continue;
      this.waiting.delete(requestId);
      this.controller.dispatch({ type: 'requestAccepted', requestId, peer: w.peer, ...splitRoute(h), callId: this.p.newId(), now });
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
      const keys = this.deriveKeys({ callId: s.callId, role: 'callee', mySk: kp.sk, myPk: kp.pk, theirPk: theirs });
      kp.sk.fill(0);
      // Não deu segredo (o convite já filtra; isto é a rede de segurança): não manda o aceite e encerra.
      if (!keys) { this.controller.hangup(); return; }
      this.keys = keys;
      key = b64url(kp.pk);
    } else if (s.t === 'request') {
      putCapped(this.outgoing, s.requestId, { peer, until: this.p.now() + REQUEST_TTL_MS }, MAX_REQUESTS);
      this.p.requestUpdate(peer, s.requestId, 'traveling', 'out');
    }
    const ok = this.p.sendSignal(peer, callWire(s, key), isLiveSignal(s));
    // A oferta nem saiu (sem sessão com o contato ou sem vizinho): termina já, sem esperar 45 s à toa.
    if (!ok && s.t === 'invite') this.controller.dispatch({ type: 'unreachable', callId: s.callId, now: this.p.now() });
  }

  /** Troca de chaves que não lança: `null` se a chave do outro for inválida (dado de contato não é confiável). */
  private deriveKeys(o: Parameters<typeof callKeys>[0]): CallKeys | null {
    if (!agree.valid(o.theirPk)) return null;
    try { return callKeys(o); } catch { return null; }
  }

  private startMedia(s: CallState) {
    if (!this.keys) return;
    const a = this.p.audio;
    this.link = new VoiceLink(this.keys, {
      now: this.p.now, links: this.p.links, send: this.p.sendFrame, isPoint: this.p.isPoint,
      onAudio: (codec, payload, seq) => a.play(codec, payload, seq),
      onRoute: (route, _latency, wifiDirect) => {
        const st = this.controller.state;
        if (st.phase !== 'active') return;
        if (route === null) this.controller.dispatch({ type: 'routeLost', now: this.p.now() });
        else if (route !== st.route || st.switching || !!wifiDirect !== !!st.wifiDirect) this.controller.dispatch({ type: 'routeFound', route, ...(wifiDirect ? { wifiDirect: true as const } : {}) });
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
