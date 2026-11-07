/**
 * Diário do liquidante: um arquivo por lote, gravado de forma atômica ANTES de cada passo que mexe
 * na chain. É o que impede pagar duas vezes depois de uma queda: a transação assinada fica guardada e
 * é reenviada com os mesmos bytes (mesmo nonce), que a chain só executa uma vez.
 */
import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomic } from './fsutil.js';

export type LotState = 'assinado' | 'finalizado' | 'falhou' | 'vencido';

export interface JournalEntry {
  lot: string;
  digest: string;
  /** Hash só dos pagamentos (sem o id). Entradas antigas não têm. */
  payoutsDigest?: string;
  total: string;
  state: LotState;
  /** Tentativas (uma nova só depois que a anterior venceu sem entrar na chain). */
  attempts: { hash: string; hex: string; nonce: number; fromBlock: number; validUntil: number; fee: string; at: number }[];
  result?: { blockHash: string; blockNumber: number; error?: string };
  updatedAt: number;
}

export class LockedError extends Error {}

export class Journal {
  constructor(private dir: string) { mkdirSync(dir, { recursive: true, mode: 0o700 }); }
  private path(lot: string) { return join(this.dir, `${lot}.json`); }

  /**
   * Entrada do lote, ou `null` se o arquivo NÃO EXISTE. Arquivo ilegível ou corrompido aborta: tratar
   * como "lote novo" pagaria de novo (auditoria final, B-a).
   */
  get(lot: string): JournalEntry | null {
    let text: string;
    try { text = readFileSync(this.path(lot), 'utf8'); } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new Error(`Diário do lote ${lot} ilegível (${(e as Error).message}). Confira o arquivo antes de pagar.`);
    }
    try {
      const j = JSON.parse(text) as JournalEntry;
      if (!j || typeof j !== 'object' || j.lot !== lot || !Array.isArray(j.attempts)) throw new Error('formato');
      return j;
    } catch { throw new Error(`Diário do lote ${lot} corrompido (${this.path(lot)}). Não pago: confira na chain e corrija o arquivo à mão.`); }
  }

  /**
   * Trava exclusiva do lote (arquivo `<lote>.lock` criado com O_EXCL): dois `lot:pay` ao mesmo tempo
   * leriam o mesmo diário e assinariam duas vezes com nonces diferentes (auditoria final, M-2). Trava de
   * um processo que já morreu (pid gravado) é retomada; de um vivo, recusa. Devolve a função que solta.
   */
  lock(lot: string): () => void {
    const file = join(this.dir, `${lot}.lock`);
    for (let tries = 0; tries < 2; tries++) {
      try {
        const fd = openSync(file, 'wx', 0o600);
        try { writeSync(fd, String(process.pid)); } finally { closeSync(fd); }
        return () => { try { unlinkSync(file); } catch { /* já saiu */ } };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        const pid = Number(readFileSync(file, 'utf8').trim());
        let alive = true;
        if (Number.isInteger(pid) && pid > 0) { try { process.kill(pid, 0); } catch (k) { alive = (k as NodeJS.ErrnoException).code === 'EPERM'; } }
        if (alive) throw new LockedError(`Pagamento do lote ${lot} em andamento (trava ${file}, processo ${pid || '?'}). Espere terminar; se nenhum estiver rodando, apague a trava.`);
        try { unlinkSync(file); } catch { /* outro processo levou */ }
      }
    }
    throw new LockedError(`Pagamento do lote ${lot} em andamento (trava ${file}).`);
  }

  /** Outro lote do diário com os mesmos pagamentos (auditoria 2026-11-06, M-05). */
  findByPayouts(payoutsDigest: string, exceptLot: string): JournalEntry | null {
    let files: string[];
    try { files = readdirSync(this.dir).filter(f => f.endsWith('.json')); } catch { return null; }
    for (const f of files.sort()) {
      const lot = f.slice(0, -5);
      if (lot === exceptLot) continue;
      const e = this.get(lot);
      if (e?.payoutsDigest === payoutsDigest) return e;
    }
    return null;
  }

  /** Gravação atômica com fsync: se o diário se perde numa queda, o lote pode ser pago de novo. */
  put(e: JournalEntry) {
    e.updatedAt = Date.now();
    writeFileAtomic(this.path(e.lot), JSON.stringify(e, null, 2));
  }
}
