/**
 * Liquidação de um lote, à prova de pagamento duplo.
 *
 * 1. Confere a chain (runtime, casas decimais, símbolo) e o saldo da conta pagadora (total + taxa +
 *    depósito existencial).
 * 2. Assina `utility.batchAll(transferKeepAlive… + remarkWithEvent)` com era mortal e GRAVA no diário.
 *    `batchAll` é tudo ou nada: ou todos recebem, ou ninguém.
 * 3. Envia e espera finalizar (GRANDPA). Grava o resultado.
 *
 * Depois de uma queda em qualquer ponto, rodar de novo:
 * - finalizado ou falhou → devolve o resultado (não paga de novo);
 * - assinado → procura a transação nos blocos em que ela podia entrar; achou → resultado;
 *   ainda dentro da validade → reenvia OS MESMOS bytes (o nonce garante uma execução só);
 *   validade passou sem entrar → aí sim assina de novo (nova tentativa).
 *
 * Pressuposto: a conta pagadora só é usada por este liquidante (senão o nonce muda por fora).
 */
import type { ChainClient, SignedLot, TxOutcome } from './chain.js';
import { preflight, TxRejected } from './chain.js';
import type { Journal, JournalEntry } from './journal.js';
import type { PlannedLot } from './lot.js';
import { planckToLunes } from './units.js';

export interface PayOptions {
  from: string;
  signer: unknown;
  log?: (m: string) => void;
  /** Espera entre consultas à chain (padrão: um bloco, 6 s). */
  wait?: () => Promise<void>;
  /** Tentativas novas no máximo (cada uma só depois de a anterior vencer sem entrar). */
  maxAttempts?: number;
}

export class SettlementError extends Error {}

type Attempt = Pick<SignedLot, 'hash' | 'hex' | 'fromBlock' | 'validUntil'>;

export async function payLot(chain: ChainClient, journal: Journal, lot: PlannedLot, o: PayOptions): Promise<JournalEntry> {
  const log = o.log ?? (() => {});
  const wait = o.wait ?? (() => new Promise<void>(r => setTimeout(r, 6000)));
  let e = journal.get(lot.id);
  if (e && e.digest !== lot.digest) throw new SettlementError(`O lote ${lot.id} já existe no diário com outros pagamentos. Use outro id.`);
  if (e && (e.state === 'finalizado' || e.state === 'falhou')) { log(`Lote ${lot.id} já ${e.state}.`); return e; }

  const info = await chain.info();
  const problems = preflight(info);
  if (problems.length) throw new SettlementError(`A chain não é a esperada: ${problems.join('; ')}.`);

  for (let round = 0; round < (o.maxAttempts ?? 3) + 1; round++) {
    // Retomada: a última tentativa assinada ainda pode estar a caminho (ou já ter entrado).
    const last = e?.state === 'assinado' ? e.attempts.at(-1) : undefined;
    if (e && last) {
      const r = await follow(chain, last, wait, log);
      if (r !== 'expired') return finish(journal, e, r, log);
      log(`A tentativa ${last.hash} venceu sem entrar na chain.`);
      e.state = 'vencido';
      journal.put(e);
      if (e.attempts.length >= (o.maxAttempts ?? 3)) break;
    }
    const fee = await chain.estimateFee(lot, o.from);
    const free = await chain.freeBalance(o.from);
    const need = lot.total + fee + info.existentialDeposit;
    if (free < need) throw new SettlementError(`Saldo insuficiente na conta pagadora: tem ${planckToLunes(free)}, precisa de ${planckToLunes(need)} LUNES.`);
    const signed = await chain.sign(lot, o.signer, await chain.nonce(o.from));
    e ??= { lot: lot.id, digest: lot.digest, total: lot.total.toString(), state: 'assinado', attempts: [], updatedAt: 0 };
    e.state = 'assinado';
    e.attempts.push({ hash: signed.hash, hex: signed.hex, nonce: signed.nonce, fromBlock: signed.fromBlock, validUntil: signed.validUntil, fee: signed.fee.toString(), at: Date.now() });
    journal.put(e); // gravado ANTES de enviar
    log(`Lote ${lot.id}: ${lot.payouts.length} pagamentos, ${planckToLunes(lot.total)} LUNES, taxa ~${planckToLunes(signed.fee)}. Enviando ${signed.hash}.`);
  }
  throw new SettlementError(`Lote ${lot.id}: ${e?.attempts.length ?? 0} tentativas venceram sem entrar na chain. Confira o nó e rode de novo.`);
}

/**
 * Leva uma tentativa até o fim: procura nos blocos, (re)envia os mesmos bytes enquanto valem e
 * espera. `expired`: a validade passou e ela não entrou (nunca mais pode entrar).
 */
async function follow(chain: ChainClient, a: Attempt, wait: () => Promise<void>, log: (m: string) => void): Promise<TxOutcome | 'expired'> {
  let sent = false;
  for (;;) {
    const info = await chain.info();
    const found = await chain.find(a.hash, a.fromBlock, Math.min(a.validUntil, info.finalized));
    if (found) return found;
    if (info.finalized > a.validUntil) return 'expired';
    if (!sent) {
      sent = true;
      try { return await chain.submit(a.hex); } catch (err) {
        if (!(err instanceof TxRejected) || err.kind === 'other') throw err;
        log(`O nó já conhece esta transação (${err.kind}); acompanhando pelos blocos.`);
      }
    }
    await wait();
  }
}
function finish(journal: Journal, e: JournalEntry, r: TxOutcome, log: (m: string) => void): JournalEntry {
  e.state = r.status === 'finalized' ? 'finalizado' : 'falhou';
  e.result = { blockHash: r.blockHash, blockNumber: r.blockNumber, ...(r.status === 'failed' ? { error: r.error } : {}) };
  journal.put(e);
  log(`Lote ${e.lot}: ${e.state} no bloco ${r.blockNumber} (${r.blockHash})${r.status === 'failed' ? `: ${r.error}` : ''}.`);
  return e;
}
