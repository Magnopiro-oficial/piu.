/**
 * Arquivo de evidências deste aparelho no formato `EvidenceFile` v1 que o validador lê
 * (apps/settlement/src/validator.ts, o mesmo que o piu-node exporta em `GET /api/relay/evidence`):
 * binários em hex, `at` em segundos (como assinado no recibo).
 * - `receipts`: recibos que o roteador deste aparelho assinou ao repassar envelopes de terceiros
 *   (os créditos guardados, menos os rejeitados aqui).
 * - `proofs`: segredos de entrega (`ackSecret`) que este aparelho conhece: os das mensagens que ele
 *   recebeu como destino e os que chegaram pela malha, mais os que validaram créditos guardados.
 * O validador confere cada assinatura e cada `hash(ackSecret) = ackHash`; o arquivo não tem nada de
 * conteúdo de mensagem nem de identidade de conversa.
 */
import { toHex } from '../protocol/bytes';
import { unb64url } from './card';
import type { Credit } from './credits';

export interface EvidenceFile {
  v: 1;
  receipts: { envelopeId: string; ackHash: string; nodePk: string; at: number; sig: string }[];
  proofs: { envelopeId: string; ackSecret: string }[];
}

const HEX32 = /^[0-9a-f]{32}$/;

export function buildEvidence(credits: Credit[], proofs: Iterable<[string, Uint8Array]>): EvidenceFile {
  const receipts = credits
    .filter(c => c.state !== 'rejeitado')
    .map(c => ({ envelopeId: c.envelopeId, ackHash: c.receipt.ackHash, nodePk: toHex(unb64url(c.receipt.nodePk)), at: c.at, sig: toHex(unb64url(c.receipt.sig)) }))
    .sort((a, b) => a.at - b.at || a.envelopeId.localeCompare(b.envelopeId));
  const seen = new Map<string, string>();
  for (const c of credits) if (c.proof && HEX32.test(c.proof)) seen.set(c.envelopeId, c.proof);
  for (const [id, secret] of proofs) if (secret.length === 16 && !seen.has(id)) seen.set(id, toHex(secret));
  const list = [...seen].map(([envelopeId, ackSecret]) => ({ envelopeId, ackSecret })).sort((a, b) => a.envelopeId.localeCompare(b.envelopeId));
  return { v: 1, receipts, proofs: list };
}

/** Nome do arquivo: `piu-evidencias-celular-AAAA-MM-DD.json` (dia local). */
export function evidenceFileName(nowMs: number): string {
  const d = new Date(nowMs);
  const p = (n: number) => String(n).padStart(2, '0');
  return `piu-evidencias-celular-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
}
