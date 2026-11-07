/**
 * Evidências de contribuição (documento, seção 11) sem expor quem conversa com quem:
 * - Recibo de retransmissão: o nó assina (id do envelope, hash do segredo de entrega, horário) com a
 *   chave técnica do nó (nunca a identidade social nem a carteira).
 * - Prova de entrega: o destino revela o `ackSecret`, que estava DENTRO do conteúdo cifrado. Só quem
 *   decifrou consegue revelá-lo, e ele não diz quem é o destino. O validador confere hash(segredo) = ackHash.
 * O validador só credita recibos de envelopes com entrega comprovada, uma vez por (envelope, nó).
 * Limitação reconhecida no documento: isto não prova sozinho a transmissão física; precisa ser
 * combinado com amostragem e auditorias probabilísticas.
 */
import { concat, equal, toHex, utf8, Writer } from './bytes';
import type { KeyPair } from './keys';
import { hash, random, sign } from './suite';

export interface RelayReceipt { envelopeId: string; ackHash: Uint8Array; nodePk: Uint8Array; at: number; sig: Uint8Array }

const receiptMessage = (envelopeId: string, ackHash: Uint8Array, nodePk: Uint8Array, at: number) =>
  hash(concat(utf8('piu/v0/relay-receipt'), utf8(envelopeId), ackHash, nodePk, new Writer().u32(at).done()));

/**
 * Horário do recibo arredondado para a hora (para baixo) ANTES de assinar (proposta econômica, seção 7:
 * contra correlação por horário). Para baixo, o recibo nunca fica "no futuro" para o validador.
 */
export const RECEIPT_TIME_STEP_SEC = 3600;
export const roundReceiptTime = (at: number) => Math.floor(at / RECEIPT_TIME_STEP_SEC) * RECEIPT_TIME_STEP_SEC;

/** Assina o recibo. `at` (segundos) é arredondado para a hora: o horário exato não sai do aparelho. */
export function makeRelayReceipt(node: KeyPair, envelopeId: string, ackHash: Uint8Array, at: number): RelayReceipt {
  const t = roundReceiptTime(at);
  return { envelopeId, ackHash, nodePk: node.pk, at: t, sig: sign.sign(receiptMessage(envelopeId, ackHash, node.pk, t), node.sk) };
}

export const verifyRelayReceipt = (r: RelayReceipt) => sign.verify(r.sig, receiptMessage(r.envelopeId, r.ackHash, r.nodePk, r.at), r.nodePk);

/**
 * Carteira que recebe os créditos de um nó numa época (proposta econômica, seção 7): o vínculo
 * nó → carteira vale por lote de liquidação, para não criar um histórico público fixo. Assinado com a
 * chave técnica do nó; a carteira é um endereço LUNES (SS58), separado da identidade social.
 */
export interface PayoutClaim { epoch: string; address: string; nodePk: Uint8Array; sig: Uint8Array }

const claimMessage = (epoch: string, address: string, nodePk: Uint8Array) =>
  hash(concat(utf8('piu/v0/payout-claim'), utf8(epoch), Uint8Array.of(0), utf8(address), Uint8Array.of(0), nodePk));

export function makePayoutClaim(node: KeyPair, epoch: string, address: string): PayoutClaim {
  return { epoch, address, nodePk: node.pk, sig: sign.sign(claimMessage(epoch, address, node.pk), node.sk) };
}

export const verifyPayoutClaim = (c: PayoutClaim) => sign.verify(c.sig, claimMessage(c.epoch, c.address, c.nodePk), c.nodePk);

export type CreditState = 'pendente' | 'validado' | 'rejeitado';

export interface LedgerPolicy {
  /** Uma rota útil tem no máximo este número de relays: recibos além disso são suspeitos (spam, colusão). */
  maxRelaysPerEnvelope: number;
  /** Teto de créditos por nó por dia (tráfego artificial e Sybil ficam limitados). */
  maxPerNodePerDay: number;
  /** Tolerância de relógio para o horário do recibo. */
  clockSkewSec: number;
}

export const DEFAULT_POLICY: LedgerPolicy = { maxRelaysPerEnvelope: 8, maxPerNodePerDay: 5000, clockSkewSec: 300 };

interface Entry { r: RelayReceipt; state: CreditState; reason?: string }

/**
 * Validador de contribuições (simplificado): os mesmos estados que a carteira mostra.
 * Combina evidências independentes, como pede o documento:
 * - assinatura do nó e deduplicação (envelope, nó);
 * - prova de entrega pelo destino (sem ela, fica pendente);
 * - tetos por envelope e por nó/dia;
 * - auditoria por amostragem: um nó reprovado perde os créditos pendentes e é bloqueado.
 */
export class ContributionLedger {
  private receipts = new Map<string, Entry>();
  private delivered = new Map<string, Uint8Array>(); // envelopeId → ackHash comprovado
  /** Envelopes com provas que não batem entre si: ninguém ganha (auditoria 2026-11-06, A-01). */
  private conflicted = new Set<string>();
  private perEnvelope = new Map<string, number>();
  private perNodeDay = new Map<string, number>();
  private blocked = new Set<string>();
  readonly policy: LedgerPolicy;

  constructor(policy: Partial<LedgerPolicy> = {}) { this.policy = { ...DEFAULT_POLICY, ...policy }; }

  private reject(key: string, r: RelayReceipt, reason: string): CreditState {
    this.receipts.set(key, { r, state: 'rejeitado', reason });
    return 'rejeitado';
  }

  submit(r: RelayReceipt, now = r.at): CreditState {
    const node = toHex(r.nodePk);
    const key = `${r.envelopeId}:${node}`;
    if (this.receipts.has(key)) return 'rejeitado'; // duplicata: não gera crédito duplicado (nem registro novo)
    if (!verifyRelayReceipt(r)) return this.reject(key, r, 'assinatura inválida');
    if (this.blocked.has(node)) return this.reject(key, r, 'nó bloqueado por auditoria');
    if (r.at > now + this.policy.clockSkewSec) return this.reject(key, r, 'horário no futuro');
    if (this.conflicted.has(r.envelopeId)) return this.reject(key, r, 'provas conflitantes');
    const relays = (this.perEnvelope.get(r.envelopeId) ?? 0) + 1;
    if (relays > this.policy.maxRelaysPerEnvelope) return this.reject(key, r, 'recibos demais para o mesmo envelope');
    const dayKey = `${node}:${Math.floor(r.at / 86400)}`;
    const today = (this.perNodeDay.get(dayKey) ?? 0) + 1;
    if (today > this.policy.maxPerNodePerDay) return this.reject(key, r, 'teto diário do nó');
    this.perEnvelope.set(r.envelopeId, relays);
    this.perNodeDay.set(dayKey, today);
    const proof = this.delivered.get(r.envelopeId);
    const state: CreditState = proof ? (equal(proof, r.ackHash) ? 'validado' : 'rejeitado') : 'pendente';
    this.receipts.set(key, { r, state });
    return state;
  }

  /**
   * O destino revela o segredo de entrega. Valida os recibos pendentes daquele envelope.
   * A primeira prova vale; repetir a mesma não muda nada. Uma prova DIFERENTE para o mesmo envelope
   * não sobrescreve (antes, a última vencia e negava o crédito de todos): o envelope fica em
   * conflito e nenhum recibo dele é creditado (auditoria 2026-11-06, A-01).
   * Este livro é o simplificado (v1, estimativa local). O validador que paga usa a prova v2 (proof.ts).
   */
  confirmDelivery(envelopeId: string, ackSecret: Uint8Array, ackHash: Uint8Array): boolean {
    if (!equal(hash(ackSecret).slice(0, 16), ackHash)) return false;
    if (this.conflicted.has(envelopeId)) return false;
    const prev = this.delivered.get(envelopeId);
    if (prev && equal(prev, ackHash)) return true;
    if (prev) {
      this.conflicted.add(envelopeId);
      this.delivered.delete(envelopeId);
      for (const v of this.receipts.values()) {
        if (v.r.envelopeId === envelopeId && v.state !== 'rejeitado') { v.state = 'rejeitado'; v.reason = 'provas conflitantes'; }
      }
      return false;
    }
    this.delivered.set(envelopeId, ackHash);
    for (const v of this.receipts.values()) {
      if (v.r.envelopeId === envelopeId && v.state === 'pendente') v.state = equal(v.r.ackHash, ackHash) ? 'validado' : 'rejeitado';
    }
    return true;
  }

  /**
   * Sorteia recibos para auditoria (ex.: desafio de retransmissão feito por outro nó).
   * `rand` retorna [0, 1); o padrão usa aleatoriedade criptográfica.
   */
  sampleForAudit(rate: number, rand: () => number = () => random(4).reduce((a, b) => a * 256 + b, 0) / 2 ** 32): RelayReceipt[] {
    return [...this.receipts.values()].filter(v => v.state !== 'rejeitado' && rand() < rate).map(v => v.r);
  }

  /** Resultado de uma auditoria. Reprovado: o nó é bloqueado e perde o que ainda não foi pago. */
  auditResult(nodePk: Uint8Array, passed: boolean) {
    if (passed) return;
    const node = toHex(nodePk);
    this.blocked.add(node);
    for (const v of this.receipts.values()) {
      if (toHex(v.r.nodePk) === node && v.state !== 'rejeitado') { v.state = 'rejeitado'; v.reason = 'reprovado em auditoria'; }
    }
  }

  /** Recibos e o estado de cada um (o validador fecha a época a partir daqui). */
  *entries(): Generator<{ receipt: RelayReceipt; state: CreditState; reason?: string }> {
    for (const v of this.receipts.values()) yield { receipt: v.r, state: v.state, reason: v.reason };
  }

  isBlocked(nodePk: Uint8Array) { return this.blocked.has(toHex(nodePk)); }

  /** Créditos por nó e estado (uma retransmissão útil = 1 crédito, ilustrativo). */
  summary(nodePk: Uint8Array): Record<CreditState, number> {
    const out: Record<CreditState, number> = { pendente: 0, validado: 0, rejeitado: 0 };
    for (const v of this.receipts.values()) if (equal(v.r.nodePk, nodePk)) out[v.state] += 1;
    return out;
  }
}
