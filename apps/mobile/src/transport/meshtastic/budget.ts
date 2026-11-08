/**
 * Tempo de rádio na rede LoRa compartilhada: balde de fichas, uma ficha por pedaço. Padrão: rajada de 4
 * (uma mensagem inteira) e 3 por minuto em regime (~9 % de um canal LongFast para este aparelho).
 */
export class AirtimeBudget {
  private tokens: number;
  private at = 0;
  private readonly perMs: number;
  constructor(private readonly o: { perMinute: number; burst: number } = { perMinute: 3, burst: 4 }) {
    this.tokens = o.burst;
    this.perMs = o.perMinute / 60_000;
  }
  private refill(now: number) {
    this.tokens = Math.min(this.o.burst, this.tokens + Math.max(0, now - this.at) * this.perMs);
    this.at = now;
  }
  /** Gasta `n` fichas se houver todas; senão não gasta nada. */
  take(n: number, now: number): boolean {
    this.refill(now);
    if (this.tokens + 1e-9 < n) return false;
    this.tokens -= n;
    return true;
  }
  /** Quanto falta (ms) para haver `n` fichas. */
  waitMs(n: number, now: number): number {
    this.refill(now);
    return this.tokens >= n ? 0 : Math.ceil((n - this.tokens) / this.perMs);
  }
}
