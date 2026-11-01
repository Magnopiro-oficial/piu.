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
import { hash, sign } from './suite';

export interface RelayReceipt { envelopeId: string; ackHash: Uint8Array; nodePk: Uint8Array; at: number; sig: Uint8Array }

const receiptMessage = (envelopeId: string, ackHash: Uint8Array, nodePk: Uint8Array, at: number) =>
  hash(concat(utf8('piu/v0/relay-receipt'), utf8(envelopeId), ackHash, nodePk, new Writer().u32(at).done()));

export function makeRelayReceipt(node: KeyPair, envelopeId: string, ackHash: Uint8Array, at: number): RelayReceipt {
  return { envelopeId, ackHash, nodePk: node.pk, at, sig: sign.sign(receiptMessage(envelopeId, ackHash, node.pk, at), node.sk) };
}

export const verifyRelayReceipt = (r: RelayReceipt) => sign.verify(r.sig, receiptMessage(r.envelopeId, r.ackHash, r.nodePk, r.at), r.nodePk);

export type CreditState = 'pendente' | 'validado' | 'rejeitado';

/**
 * Validador de contribuições (simplificado): os mesmos estados que a carteira mostra.
 * Rejeita assinatura falsa e recibo repetido; mantém pendente até a entrega ser comprovada.
 */
export class ContributionLedger {
  private receipts = new Map<string, { r: RelayReceipt; state: CreditState; reason?: string }>();
  private delivered = new Map<string, Uint8Array>(); // envelopeId → ackHash comprovado

  submit(r: RelayReceipt): CreditState {
    const key = `${r.envelopeId}:${toHex(r.nodePk)}`;
    if (this.receipts.has(key)) return 'rejeitado'; // duplicata: não gera crédito duplicado
    if (!verifyRelayReceipt(r)) { this.receipts.set(key, { r, state: 'rejeitado', reason: 'assinatura inválida' }); return 'rejeitado'; }
    const proof = this.delivered.get(r.envelopeId);
    const state: CreditState = proof ? (equal(proof, r.ackHash) ? 'validado' : 'rejeitado') : 'pendente';
    this.receipts.set(key, { r, state });
    return state;
  }

  /** O destino revela o segredo de entrega. Valida os recibos pendentes daquele envelope. */
  confirmDelivery(envelopeId: string, ackSecret: Uint8Array, ackHash: Uint8Array): boolean {
    if (!equal(hash(ackSecret).slice(0, 16), ackHash)) return false;
    this.delivered.set(envelopeId, ackHash);
    for (const v of this.receipts.values()) {
      if (v.r.envelopeId === envelopeId && v.state === 'pendente') v.state = equal(v.r.ackHash, ackHash) ? 'validado' : 'rejeitado';
    }
    return true;
  }

  /** Créditos por nó e estado (uma retransmissão útil = 1 crédito, ilustrativo). */
  summary(nodePk: Uint8Array): Record<CreditState, number> {
    const out: Record<CreditState, number> = { pendente: 0, validado: 0, rejeitado: 0 };
    for (const v of this.receipts.values()) if (equal(v.r.nodePk, nodePk)) out[v.state] += 1;
    return out;
  }
}
