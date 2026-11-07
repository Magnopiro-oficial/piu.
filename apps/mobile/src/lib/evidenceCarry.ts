/**
 * Evidências e registro do modo nó pela malha até a caixa do validador (docs/carteira/transacoes-pela-malha.md).
 * O arquivo (`EvidenceFile` de messaging/evidence.ts, `PhoneRegistryFile` de lib/phoneNodeCore.ts) é
 * dividido em partes que são, cada uma, um arquivo VÁLIDO sozinho (o validador lê vários arquivos e
 * junta; recibo repetido é descartado por ele). Cada parte vai selada para a chave do validador
 * (`sealBundle`): gateways e relays só carregam. O compartilhamento manual do arquivo continua valendo.
 */
import { BundleKind, MAX_BUNDLE_BYTES, sealBundle } from '../protocol/carry';
import type { EvidenceFile } from '../messaging/evidence';
import type { PhoneRegistryFile } from './phoneNodeCore';

/** Folga para o selo (versão, chave efêmera, nonce, tag, tipo) e para o JSON da moldura. */
const JSON_BUDGET = MAX_BUNDLE_BYTES - 256;
const size = (o: unknown) => new TextEncoder().encode(JSON.stringify(o)).length;

/** Distribui `items` em partes até `budget` bytes de JSON cada, partindo de `base(lista)`. */
function pack<T>(items: T[], frame: (part: T[]) => unknown, budget = JSON_BUDGET): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  for (const it of items) {
    if (size(frame([it])) > budget) continue; // um item sozinho não cabe: fica para o arquivo manual
    if (cur.length && size(frame([...cur, it])) > budget) { out.push(cur); cur = []; }
    cur.push(it);
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Partes do arquivo de evidências: recibos, provas v2 e provas v1, cada parte um `EvidenceFile` v2. */
export function evidenceParts(file: EvidenceFile): EvidenceFile[] {
  type Item = { k: 'r'; v: EvidenceFile['receipts'][number] } | { k: 's'; v: EvidenceFile['sealedProofs'][number] } | { k: 'p'; v: EvidenceFile['proofs'][number] };
  const items: Item[] = [...file.receipts.map(v => ({ k: 'r' as const, v })), ...file.sealedProofs.map(v => ({ k: 's' as const, v })), ...file.proofs.map(v => ({ k: 'p' as const, v }))];
  const frame = (part: Item[]): EvidenceFile => ({
    v: 2,
    receipts: part.flatMap(x => (x.k === 'r' ? [x.v] : [])),
    proofs: part.flatMap(x => (x.k === 'p' ? [x.v] : [])),
    sealedProofs: part.flatMap(x => (x.k === 's' ? [x.v] : [])),
  });
  return pack(items, frame).map(frame);
}

/**
 * Partes do arquivo de registro: a primeira leva registro, avais, saídas e retiradas; os certificados
 * das chaves do dia se dividem entre as partes (cada um se confere sozinho no validador).
 */
export function registryParts(file: PhoneRegistryFile): PhoneRegistryFile[] {
  const head: PhoneRegistryFile = { ...file, certs: [] };
  const frame = (certs: PhoneRegistryFile['certs']): PhoneRegistryFile => ({ v: 1, certs, revocations: [], phones: [], endorsements: [], exits: [], endorsementRevocations: [] });
  const headBudget = JSON_BUDGET - size(head);
  if (headBudget < 0) return [];
  const first = pack(file.certs, c => ({ ...head, certs: c }), JSON_BUDGET);
  if (!first.length) return [head];
  // A primeira parte com o cabeçalho; as demais só com certificados (o empacotamento é o mesmo, com folga).
  const [a, ...rest] = first;
  const restCerts = rest.flat();
  return [{ ...head, certs: a! }, ...pack(restCerts, frame).map(frame)];
}

/** Sela cada parte para a chave do validador. Sem chave publicada (`null`), nada vai pela malha. */
export function sealEvidence(file: EvidenceFile, validatorPk: Uint8Array | null): Uint8Array[] {
  if (!validatorPk) return [];
  return evidenceParts(file).map(p => sealBundle(BundleKind.Evidence, JSON.stringify(p), validatorPk));
}
export function sealRegistry(file: PhoneRegistryFile | null, validatorPk: Uint8Array | null): Uint8Array[] {
  if (!validatorPk || !file) return [];
  return registryParts(file).map(p => sealBundle(BundleKind.Registry, JSON.stringify(p), validatorPk));
}
