/**
 * Adapter serial do LNNP (INF-005 e INF-007): rádio LoRa ou cabo USB, pela porta serial.
 *
 * O piu-node fala KISS (kiss.ts) com o que estiver na porta:
 * - `lora`: um rádio LoRa com firmware de modem KISS (o rádio guarda frequência, SF e banda). Cada
 *   quadro KISS vira um pacote no ar, de até 255 bytes. Meio lento e compartilhado: só mensagens
 *   pequenas (nunca mídia), fila curta, limite de ocupação do canal e confirmação de cada pacote.
 * - `usb`: outro nó ligado por cabo serial/USB (ponto a ponto). Mesmo enquadramento, pacotes maiores
 *   e sem limite de tempo no ar.
 *
 * Pacote (dentro do quadro KISS):
 *   tipo u8 · destino u32 · origem u32 · seq u8 · dados
 * O endereço curto é o início da etiqueta do nó (`nodeTag`); o destino 0xFFFFFFFF é o anúncio.
 * Ele só serve para separar quem fala no meio compartilhado: a identidade é provada no handshake.
 *
 * Tipos: ANÚNCIO (o mesmo de 18 bytes do LAN; o campo "porta" leva o tamanho máximo do pacote),
 * HELLO e HANDSHAKE (quadros em claro do handshake LNNP), DADOS (registro cifrado do enlace) e ACK.
 * HELLO, HANDSHAKE e DADOS são confirmados um a um (para e espera, por vizinho), com até `retries`
 * repetições; perdas que sobrarem viram lacunas que o registro LNNP tolera (o contador só cresce).
 *
 * Handshake pelo meio: só quem tem o endereço curto menor começa (ao ouvir o anúncio do outro, manda
 * HELLO); o outro só responde: a cada HELLO recebido, começa do zero e manda HELLO e AUTH; o primeiro
 * manda AUTH. É o mesmo handshake simétrico do LNNP, em sequência. Com um lado só começando, perdas
 * não fazem os dois recomeçarem um por causa do outro. AUTH de uma tentativa antiga é descartado.
 * Quem recebe DADOS sem ter sessão (reiniciou) responde com um ERRO em claro: o outro derruba o enlace
 * e refaz o handshake no próximo anúncio.
 */
import { execFile } from 'node:child_process';
import { closeSync, constants, openSync } from 'node:fs';
import { isatty, ReadStream, WriteStream } from 'node:tty';
import { promisify } from 'node:util';
import { compareBytes, decodeBeacon, encodeBeacon, errorFrame, FrameType, Handshake, LNNP_MIN_VERSION, LNNP_VERSION, LnnpErrorCode, Medium } from '../protocol/lnnp.js';
import type { TransportClass } from '../protocol/router.js';
import { DutyCycle, type LoraParams, loraAirtimeMs } from './airtime.js';
import type { LinkPort, RelayEngine } from './engine.js';
import { KissDecoder, kissEncode } from './kiss.js';

/** A porta serial (ou o rádio simulado nos testes): bytes crus nos dois sentidos. */
export interface Modem {
  label: string;
  write(bytes: Uint8Array): void;
  onData(cb: (bytes: Uint8Array) => void): void;
  close(): Promise<void> | void;
}

export type SerialKind = 'lora' | 'usb';

export interface SerialOptions {
  kind: SerialKind;
  modem: Modem;
  /** Parâmetros do rádio (só para calcular o tempo no ar). */
  radio?: LoraParams;
  /** Ocupação máxima do canal, em % por hora (LoRa). Os ACKs sempre passam. */
  dutyPercent?: number;
  /** Maior envelope enviado por este meio (LoRa: padrão 1536 bytes). */
  maxEnvelope?: number;
  beaconMs?: number;
  /** Sem ouvir o vizinho por este tempo, o enlace cai. */
  linkTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  retries?: number;
  /** Intervalo da rodada do adapter (envio, repetição, prazos). */
  pollMs?: number;
  random?: () => number;
  now?: () => number;
}

export const HEADER = 10;
export const LORA_MAX_PACKET = 255;
export const USB_MAX_PACKET = 4096;
const BROADCAST = 0xffffffff;

export enum PacketType { Beacon = 1, Hello = 2, Handshake = 3, Data = 4, Ack = 5 }

export interface Packet { type: PacketType; dst: number; src: number; seq: number; payload: Uint8Array }

export function encodePacket(p: Packet): Uint8Array {
  const b = new Uint8Array(HEADER + p.payload.length);
  const v = new DataView(b.buffer);
  v.setUint8(0, p.type); v.setUint32(1, p.dst >>> 0); v.setUint32(5, p.src >>> 0); v.setUint8(9, p.seq & 0xff);
  b.set(p.payload, HEADER);
  return b;
}

export function decodePacket(b: Uint8Array): Packet | null {
  if (b.length < HEADER) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const type = v.getUint8(0);
  if (type < PacketType.Beacon || type > PacketType.Ack) return null;
  return { type, dst: v.getUint32(1), src: v.getUint32(5), seq: v.getUint8(9), payload: b.slice(HEADER) };
}

const shortAddr = (tag: Uint8Array) => new DataView(tag.buffer, tag.byteOffset, 4).getUint32(0);

/** Impressão curta do conteúdo: repetição idêntica de um pacote confirmado não é entregue duas vezes. */
function fnv(b: Uint8Array) { let h = 0x811c9dc5; for (const x of b) h = Math.imul(h ^ x, 0x01000193) >>> 0; return h; }

interface Outgoing { type: PacketType; payload: Uint8Array; env?: string }
interface Inflight { packet: Uint8Array; seq: number; tries: number; deadline: number; sent: boolean; data: boolean; env?: string }

interface Peer {
  addr: number;
  heardAt: number;
  hs: Handshake | null;
  hsAt: number;
  gotHello: boolean;
  link: LinkPort | null;
  queue: Outgoing[];
  queuedBytes: number;
  inflight: Inflight | null;
  nextSeq: number;
  lastRx: { seq: number; sum: number } | null;
  failures: number;
}

export interface SerialStats {
  label: string;
  kind: SerialKind;
  packetsSent: number;
  packetsReceived: number;
  retries: number;
  /** Pacotes desistidos depois de todas as repetições. */
  lost: number;
  /** Ruído, pacote de outro destino ou malformado. */
  ignored: number;
  airtimeMs?: number;
  dutyPercent?: number;
  dutyUsedPercent?: number;
  /** Envios adiados pelo limite de ocupação do canal. */
  dutyWaits?: number;
}

export class SerialAdapter {
  readonly kind: SerialKind;
  readonly maxPacket: number;
  private readonly medium: TransportClass;
  private readonly caps: { mtu: number; media: number };
  private decoder: KissDecoder;
  private peers = new Map<number, Peer>();
  private acks: Uint8Array[] = [];
  private beaconDue = 0;
  private busyUntil = 0;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private seq = 0;
  private rr = 0;
  private duty: DutyCycle | null;
  private now: () => number;
  private rand: () => number;
  private readonly addr: number;
  readonly counters = { packetsSent: 0, packetsReceived: 0, retries: 0, lost: 0, ignored: 0, airtimeMs: 0, dutyWaits: 0 };

  constructor(private engine: RelayEngine, private o: SerialOptions) {
    this.kind = o.kind;
    this.maxPacket = o.kind === 'lora' ? LORA_MAX_PACKET : USB_MAX_PACKET;
    this.medium = o.kind === 'lora' ? 'lora' : 'eth';
    this.caps = { mtu: this.maxPacket - HEADER, media: o.kind === 'lora' ? Medium.Lora : Medium.Usb };
    this.decoder = new KissDecoder(this.maxPacket);
    this.duty = o.kind === 'lora' ? new DutyCycle(o.dutyPercent ?? 10) : null;
    this.now = o.now ?? Date.now;
    this.rand = o.random ?? Math.random;
    this.addr = shortAddr(engine.tag);
  }

  private get radio(): LoraParams { return this.o.radio ?? { sf: 9, bwKHz: 125, cr: 5 }; }
  /** Tempo que o pacote ocupa o meio (USB: desprezível). */
  airtime(bytes: number) { return this.kind === 'lora' ? loraAirtimeMs(bytes, this.radio) : 0; }
  private get beaconMs() { return this.o.beaconMs ?? (this.kind === 'lora' ? 30_000 : 5_000); }
  private get linkTimeoutMs() { return this.o.linkTimeoutMs ?? (this.kind === 'lora' ? 10 * 60_000 : 30_000); }
  private get hsTimeoutMs() { return this.o.handshakeTimeoutMs ?? (this.kind === 'lora' ? 60_000 : 5_000); }
  private get retries() { return this.o.retries ?? 4; }
  /** Fila por vizinho: no LoRa, cerca de dois envelopes pequenos. */
  private get queueLimit() { return this.kind === 'lora' ? 2 * (this.o.maxEnvelope ?? 1536) : 256 * 1024; }

  start() {
    this.o.modem.onData(chunk => { for (const f of this.decoder.push(chunk)) this.onPacket(f); });
    this.beaconDue = this.now() + Math.floor(this.rand() * 1000);
    this.timer = setInterval(() => this.pump(), this.o.pollMs ?? (this.kind === 'lora' ? 25 : 5));
    this.timer.unref();
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    for (const p of this.peers.values()) this.dropLink(p);
    await this.o.modem.close();
  }

  stats(): SerialStats {
    const c = this.counters;
    const base: SerialStats = { label: this.o.modem.label, kind: this.kind, packetsSent: c.packetsSent, packetsReceived: c.packetsReceived, retries: c.retries, lost: c.lost, ignored: c.ignored + this.decoder.dropped };
    if (!this.duty) return base;
    return { ...base, airtimeMs: Math.round(c.airtimeMs), dutyPercent: this.o.dutyPercent ?? 10, dutyUsedPercent: Math.round((this.duty.used(this.now()) / 3_600_000) * 10000) / 100, dutyWaits: c.dutyWaits };
  }

  // ── recepção ────────────────────────────────────────────

  private peer(addr: number): Peer {
    let p = this.peers.get(addr);
    if (!p) {
      p = { addr, heardAt: this.now(), hs: null, hsAt: 0, gotHello: false, link: null, queue: [], queuedBytes: 0, inflight: null, nextSeq: Math.floor(this.rand() * 256), lastRx: null, failures: 0 };
      this.peers.set(addr, p);
    }
    return p;
  }

  private onPacket(bytes: Uint8Array) {
    const pk = decodePacket(bytes);
    if (!pk || pk.src === this.addr || (pk.dst !== this.addr && pk.dst !== BROADCAST)) { this.counters.ignored++; return; }
    this.counters.packetsReceived++;
    if (pk.type === PacketType.Beacon) { this.onBeacon(pk); return; }
    const p = this.peer(pk.src);
    p.heardAt = this.now();
    if (pk.type === PacketType.Ack) {
      if (p.inflight?.sent && p.inflight.seq === pk.seq) { p.inflight = null; p.failures = 0; }
      return;
    }
    // DADOS sem sessão (este nó reiniciou ou o enlace caiu): não confirma, para o outro lado não dar
    // como entregue, e avisa para ele refazer o handshake.
    if (pk.type === PacketType.Data && !p.link) {
      if (!p.hs && !p.queue.some(x => x.type === PacketType.Handshake)) this.enqueue(p, PacketType.Handshake, errorFrame(LnnpErrorCode.State, 'sem sessão'));
      return;
    }
    // Confiáveis: confirma sempre (o ACK anterior pode ter se perdido) e entrega uma vez só.
    this.acks.push(encodePacket({ type: PacketType.Ack, dst: pk.src, src: this.addr, seq: pk.seq, payload: new Uint8Array(0) }));
    const sum = fnv(pk.payload);
    if (p.lastRx && p.lastRx.seq === pk.seq && p.lastRx.sum === sum) return;
    p.lastRx = { seq: pk.seq, sum };
    try {
      if (pk.type === PacketType.Hello) this.onHello(p, pk.payload);
      else if (pk.type === PacketType.Handshake) this.onAuth(p, pk.payload);
      else if (pk.type === PacketType.Data) this.onData(p, pk.payload);
    } catch (e) {
      this.failHandshake(p, e instanceof Error ? e.message : 'erro');
    }
  }

  private onBeacon(pk: Packet) {
    const b = decodeBeacon(pk.payload);
    if (!b || shortAddr(b.tag) !== pk.src) { this.counters.ignored++; return; }
    const p = this.peer(pk.src);
    p.heardAt = this.now();
    if (b.maxVersion < LNNP_MIN_VERSION || b.minVersion > LNNP_VERSION) return;
    if (p.link || p.hs) return;
    if (!this.initiates(p)) return;                       // o outro (endereço menor) começa
    if (this.engine.hasPeerTag(b.tag)) return;            // já conectado por outro meio
    this.startHandshake(p);
  }

  /** Quem começa o handshake com este vizinho: o de endereço curto menor. */
  private initiates(p: Peer) { return this.addr < p.addr; }

  private startHandshake(p: Peer) {
    p.hs = new Handshake(this.engine.handshakeOptions(this.caps));
    p.hsAt = this.now();
    p.gotHello = false;
    this.enqueue(p, PacketType.Hello, p.hs.hello);
  }

  private onHello(p: Peer, frame: Uint8Array) {
    if (this.initiates(p)) {
      // Resposta ao meu HELLO. Sem tentativa em andamento (ou já respondida), é de uma tentativa velha.
      if (!p.hs || p.gotHello) { this.counters.ignored++; return; }
    } else {
      // O vizinho começou (ou recomeçou): começa do zero e responde HELLO antes do AUTH.
      this.clearHandshakeQueue(p);
      p.hs = new Handshake(this.engine.handshakeOptions(this.caps));
      p.hsAt = this.now();
      this.enqueue(p, PacketType.Hello, p.hs.hello);
    }
    const auth = p.hs.receiveHello(frame);
    p.gotHello = true;
    this.enqueue(p, PacketType.Handshake, auth);
  }

  private onAuth(p: Peer, frame: Uint8Array) {
    if (frame[0] === FrameType.Error) {
      // O vizinho recusou o handshake ou não tem mais a sessão (reiniciou): refaz no próximo anúncio.
      if (p.hs) this.failHandshake(p, 'recusado pelo vizinho');
      else if (p.link) this.dropLink(p);
      return;
    }
    if (!p.hs) { this.counters.ignored++; return; }
    let session;
    try { session = p.hs.receiveAuth(frame); } catch { this.counters.ignored++; return; } // AUTH de tentativa antiga: espera o certo
    p.hs = null;
    // Vizinho que reiniciou: o enlace novo (autenticado) substitui o antigo.
    if (p.link) this.dropLink(p);
    const address = `${this.kind}:${this.o.modem.label}#${p.addr.toString(16).padStart(8, '0')}`;
    const link: LinkPort = {
      id: `${session.peerId}#${this.kind}${++this.seq}`, session, medium: this.medium, inbound: compareBytes(this.engine.node.pk, session.peerPk) > 0,
      address, since: this.now(), caps: this.caps,
      send: (rec, env) => this.enqueue(p, PacketType.Data, rec, env),
      close: () => this.dropLink(p),
      capacity: () => this.queueLimit - p.queuedBytes,
      maxEnvelope: this.kind === 'lora' ? (this.o.maxEnvelope ?? 1536) : undefined,
    };
    p.link = link;
    // Já conectado a este nó por outro meio: avisa o vizinho para ele também fechar este.
    if (!this.engine.attach(link)) { p.link = null; this.enqueue(p, PacketType.Data, session.seal(FrameType.Close)); }
  }

  private onData(p: Peer, record: Uint8Array) {
    const link = p.link;
    if (!link) return;
    let frame;
    try { frame = link.session.open(record); } catch { this.counters.ignored++; return; } // registro velho ou adulterado: só descarta
    this.engine.receive(link.id, frame);
  }

  private failHandshake(p: Peer, reason: string) {
    if (!p.hs) return;
    p.hs = null;
    this.clearHandshakeQueue(p);
    this.engine.handshakeFailed(`${this.kind}: ${reason}`);
  }

  private clearHandshakeQueue(p: Peer) {
    p.queue = p.queue.filter(x => x.type === PacketType.Data);
    if (p.inflight && !p.inflight.data) p.inflight = null;
  }

  private dropLink(p: Peer) {
    const l = p.link;
    if (!l) return;
    p.link = null;
    // O que estava na fila não chegou: volta para o roteador mandar de novo (este ou outro enlace).
    const lost = new Set<string>();
    for (const x of p.queue) if (x.env) lost.add(x.env);
    if (p.inflight?.data && p.inflight.env) lost.add(p.inflight.env);
    for (const id of lost) this.engine.undelivered(l.session.peerId, id);
    p.queue = p.queue.filter(x => x.type !== PacketType.Data); p.queuedBytes = 0;
    if (p.inflight?.data) p.inflight = null;
    this.engine.detach(l.id);
  }

  // ── envio ───────────────────────────────────────────────

  private enqueue(p: Peer, type: PacketType, payload: Uint8Array, env?: string) {
    if (HEADER + payload.length > this.maxPacket) { this.counters.lost++; return; } // não deveria acontecer (MTU negociada)
    p.queue.push({ type, payload, env });
    if (type === PacketType.Data) p.queuedBytes += payload.length;
  }

  private transmit(packet: Uint8Array, now: number): boolean {
    const at = this.airtime(packet.length);
    if (this.duty && !this.duty.allows(at, now)) { this.counters.dutyWaits++; return false; }
    this.duty?.spend(at, now);
    this.counters.airtimeMs += at;
    this.counters.packetsSent++;
    this.o.modem.write(kissEncode(packet));
    // Meio compartilhado: espera o pacote sair e um pouco mais, ao acaso, para não colidir com vizinhos.
    this.busyUntil = now + at + (this.kind === 'lora' ? this.rand() * (at / 2 + 20) : 0);
    return true;
  }

  /** Quanto esperar o ACK: o pacote no ar, a resposta no ar e a folga de quem recebe. */
  private ackWait(bytes: number, tries: number) {
    const base = this.airtime(bytes) + this.airtime(HEADER) * 2 + (this.kind === 'lora' ? 250 : 100);
    return base * (1 + tries) + this.rand() * base;
  }

  private pump() {
    if (this.stopped) return;
    const now = this.now();
    this.housekeeping(now);
    if (now < this.busyUntil) return;
    // 1. Confirmações primeiro (curtas; sempre passam, para o outro lado não repetir à toa).
    const ack = this.acks.shift();
    if (ack) {
      this.counters.packetsSent++; this.counters.airtimeMs += this.airtime(ack.length);
      this.duty?.spend(this.airtime(ack.length), now);
      this.o.modem.write(kissEncode(ack));
      this.busyUntil = now + this.airtime(ack.length);
      return;
    }
    // 2. Anúncio.
    if (now >= this.beaconDue) {
      const b = encodePacket({ type: PacketType.Beacon, dst: BROADCAST, src: this.addr, seq: 0,
        payload: encodeBeacon({ minVersion: LNNP_MIN_VERSION, maxVersion: LNNP_VERSION, port: this.maxPacket, tag: this.engine.tag, relay: this.engine.relaying }) });
      if (this.transmit(b, now)) this.beaconDue = now + this.beaconMs * (0.9 + this.rand() * 0.2);
      return;
    }
    // 3. Um pacote confiável por vez, revezando entre os vizinhos.
    const peers = [...this.peers.values()];
    for (let i = 0; i < peers.length; i++) {
      const p = peers[(this.rr + i) % peers.length]!;
      const f = this.nextReliable(p, now);
      if (!f) continue;
      if (!this.transmit(f.packet, now)) return;
      if (f.sent) this.counters.retries++;
      f.sent = true;
      f.tries++;
      f.deadline = now + this.ackWait(f.packet.length, f.tries);
      this.rr = (this.rr + i + 1) % Math.max(1, peers.length);
      return;
    }
  }

  /** O pacote confiável deste vizinho que pode sair agora (novo ou repetição vencida). */
  private nextReliable(p: Peer, now: number): Inflight | null {
    if (p.inflight) {
      if (!p.inflight.sent) return p.inflight;
      if (now < p.inflight.deadline) return null;
      if (p.inflight.tries <= this.retries) return p.inflight;
      // Desistiu deste pacote. O registro LNNP tolera a lacuna; o handshake recomeça depois.
      this.counters.lost++;
      p.failures++;
      const wasHs = !p.inflight.data;
      if (p.inflight.env && p.link) this.engine.undelivered(p.link.session.peerId, p.inflight.env);
      p.inflight = null;
      if (wasHs && p.hs) { this.failHandshake(p, 'vizinho não respondeu'); return null; }
      if (p.failures >= 3 && p.link) { this.dropLink(p); return null; }
    }
    const next = p.queue.shift();
    if (!next) return null;
    if (next.type === PacketType.Data) p.queuedBytes -= next.payload.length;
    const seq = p.nextSeq; p.nextSeq = (p.nextSeq + 1) & 0xff;
    p.inflight = { packet: encodePacket({ type: next.type, dst: p.addr, src: this.addr, seq, payload: next.payload }), seq, tries: 0, deadline: 0, sent: false, data: next.type === PacketType.Data, env: next.env };
    return p.inflight;
  }

  private housekeeping(now: number) {
    for (const p of this.peers.values()) {
      if (p.hs && now - p.hsAt > this.hsTimeoutMs) this.failHandshake(p, 'tempo esgotado');
      if (p.link && now - p.heardAt > this.linkTimeoutMs) this.dropLink(p);
      // Vizinho sumido há muito tempo e sem nada pendente: esquece.
      if (!p.link && !p.hs && !p.inflight && !p.queue.length && now - p.heardAt > 2 * this.linkTimeoutMs) this.peers.delete(p.addr);
    }
  }
}

// ── porta serial de verdade ─────────────────────────────────

const run = promisify(execFile);

/**
 * Abre a porta serial sem dependência nativa: `stty` põe a linha em modo cru (no OpenWrt, o do
 * busybox) e o terminal é lido e escrito pelo laço de eventos do Node (`tty`), sem bloquear uma
 * thread: o nó fecha na hora mesmo com o rádio mudo.
 */
export async function openSerialModem(path: string, baud: number): Promise<Modem> {
  const flag = process.platform === 'darwin' ? '-f' : '-F';
  await run('stty', [flag, path, String(baud), 'raw', '-echo', '-echoe', '-echok', '-ixon', '-ixoff', 'cs8', '-cstopb', '-parenb', 'clocal']);
  const rfd = openSync(path, constants.O_RDWR | constants.O_NOCTTY);
  if (!isatty(rfd)) { closeSync(rfd); throw new Error(`${path} não é uma porta serial.`); }
  const wfd = openSync(path, constants.O_RDWR | constants.O_NOCTTY);
  const input = new ReadStream(rfd);
  const output = new WriteStream(wfd);
  let closed = false;
  input.on('error', () => {}); output.on('error', () => {});
  return {
    label: path,
    write(bytes) { if (!closed) output.write(bytes); },
    onData(cb) { input.on('data', chunk => cb(new Uint8Array(chunk as Buffer))); },
    close() { if (closed) return; closed = true; input.destroy(); output.destroy(); },
  };
}

/** `lora:/dev/ttyUSB0@115200` → tipo, caminho e velocidade. */
export function parseSerialSpec(s: string): { kind: SerialKind; path: string; baud: number } {
  const m = /^(lora|usb):([^@]+)(?:@(\d+))?$/.exec(s.trim());
  if (!m) throw new Error(`PIU_SERIAL: use tipo:caminho@velocidade, ex.: lora:/dev/ttyUSB0@115200 (recebido: ${s})`);
  return { kind: m[1] as SerialKind, path: m[2]!, baud: Number(m[3] ?? 115200) };
}
