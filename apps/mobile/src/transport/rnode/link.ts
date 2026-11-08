/**
 * O rádio próprio do Piu (RNode) como um meio do app (`piulora`, docs/transporte/super-node-lora.md,
 * caminho B). É a mesma malha LoRa que o Meshtastic: o vizinho virtual é o mesmo `lora:mesh`, e com os
 * dois ligados o seletor de enlaces escolhe este (custo 3 contra 4), com o Meshtastic de reserva.
 *
 * A cada conexão o app configura o rádio com o canal da região (`piuRadio`) e só sobe o enlace quando o
 * RNode confirma cada ajuste. No ar passam os pedaços "P1" e o anúncio "PN", um por pacote KISS.
 * Testado em __tests__/piulora.test.ts.
 */
import type { LinkEvent } from '../multi';
import { AirtimeBudget } from '../meshtastic/budget';
import { Reassembler, splitEnvelope } from '../meshtastic/fragments';
import { LORA_PEER, LoraBusyError } from '../meshtastic/link';
import { decodeNodeBeacon, NodeSightings } from '../meshtastic/nodeBeacon';
import { piuRadio, type PiuRadio } from './regions';
import { CMD, configFrames, KissReader, kissFrame, probeFrames, Reconfigures, RNodeSetup } from './rnode';

/** Sem resposta completa do rádio neste tempo, desiste (o Reticulum espera 5 s pela detecção no BLE). */
export const RNODE_ANSWER_MS = 12_000;

/** Bytes crus com o RNode (no app, o serviço Nordic UART do Bluetooth). */
export interface ByteStream {
  write(bytes: Uint8Array): Promise<void>;
  onData(fn: (bytes: Uint8Array) => void): () => void;
}

export type PiuLoraState = 'off' | 'configuring' | 'up' | 'failed';
export type PiuLoraStatus = {
  state: PiuLoraState;
  /** Região do canal (null: a pessoa ainda não escolheu). */
  region: string | null;
  /** Por que o rádio não subiu (ajuste recusado, erro do firmware). */
  problem?: string;
  /** Placa conhecida pelo modelo gravado na memória (ex.: "Heltec LoRa32 v3"). */
  board?: string;
  sent: number; received: number;
  busyUntil?: number;
  superNodes: number; gateways: number;
};

/** Tempo de rádio do celular (o mesmo do Meshtastic: 3 pedaços/min, rajada 4), proporcional à região. */
function budgetFor(r: PiuRadio) {
  const share = Math.min(10, r.airtimePct) / 10;
  return new AirtimeBudget({ perMinute: Math.max(1, Math.round(3 * share)), burst: Math.max(2, Math.round(4 * share)) });
}

export class PiuLoraLink {
  private fns = new Set<(e: LinkEvent) => void>();
  private watchers = new Set<() => void>();
  private port: ByteStream | null = null;
  private off: (() => void) | null = null;
  private rd = new KissReader();
  private setup: RNodeSetup | null = null;
  private radio: PiuRadio | null;
  private budget: AirtimeBudget;
  private st: PiuLoraStatus;
  private readonly re = new Reassembler();
  private readonly sightings = new NodeSightings();

  constructor(private readonly o: { now?: () => number; random32?: () => number; region?: string | null; answerMs?: number } = {}) {
    this.radio = o.region ? piuRadio(o.region) : null;
    this.budget = this.radio ? budgetFor(this.radio) : new AirtimeBudget();
    this.st = { state: 'off', region: this.radio?.region ?? null, sent: 0, received: 0, superNodes: 0, gateways: 0 };
  }
  private now() { return this.o.now?.() ?? Date.now(); }
  private rnd() { return (this.o.random32?.() ?? Math.floor(Math.random() * 2 ** 32)) >>> 0; }

  status(): PiuLoraStatus { return { ...this.st }; }
  onChange(fn: () => void) { this.watchers.add(fn); return () => { this.watchers.delete(fn); }; }
  subscribe(fn: (e: LinkEvent) => void) { this.fns.add(fn); return () => { this.fns.delete(fn); }; }
  private emit(e: LinkEvent) { this.fns.forEach(f => f(e)); }
  private set(p: Partial<PiuLoraStatus>) { this.st = { ...this.st, ...p }; this.watchers.forEach(f => f()); }

  async attach(port: ByteStream) {
    this.detach();
    this.port = port;
    this.rd = new KissReader();
    this.off = port.onData(b => { for (const c of this.rd.push(b)) this.onCommand(c.cmd, c.data); });
    this.sightings.clear();
    this.set({ superNodes: 0, gateways: 0 });
    this.emit({ type: 'state', state: 'starting' });
    await this.configure();
  }

  /** Troca o canal (a pessoa escolheu outra região): reconfigura o rádio, se estiver conectado. */
  async setRegion(id: string) {
    this.radio = piuRadio(id);
    this.budget = budgetFor(this.radio);
    this.set({ region: this.radio.region });
    if (this.port) await this.configure();
  }

  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly reconf = new Reconfigures();

  /** Pergunta quem é a placa; a configuração vai quando ela responde (onCommand, 'probed'). */
  private async configure() {
    if (!this.port) return;
    if (!this.radio) { this.fail('escolha a região do rádio'); return; }
    this.down();
    this.setup = new RNodeSetup(this.radio);
    this.set({ state: 'configuring', problem: undefined });
    this.clearTimer();
    const setup = this.setup;
    this.timer = setTimeout(() => { if (this.setup === setup && setup.state !== 'up' && setup.state !== 'failed') this.fail('o rádio não respondeu'); }, this.o.answerMs ?? RNODE_ANSWER_MS);
    for (const f of probeFrames()) await this.port.write(f);
  }

  private clearTimer() { if (this.timer) clearTimeout(this.timer); this.timer = null; }

  private fail(problem: string) {
    this.clearTimer();
    this.down();
    this.set({ state: 'failed', problem });
  }

  /** O vizinho virtual cai (o rádio continua conectado). */
  private down() {
    if (this.st.state !== 'up') return;
    this.emit({ type: 'down', medium: 'piulora', id: LORA_PEER });
    this.emit({ type: 'lost', medium: 'piulora', id: LORA_PEER });
  }

  detach() {
    this.down();
    this.clearTimer();
    this.off?.(); this.off = null; this.port = null; this.setup = null;
    if (this.st.state !== 'off') this.set({ state: 'off', problem: undefined });
    this.emit({ type: 'state', state: 'off' });
  }

  /** Quanto falta para caber um envelope deste tamanho no orçamento de rádio (0 = já). */
  waitMs(bytes: number): number {
    try { return this.budget.waitMs(splitEnvelope(new Uint8Array(bytes), 0).length, this.now()); } catch { return Infinity; }
  }

  async send(id: string, env: Uint8Array): Promise<void> {
    if (id !== LORA_PEER || !this.port || this.st.state !== 'up') throw new Error('Rádio LoRa do Piu desconectado.');
    const msgId = this.rnd();
    const parts = splitEnvelope(env, msgId); // grande demais: lança, e o roteador tenta outro meio
    const now = this.now();
    if (!this.budget.take(parts.length, now)) {
      const wait = this.budget.waitMs(parts.length, now);
      this.set({ busyUntil: now + wait });
      throw new LoraBusyError(wait);
    }
    this.re.sent(msgId, now);
    for (const p of parts) await this.port.write(kissFrame(CMD.DATA, p));
    this.set({ sent: this.st.sent + 1, busyUntil: undefined });
  }

  private onCommand(cmd: number, data: Uint8Array) {
    const s = this.setup;
    if (!s) return;
    if (cmd !== CMD.DATA) {
      const was = s.state;
      const next = s.push(cmd, data);
      if (next === 'probed' && this.port && this.radio) {
        if (s.board.product) this.set({ board: s.board.product });
        const port = this.port;
        void (async () => { for (const f of configFrames(this.radio!)) await port.write(f); })().catch(() => {});
        return;
      }
      if (next === 'reconfigure') {
        if (this.reconf.allow(this.now())) void this.configure().catch(() => {});
        else this.fail('erro do RNode 0x02');
        return;
      }
      if (was !== 'up' && s.state === 'up') {
        this.clearTimer();
        this.set({ state: 'up' });
        this.emit({ type: 'state', state: 'running' });
        this.emit({ type: 'found', medium: 'piulora', id: LORA_PEER, name: 'Malha LoRa' });
        this.emit({ type: 'up', medium: 'piulora', id: LORA_PEER, name: 'Malha LoRa' });
      } else if (was !== 'failed' && s.state === 'failed') this.fail(s.problem ?? 'erro do rádio');
      return;
    }
    if (this.st.state !== 'up') return;
    const sec = Math.floor(this.now() / 1000);
    const beacon = decodeNodeBeacon(data, sec);
    if (beacon) { this.sightings.saw(beacon, sec); this.syncNodes(); return; }
    const env = this.re.push(data, this.now());
    if (!env) return;
    this.set({ received: this.st.received + 1 });
    this.emit({ type: 'data', medium: 'piulora', id: LORA_PEER, data: env });
  }

  private syncNodes() {
    const near = this.sightings.near(Math.floor(this.now() / 1000));
    const n = near.length, g = near.filter(b => b.gateway).length;
    if (n !== this.st.superNodes || g !== this.st.gateways) this.set({ superNodes: n, gateways: g });
  }
  refreshNodes() { this.syncNodes(); }
}
