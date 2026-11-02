import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_FAILURES = 5;

export type PairResult = 'ok' | 'invalid' | 'expired' | 'locked';

const hash = (s: string) => createHash('sha256').update(s).digest();

/**
 * Código de pareamento de uso único (8 dígitos, 10 minutos), mostrado só no console/tela do
 * equipamento: provar o código é provar acesso físico ao nó.
 * - Guardado só como hash; comparação em tempo constante.
 * - Depois de 5 erros (de qualquer origem) o código é destruído: um atacante na rede não tem como
 *   continuar tentando; o operador gera outro no próprio equipamento.
 * Força bruta: 10^8 combinações, 5 tentativas por código.
 */
export class Pairing {
  private cur: { hash: Buffer; expiresAt: number; failures: number } | null = null;

  /** Novo código (invalida o anterior). Mostre-o só localmente. */
  issue(now: number): string {
    const code = String(randomInt(0, 100_000_000)).padStart(8, '0');
    this.cur = { hash: hash(code), expiresAt: now + CODE_TTL_MS, failures: 0 };
    return code;
  }

  get active() { return this.cur !== null; }

  verify(input: string, now: number): PairResult {
    if (!this.cur) return 'locked';
    if (now > this.cur.expiresAt) { this.cur = null; return 'expired'; }
    const ok = /^\d{8}$/.test(input) && timingSafeEqual(hash(input), this.cur.hash);
    if (ok) { this.cur = null; return 'ok'; } // uso único
    this.cur.failures += 1;
    if (this.cur.failures >= MAX_FAILURES) { this.cur = null; return 'locked'; }
    return 'invalid';
  }
}
