// GERADO por scripts/sync-protocol.mjs a partir de apps/mobile/src/transport/rnode/rnode.ts. Não edite aqui.
/**
 * Rádio RNode por KISS (docs/transporte/super-node-lora.md, caminho B): o firmware RNode é um modem burro
 * que espera a configuração de quem conecta, a cada conexão, e responde cada ajuste com o valor em vigor.
 * Quadro: `0xC0 · comando · dados (com escape KISS) · 0xC0`. Os valores do rádio saem de `piuRadio(região)`.
 * Testado em __tests__/rnode.test.ts; o piu-node usa uma cópia.
 */
import type { PiuRadio } from './regions.js';

const FEND = 0xc0, FESC = 0xdb, TFEND = 0xdc, TFESC = 0xdd;

export const CMD = {
  DATA: 0x00, FREQUENCY: 0x01, BANDWIDTH: 0x02, TXPOWER: 0x03, SF: 0x04, CR: 0x05, RADIO_STATE: 0x06,
  DETECT: 0x08, ST_ALOCK: 0x0b, LT_ALOCK: 0x0c, READY: 0x0f, STAT_RSSI: 0x23, ERROR: 0x90,
} as const;
const DETECT_REQ = 0x73, DETECT_RESP = 0x46;
/** Um pacote no ar; o firmware divide até 508, mas os pedaços "P1" (226) e o "PN" (104) cabem em um. */
export const RNODE_PACKET = 255;

export function kissFrame(cmd: number, data: Uint8Array): Uint8Array {
  const out = [FEND, cmd];
  for (const x of data) {
    if (x === FEND) out.push(FESC, TFEND);
    else if (x === FESC) out.push(FESC, TFESC);
    else out.push(x);
  }
  out.push(FEND);
  return Uint8Array.from(out);
}

export type KissCommand = { cmd: number; data: Uint8Array };

/** Separa os quadros KISS; o que vier fora de quadro é descartado. */
export class KissReader {
  private buf: number[] | null = null;
  private esc = false;
  push(bytes: Uint8Array): KissCommand[] {
    const out: KissCommand[] = [];
    for (const x of bytes) {
      if (x === FEND) {
        if (this.buf && this.buf.length > 0) out.push({ cmd: this.buf[0]!, data: Uint8Array.from(this.buf.slice(1)) });
        this.buf = []; this.esc = false;
        continue;
      }
      if (!this.buf) continue;
      if (this.esc) { this.buf.push(x === TFEND ? FEND : x === TFESC ? FESC : x); this.esc = false; }
      else if (x === FESC) this.esc = true;
      else this.buf.push(x);
      if (this.buf.length > 1 + 508) this.buf = null; // quadro grande demais: espera o próximo FEND
    }
    return out;
  }
}

const be32 = (n: number) => Uint8Array.of((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
const be16 = (n: number) => Uint8Array.of((n >>> 8) & 0xff, n & 0xff);
const alock = (p: PiuRadio) => Math.round(p.airtimePct * 100);

/** Quadros que configuram o rádio, na ordem: detectar primeiro, ligar por último. */
export function configFrames(p: PiuRadio): Uint8Array[] {
  return [
    kissFrame(CMD.DETECT, Uint8Array.of(DETECT_REQ)),
    kissFrame(CMD.FREQUENCY, be32(p.freqHz)),
    kissFrame(CMD.BANDWIDTH, be32(p.bwHz)),
    kissFrame(CMD.TXPOWER, Uint8Array.of(p.txDbm)),
    kissFrame(CMD.SF, Uint8Array.of(p.sf)),
    kissFrame(CMD.CR, Uint8Array.of(p.cr)),
    kissFrame(CMD.LT_ALOCK, be16(alock(p))),
    kissFrame(CMD.RADIO_STATE, Uint8Array.of(0x01)),
  ];
}

export type RNodeState = 'detecting' | 'configuring' | 'up' | 'failed';

const num = (d: Uint8Array) => d.reduce((a, x) => a * 256 + x, 0);

/**
 * Confere as respostas do RNode contra o pedido. O enlace só sobe quando todos os ajustes conferem e o
 * rádio está ligado; valor diferente ou erro do firmware derruba. A potência pode voltar menor (a placa
 * limita), nunca maior.
 */
export class RNodeSetup {
  state: RNodeState = 'detecting';
  problem: string | null = null;
  private pending: Map<number, { what: string; ok: (v: number) => boolean }>;

  constructor(p: PiuRadio) {
    this.pending = new Map([
      [CMD.FREQUENCY, { what: 'frequência', ok: v => v === p.freqHz }],
      [CMD.BANDWIDTH, { what: 'banda', ok: v => v === p.bwHz }],
      [CMD.TXPOWER, { what: 'potência', ok: v => v <= p.txDbm }],
      [CMD.SF, { what: 'SF', ok: v => v === p.sf }],
      [CMD.CR, { what: 'CR', ok: v => v === p.cr }],
      [CMD.LT_ALOCK, { what: 'tempo no ar', ok: v => v === alock(p) }],
      [CMD.RADIO_STATE, { what: 'rádio', ok: v => v === 1 }],
    ]);
  }

  private fail(why: string) { this.state = 'failed'; this.problem = why; }

  push(cmd: number, data: Uint8Array) {
    if (this.state === 'failed') return;
    if (cmd === CMD.ERROR) return this.fail(`erro do RNode 0x${(data[0] ?? 0).toString(16).padStart(2, '0')}`);
    if (cmd === CMD.DETECT) {
      if (data[0] !== DETECT_RESP) return this.fail('não é um RNode');
      if (this.state === 'detecting') this.state = 'configuring';
      return;
    }
    if (this.state === 'detecting') return;
    const want = this.pending.get(cmd);
    if (!want) return;
    if (!want.ok(num(data))) return this.fail(`${want.what} diferente do pedido (${num(data)})`);
    this.pending.delete(cmd);
    if (this.pending.size === 0) this.state = 'up';
  }
}
