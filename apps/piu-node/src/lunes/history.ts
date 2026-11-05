/**
 * Histórico de movimentações da carteira de provider, lido do indexador público da Lunes com o mesmo
 * módulo do app (src/lunes/lunesHistory.ts, cópia gerada de apps/mobile/src/lib). Só leitura, sem chave.
 *
 * Mesma política de src/lunes/reader.ts: cache curto por endereço (60 s, o indexador é mais lento e
 * muda menos que o saldo), uma consulta para pedidos simultâneos, última leitura com o motivo quando o
 * indexador falha e uma espera (15 s) antes de tentar de novo depois de uma falha. Sem leitura anterior,
 * `history` é null — nunca uma lista vazia fingindo que a conta não tem movimentações.
 */
import { fetchLunesHistory, type HistorySnapshot, toHistorySnapshot } from './lunesHistory.js';

export interface LunesHistoryResult { history: HistorySnapshot | null; error: string | null; cached: boolean }

export interface LunesHistoryReaderOptions {
  fetch?: typeof fetch;
  indexer?: string;
  /** Quantos enviados e quantos recebidos pedir (padrão: 50 + 50, como no app). */
  first?: number;
  ttlMs?: number;
  retryMs?: number;
  timeoutMs?: number;
  now?: () => number;
}

export class LunesHistoryReader {
  private readonly o: LunesHistoryReaderOptions;
  private readonly ttl: number;
  private readonly retry: number;
  private readonly now: () => number;
  private last = new Map<string, HistorySnapshot>();
  private failed = new Map<string, { at: number; error: string }>();
  private inflight = new Map<string, Promise<LunesHistoryResult>>();

  constructor(o: LunesHistoryReaderOptions = {}) {
    this.o = o;
    this.ttl = o.ttlMs ?? 60_000;
    this.retry = o.retryMs ?? 15_000;
    this.now = o.now ?? Date.now;
  }

  async history(address: string): Promise<LunesHistoryResult> {
    const t = this.now();
    const last = this.last.get(address) ?? null;
    if (last && t - last.at < this.ttl) return { history: last, error: null, cached: true };
    const f = this.failed.get(address);
    if (f && t - f.at < this.retry) return { history: last, error: f.error, cached: true };
    const running = this.inflight.get(address);
    if (running) return running;
    const p = this.read(address).finally(() => this.inflight.delete(address));
    this.inflight.set(address, p);
    return p;
  }

  private async read(address: string): Promise<LunesHistoryResult> {
    try {
      const h = await fetchLunesHistory(address, {
        ...(this.o.fetch ? { fetch: this.o.fetch } : {}), ...(this.o.indexer ? { indexer: this.o.indexer } : {}),
        ...(this.o.first ? { first: this.o.first } : {}), ...(this.o.timeoutMs ? { timeoutMs: this.o.timeoutMs } : {}), now: this.now,
      });
      const snap = toHistorySnapshot(h);
      this.last.set(address, snap);
      this.failed.delete(address);
      return { history: snap, error: null, cached: false };
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Falha na consulta ao indexador da Lunes.';
      this.failed.set(address, { at: this.now(), error });
      return { history: this.last.get(address) ?? null, error, cached: false };
    }
  }
}
