/**
 * SÓ TESTES E GALERIA DE DESENVOLVIMENTO (nada do app importa este arquivo). Uma placa RNode em
 * software, para testar o Piu como se tivesse a placa na mão: porta byte a byte o `serial_callback` do
 * firmware markqvist/RNode_Firmware (RNode_Firmware.ino, commit 56775c5) e as respostas de Utilities.h:
 * - comandos de um byte rodam a cada byte e os de vários bytes juntam com escape até completar;
 * - potência limitada pelo chip (SX127x 17, SX126x 22 ou o máximo do amplificador, SX1280 13/20),
 *   SF 5–12, CR 5–8, tempo no ar guardado em float de 32 bits;
 * - placa sem provisionar não liga o rádio; placa em modo TNC devolve o que recebe mas não aplica;
 * - ao ligar, o rádio avisa o estado duas vezes (startRadio e a resposta do comando);
 * - no ar: o pacote recebido sai como RSSI, SNR e DATA; o enviado respeita o limite de tempo no ar.
 * Os perfis de placa vêm do rnodeconf (models) e do Boards.h.
 */
import { CMD } from './rnode';

const FEND = 0xc0, FESC = 0xdb, TFEND = 0xdc, TFESC = 0xdd;
const MTU = 508, CMD_L = 64, DETECT_REQ = 0x73, DETECT_RESP = 0x46;
const PLATFORM = { AVR: 0x90, ESP32: 0x80, NRF52: 0x70 } as const;
const MCU = { M1284P: 0x91, M2560: 0x92, ESP32: 0x81, NRF52: 0x71 } as const;
const ERROR = { INITRADIO: 0x01, TXFAILED: 0x02 } as const;

export type Chip = 'SX1262' | 'SX1268' | 'SX1276' | 'SX1278' | 'SX1280';
/** Como o celular ou o computador chega na placa. */
export type Link = 'ble' | 'classic' | 'usb';

export type BoardProfile = {
  /** Nome na documentação (docs/hardware/placas-lora.md). */
  name: string;
  /** Código do modelo gravado pelo rnodeconf (define a faixa). */
  model: number;
  chip: Chip;
  platform: number; mcu: number;
  /** Bluetooth no firmware RNode: BLE (celular), clássico (só Android com outro módulo) ou nenhum. */
  link: Link;
  /** Potência máxima do amplificador (Boards.h, PA_MAX_OUTPUT). */
  paMax?: number;
};

const ESP = { platform: PLATFORM.ESP32, mcu: MCU.ESP32 }, NRF = { platform: PLATFORM.NRF52, mcu: MCU.NRF52 };
const b = (name: string, model: number, chip: Chip, p: { platform: number; mcu: number }, link: Link, paMax?: number): BoardProfile =>
  ({ name, model, chip, ...p, link, ...(paMax ? { paMax } : {}) });

/**
 * Todas as placas que rodam RNode na documentação, em cada versão de faixa vendida. As de ESP32 original
 * têm Bluetooth clássico no RNode (o Piu usa pelo USB do piu-node); as de ATmega não têm Bluetooth.
 */
export const RNODE_BOARDS: readonly BoardProfile[] = [
  b('Heltec V3 (915)', 0xca, 'SX1262', ESP, 'ble'), b('Heltec V3 (433)', 0xc5, 'SX1268', ESP, 'ble'),
  b('Heltec V4', 0xc8, 'SX1262', ESP, 'ble', 28),
  b('Heltec T114 (915)', 0xc7, 'SX1262', NRF, 'ble'), b('Heltec T114 (433)', 0xc6, 'SX1268', NRF, 'ble'),
  b('Heltec V2.x (915)', 0xc9, 'SX1276', ESP, 'classic'), b('Heltec V2.x (433)', 0xc4, 'SX1278', ESP, 'classic'),
  b('LILYGO T-Beam SX1276', 0xe9, 'SX1276', ESP, 'classic'), b('LILYGO T-Beam SX1278', 0xe4, 'SX1278', ESP, 'classic'),
  b('LILYGO T-Beam SX1262', 0xe8, 'SX1262', ESP, 'classic'), b('LILYGO T-Beam SX1268', 0xe3, 'SX1268', ESP, 'classic'),
  b('LILYGO T-Beam Supreme (915)', 0xdc, 'SX1262', ESP, 'ble'), b('LILYGO T-Beam Supreme (433)', 0xdb, 'SX1268', ESP, 'ble'),
  b('LILYGO T3-S3 SX1262', 0xa6, 'SX1262', ESP, 'ble'), b('LILYGO T3-S3 SX1268', 0xa1, 'SX1268', ESP, 'ble'),
  b('LILYGO T3-S3 SX1276', 0xaa, 'SX1276', ESP, 'ble'), b('LILYGO T3-S3 SX1278', 0xa5, 'SX1278', ESP, 'ble'),
  b('LILYGO T3-S3 SX1280', 0xac, 'SX1280', ESP, 'ble', 20),
  b('LILYGO T-Deck (915)', 0xd9, 'SX1262', ESP, 'ble'), b('LILYGO T-Deck (433)', 0xd4, 'SX1268', ESP, 'ble'),
  b('LILYGO T-Echo (915)', 0x17, 'SX1262', NRF, 'ble'), b('LILYGO T-Echo (433)', 0x16, 'SX1262', NRF, 'ble'),
  b('LILYGO T-LoRa V1 (915)', 0xbb, 'SX1276', ESP, 'classic'), b('LILYGO T-LoRa V1 (433)', 0xba, 'SX1278', ESP, 'classic'),
  b('LILYGO T-LoRa V2 (915)', 0xb8, 'SX1276', ESP, 'classic'), b('LILYGO T-LoRa V2 (433)', 0xb3, 'SX1278', ESP, 'classic'),
  b('LILYGO T-LoRa V2.1-1.6 (915)', 0xb9, 'SX1276', ESP, 'classic'), b('LILYGO T-LoRa V2.1-1.6 (433)', 0xb4, 'SX1278', ESP, 'classic'),
  b('RAK WisBlock 4631 (915)', 0x12, 'SX1262', NRF, 'ble'), b('RAK WisBlock 4631 (433)', 0x11, 'SX1262', NRF, 'ble'),
  b('RAK WisBlock 4631 + SX1280 (915)', 0x14, 'SX1262', NRF, 'ble'),
  b('Seeed XIAO ESP32-S3 (915)', 0xdd, 'SX1262', ESP, 'ble'), b('Seeed XIAO ESP32-S3 (433)', 0xde, 'SX1262', ESP, 'ble'),
  b('openCom XL', 0x21, 'SX1262', NRF, 'ble'),
  b('RNode NG 2.1 / Handheld v2.x (915)', 0xa7, 'SX1276', ESP, 'classic'), b('RNode NG 2.1 / Handheld v2.x (433)', 0xa2, 'SX1278', ESP, 'classic'),
  b('RNode NG 2.0 (915)', 0xa8, 'SX1276', ESP, 'classic'), b('RNode NG 2.0 (433)', 0xa3, 'SX1278', ESP, 'classic'),
  b('ESP32 montada em casa', 0xfe, 'SX1276', ESP, 'classic'),
  b('nRF52 montada em casa', 0xfe, 'SX1262', NRF, 'ble'),
  b('ATmega1284p montada em casa', 0xa9, 'SX1276', { platform: PLATFORM.AVR, mcu: MCU.M1284P }, 'usb'),
];

/** Parâmetros do rádio em vigor (os que valem no ar). */
export type Phy = { freqHz: number; bwHz: number; sf: number; cr: number; txDbm: number };

export type EmulatorOptions = {
  /** Versão do firmware (padrão 1.86, a atual). */
  fw?: [number, number];
  /** A placa passou pelo rnodeconf (memória com a trava gravada). Padrão: sim. */
  provisioned?: boolean;
  /** Configuração salva (modo TNC): liga sozinha com ela e não aplica a do Piu. */
  tnc?: Phy | null;
  /** O chip de rádio não responde (LoRa->begin falha). */
  radioFault?: boolean;
  /** Antes de cada transmissão, decide se o modem falha (ERROR_TXFAILED). */
  txFault?: () => boolean;
};

/** Tempo no ar de um pacote LoRa (fórmula da Semtech AN1200.13), em ms. */
export function airtimeMs(bytes: number, p: Pick<Phy, 'bwHz' | 'sf' | 'cr'>): number {
  const tSym = (2 ** p.sf) / p.bwHz * 1000;
  const de = tSym > 16 ? 1 : 0, ih = 0, crc = 1, preamble = 18;
  const payload = 8 + Math.max(Math.ceil((8 * bytes - 4 * p.sf + 28 + 16 * crc - 20 * ih) / (4 * (p.sf - 2 * de))) * (p.cr - 4), 0);
  return (preamble + 4.25) * tSym + payload * tSym;
}

export class RNodeEmulator {
  readonly fw: [number, number];
  /** O que a placa escreve para quem está conectado. */
  private out = new Set<(bytes: Uint8Array) => void>();
  private tx = new Set<(pkt: Uint8Array, phy: Phy, startMs: number) => void>();
  /** O modem transmite um pacote por vez: o próximo começa quando o anterior termina. */
  private busyUntil = 0;
  // Estado do serial_callback.
  private inFrame = false; private command = 0xfe; private frameLen = 0; private escape = false;
  private cmdbuf = new Uint8Array(CMD_L); private packet: number[] = [];
  // Rádio.
  private freq = 0; private bw = 0; private txp = 0xff; private sf = 0; private cr = 5;
  private ltAirtimeLimit = Math.fround(0); private stAirtimeLimit = Math.fround(0);
  online = false;
  private readonly tncMode: boolean;
  private readonly hwReady: boolean;
  private applied: Phy | null = null;
  private queue: Uint8Array[] = [];
  /** Tempo no ar nos últimos 60 s (para o limite de longo prazo), em [início, fim] ms. */
  private airLog: [number, number][] = [];
  stats = { rx: 0, tx: 0, dropped: 0 };
  readonly rom = new Uint8Array(200);

  constructor(readonly board: BoardProfile, private readonly o: EmulatorOptions & { now?: () => number } = {}) {
    this.fw = o.fw ?? [1, 86];
    const rom = this.rom;
    rom[0x00] = 0x03; rom[0x01] = board.model; rom[0x02] = 0x01;
    if (o.provisioned !== false) rom[0x9b] = 0x73;
    this.hwReady = o.provisioned !== false;
    this.tncMode = !!o.tnc && this.hwReady;
    if (this.tncMode && o.tnc) {
      rom[0xa7] = 0x73;
      const t = o.tnc;
      this.freq = t.freqHz; this.bw = t.bwHz; this.sf = t.sf; this.cr = t.cr; this.txp = this.clampTx(t.txDbm);
      this.startRadio(false);
    }
  }

  private now() { return this.o.now?.() ?? Date.now(); }

  /** Bytes que a placa manda (notificações do BLE, ou a serial). */
  onOutput(fn: (bytes: Uint8Array) => void) { this.out.add(fn); return () => { this.out.delete(fn); }; }
  /** Pacotes que a placa põe no ar, com o instante em que cada um começa (ms). */
  onTransmit(fn: (pkt: Uint8Array, phy: Phy, startMs: number) => void) { this.tx.add(fn); return () => { this.tx.delete(fn); }; }

  private outBuf: number[] = [];
  private write(...bytes: number[]) { this.outBuf.push(...bytes); }
  private esc(x: number) { x &= 0xff; if (x === FEND) this.write(FESC, TFEND); else if (x === FESC) this.write(FESC, TFESC); else this.write(x); }
  private flush() {
    if (!this.outBuf.length) return;
    const b = Uint8Array.from(this.outBuf); this.outBuf = [];
    this.out.forEach(f => f(b));
  }

  /** Bytes que chegam de quem está conectado. */
  input(bytes: Uint8Array) {
    for (const x of bytes) this.serial(x);
    this.flush();
  }

  /** Texto solto que o firmware escreve na serial (aviso de memória inválida, por exemplo). */
  bootText(text: string) { this.write(...new TextEncoder().encode(text)); this.flush(); }

  private clampTx(txp: number): number {
    const c = this.board.chip;
    if (c === 'SX1262' || c === 'SX1268') return Math.min(txp, this.board.paMax ?? 22);
    if (c === 'SX1280') return Math.min(txp, this.board.paMax ? 20 : 13);
    return Math.min(txp, 17);
  }

  private unesc(x: number): number | null {
    if (x === FESC) { this.escape = true; return null; }
    if (this.escape) { if (x === TFEND) x = FEND; if (x === TFESC) x = FESC; this.escape = false; }
    return x;
  }

  private serial(x: number) {
    if (this.inFrame && x === FEND && this.command === CMD.DATA) {
      this.inFrame = false;
      if (this.packet.length >= 1) this.enqueue(Uint8Array.from(this.packet));
      this.packet = [];
      return;
    }
    if (x === FEND) { this.inFrame = true; this.command = 0xfe; this.frameLen = 0; this.packet = []; return; }
    if (!this.inFrame || this.frameLen >= MTU) return;
    if (this.frameLen === 0 && this.command === 0xfe) { this.command = x; return; }
    const c = this.command;
    const multi = (n: number, done: (d: Uint8Array) => void) => {
      const v = this.unesc(x);
      if (v === null) return;
      if (this.frameLen < CMD_L) this.cmdbuf[this.frameLen++] = v;
      if (this.frameLen === n) done(this.cmdbuf.subarray(0, n));
    };
    const u32 = (d: Uint8Array) => ((d[0]! << 24) | (d[1]! << 16) | (d[2]! << 8) | d[3]!) >>> 0;
    switch (c) {
      case CMD.DATA: {
        const v = this.unesc(x);
        if (v !== null && this.packet.length < MTU) this.packet.push(v);
        return;
      }
      case CMD.FREQUENCY: return multi(4, d => { const f = u32(d); if (f !== 0) { this.freq = f; this.apply(); } this.reply32(CMD.FREQUENCY, this.freq); });
      case CMD.BANDWIDTH: return multi(4, d => { const f = u32(d); if (f !== 0) { this.bw = f; this.apply(); } this.reply32(CMD.BANDWIDTH, this.bw); });
      case CMD.TXPOWER:
        if (x !== 0xff) { this.txp = this.clampTx(x); this.apply(); }
        return this.reply(CMD.TXPOWER, this.txp);
      case CMD.SF:
        if (x !== 0xff) { this.sf = Math.max(5, Math.min(12, x)); this.apply(); }
        return this.reply(CMD.SF, this.sf);
      case CMD.CR:
        if (x !== 0xff) { this.cr = Math.max(5, Math.min(8, x)); this.apply(); }
        return this.reply(CMD.CR, this.cr);
      case CMD.RADIO_STATE:
        if (x === 0x00) this.stopRadio();
        else if (x === 0x01) this.startRadio(true);
        return this.reply(CMD.RADIO_STATE, this.online ? 1 : 0);
      case CMD.ST_ALOCK: return multi(2, d => { this.stAirtimeLimit = alockFrom(d); this.reply16(CMD.ST_ALOCK, alockTo(this.stAirtimeLimit)); });
      case CMD.LT_ALOCK: return multi(2, d => { this.ltAirtimeLimit = alockFrom(d); this.reply16(CMD.LT_ALOCK, alockTo(this.ltAirtimeLimit)); });
      case CMD.DETECT: if (x === DETECT_REQ) this.reply(CMD.DETECT, DETECT_RESP); return;
      case CMD.FW_VERSION: this.write(FEND, CMD.FW_VERSION, this.fw[0], this.fw[1], FEND); return;
      case CMD.PLATFORM: return this.reply(CMD.PLATFORM, this.board.platform);
      case CMD.MCU: return this.reply(CMD.MCU, this.board.mcu);
      case CMD.ROM_READ: this.write(FEND, CMD.ROM_READ); for (const r of this.rom) this.esc(r); this.write(FEND); return;
      case CMD.READY: return this.reply(CMD.READY, 1);
      default: return;
    }
  }

  private reply(cmd: number, v: number) { this.write(FEND, cmd, v & 0xff, FEND); }
  private reply32(cmd: number, v: number) { this.write(FEND, cmd); for (const s of [24, 16, 8, 0]) this.esc(v >>> s); this.write(FEND); }
  private reply16(cmd: number, v: number) { this.write(FEND, cmd); this.esc(v >> 8); this.esc(v); this.write(FEND); }

  /** Em modo host o ajuste vale na hora; em modo TNC fica só na memória (op_mode, RNode_Firmware.ino). */
  private apply() {
    if (this.tncMode || !this.online) return;
    this.applied = this.phyNow();
  }
  private phyNow(): Phy { return { freqHz: this.freq, bwHz: this.bw, sf: this.sf, cr: this.cr, txDbm: this.txp }; }

  private startRadio(answer: boolean) {
    const locked = !(this.freq !== 0 && this.bw !== 0 && this.txp !== 0xff && this.sf !== 0);
    if (this.online) return;
    if (!locked && this.hwReady) {
      if (this.o.radioFault) { if (answer) this.write(FEND, CMD.ERROR, ERROR.INITRADIO, FEND); return; }
      this.online = true;
      this.applied = this.phyNow();
      if (answer) this.reply(CMD.RADIO_STATE, 1);
      this.drain();
    } else {
      this.online = false;
      if (answer) this.reply(CMD.RADIO_STATE, 0);
    }
  }
  private stopRadio() { this.online = false; }

  /** Configuração no ar agora (a aplicada, que no modo TNC é a salva). */
  phy(): Phy | null { return this.online ? this.applied : null; }

  private enqueue(pkt: Uint8Array) {
    if (this.queue.length >= 24) { this.stats.dropped++; return; }
    this.queue.push(pkt);
    if (this.online) this.drain();
  }

  /** Esvazia a fila respeitando o limite de tempo no ar de longo prazo (o que passa fica para depois). */
  drain() {
    if (!this.online || !this.applied) return;
    const now = this.now();
    this.airLog = this.airLog.filter(([, end]) => now - end < 60_000);
    while (this.queue.length) {
      const pkt = this.queue[0]!, ms = airtimeMs(pkt.length, this.applied);
      const used = this.airLog.reduce((a, [s, e]) => a + (e - s), 0);
      const limit = this.ltAirtimeLimit;
      if (limit > 0 && (used + ms) / 60_000 > limit) break;
      this.queue.shift();
      if (this.o.txFault?.()) { this.write(FEND, CMD.ERROR, ERROR.TXFAILED, FEND); continue; }
      const start = Math.max(now, this.busyUntil);
      this.busyUntil = start + ms;
      this.airLog.push([start, start + ms]);
      this.stats.tx++;
      const phy = this.applied;
      this.tx.forEach(f => f(pkt, phy, start));
    }
    this.flush();
  }

  /** Um pacote ouvido no ar (já filtrado pelo canal): sai como RSSI, SNR e DATA. */
  receive(pkt: Uint8Array, rssi = -90, snr = 8) {
    if (!this.online) return;
    this.stats.rx++;
    this.reply(CMD.STAT_RSSI, rssi + 157);
    this.reply(CMD.STAT_SNR, Math.round(snr * 4) & 0xff);
    this.write(FEND, CMD.DATA); for (const x of pkt) this.esc(x); this.write(FEND);
    this.flush();
  }
}

/** O firmware guarda o tempo no ar como float de 32 bits e devolve truncado (Utilities.h). */
function alockFrom(d: Uint8Array): number {
  const at = (d[0]! << 8) | d[1]!;
  if (at === 0) return 0;
  const f = Math.fround(at / 10_000);
  return f >= 1 ? 0 : f;
}
const alockTo = (f: number) => Math.trunc(Math.fround(Math.fround(f * 100) * 100)) & 0xffff;
