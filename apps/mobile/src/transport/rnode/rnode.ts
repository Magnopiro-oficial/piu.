/**
 * Rádio RNode por KISS (docs/transporte/super-node-lora.md, caminho B): o firmware RNode é um modem burro
 * que espera a configuração de quem conecta, a cada conexão, e responde cada ajuste com o valor em vigor.
 * Quadro: `0xC0 · comando · dados (com escape KISS) · 0xC0`. Os valores do rádio saem de `piuRadio(região)`.
 * Testado em __tests__/rnode.test.ts; o piu-node usa uma cópia.
 */
import type { PiuRadio } from './regions';

const FEND = 0xc0, FESC = 0xdb, TFEND = 0xdc, TFESC = 0xdd;

export const CMD = {
  DATA: 0x00, FREQUENCY: 0x01, BANDWIDTH: 0x02, TXPOWER: 0x03, SF: 0x04, CR: 0x05, RADIO_STATE: 0x06,
  DETECT: 0x08, ST_ALOCK: 0x0b, LT_ALOCK: 0x0c, READY: 0x0f, STAT_RSSI: 0x23, STAT_SNR: 0x24,
  PLATFORM: 0x48, MCU: 0x49, FW_VERSION: 0x50, ROM_READ: 0x51, ERROR: 0x90,
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

/**
 * Perguntas antes de configurar (como o RNodeInterface do Reticulum): é um RNode, qual firmware, qual
 * processador e a memória da placa (modelo, faixa, se foi provisionada, se está em modo TNC). O firmware
 * responde na ordem; a memória vem por último.
 */
export function probeFrames(): Uint8Array[] {
  return [
    kissFrame(CMD.DETECT, Uint8Array.of(DETECT_REQ)),
    kissFrame(CMD.FW_VERSION, Uint8Array.of(0)),
    kissFrame(CMD.PLATFORM, Uint8Array.of(0)),
    kissFrame(CMD.MCU, Uint8Array.of(0)),
    kissFrame(CMD.ROM_READ, Uint8Array.of(0)),
  ];
}

/** Quadros que configuram o rádio, na ordem: canal primeiro, ligar por último. */
export function configFrames(p: PiuRadio): Uint8Array[] {
  return [
    kissFrame(CMD.FREQUENCY, be32(p.freqHz)),
    kissFrame(CMD.BANDWIDTH, be32(p.bwHz)),
    kissFrame(CMD.TXPOWER, Uint8Array.of(p.txDbm)),
    kissFrame(CMD.SF, Uint8Array.of(p.sf)),
    kissFrame(CMD.CR, Uint8Array.of(p.cr)),
    kissFrame(CMD.LT_ALOCK, be16(alock(p))),
    kissFrame(CMD.RADIO_STATE, Uint8Array.of(0x01)),
  ];
}

/** Firmware mais antigo que o Reticulum aceita (RNodeInterface.REQUIRED_FW_VER). */
export const RNODE_MIN_FW: readonly [number, number] = [1, 52];

/**
 * Modelos gravados na memória da placa pelo rnodeconf (models, RNS/Utilities/rnodeconf.py): faixa que o
 * rádio e o filtro da placa alcançam. 0x16 (T-Echo 433) segue o rótulo, 430–510 MHz.
 */
export const RNODE_MODELS: Readonly<Record<number, { product: string; loHz: number; hiHz: number; chip: string }>> = (() => {
  const M = 1e6, G = 1e9;
  const t: [number, string, number, number, string][] = [
    [0xa4, 'RNode', 410 * M, 525 * M, 'SX1278'], [0xa9, 'RNode', 820 * M, 1020 * M, 'SX1276'],
    [0xa1, 'RNode', 410 * M, 525 * M, 'SX1268'], [0xa6, 'RNode', 820 * M, 1020 * M, 'SX1262'],
    [0xa5, 'RNode', 410 * M, 525 * M, 'SX1278'], [0xaa, 'RNode', 820 * M, 1020 * M, 'SX1276'],
    [0xac, 'RNode', 2.4 * G, 2.5 * G, 'SX1280'],
    [0xa2, 'RNode', 410 * M, 525 * M, 'SX1278'], [0xa7, 'RNode', 820 * M, 1020 * M, 'SX1276'],
    [0xa3, 'RNode', 410 * M, 525 * M, 'SX1278'], [0xa8, 'RNode', 820 * M, 1020 * M, 'SX1276'],
    [0xb3, 'LilyGO LoRa32 v2.0', 420 * M, 520 * M, 'SX1278'], [0xb8, 'LilyGO LoRa32 v2.0', 850 * M, 950 * M, 'SX1276'],
    [0xb4, 'LilyGO LoRa32 v2.1', 420 * M, 520 * M, 'SX1278'], [0xb9, 'LilyGO LoRa32 v2.1', 850 * M, 950 * M, 'SX1276'],
    [0xba, 'LilyGO LoRa32 v1.0', 420 * M, 520 * M, 'SX1278'], [0xbb, 'LilyGO LoRa32 v1.0', 850 * M, 950 * M, 'SX1276'],
    [0xc4, 'Heltec LoRa32 v2', 420 * M, 520 * M, 'SX1278'], [0xc9, 'Heltec LoRa32 v2', 850 * M, 950 * M, 'SX1276'],
    [0xc5, 'Heltec LoRa32 v3', 420 * M, 520 * M, 'SX1268'], [0xca, 'Heltec LoRa32 v3', 850 * M, 950 * M, 'SX1262'],
    [0xc8, 'Heltec LoRa32 v4', 860 * M, 930 * M, 'SX1262'],
    [0xc6, 'Heltec T114', 420 * M, 520 * M, 'SX1268'], [0xc7, 'Heltec T114', 850 * M, 950 * M, 'SX1262'],
    [0xe4, 'LilyGO T-Beam', 420 * M, 520 * M, 'SX1278'], [0xe9, 'LilyGO T-Beam', 850 * M, 950 * M, 'SX1276'],
    [0xe3, 'LilyGO T-Beam', 420 * M, 520 * M, 'SX1268'], [0xe8, 'LilyGO T-Beam', 850 * M, 950 * M, 'SX1262'],
    [0xd4, 'LilyGO T-Deck', 420 * M, 520 * M, 'SX1268'], [0xd9, 'LilyGO T-Deck', 850 * M, 950 * M, 'SX1262'],
    [0xdb, 'LilyGO T-Beam Supreme', 420 * M, 520 * M, 'SX1268'], [0xdc, 'LilyGO T-Beam Supreme', 850 * M, 950 * M, 'SX1262'],
    [0x11, 'RAK4631', 430 * M, 510 * M, 'SX1262'], [0x12, 'RAK4631', 779 * M, 928 * M, 'SX1262'],
    [0x13, 'RAK4631', 430 * M, 510 * M, 'SX1262'], [0x14, 'RAK4631', 779 * M, 928 * M, 'SX1262'],
    [0x16, 'LilyGO T-Echo', 430 * M, 510 * M, 'SX1262'], [0x17, 'LilyGO T-Echo', 779 * M, 928 * M, 'SX1262'],
    [0x21, 'openCom XL', 820 * M, 960 * M, 'SX1262'],
    [0xde, 'Seeed XIAO ESP32S3', 420 * M, 520 * M, 'SX1262'], [0xdd, 'Seeed XIAO ESP32S3', 850 * M, 950 * M, 'SX1262'],
  ];
  return Object.fromEntries(t.map(([m, product, loHz, hiHz, chip]) => [m, { product, loHz, hiHz, chip }]));
})();

/** Memória da placa (EEPROM, ROM.h do firmware): endereços que interessam ao Piu. */
const ROM = { MODEL: 0x01, INFO_LOCK: 0x9b, CONF_OK: 0xa7, YES: 0x73 } as const;

export type RNodeBoard = { fw?: [number, number]; platform?: number; mcu?: number; model?: number; product?: string };

export type RNodeState = 'detecting' | 'configuring' | 'up' | 'failed';

/** Erros do firmware que não derrubam um rádio que já está no ar (Framing.h). */
const ERR = { INITRADIO: 0x01, TXFAILED: 0x02 } as const;

const num = (d: Uint8Array) => d.reduce((a, x) => a * 256 + x, 0);
const mhz = (hz: number) => String(Math.round(hz / 1e5) / 10).replace('.', ',');

/**
 * Confere o RNode antes e depois de configurar. `push` devolve 'probed' quando as perguntas foram
 * respondidas e a placa serve (hora de mandar `configFrames`) e 'reconfigure' quando o rádio no ar
 * informa falha de transmissão (o Reticulum reinicia o rádio nesse caso). O enlace só sobe quando todos
 * os ajustes conferem e o rádio está ligado; valor diferente ou erro do firmware na configuração derruba.
 * A potência pode voltar menor (a placa limita), nunca maior; o tempo no ar volta com o arredondamento
 * do firmware (float de 32 bits, até 1 centésimo a menos; 100 % volta 0).
 */
export class RNodeSetup {
  state: RNodeState = 'detecting';
  problem: string | null = null;
  board: RNodeBoard = {};
  /** Erros passageiros do firmware com o rádio no ar (fila cheia, memória, modem). */
  hwErrors = 0;
  private detected = false;
  private pending: Map<number, { what: string; ok: (v: number) => boolean }>;

  constructor(private readonly p: PiuRadio) {
    const at = alock(p);
    this.pending = new Map([
      [CMD.FREQUENCY, { what: 'frequência', ok: v => v === p.freqHz }],
      [CMD.BANDWIDTH, { what: 'banda', ok: v => v === p.bwHz }],
      [CMD.TXPOWER, { what: 'potência', ok: v => v <= p.txDbm }],
      [CMD.SF, { what: 'SF', ok: v => v === p.sf }],
      [CMD.CR, { what: 'CR', ok: v => v === p.cr }],
      [CMD.LT_ALOCK, { what: 'tempo no ar', ok: v => (at >= 10_000 ? v === 0 : v === at || v === at - 1) }],
      [CMD.RADIO_STATE, { what: 'rádio', ok: v => v === 1 }],
    ]);
  }

  private fail(why: string) { this.state = 'failed'; this.problem = why; }

  push(cmd: number, data: Uint8Array): 'probed' | 'reconfigure' | undefined {
    if (this.state === 'failed') return;
    if (cmd === CMD.ERROR) {
      const code = data[0] ?? 0;
      if (this.state === 'up' && code !== ERR.INITRADIO) {
        this.hwErrors++;
        return code === ERR.TXFAILED ? 'reconfigure' : undefined;
      }
      this.fail(`erro do RNode 0x${code.toString(16).padStart(2, '0')}`);
      return;
    }
    if (this.state === 'detecting') return this.probe(cmd, data);
    const want = this.pending.get(cmd);
    if (!want) return;
    if (!want.ok(num(data))) {
      this.fail(cmd === CMD.RADIO_STATE ? 'o rádio da placa não ligou' : `${want.what} diferente do pedido (${num(data)})`);
      return;
    }
    this.pending.delete(cmd);
    if (this.pending.size === 0) this.state = 'up';
  }

  private probe(cmd: number, data: Uint8Array): 'probed' | undefined {
    if (cmd === CMD.DETECT) {
      if (data[0] !== DETECT_RESP) this.fail('não é um RNode');
      else this.detected = true;
      return;
    }
    if (!this.detected) return;
    if (cmd === CMD.FW_VERSION && data.length >= 2) this.board.fw = [data[0]!, data[1]!];
    else if (cmd === CMD.PLATFORM && data.length) this.board.platform = data[0];
    else if (cmd === CMD.MCU && data.length) this.board.mcu = data[0];
    else if (cmd === CMD.ROM_READ) return this.checkBoard(data);
  }

  /** A memória chega por último: decide se a placa serve para o canal da região. */
  private checkBoard(rom: Uint8Array): 'probed' | undefined {
    const fw = this.board.fw;
    if (!fw || fw[0] < RNODE_MIN_FW[0] || (fw[0] === RNODE_MIN_FW[0] && fw[1] < RNODE_MIN_FW[1])) {
      const v = fw ? `${fw[0]}.${String(fw[1]).padStart(2, '0')}` : '?';
      return void this.fail(`firmware antigo (${v}); precisa de ${RNODE_MIN_FW[0]}.${RNODE_MIN_FW[1]} ou mais`);
    }
    if (rom.length > ROM.CONF_OK) {
      if (rom[ROM.INFO_LOCK] !== ROM.YES) return void this.fail('placa sem provisionar');
      // Modo TNC: a placa liga com a configuração salva e não aplica a que o Piu manda (op_mode).
      if (rom[ROM.CONF_OK] === ROM.YES) return void this.fail('placa em modo TNC');
      const model = rom[ROM.MODEL]!, m = RNODE_MODELS[model];
      this.board.model = model;
      if (m) {
        this.board.product = m.product;
        if (this.p.freqHz < m.loHz || this.p.freqHz > m.hiHz) {
          return void this.fail(`frequência fora da faixa da placa (${mhz(m.loHz)}–${mhz(m.hiHz)} MHz)`);
        }
      }
    }
    this.state = 'configuring';
    return 'probed';
  }
}

/**
 * Falha de transmissão reconfigura a placa, mas no máximo 2 vezes por minuto: placa com defeito (ou que
 * mente) não prende o app num laço de reconfigurar; depois disso o rádio fica com o erro na tela.
 */
export class Reconfigures {
  private at: number[] = [];
  allow(now: number): boolean {
    this.at = this.at.filter(t => now - t < 60_000);
    if (this.at.length >= 2) return false;
    this.at.push(now);
    return true;
  }
}
