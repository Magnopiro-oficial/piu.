/**
 * Super Node com LoRa próprio (docs/transporte/super-node-lora.md, caminho B): um rádio com firmware RNode
 * no USB, configurado pelo Piu a cada conexão com o canal da região (`piuRadio`). No ar passam os mesmos
 * pedaços "P1" e o mesmo anúncio "PN" do caminho A, um por pacote, sem o cabeçalho do Meshtastic. Para o
 * motor é a malha aberta `lora:piu`; com um rádio Meshtastic também ligado, o roteador manda cada envelope
 * uma vez para cada malha, e o nó vira ponte entre as duas redes.
 */
import { FRAGMENT_BYTES, LORA_MAX_ENVELOPE, Reassembler, splitEnvelope } from '../meshtastic/fragments.js';
import { AirtimeBudget } from '../meshtastic/budget.js';
import { decodeNodeBeacon, encodeNodeBeacon, NodeSightings } from '../meshtastic/nodeBeacon.js';
import type { KeyPair } from '../protocol/keys.js';
import type { PiuRadio } from '../rnode/regions.js';
import { CMD, configFrames, KissReader, kissFrame, RNodeSetup, type RNodeState } from '../rnode/rnode.js';
import type { MeshPort, RelayEngine } from './engine.js';
import type { Modem } from './serial.js';

export const PIU_PEER = 'lora:piu';

export interface RNodeOptions {
  modem: Modem;
  /** Chave técnica do nó: assina o anúncio "PN". */
  node: KeyPair;
  /** Canal, potência e tempo no ar da região. */
  radio: PiuRadio;
  /** Intervalo do anúncio (ms). */
  beaconMs?: number;
  /** Sem resposta certa do rádio, configura de novo depois deste tempo (ms). */
  retryMs?: number;
  roles?: () => { relay: boolean; gateway: boolean };
  now?: () => number;
  tickMs?: number;
  log?: (m: string) => void;
}

export interface RNodeStats {
  kind: 'rnode'; path: string; region: string; freqHz: number; state: RNodeState; problem: string | null;
  superNodes: number; sent: number; received: number; busy: number;
}

export class RNodeAdapter {
  private rd = new KissReader();
  private re = new Reassembler();
  private sightings = new NodeSightings();
  private setup: RNodeSetup;
  private configuredAt = 0;
  private budget: AirtimeBudget;
  private readonly burst: number;
  private nextId = (Math.random() * 0xffffffff) >>> 0;
  private timers: ReturnType<typeof setInterval>[] = [];
  private st = { sent: 0, received: 0, busy: 0 };
  private port: MeshPort;

  constructor(private readonly engine: RelayEngine, private readonly o: RNodeOptions) {
    // Tempo de rádio do nó fixo (6 pedaços/min, rajada 8 com 10 % no ar), proporcional ao limite da região.
    const share = Math.min(10, o.radio.airtimePct) / 10;
    this.burst = Math.max(2, Math.round(8 * share));
    this.budget = new AirtimeBudget({ perMinute: Math.max(1, Math.round(6 * share)), burst: this.burst });
    this.setup = new RNodeSetup(o.radio);
    const self = this;
    this.port = {
      id: PIU_PEER, medium: 'lora', address: o.modem.label, since: this.now(), maxEnvelope: LORA_MAX_ENVELOPE,
      capacity: () => self.capacity(),
      send: env => self.sendEnvelope(env),
    };
  }

  private now() { return this.o.now?.() ?? Date.now(); }
  private get up() { return this.setup.state === 'up'; }

  start() {
    this.o.modem.onData(b => { for (const c of this.rd.push(b)) this.onCommand(c.cmd, c.data); });
    this.configure();
    const tick = setInterval(() => this.tick(), this.o.tickMs ?? 5000);
    const beacon = setInterval(() => this.beacon(), this.o.beaconMs ?? 15 * 60_000);
    for (const t of [tick, beacon]) { t.unref?.(); this.timers.push(t); }
  }

  async stop() {
    this.timers.splice(0).forEach(clearInterval);
    this.down();
    await this.o.modem.close();
  }

  /** Rodada: entrega à malha e, sem o rádio pronto, configura de novo depois de `retryMs`. */
  tick() {
    if (this.up) { this.engine.flushMesh(this.port); return; }
    if (this.now() - this.configuredAt >= (this.o.retryMs ?? 60_000)) this.configure();
  }

  private configure() {
    this.setup = new RNodeSetup(this.o.radio);
    this.configuredAt = this.now();
    for (const f of configFrames(this.o.radio)) this.o.modem.write(f);
  }

  private down() { this.engine.detachMesh(PIU_PEER); }

  private capacity(): number {
    let k = 0;
    while (k < this.burst && this.budget.waitMs(k + 1, this.now()) === 0) k++;
    return k * FRAGMENT_BYTES;
  }

  private sendEnvelope(env: Uint8Array): boolean {
    let parts: Uint8Array[];
    try { parts = splitEnvelope(env, this.nextId++); } catch { return false; }
    if (!this.budget.take(parts.length, this.now())) { this.st.busy++; return false; }
    for (const p of parts) this.o.modem.write(kissFrame(CMD.DATA, p));
    this.st.sent++;
    return true;
  }

  /** Anúncio "PN": fora do balde dos envelopes (um pacote a cada 15 min). */
  private beacon() {
    if (!this.up) return;
    const roles = this.o.roles?.() ?? { relay: true, gateway: false };
    this.o.modem.write(kissFrame(CMD.DATA, encodeNodeBeacon(this.o.node, { at: Math.floor(this.now() / 1000), ...roles })));
  }

  private onCommand(cmd: number, data: Uint8Array) {
    if (cmd !== CMD.DATA) {
      const was = this.setup.state;
      this.setup.push(cmd, data);
      if (was !== 'up' && this.up) {
        const r = this.o.radio;
        this.o.log?.(`RNode: rádio ${this.o.modem.label} pronto (${r.region}, ${(r.freqHz / 1e6).toFixed(3)} MHz, ${r.txDbm} dBm)`);
        this.engine.attachMesh(this.port);
        this.beacon();
      } else if (was !== 'failed' && this.setup.state === 'failed') {
        this.o.log?.(`RNode: ${this.o.modem.label}: ${this.setup.problem}`);
        if (was === 'up') this.down();
      }
      return;
    }
    if (!this.up) return;
    const sec = Math.floor(this.now() / 1000);
    const beacon = decodeNodeBeacon(data, sec);
    if (beacon) {
      if (beacon.pk.every((x, i) => x === this.o.node.pk[i])) return;
      this.sightings.saw(beacon, sec);
      return;
    }
    const env = this.re.push(data, this.now());
    if (!env) return;
    this.st.received++;
    this.engine.receiveMesh(PIU_PEER, env);
  }

  stats(): RNodeStats {
    const r = this.o.radio;
    return {
      kind: 'rnode', path: this.o.modem.label, region: r.region, freqHz: r.freqHz, state: this.setup.state, problem: this.setup.problem,
      superNodes: this.sightings.near(Math.floor(this.now() / 1000)).length, ...this.st,
    };
  }
}
