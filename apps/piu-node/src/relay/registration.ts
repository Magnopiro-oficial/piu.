/**
 * Arquivo de registro para o validador v2 (docs/economia/prova-de-entrega-v2.md, seção 4.7): os
 * certificados `OPERATOR_CERT` dos equipamentos e a lista de revogação do operador, no formato
 * `RegistryFile` que `apps/settlement` lê em `dados/registro/*.json`. Só o validador decide quais
 * operadores admite (`operadores.json`); este arquivo se autoverifica (assinaturas do operador).
 * Avais: o operador pode avalizar celulares (docs/economia/no-celular.md, "semente da confiança"):
 * `endorsements` vai no mesmo arquivo, e o validador lê avais de qualquer arquivo de registro.
 * Pendente: rota no painel para o dono baixar este arquivo e avalizar um celular (app.ts).
 */
import type { EndorsementJson, EndorsementRevocationJson } from '../protocol/phoneNode.js';
import { certToJson, type CertJson, type ListJson, listToJson, type OperatorCert, type RevocationList } from './operator-frames.js';

export interface RegistryFile { v: 1; certs: CertJson[]; revocations: ListJson[]; endorsements?: EndorsementJson[]; endorsementRevocations?: EndorsementRevocationJson[] }

export function registrationFile(certs: (OperatorCert | null | undefined)[], lists: (RevocationList | null | undefined)[] = [], endorsements: EndorsementJson[] = [], unendorsed: EndorsementRevocationJson[] = []): RegistryFile {
  const seen = new Set<string>();
  const out: CertJson[] = [];
  for (const c of certs) {
    if (!c) continue;
    const j = certToJson(c);
    const k = `${j.operatorPk}:${j.nodePk}:${j.issuedAt}`;
    if (!seen.has(k)) { seen.add(k); out.push(j); }
  }
  const base: RegistryFile = { v: 1, certs: out, revocations: lists.filter((l): l is RevocationList => !!l).map(listToJson) };
  const avals = [...new Map(endorsements.map(e => [e.sig, e])).values()];
  const withAvals: RegistryFile = avals.length ? { ...base, endorsements: avals } : base;
  return unendorsed.length ? { ...withAvals, endorsementRevocations: [...new Map(unendorsed.map(e => [e.sig, e])).values()] } : withAvals;
}
