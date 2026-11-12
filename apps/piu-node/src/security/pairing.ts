import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_FAILURES = 5;
/** Com a origem informada: erros somados de todas as origens antes de destruir o código. */
const MAX_TOTAL_FAILURES = 20;

/** `blocked`: só aquela origem foi barrada; o código continua valendo para as demais. */
export type PairResult = 'ok' | 'invalid' | 'expired' | 'locked' | 'blocked';

const hash = (s: string) => createHash('sha256').update(s).digest();

/**
 * Código de pareamento de uso único (8 dígitos, 10 minutos), mostrado só no console/tela do
 * equipamento: provar o código é provar acesso físico ao nó.
 * - Guardado só como hash; comparação em tempo constante.
 * - Sem origem: depois de 5 erros o código é destruído; o operador gera outro no próprio equipamento.
 * - Com origem (IP): 5 erros barram só aquela origem e o código segue valendo para o dono, assim uma
 *   máquina da rede não consegue apagar o código de novo a cada emissão. 20 erros somados destroem o código.
 * Força bruta: 10^8 combinações, no máximo 20 tentativas por código.
 */
export class Pairing {
  private cur: { hash: Buffer; expiresAt: number; failures: number; bySource: Map<string, number> } | null = null;

  /** Novo código (invalida o anterior). Mostre-o só localmente. */
  issue(now: number): string {
    const code = String(randomInt(0, 100_000_000)).padStart(8, '0');
    this.cur = { hash: hash(code), expiresAt: now + CODE_TTL_MS, failures: 0, bySource: new Map() };
    return code;
  }

  get active() { return this.cur !== null; }

  verify(input: string, now: number, source?: string): PairResult {
    if (!this.cur) return 'locked';
    if (now > this.cur.expiresAt) { this.cur = null; return 'expired'; }
    // Origem já barrada: não testa mais nada (nem o código certo), sem gastar o código dos outros.
    if (source !== undefined && (this.cur.bySource.get(source) ?? 0) >= MAX_FAILURES) return 'blocked';
    const ok = /^\d{8}$/.test(input) && timingSafeEqual(hash(input), this.cur.hash);
    if (ok) { this.cur = null; return 'ok'; } // uso único
    this.cur.failures += 1;
    if (source === undefined) {
      if (this.cur.failures >= MAX_FAILURES) { this.cur = null; return 'locked'; }
      return 'invalid';
    }
    if (this.cur.failures >= MAX_TOTAL_FAILURES) { this.cur = null; return 'locked'; }
    const n = (this.cur.bySource.get(source) ?? 0) + 1;
    this.cur.bySource.set(source, n); // no máximo 20 entradas: cada uma custa um erro
    return n >= MAX_FAILURES ? 'blocked' : 'invalid';
  }
}
