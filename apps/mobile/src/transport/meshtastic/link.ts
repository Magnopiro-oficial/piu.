/**
 * O rádio Meshtastic como um meio do Piu (`lora`): a malha LoRa inteira aparece como UM vizinho virtual,
 * `lora:mesh`. Enviar = transmitir os pedaços do envelope para todos na porta privada; o que chega com a
 * marca do Piu é remontado e entregue ao roteador, que já descarta repetidos. Testado em
 * __tests__/meshtastic.test.ts. Especificação: docs/transporte/piu-sobre-meshtastic.md.
 */
import type { LinkEvent } from '../multi';
import { AirtimeBudget } from './budget';
import { Reassembler, splitEnvelope } from './fragments';
import { decodeNodeBeacon, NodeSightings, type HeardNode } from './nodeBeacon';
import { bandLabel, regionByCode } from '../rnode/regions';
import { decodeFromRadio, encodeToRadioPacket, encodeWantConfig, PRIVATE_APP } from './proto';

export const LORA_PEER = 'lora:mesh';

/** O rádio visto pelo JS: bytes de protobuf indo (ToRadio) e voltando (FromRadio). */
export interface RadioPort {
  write(bytes: Uint8Array): Promise<void>;
  onFromRadio(fn: (bytes: Uint8Array) => void): () => void;
  /** Força a leitura do que o rádio tem guardado. */
  drain?(): Promise<void>;
}

export type LoraState = 'off' | 'configuring' | 'up';
export type LoraStatus = {
  state: LoraState; myNode: number | null; sent: number; received: number;
  /** Bateria do próprio rádio (%; >100 = na tomada), se ele informa. */
  battery?: number;
  /** Nós LoRa que o rádio conhece, fora ele mesmo. */
  nodesHeard: number;
  /** Região do rádio (RegionCode); 0 = não definida. */
  region?: number;
  /** Saltos do último envelope do Piu recebido pelo LoRa. */
  lastHops?: number;
  /** Até quando o rádio está sem orçamento para o que espera na fila (ms); só depois de um envio recusado. */
  busyUntil?: number;
  /** Super Nodes do Piu ouvidos nos últimos 40 min (anúncio "PN" válido), e quantos são gateway. */
  superNodes?: number;
  gateways?: number;
};

/** Faixa da região do rádio para mostrar (tabela mundial, rnode/regions.ts); 0 = não definida. */
export function regionLabel(code: number | undefined): string | null {
  if (code === undefined || code === 0) return null;
  const r = regionByCode(code);
  return r ? bandLabel(r.id) : `região ${code}`;
}

export class LoraBusyError extends Error {
  constructor(readonly waitMs: number) { super(`LoRa ocupado: tente em ${Math.ceil(waitMs / 1000)} s.`); }
}

export class LoraLink {
  private fns = new Set<(e: LinkEvent) => void>();
  private watchers = new Set<() => void>();
  private port: RadioPort | null = null;
  private off: (() => void) | null = null;
  private configId = 0;
  private st: LoraStatus = { state: 'off', myNode: null, sent: 0, received: 0, nodesHeard: 0 };
  private nodes = new Map<number, number | undefined>();
  private readonly re = new Reassembler();
  private readonly sightings = new NodeSightings();

  private readonly budget: AirtimeBudget;

  constructor(private readonly o: { now?: () => number; random32?: () => number; budget?: AirtimeBudget } = {}) {
    this.budget = o.budget ?? new AirtimeBudget();
  }
  private now() { return this.o.now?.() ?? Date.now(); }
  private rnd() { return (this.o.random32?.() ?? Math.floor(Math.random() * 2 ** 32)) >>> 0; }

  status(): LoraStatus { return { ...this.st }; }
  onChange(fn: () => void) { this.watchers.add(fn); return () => { this.watchers.delete(fn); }; }
  subscribe(fn: (e: LinkEvent) => void) { this.fns.add(fn); return () => { this.fns.delete(fn); }; }
  private emit(e: LinkEvent) { this.fns.forEach(f => f(e)); }
  private set(p: Partial<LoraStatus>) { this.st = { ...this.st, ...p }; this.watchers.forEach(f => f()); }

  /** Rádio conectado pelo Bluetooth: pede a configuração; o enlace sobe quando ela termina. */
  /** Pede a configuração de novo (ex.: a pessoa acabou de definir a região no app oficial). */
  async refresh() {
    if (!this.port) return;
    this.configId = this.rnd() || 1;
    await this.port.write(encodeWantConfig(this.configId));
    await this.port.drain?.();
  }

  async attach(port: RadioPort) {
    this.detach();
    this.port = port;
    this.off = port.onFromRadio(b => this.onBytes(b));
    this.configId = this.rnd() || 1;
    this.nodes.clear();
    this.sightings.clear();
    this.set({ nodesHeard: 0, battery: undefined, region: undefined, lastHops: undefined, superNodes: 0, gateways: 0 });
    this.set({ state: 'configuring' });
    this.emit({ type: 'state', state: 'starting' });
    await port.write(encodeWantConfig(this.configId));
    await port.drain?.();
  }

  detach() {
    const was = this.st.state === 'up';
    this.off?.(); this.off = null; this.port = null;
    if (this.st.state !== 'off') this.set({ state: 'off', myNode: null });
    if (was) { this.emit({ type: 'down', medium: 'lora', id: LORA_PEER }); this.emit({ type: 'lost', medium: 'lora', id: LORA_PEER }); }
    this.emit({ type: 'state', state: 'off' });
  }

  /** Quanto falta para caber um envelope deste tamanho no orçamento de rádio (0 = já). */
  waitMs(bytes: number): number {
    try { return this.budget.waitMs(splitEnvelope(new Uint8Array(bytes), 0).length, this.now()); } catch { return Infinity; }
  }

  async send(id: string, env: Uint8Array): Promise<void> {
    if (id !== LORA_PEER || !this.port || this.st.state !== 'up') throw new Error('Rádio LoRa desconectado.');
    const msgId = this.rnd();
    const parts = splitEnvelope(env, msgId); // grande demais: lança, e o roteador tenta outro meio
    const now = this.now();
    if (!this.budget.take(parts.length, now)) {
      const wait = this.budget.waitMs(parts.length, now);
      this.set({ busyUntil: now + wait });
      throw new LoraBusyError(wait);
    }
    this.re.sent(msgId, now);
    for (const payload of parts) await this.port.write(encodeToRadioPacket({ payload, id: this.rnd() || 1 }));
    this.set({ sent: this.st.sent + 1, busyUntil: undefined });
  }

  private onBytes(b: Uint8Array) {
    let m;
    try { m = decodeFromRadio(b); } catch { return; }
    if (m.myNodeNum !== undefined) this.set({ myNode: m.myNodeNum });
    if (m.loraRegion !== undefined) this.set({ region: m.loraRegion });
    if (m.node && m.node.num) {
      this.nodes.set(m.node.num, m.node.battery);
      const me = this.st.myNode;
      this.set({ nodesHeard: [...this.nodes.keys()].filter(n => n !== me).length, ...(me !== null && this.nodes.has(me) ? { battery: this.nodes.get(me) } : {}) });
    }
    if (m.configCompleteId !== undefined && m.configCompleteId === this.configId && this.st.state !== 'up') {
      this.set({ state: 'up' });
      this.emit({ type: 'state', state: 'running' });
      this.emit({ type: 'found', medium: 'lora', id: LORA_PEER, name: 'Malha LoRa' });
      this.emit({ type: 'up', medium: 'lora', id: LORA_PEER, name: 'Malha LoRa' });
    }
    const p = m.packet;
    if (!p || p.portnum !== PRIVATE_APP || !p.payload) return;
    if (p.from !== undefined && p.from === this.st.myNode) return;
    const beacon = decodeNodeBeacon(p.payload, Math.floor(this.now() / 1000));
    if (beacon) { this.sightings.saw(beacon, Math.floor(this.now() / 1000)); this.syncNodes(); return; }
    const env = this.re.push(p.payload, this.now());
    if (!env) return;
    const hops = p.hopStart !== undefined && p.hopLimit !== undefined && p.hopStart >= p.hopLimit ? p.hopStart - p.hopLimit : undefined;
    this.set({ received: this.st.received + 1, ...(hops !== undefined ? { lastHops: hops } : {}) });
    this.emit({ type: 'data', medium: 'lora', id: LORA_PEER, data: env });
  }

  /** Super Nodes por perto (o prazo de 40 min também vence sem novo anúncio: `refreshNodes`). */
  private syncNodes() {
    const near = this.sightings.near(Math.floor(this.now() / 1000));
    const n = near.length, g = near.filter(b => b.gateway).length;
    if (n !== (this.st.superNodes ?? 0) || g !== (this.st.gateways ?? 0)) this.set({ superNodes: n, gateways: g });
  }
  refreshNodes() { this.syncNodes(); }
  /** Cada Super Node ouvido nos últimos 40 min (mapa da rede). */
  heard(): HeardNode[] { return this.sightings.heard(Math.floor(this.now() / 1000)); }
}
