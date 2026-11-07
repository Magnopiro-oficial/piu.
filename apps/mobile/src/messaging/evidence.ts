/**
 * Arquivo de evidências deste aparelho no formato `EvidenceFile` v2 que o validador lê
 * (apps/settlement/src/validator.ts, o mesmo que o piu-node exporta em `GET /api/relay/evidence`):
 * binários em hex, `at` em segundos (como assinado no recibo).
 * - `receipts`: recibos que o roteador deste aparelho assinou ao repassar envelopes de terceiros
 *   (os créditos guardados, menos os rejeitados aqui).
 * - `proofs`: legado v1, segredos de entrega (`ackSecret`) que este aparelho conhece. O validador v2
 *   não paga por eles (docs/economia/prova-de-entrega-v2.md); continuam aqui para quem confere à mão.
 * - `sealedProofs`: provas de entrega v2 (protocol/proof.ts), assinadas pelo destino e seladas para a
 *   chave do validador: as que este aparelho fez como destino e as que chegaram pela malha.
 * O arquivo não tem conteúdo de mensagem, e a identidade do destino só está DENTRO das provas
 * seladas (só o validador abre).
 */
import { toHex } from '../protocol/bytes';
import { SEALED_PROOF_BYTES } from '../protocol/proof';
import { unb64url } from './card';
import type { Credit } from './credits';

export interface EvidenceFile {
  v: 2;
  receipts: { envelopeId: string; ackHash: string; nodePk: string; at: number; sig: string }[];
  proofs: { envelopeId: string; ackSecret: string }[];
  sealedProofs: { envelopeId: string; sealed: string }[];
}

const HEX32 = /^[0-9a-f]{32}$/;
const SEALED = new RegExp(`^[0-9a-f]{${SEALED_PROOF_BYTES * 2}}$`);

export function buildEvidence(credits: Credit[], proofs: Iterable<[string, Uint8Array]>, sealed: Iterable<[string, Uint8Array]> = []): EvidenceFile {
  const receipts = credits
    .filter(c => c.state !== 'rejeitado')
    .map(c => ({ envelopeId: c.envelopeId, ackHash: c.receipt.ackHash, nodePk: toHex(unb64url(c.receipt.nodePk)), at: c.at, sig: toHex(unb64url(c.receipt.sig)) }))
    .sort((a, b) => a.at - b.at || a.envelopeId.localeCompare(b.envelopeId));
  const seen = new Map<string, string>();
  for (const c of credits) if (c.proof && HEX32.test(c.proof)) seen.set(c.envelopeId, c.proof);
  for (const [id, secret] of proofs) if (secret.length === 16 && !seen.has(id)) seen.set(id, toHex(secret));
  const list = [...seen].map(([envelopeId, ackSecret]) => ({ envelopeId, ackSecret })).sort((a, b) => a.envelopeId.localeCompare(b.envelopeId));
  // Várias provas por envelope podem ir (até 3 em cada fonte): o validador descarta as que não conferem.
  const v2 = new Map<string, { envelopeId: string; sealed: string }>();
  const add = (envelopeId: string, hex: string) => { if (HEX32.test(envelopeId) && SEALED.test(hex)) v2.set(hex, { envelopeId, sealed: hex }); };
  for (const c of credits) for (const h of Array.isArray(c.sealed) ? c.sealed : []) add(c.envelopeId, h);
  for (const [id, b] of sealed) if (b.length === SEALED_PROOF_BYTES) add(id, toHex(b));
  const sealedProofs = [...v2.values()].sort((a, b) => a.envelopeId.localeCompare(b.envelopeId) || a.sealed.localeCompare(b.sealed));
  return { v: 2, receipts, proofs: list, sealedProofs };
}

/** Nome do arquivo: `piu-evidencias-celular-AAAA-MM-DD.json` (dia local). */
export function evidenceFileName(nowMs: number): string {
  const d = new Date(nowMs);
  const p = (n: number) => String(n).padStart(2, '0');
  return `piu-evidencias-celular-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
}
