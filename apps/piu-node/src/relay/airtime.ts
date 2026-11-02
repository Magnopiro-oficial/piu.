/**
 * Tempo no ar de um pacote LoRa (fórmula da Semtech, AN1200.13) e limite de ocupação do canal.
 * O rádio guarda os parâmetros (SF, banda, taxa de código) no firmware; aqui eles servem para o nó
 * saber quanto tempo cada pacote ocupa o canal e não passar do limite configurado.
 */
export interface LoraParams {
  /** Spreading factor (7–12). */
  sf: number;
  /** Largura de banda em kHz (125, 250, 500). */
  bwKHz: number;
  /** Taxa de código: 5 a 8 (4/5 a 4/8). */
  cr: number;
  /** Símbolos de preâmbulo (padrão 8). */
  preamble?: number;
}

export function loraAirtimeMs(bytes: number, p: LoraParams): number {
  const tSym = (2 ** p.sf) / p.bwKHz; // ms
  const de = tSym > 16 ? 1 : 0;        // otimização para taxa baixa (obrigatória acima de 16 ms por símbolo)
  const preamble = ((p.preamble ?? 8) + 4.25) * tSym;
  const num = 8 * bytes - 4 * p.sf + 28 + 16; // CRC ligado, cabeçalho explícito
  const sym = 8 + Math.max(Math.ceil(num / (4 * (p.sf - 2 * de))) * p.cr, 0);
  return preamble + sym * tSym;
}

/** Ocupação do canal numa janela deslizante (padrão 1 h). */
export class DutyCycle {
  private log: [number, number][] = [];
  private sum = 0;
  constructor(private percent: number, private windowMs = 3_600_000) {}
  private trim(now: number) {
    while (this.log.length && this.log[0]![0] <= now - this.windowMs) this.sum -= this.log.shift()![1];
  }
  /** Cabe mais este tempo no ar agora? */
  allows(ms: number, now: number) { this.trim(now); return this.sum + ms <= (this.percent / 100) * this.windowMs; }
  spend(ms: number, now: number) { this.log.push([now, ms]); this.sum += ms; }
  used(now: number) { this.trim(now); return this.sum; }
  get budgetMs() { return (this.percent / 100) * this.windowMs; }
}
