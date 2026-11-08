/**
 * Transporte da voz durante a chamada, por cima dos enlaces com os vizinhos (o mesmo `send` que leva os
 * envelopes). Os quadros (./callCrypto) só vão a vizinhos diretos: até achar por onde o contato
 * responde, vão a todos (quem não é da chamada descarta pela etiqueta); depois, só por aquele enlace.
 * Dentro do quadro cifrado, o 1º byte diz o que é: áudio (codec) ou ping/pong (latência e "ainda vivo").
 * Sem quadro válido por LOST_MS, o caminho caiu: a máquina entra em "mudando" e volta a procurar.
 */
import type { Medium } from '../transport/types';
import { openVoice, sealVoice, VoiceReplay, type CallKeys } from './callCrypto';
import type { LiveRoute } from './callMachine';

export const Inner = { Opus: 0x01, Pcmu: 0x02, Ping: 0x10, Pong: 0x11 } as const;
export type Codec = 'opus' | 'pcmu';
export const PING_EVERY_MS = 1000;
export const LOST_MS = 1500;

export type VoiceLinkPorts = {
  now(): number;
  /** Enlaces diretos agora (vizinhos conectados e o meio de cada um). */
  links(): { peerId: string; medium: Medium }[];
  send(peerId: string, frame: Uint8Array): void;
  onAudio(codec: Codec, payload: Uint8Array, seq: number): void;
  /** Caminho ao vivo (ou `null` quando caiu) e latência medida (ida e volta / 2). */
  onRoute(route: LiveRoute | null, latencyMs?: number): void;
  /** O vizinho é um Ponto Piu (repassa a voz entre os dois)? */
  isPoint?(peerId: string): boolean;
};

export function routeOfMedium(medium: Medium, point: boolean): LiveRoute {
  if (point) return 'point';
  return medium === 'lan' || medium === 'sim' ? 'direct' : 'bt';
}

export class VoiceLink {
  private seq = 0;
  private replay = new VoiceReplay();
  private link: { peerId: string; medium: Medium } | null = null;
  private lastRx = -Infinity;
  private lastPing = -Infinity;
  private latency?: number;
  private route: LiveRoute | null = null;
  private closed = false;

  constructor(private readonly keys: CallKeys, private readonly p: VoiceLinkPorts) {}

  get currentRoute() { return this.route; }
  get latencyMs() { return this.latency; }

  sendAudio(codec: Codec, payload: Uint8Array) {
    const inner = new Uint8Array(1 + payload.length);
    inner[0] = codec === 'opus' ? Inner.Opus : Inner.Pcmu;
    inner.set(payload, 1);
    this.out(inner);
  }

  /** Quadro que chegou de um vizinho. `true` se era desta chamada (não vai para o mensageiro). */
  receive(peerId: string, medium: Medium, frame: Uint8Array): boolean {
    if (this.closed) return false;
    const got = openVoice(this.keys, frame, this.replay);
    if (!got || got.payload.length < 1) return false;
    const now = this.p.now();
    this.lastRx = now;
    if (!this.link || this.link.peerId !== peerId) this.link = { peerId, medium };
    this.setRoute(routeOfMedium(medium, !!this.p.isPoint?.(peerId)));
    const kind = got.payload[0], body = got.payload.subarray(1);
    if (kind === Inner.Ping && body.length === 8) this.out(concatByte(Inner.Pong, body));
    else if (kind === Inner.Pong && body.length === 8) {
      const sent = new DataView(body.buffer, body.byteOffset).getFloat64(0);
      const rtt = now - sent;
      if (rtt >= 0 && rtt < 10_000) { this.latency = rtt / 2; this.p.onRoute(this.route, this.latency); }
    } else if (kind === Inner.Opus || kind === Inner.Pcmu) this.p.onAudio(kind === Inner.Opus ? 'opus' : 'pcmu', body, got.seq);
    return true;
  }

  /** Chamar a cada ~250 ms: ping de 1 em 1 s e detecção de caminho caído. */
  tick() {
    if (this.closed) return;
    const now = this.p.now();
    if (now - this.lastPing >= PING_EVERY_MS) {
      this.lastPing = now;
      const ts = new Uint8Array(8);
      new DataView(ts.buffer).setFloat64(0, now);
      this.out(concatByte(Inner.Ping, ts));
    }
    if (this.route && now - this.lastRx > LOST_MS) {
      this.link = null;
      this.setRoute(null);
    }
  }

  close() { this.closed = true; this.link = null; }

  private setRoute(r: LiveRoute | null) {
    if (r === this.route) return;
    this.route = r;
    if (!r) this.latency = undefined;
    this.p.onRoute(r, this.latency);
  }

  private out(inner: Uint8Array) {
    if (this.closed) return;
    const frame = sealVoice(this.keys, this.seq++, inner);
    const targets = this.link ? [this.link] : this.p.links();
    for (const l of targets) this.p.send(l.peerId, frame);
  }
}

const concatByte = (b: number, rest: Uint8Array) => { const o = new Uint8Array(1 + rest.length); o[0] = b; o.set(rest, 1); return o; };
