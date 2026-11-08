/**
 * Transporte da voz durante a chamada, por cima dos enlaces com os vizinhos (o mesmo `send` que leva os
 * envelopes). Os quadros (./callCrypto) só vão a vizinhos diretos: até achar por onde o contato
 * responde, vão a todos (quem não é da chamada descarta pela etiqueta); depois, só por aquele enlace.
 * Dentro do quadro cifrado, o 1º byte diz o que é: áudio (codec) ou ping/pong (latência e "ainda vivo").
 * Sem quadro válido por LOST_MS, o caminho caiu: a máquina entra em "mudando" e volta a procurar.
 * LoRa (Meshtastic ou rádio do Piu) nunca carrega voz: nem vira o enlace, nem entra no envio a todos.
 */
import type { Medium } from '../transport/types';
import { openVoice, sealVoice, VoiceReplay, type CallKeys } from './callCrypto';
import type { LiveRoute, RouteHint } from './callMachine';

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
  /** Caminho ao vivo (ou `null` quando caiu), latência medida (ida e volta / 2) e se o `bt` é Wi-Fi Direct. */
  onRoute(route: LiveRoute | null, latencyMs?: number, wifiDirect?: boolean): void;
  /** O vizinho é um Ponto Piu (repassa a voz entre os dois)? */
  isPoint?(peerId: string): boolean;
};

export function routeOfMedium(medium: Medium, point: boolean): LiveRoute {
  if (point) return 'point';
  return medium === 'lan' || medium === 'sim' ? 'direct' : 'bt';
}

/** Como `routeOfMedium`, mas Nearby Connections aparece como Wi-Fi Direct, como no resto do app (lib/networkCore.ts). */
export const hintOfMedium = (medium: Medium, point: boolean): RouteHint => (!point && medium === 'nearby' ? 'wifiDirect' : routeOfMedium(medium, point));

/** ~1 kbps compartilhado: a voz ao vivo não cabe e gastaria o tempo de rádio de todos. */
const isLora = (m: Medium) => m === 'lora' || m === 'piulora';

export class VoiceLink {
  private seq = 0;
  private replay = new VoiceReplay();
  private link: { peerId: string; medium: Medium } | null = null;
  private lastRx = -Infinity;
  private lastPing = -Infinity;
  private latency?: number;
  private route: LiveRoute | null = null;
  private wifiDirect = false;
  private closed = false;

  constructor(private readonly keys: CallKeys, private readonly p: VoiceLinkPorts) {}

  get currentRoute() { return this.route; }
  /** O caminho `bt` de agora é Wi-Fi Direct (Nearby)? */
  get isWifiDirect() { return this.wifiDirect; }
  get latencyMs() { return this.latency; }

  sendAudio(codec: Codec, payload: Uint8Array) {
    const inner = new Uint8Array(1 + payload.length);
    inner[0] = codec === 'opus' ? Inner.Opus : Inner.Pcmu;
    inner.set(payload, 1);
    this.out(inner);
  }

  /** Quadro que chegou de um vizinho. `true` se era desta chamada (não vai para o mensageiro). */
  receive(peerId: string, medium: Medium, frame: Uint8Array): boolean {
    if (this.closed || isLora(medium)) return false;
    const got = openVoice(this.keys, frame, this.replay);
    if (!got || got.payload.length < 1) return false;
    const now = this.p.now();
    this.lastRx = now;
    if (!this.link || this.link.peerId !== peerId) this.link = { peerId, medium };
    const point = !!this.p.isPoint?.(peerId);
    this.setRoute(routeOfMedium(medium, point), hintOfMedium(medium, point) === 'wifiDirect');
    const kind = got.payload[0], body = got.payload.subarray(1);
    if (kind === Inner.Ping && body.length === 8) this.out(concatByte(Inner.Pong, body));
    else if (kind === Inner.Pong && body.length === 8) {
      const sent = new DataView(body.buffer, body.byteOffset).getFloat64(0);
      const rtt = now - sent;
      if (rtt >= 0 && rtt < 10_000) { this.latency = rtt / 2; this.p.onRoute(this.route, this.latency, this.wifiDirect); }
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

  private setRoute(r: LiveRoute | null, wifiDirect = false) {
    if (r === this.route && wifiDirect === this.wifiDirect) return;
    this.route = r;
    this.wifiDirect = wifiDirect;
    if (!r) this.latency = undefined;
    this.p.onRoute(r, this.latency, wifiDirect);
  }

  private out(inner: Uint8Array) {
    if (this.closed) return;
    const frame = sealVoice(this.keys, this.seq++, inner);
    const targets = this.link ? [this.link] : this.p.links().filter(l => !isLora(l.medium));
    for (const l of targets) this.p.send(l.peerId, frame);
  }
}

const concatByte = (b: number, rest: Uint8Array) => { const o = new Uint8Array(1 + rest.length); o[0] = b; o.set(rest, 1); return o; };
