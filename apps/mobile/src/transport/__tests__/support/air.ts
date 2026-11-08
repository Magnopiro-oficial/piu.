/**
 * O ar entre as placas emuladas, com relógio virtual: cada pacote ocupa o canal pelo tempo no ar da
 * fórmula da Semtech e chega a quem está no mesmo canal (frequência, banda, SF), ligado, sem transmitir
 * e com sinal acima da sensibilidade. Perda pela distância (modelo log-distância, expoente 3,3 de área
 * suburbana, com sombreamento aleatório de 4 dB); dois pacotes que se sobrepõem no receptor se perdem,
 * a menos que um chegue 6 dB mais forte (efeito de captura do LoRa).
 */
import { airtimeMs, type Phy, type RNodeEmulator } from '../../rnode/emulator';
import { seeded } from './rnodeBench';

type Node = { emu: RNodeEmulator; x: number; y: number };
type Tx = { from: Node; pkt: Uint8Array; phy: Phy; start: number; end: number };

const SNR_LIMIT: Record<number, number> = { 5: -2.5, 6: -5, 7: -7.5, 8: -10, 9: -12.5, 10: -15, 11: -17.5, 12: -20 };
/** Sensibilidade do receptor (dBm): ruído térmico + figura de ruído 6 dB + SNR mínimo do SF. */
export const sensitivity = (p: Pick<Phy, 'bwHz' | 'sf'>) => -174 + 10 * Math.log10(p.bwHz) + 6 + SNR_LIMIT[p.sf]!;

export class Air {
  t: number;
  private nodes: Node[] = [];
  private txs: Tx[] = [];
  private rnd: () => number;
  /** Para conferir o uso do canal: tudo que foi ao ar. */
  log: Tx[] = [];
  constructor(start: number, o: { seed?: number; exponent?: number; shadowDb?: number; antennaDbi?: number } = {}) {
    this.t = start;
    this.rnd = seeded(o.seed ?? 3);
    this.o = { exponent: o.exponent ?? 3.3, shadowDb: o.shadowDb ?? 4, antennaDbi: o.antennaDbi ?? 2 };
  }
  private o: { exponent: number; shadowDb: number; antennaDbi: number };
  now = () => this.t;

  add(emu: RNodeEmulator, x: number, y = 0) {
    const n = { emu, x, y };
    this.nodes.push(n);
    emu.onTransmit((pkt, phy, start) => {
      const tx = { from: n, pkt, phy, start, end: start + airtimeMs(pkt.length, phy) };
      this.txs.push(tx); this.log.push(tx);
    });
    return n;
  }

  /** Potência recebida (dBm), com sombreamento sorteado por pacote. */
  rssi(tx: Tx, to: Node) {
    const d = Math.max(1, Math.hypot(tx.from.x - to.x, tx.from.y - to.y));
    const fMHz = tx.phy.freqHz / 1e6;
    const pl1m = 20 * Math.log10(fMHz) - 27.55;
    const shadow = (this.rnd() * 2 - 1) * this.o.shadowDb;
    return tx.phy.txDbm + 2 * this.o.antennaDbi - (pl1m + 10 * this.o.exponent * Math.log10(d)) + shadow;
  }

  private same(a: Phy, b: Phy) { return a.freqHz === b.freqHz && a.bwHz === b.bwHz && a.sf === b.sf; }

  /** Avança o relógio até `ms` depois, entregando cada pacote que termina nesse tempo. */
  run(ms: number) {
    const until = this.t + ms;
    for (;;) {
      const next = this.txs.filter(x => x.end <= until).sort((a, b) => a.end - b.end)[0];
      if (!next) break;
      this.t = Math.max(this.t, next.end);
      this.txs.splice(this.txs.indexOf(next), 1);
      this.deliver(next);
    }
    this.t = until;
    for (const n of this.nodes) n.emu.drain();
  }

  private deliver(tx: Tx) {
    for (const to of this.nodes) {
      if (to === tx.from) continue;
      const rx = to.emu.phy();
      if (!rx || !this.same(rx, tx.phy)) continue;
      // Meio-duplex: quem estava transmitindo no mesmo canal não ouviu.
      if (this.log.some(o => o.from === to && this.same(o.phy, tx.phy) && o.start < tx.end && o.end > tx.start)) continue;
      const p = this.rssi(tx, to);
      if (p < sensitivity(tx.phy)) continue;
      const rivals = this.log.filter(o => o !== tx && o.from !== to && this.same(o.phy, tx.phy) && o.start < tx.end && o.end > tx.start);
      if (rivals.some(o => this.rssi(o, to) > p - 6)) continue;
      to.emu.receive(tx.pkt, Math.round(p), Math.round(p - (-174 + 10 * Math.log10(tx.phy.bwHz) + 6)));
    }
  }
}
