/**
 * Rádio LoRa simulado, para testes e desenvolvimento sem placa. Cada rádio é um `Modem` (o mesmo
 * fluxo KISS da porta serial) e o "ar" imita o que importa do meio real:
 * - alcance: só ouve quem está ligado por `link(a, b)` (topologia em linha, losango etc.);
 * - tempo no ar pela fórmula da Semtech, com o pacote chegando só depois disso;
 * - pacote acima de 255 bytes é recusado pelo rádio;
 * - perda aleatória por enlace;
 * - colisão: dois pacotes chegando ao mesmo tempo a um rádio se perdem; quem está transmitindo
 *   não ouve (meio half-duplex).
 */
import { type LoraParams, loraAirtimeMs } from './airtime.js';
import { KissDecoder, kissEncode } from './kiss.js';
import type { Modem } from './serial.js';

interface SimRadio {
  name: string;
  decoder: KissDecoder;
  listeners: ((b: Uint8Array) => void)[];
  /** Fim da transmissão atual deste rádio (ms). */
  txUntil: number;
  /** Transmissões recentes [início, fim]: quem transmite não ouve. */
  tx: [number, number][];
  /** Recepções em curso: [início, fim, pacote, perdido]. */
  rx: { start: number; end: number; lost: boolean }[];
  closed: boolean;
}

export interface RadioSimOptions {
  radio?: LoraParams;
  /** Perda em cada enlace (0–1). */
  loss?: number;
  maxPacket?: number;
  random?: () => number;
}

export class RadioSim {
  private radios = new Map<string, SimRadio>();
  private range = new Map<string, Set<string>>();
  readonly stats = { transmitted: 0, delivered: 0, lost: 0, collisions: 0, tooLarge: 0 };
  private rand: () => number;

  constructor(private o: RadioSimOptions = {}) { this.rand = o.random ?? Math.random; }

  get params(): LoraParams { return this.o.radio ?? { sf: 7, bwKHz: 500, cr: 5 }; }

  /** Um rádio novo, ligado à "porta serial" que o piu-node abre. */
  modem(name: string): Modem {
    const r: SimRadio = { name, decoder: new KissDecoder(this.o.maxPacket ?? 255), listeners: [], txUntil: 0, tx: [], rx: [], closed: false };
    this.radios.set(name, r);
    this.range.set(name, this.range.get(name) ?? new Set());
    return {
      label: `sim:${name}`,
      write: bytes => { for (const pkt of r.decoder.push(bytes)) this.transmit(r, pkt); },
      onData: cb => { r.listeners.push(cb); },
      close: () => { r.closed = true; },
    };
  }

  /** Coloca dois rádios no alcance um do outro. */
  link(a: string, b: string) {
    if (!this.range.has(a)) this.range.set(a, new Set());
    if (!this.range.has(b)) this.range.set(b, new Set());
    this.range.get(a)!.add(b); this.range.get(b)!.add(a);
  }
  unlink(a: string, b: string) { this.range.get(a)?.delete(b); this.range.get(b)?.delete(a); }

  private transmit(from: SimRadio, pkt: Uint8Array) {
    if (from.closed) return;
    if (pkt.length > (this.o.maxPacket ?? 255)) { this.stats.tooLarge++; return; }
    this.stats.transmitted++;
    const now = Date.now();
    const at = loraAirtimeMs(pkt.length, this.params);
    const start = Math.max(now, from.txUntil);
    from.txUntil = start + at;
    from.tx.push([start, start + at]);
    from.tx = from.tx.filter(([, e]) => e > now - 10_000);
    for (const name of this.range.get(from.name) ?? []) {
      const to = this.radios.get(name);
      if (!to || to.closed) continue;
      const rx = { start, end: start + at, lost: this.rand() < (this.o.loss ?? 0) };
      // Colisão com outra recepção que se sobrepõe: as duas se perdem.
      for (const other of to.rx) if (other.end > rx.start && other.start < rx.end) { if (!other.lost || !rx.lost) this.stats.collisions++; other.lost = true; rx.lost = true; }
      to.rx.push(rx);
      setTimeout(() => {
        to.rx.splice(to.rx.indexOf(rx), 1);
        // Quem estava transmitindo durante a recepção não ouviu (half-duplex).
        if (to.tx.some(([s, e]) => e > rx.start && s < rx.end)) { if (!rx.lost) this.stats.collisions++; rx.lost = true; }
        if (rx.lost || to.closed) { this.stats.lost++; return; }
        this.stats.delivered++;
        const frame = kissEncode(pkt);
        for (const l of to.listeners) l(frame);
      }, Math.max(0, rx.end - now)).unref?.();
    }
  }
}
