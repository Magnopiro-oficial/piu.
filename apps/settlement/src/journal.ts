/**
 * Diário do liquidante: um arquivo por lote, gravado de forma atômica ANTES de cada passo que mexe
 * na chain. É o que impede pagar duas vezes depois de uma queda: a transação assinada fica guardada e
 * é reenviada com os mesmos bytes (mesmo nonce), que a chain só executa uma vez.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type LotState = 'assinado' | 'finalizado' | 'falhou' | 'vencido';

export interface JournalEntry {
  lot: string;
  digest: string;
  total: string;
  state: LotState;
  /** Tentativas (uma nova só depois que a anterior venceu sem entrar na chain). */
  attempts: { hash: string; hex: string; nonce: number; fromBlock: number; validUntil: number; fee: string; at: number }[];
  result?: { blockHash: string; blockNumber: number; error?: string };
  updatedAt: number;
}

export class Journal {
  constructor(private dir: string) { mkdirSync(dir, { recursive: true, mode: 0o700 }); }
  private path(lot: string) { return join(this.dir, `${lot}.json`); }

  get(lot: string): JournalEntry | null {
    try { return JSON.parse(readFileSync(this.path(lot), 'utf8')) as JournalEntry; } catch { return null; }
  }

  put(e: JournalEntry) {
    e.updatedAt = Date.now();
    const tmp = this.path(e.lot) + '.tmp';
    writeFileSync(tmp, JSON.stringify(e, null, 2), { mode: 0o600 });
    renameSync(tmp, this.path(e.lot));
  }
}
