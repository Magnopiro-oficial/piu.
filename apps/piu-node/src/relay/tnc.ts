/**
 * Modem KISS de banda estreita (docs/estudos/2026-11-23-comunicacao-uhf-vhf.md, opção B): um TNC de rádio
 * VHF/UHF (Direwolf por TCP, NinoTNC por USB) a 1200 ou 9600 bps. O rádio e a frequência ficam com quem
 * tem o direito de transmitir; o Piu só entrega quadros KISS ao modem.
 *
 * Mesmo modelo do rádio próprio (rnode.ts): malha aberta no motor (`lora:tnc`), os mesmos pedaços "P1" e
 * o mesmo anúncio "PN", sem handshake e sem confirmação por pacote (cada uma custaria segundos de ar).
 * Para o roteador é a classe `lora` (rádio lento): mídia e sinal ao vivo nunca saem por aqui.
 *
 * Tempo no ar: calculado pela taxa do modem e pelo TXDELAY, limitado a `dutyPercent` por hora. Uma parte
 * (RESERVE) fica só para envelopes de prioridade alta ou crítica: alerta não espera atrás de repasse.
 *
 * ATENÇÃO (regra de rádio): o Piu só leva envelopes cifrados, e faixa de radioamador não aceita cifra.
 * Este adaptador é para canal privado com licença (no Brasil, Serviço Limitado Privado) ou faixa de uso
 * livre que aceite dados. A configuração recusa subir sem `PIU_TNC_BAND` (config.ts).
 */
import { FRAGMENT_BYTES, LORA_MAX_ENVELOPE, LORA_MAX_PARTS, Reassembler, splitEnvelope } from '../meshtastic/fragments.js';
import { decodeNodeBeacon, encodeNodeBeacon, NodeSightings } from '../meshtastic/nodeBeacon.js';
import { parseHeader, Priority } from '../protocol/envelope.js';
import type { KeyPair } from '../protocol/keys.js';
import { DutyCycle } from './airtime.js';
import { AX25_HEADER, ax25Decode, ax25Encode } from './ax25.js';
import type { MeshPort, RelayEngine } from './engine.js';
import { KissDecoder, kissEncode } from './kiss.js';
import type { Modem } from './serial.js';

export const TNC_PEER = 'lora:tnc';
/** Endereço AX.25 de destino de todo quadro do Piu (separa do APRS e de outros no mesmo canal). */
export const TNC_DEST = 'PIU';
/** Fatia do tempo no ar guardada para prioridade alta e crítica. */
const RESERVE = 0.2;
const KISS_TXDELAY = 0x01;
/** Cabeçalho do pedaço "P1" (fragments.ts). */
const PART_HEAD = 7;
/** Flags de abertura e fechamento e os 2 bytes de verificação (FCS) que o modem põe no ar. */
const FRAMING = 4;

export interface TncRadio {
  /** Onde o rádio transmite: canal privado com licença, ou faixa de uso livre que aceita dados. */
  band: 'licensed' | 'free';
  /** Taxa do modem no ar (1200, 9600 …). */
  bps: number;
  /** Tempo para o rádio abrir a transmissão antes dos dados (ms). */
  txDelayMs: number;
  /** Ocupação máxima do canal, em % por hora. */
  dutyPercent: number;
  /** Endereço AX.25 de origem (até 6 letras ou números, com -0 a -15 opcional). */
  call: string;
  /** Põe o cabeçalho AX.25 em cada quadro (Direwolf e NinoTNC esperam). Desligado: pedaços crus. */
  ax25: boolean;
}

/** Tempo no ar de um quadro com `bytes` de conteúdo (ms). Não conta o bit stuffing (poucos %). */
export function tncAirtimeMs(bytes: number, r: Pick<TncRadio, 'bps' | 'txDelayMs' | 'ax25'>): number {
  return r.txDelayMs + ((bytes + (r.ax25 ? AX25_HEADER : 0) + FRAMING) * 8000) / r.bps;
}

export interface TncOptions {
  modem: Modem;
  /** Chave técnica do nó: assina o anúncio "PN". */
  node: KeyPair;
  radio: TncRadio;
  /** Intervalo do anúncio (ms). */
  beaconMs?: number;
  roles?: () => { relay: boolean; gateway: boolean };
  now?: () => number;
  tickMs?: number;
  log?: (m: string) => void;
}

export interface TncStats {
  kind: 'tnc'; path: string; band: TncRadio['band']; bps: number; state: 'up';
  superNodes: number; sent: number; received: number;
  /** Envios adiados por falta de tempo no ar. */
  busy: number;
  /** Quadros que não são do Piu (outro tráfego no canal, ruído). */
  ignored: number;
  /** Tempo no ar gasto na última hora e o teto (ms). */
  airtimeMs: number; budgetMs: number;
}

export class TncAdapter {
  private rd = new KissDecoder(AX25_HEADER + PART_HEAD + FRAGMENT_BYTES + 64);
  private re = new Reassembler();
  private sightings = new NodeSightings();
  private duty: DutyCycle;
  private nextId = (Math.random() * 0xffffffff) >>> 0;
  private timers: ReturnType<typeof setInterval>[] = [];
  private st = { sent: 0, received: 0, busy: 0, ignored: 0 };
  private port: MeshPort;

  constructor(private readonly engine: RelayEngine, private readonly o: TncOptions) {
    this.duty = new DutyCycle(o.radio.dutyPercent);
    const self = this;
    this.port = {
      id: TNC_PEER, medium: 'lora', address: o.modem.label, since: this.now(), maxEnvelope: LORA_MAX_ENVELOPE,
      capacity: () => self.capacity(),
      send: env => self.sendEnvelope(env),
    };
  }

  private now() { return this.o.now?.() ?? Date.now(); }
  private air(bytes: number) { return tncAirtimeMs(bytes, this.o.radio); }
  private frame(p: Uint8Array) { return kissEncode(this.o.radio.ax25 ? ax25Encode(p, { dst: TNC_DEST, src: this.o.radio.call }) : p); }

  start() {
    const r = this.o.radio;
    this.o.modem.onData(b => { for (const f of this.rd.push(b)) this.onFrame(f); });
    this.o.modem.write(kissEncode(Uint8Array.of(Math.min(255, Math.round(r.txDelayMs / 10))), KISS_TXDELAY));
    this.engine.attachMesh(this.port);
    this.o.log?.(`TNC: modem ${this.o.modem.label} pronto (${r.bps} bps, até ${r.dutyPercent} % do tempo no ar, ${r.band === 'licensed' ? 'canal com licença' : 'faixa de uso livre'})`);
    this.beacon();
    const tick = setInterval(() => this.tick(), this.o.tickMs ?? 5000);
    const beacon = setInterval(() => this.beacon(), this.o.beaconMs ?? 15 * 60_000);
    for (const t of [tick, beacon]) { t.unref?.(); this.timers.push(t); }
  }

  async stop() {
    this.timers.splice(0).forEach(clearInterval);
    this.engine.detachMesh(TNC_PEER);
    await this.o.modem.close();
  }

  /** Rodada: entrega à malha o que couber no tempo no ar. */
  tick() { this.engine.flushMesh(this.port); }

  /** Bytes de envelope que ainda cabem agora (em pedaços inteiros, no máximo uma mensagem). */
  private capacity(): number {
    const room = this.duty.budgetMs - this.duty.used(this.now());
    const parts = Math.min(LORA_MAX_PARTS, Math.floor(room / this.air(PART_HEAD + FRAGMENT_BYTES)));
    return Math.max(0, parts) * FRAGMENT_BYTES;
  }

  private urgent(env: Uint8Array) {
    try { return parseHeader(env).priority >= Priority.High; } catch { return false; }
  }

  private sendEnvelope(env: Uint8Array): boolean {
    let parts: Uint8Array[];
    try { parts = splitEnvelope(env, this.nextId++); } catch { return false; }
    const ms = parts.reduce((a, p) => a + this.air(p.length), 0), now = this.now();
    const limit = this.duty.budgetMs * (this.urgent(env) ? 1 : 1 - RESERVE);
    if (this.duty.used(now) + ms > limit) { this.st.busy++; return false; }
    this.duty.spend(ms, now);
    for (const p of parts) this.o.modem.write(this.frame(p));
    this.st.sent++;
    return true;
  }

  /** Anúncio "PN": conta no tempo no ar; com o canal cheio, fica para a próxima vez. */
  private beacon() {
    const roles = this.o.roles?.() ?? { relay: true, gateway: false };
    const b = encodeNodeBeacon(this.o.node, { at: Math.floor(this.now() / 1000), ...roles });
    const ms = this.air(b.length), now = this.now();
    if (!this.duty.allows(ms, now)) return;
    this.duty.spend(ms, now);
    this.o.modem.write(this.frame(b));
  }

  private onFrame(frame: Uint8Array) {
    const data = this.o.radio.ax25 ? ax25Decode(frame, TNC_DEST) : frame;
    if (!data) { this.st.ignored++; return; }
    const sec = Math.floor(this.now() / 1000);
    const beacon = decodeNodeBeacon(data, sec);
    if (beacon) {
      if (!beacon.pk.every((x, i) => x === this.o.node.pk[i])) this.sightings.saw(beacon, sec);
      return;
    }
    const env = this.re.push(data, this.now());
    if (!env) return;
    this.st.received++;
    this.engine.receiveMesh(TNC_PEER, env);
  }

  stats(): TncStats {
    const r = this.o.radio, now = this.now();
    return {
      kind: 'tnc', path: this.o.modem.label, band: r.band, bps: r.bps, state: 'up',
      superNodes: this.sightings.near(Math.floor(now / 1000)).length, ...this.st,
      airtimeMs: Math.round(this.duty.used(now)), budgetMs: this.duty.budgetMs,
    };
  }
}
