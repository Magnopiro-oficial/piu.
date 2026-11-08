/**
 * Super Node no canal Meshtastic (docs/transporte/super-node-lora.md, caminho A): um rádio Meshtastic no
 * USB, pela API serial de cliente. O nó entra na mesma malha que os celulares usam (porta 256, canal 0,
 * pedaços "P1"), como a malha aberta `lora:mesh` do motor, e anuncia a si mesmo ("PN") a cada 15 min.
 *
 * Quadro da serial: `0x94 0xC3 · tamanho u16 (big-endian) · ToRadio/FromRadio`, até 512 bytes. O que vier
 * fora de quadro (log de depuração do firmware) é ignorado.
 */
import { BROADCAST, decodeFromRadio, encodeToRadioPacket, encodeWantConfig, PRIVATE_APP } from '../meshtastic/proto.js';
import { FRAGMENT_BYTES, LORA_MAX_ENVELOPE, Reassembler, splitEnvelope } from '../meshtastic/fragments.js';
import { AirtimeBudget } from '../meshtastic/budget.js';
import { decodeNodeBeacon, encodeNodeBeacon, NodeSightings } from '../meshtastic/nodeBeacon.js';
import type { KeyPair } from '../protocol/keys.js';
import type { MeshPort, RelayEngine } from './engine.js';
import type { Modem } from './serial.js';

const START1 = 0x94, START2 = 0xc3, MAX_FRAME = 512;
export const MESH_PEER = 'lora:mesh';
/** ToRadio{heartbeat: {}}: mantém a API serial aberta (o firmware fecha depois de 15 min calado). */
const HEARTBEAT = Uint8Array.of(0x3a, 0x00);

export function encodeStreamFrame(proto: Uint8Array): Uint8Array {
  if (proto.length > MAX_FRAME) throw new Error('Quadro grande demais para a serial do Meshtastic.');
  const b = new Uint8Array(4 + proto.length);
  b[0] = START1; b[1] = START2; b[2] = proto.length >> 8; b[3] = proto.length & 0xff;
  b.set(proto, 4);
  return b;
}

/** Separa os quadros da serial; bytes soltos entre eles são descartados. */
export class StreamDecoder {
  private buf: number[] = [];
  push(bytes: Uint8Array): Uint8Array[] {
    const out: Uint8Array[] = [];
    for (const x of bytes) this.buf.push(x);
    for (;;) {
      const i = this.buf.findIndex((x, k) => x === START1 && this.buf[k + 1] === START2);
      if (i < 0) { this.buf = this.buf.slice(-1).filter(x => x === START1); break; }
      if (i > 0) this.buf = this.buf.slice(i);
      if (this.buf.length < 4) break;
      const len = (this.buf[2]! << 8) | this.buf[3]!;
      if (len > MAX_FRAME) { this.buf = this.buf.slice(2); continue; }
      if (this.buf.length < 4 + len) break;
      out.push(Uint8Array.from(this.buf.slice(4, 4 + len)));
      this.buf = this.buf.slice(4 + len);
    }
    return out;
  }
}

export interface MeshtasticOptions {
  modem: Modem;
  /** Chave técnica do nó: assina o anúncio "PN". */
  node: KeyPair;
  /** Tempo de rádio: pedaços por minuto e rajada (nó fixo, um pouco mais folgado que o celular). */
  perMinute?: number;
  burst?: number;
  /** Intervalo do anúncio (ms). */
  beaconMs?: number;
  /** Retransmite agora / é gateway (vai no anúncio). */
  roles?: () => { relay: boolean; gateway: boolean };
  now?: () => number;
  tickMs?: number;
  log?: (m: string) => void;
}

export interface MeshtasticStats {
  kind: 'meshtastic'; path: string; state: 'configuring' | 'up';
  myNode: number | null; nodesHeard: number; superNodes: number;
  sent: number; received: number; busy: number;
}

export class MeshtasticAdapter {
  private dec = new StreamDecoder();
  private re = new Reassembler();
  private sightings = new NodeSightings();
  private budget: AirtimeBudget;
  private readonly burst: number;
  private nodes = new Set<number>();
  private configId = (Math.random() * 0xffffffff) >>> 0 || 1;
  private myNode: number | null = null;
  private up = false;
  private nextId = (Math.random() * 0xffffffff) >>> 0;
  private timers: ReturnType<typeof setInterval>[] = [];
  private st = { sent: 0, received: 0, busy: 0 };
  private port: MeshPort;

  constructor(private readonly engine: RelayEngine, private readonly o: MeshtasticOptions) {
    this.burst = o.burst ?? 8;
    this.budget = new AirtimeBudget({ perMinute: o.perMinute ?? 6, burst: this.burst });
    const self = this;
    this.port = {
      id: MESH_PEER, medium: 'lora', address: o.modem.label, since: this.now(), maxEnvelope: LORA_MAX_ENVELOPE,
      capacity: () => self.capacity(),
      send: env => self.sendEnvelope(env),
    };
  }

  private now() { return this.o.now?.() ?? Date.now(); }
  private write(proto: Uint8Array) { this.o.modem.write(encodeStreamFrame(proto)); }

  start() {
    this.o.modem.onData(b => { for (const f of this.dec.push(b)) this.onFrame(f); });
    // Acorda a serial do firmware (bytes START2 soltos) e pede a configuração.
    this.o.modem.write(new Uint8Array(32).fill(START2));
    this.write(encodeWantConfig(this.configId));
    const tick = setInterval(() => { if (this.up) this.engine.flushMesh(this.port); }, this.o.tickMs ?? 5000);
    const beat = setInterval(() => this.write(HEARTBEAT), 5 * 60_000);
    const beacon = setInterval(() => this.beacon(), this.o.beaconMs ?? 15 * 60_000);
    for (const t of [tick, beat, beacon]) { t.unref?.(); this.timers.push(t); }
  }

  async stop() {
    this.timers.splice(0).forEach(clearInterval);
    if (this.up) this.engine.detachMesh(MESH_PEER);
    this.up = false;
    await this.o.modem.close();
  }

  /**
   * Bytes que cabem no tempo de rádio agora (pedaços inteiros). É uma estimativa: o que passar dela é
   * recusado em `sendEnvelope` e volta para a fila do roteador até a próxima rodada.
   */
  private capacity(): number {
    let k = 0;
    while (k < this.burst && this.budget.waitMs(k + 1, this.now()) === 0) k++;
    return k * FRAGMENT_BYTES;
  }

  private sendEnvelope(env: Uint8Array): boolean {
    let parts: Uint8Array[];
    try { parts = splitEnvelope(env, this.nextId++); } catch { return false; }
    if (!this.budget.take(parts.length, this.now())) { this.st.busy++; return false; }
    for (const p of parts) this.write(encodeToRadioPacket({ payload: p, id: this.nextId++ }));
    this.st.sent++;
    return true;
  }

  /** Anúncio "PN": fora do balde dos envelopes (um pacote a cada 15 min). */
  private beacon() {
    if (!this.up) return;
    const roles = this.o.roles?.() ?? { relay: true, gateway: false };
    this.write(encodeToRadioPacket({ payload: encodeNodeBeacon(this.o.node, { at: Math.floor(this.now() / 1000), ...roles }), id: this.nextId++ }));
  }

  private onFrame(b: Uint8Array) {
    let m;
    try { m = decodeFromRadio(b); } catch { return; }
    if (m.myNodeNum !== undefined) this.myNode = m.myNodeNum;
    if (m.node?.num) this.nodes.add(m.node.num);
    if (m.configCompleteId === this.configId && !this.up) {
      this.up = true;
      this.o.log?.(`Meshtastic: rádio ${this.o.modem.label} pronto (nó ${this.myNode?.toString(16) ?? '?'})`);
      this.engine.attachMesh(this.port);
      this.beacon();
    }
    const p = m.packet;
    if (!p || p.portnum !== PRIVATE_APP || !p.payload || (p.from !== undefined && p.from === this.myNode)) return;
    if (p.to !== undefined && p.to !== BROADCAST) return;
    if (p.from !== undefined) this.nodes.add(p.from);
    const sec = Math.floor(this.now() / 1000);
    const beacon = decodeNodeBeacon(p.payload, sec);
    if (beacon) { this.sightings.saw(beacon, sec); return; }
    const env = this.re.push(p.payload, this.now());
    if (!env) return;
    this.st.received++;
    this.engine.receiveMesh(MESH_PEER, env);
  }

  stats(): MeshtasticStats {
    const me = this.myNode;
    return {
      kind: 'meshtastic', path: this.o.modem.label, state: this.up ? 'up' : 'configuring', myNode: me,
      nodesHeard: [...this.nodes].filter(n => n !== me).length, superNodes: this.sightings.near(Math.floor(this.now() / 1000)).length, ...this.st,
    };
  }
}
