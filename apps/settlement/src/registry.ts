/**
 * Registro de nós (docs/economia/prova-de-entrega-v2.md, seção 4.7; auditoria 2026-11-06, C-01).
 *
 * Só nó REGISTRADO gera crédito: chave de nó com certificado `OPERATOR_CERT` de um operador admitido.
 * - `operadores.json` (confiável, de quem opera o validador): as chaves de operador admitidas.
 * - `registro/*.json` (não confiável, se autoverifica): certificados e listas de revogação, no MESMO
 *   formato JSON e com as MESMAS mensagens assinadas que o piu-node usa
 *   (apps/piu-node/src/relay/operator-frames.ts: `piu/lnnp/v1/operator-cert`, `…/operator-rotation`,
 *   `…/revocation`). Copiado aqui porque o liquidante roda sozinho, sem o piu-node; o teste
 *   test/registry.test.ts confere com o código do piu-node quando ele está presente.
 * - Rotação da chave de operador: os passos das cadeias são seguidos a partir da chave admitida. Depois
 *   de uma rotação em `at`, a chave anterior só vale para o que foi emitido ANTES de `at`, e a nova só
 *   a partir de `at` (certificado ou lista retroativos são recusados).
 * - Um nó certificado por dois operadores admitidos diferentes fica de fora (conflito).
 * - Lista de revogação: vale a de número maior de cada operador; nó revogado não gera crédito.
 * - Celulares (docs/economia/no-celular.md): a chave de operador de um celular HABILITADO (caução +
 *   avais, phone-nodes.ts) entra como raiz de classe `phone`, sem cadeia de rotação, com janela de
 *   vigência [habilitado desde, saída) sobre o horário do recibo, e a carteira declarada no registro.
 */
import { concat, toHex, utf8, Writer } from './protocol/bytes.js';
import type { KeyPair } from './protocol/keys.js';
import { hash, sign } from './protocol/suite.js';
import { fromHex, isU32, pkHex } from './hex.js';
import type { EndorsementJson, EndorsementRevocationJson, PhoneExitJson, PhoneRegistrationJson } from './protocol/phoneNode.js';

export interface StepJson { prevPk: string; nextPk: string; at: number; sig: string }
export interface CertJson { operatorPk: string; nodePk: string; issuedAt: number; sig: string; chain?: StepJson[] }
export interface ListJson { operatorPk: string; seq: number; issuedAt: number; revoked: string[]; sig: string }
export interface OperatorsFile { v: 1; operators: { pk: string; name?: string }[] }
export interface RegistryFile {
  v: 1; certs?: CertJson[]; revocations?: ListJson[];
  /** Celulares como nó (classe `phone`): registro, avais (de qualquer arquivo) e pedidos de saída. */
  phones?: PhoneRegistrationJson[]; endorsements?: EndorsementJson[]; exits?: PhoneExitJson[];
  endorsementRevocations?: EndorsementRevocationJson[];
}
export type OperatorClass = 'node' | 'phone';
/** Celular habilitado: janela [from, until) em horário de recibo, a carteira e a caução (planck) do registro. */
export interface PhoneWindow { from: number; until: number; wallet: string; bond: bigint }
/** Limites por arquivo de registro (não confiável): o resto do arquivo é ignorado. */
export const MAX_CERTS_PER_FILE = 256;

/** Folga entre a emissão do certificado e o recibo (o recibo é arredondado para a hora, para baixo). */
export const CERT_SLACK_SEC = 3600;
const MAX_CHAIN = 16;

// Estrito: fora de u32 lança erro (a cópia do protocolo reduz módulo 2^32; ver isU32, H-1).
const u32 = (n: number) => { if (!isU32(n)) throw new Error('fora de u32'); return new Writer().u32(n).done(); };
const certMessage = (op: Uint8Array, node: Uint8Array, issuedAt: number) => hash(concat(utf8('piu/lnnp/v1/operator-cert'), op, node, u32(issuedAt)));
const rotationMessage = (prev: Uint8Array, next: Uint8Array, at: number) => hash(concat(utf8('piu/lnnp/v1/operator-rotation'), prev, next, u32(at)));
const listMessage = (op: Uint8Array, seq: number, issuedAt: number, revoked: Uint8Array[]) =>
  hash(concat(utf8('piu/lnnp/v1/revocation'), op, u32(seq), u32(issuedAt), new Writer().u16(revoked.length).done(), ...revoked));

/** Certificado como o piu-node emite (para testes e demonstração). */
export function makeCertJson(op: KeyPair, nodePk: Uint8Array, issuedAt: number): CertJson {
  return { operatorPk: toHex(op.pk), nodePk: toHex(nodePk), issuedAt, sig: toHex(sign.sign(certMessage(op.pk, nodePk, issuedAt), op.sk)), chain: [] };
}
export function makeRotationJson(prev: KeyPair, nextPk: Uint8Array, at: number): StepJson {
  return { prevPk: toHex(prev.pk), nextPk: toHex(nextPk), at, sig: toHex(sign.sign(rotationMessage(prev.pk, nextPk, at), prev.sk)) };
}
export function makeRevocationJson(op: KeyPair, seq: number, issuedAt: number, revoked: Uint8Array[]): ListJson {
  const uniq = [...new Map(revoked.map(pk => [toHex(pk), pk])).entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, pk]) => pk);
  return { operatorPk: toHex(op.pk), seq, issuedAt, revoked: uniq.map(toHex), sig: toHex(sign.sign(listMessage(op.pk, seq, issuedAt, uniq), op.sk)) };
}

interface NodeEntry { operator: string; issuedAt: number }

export class NodeRegistry {
  private nodes = new Map<string, NodeEntry>();
  private conflicted = new Set<string>();
  private revoked = new Map<string, Set<string>>(); // operador admitido → nós revogados
  /** Vigência das chaves de operador: [validFrom, validUntil) em `issuedAt`. */
  private validFrom = new Map<string, number>();
  private validUntil = new Map<string, number>();
  /** Raízes de classe `phone` (celulares habilitados). */
  private phones = new Map<string, PhoneWindow>();
  /** Chaves de operador admitido (raízes e as que vieram por rotação) → raiz, sem os celulares. */
  private opRoot = new Map<string, string>();
  /** Diagnóstico para o relatório. */
  readonly stats = { operators: 0, certs: 0, badCerts: 0, conflicts: 0, revoked: 0 };

  private constructor() {}

  static build(operators: OperatorsFile[], files: RegistryFile[], phones: ReadonlyMap<string, PhoneWindow> = new Map()): NodeRegistry {
    const reg = new NodeRegistry();
    const roots = new Set<string>();
    for (const f of operators) for (const o of f?.operators ?? []) { try { roots.add(pkHex(o.pk)); } catch { /* malformado */ } }
    reg.stats.operators = roots.size;
    // Operador admitido continua sendo da classe `node`, mesmo que também tenha registro de celular.
    for (const [pk, w] of phones) { try { const k = pkHex(pk); if (!roots.has(k)) reg.phones.set(k, w); } catch { /* malformado */ } }
    // Limite por arquivo e sem repetição ANTES de conferir: arquivo gigante ou repetido não custa
    // verificação de assinatura (revisão do modo nó, item 5). A repetição é pelo certificado INTEIRO
    // (campos, assinatura e cadeia), não só pela assinatura: uma cópia com a mesma assinatura e outro
    // campo trocado (ou sem a cadeia), lida antes, não ocupa o lugar do certificado honesto.
    const certs: CertJson[] = [];
    const seenCert = new Set<string>();
    for (const f of files) for (const c of Array.isArray(f?.certs) ? f.certs.slice(0, MAX_CERTS_PER_FILE) : []) {
      // Forma conferida ANTES da deduplicação (H-1: cópia com `issuedAt` + 2^32).
      if (typeof c?.sig !== 'string' || !isU32(c.issuedAt)) continue;
      const k = JSON.stringify([c.operatorPk, c.nodePk, c.issuedAt, c.sig, Array.isArray(c.chain) ? c.chain.slice(0, MAX_CHAIN) : []]);
      if (seenCert.has(k)) continue;
      seenCert.add(k);
      certs.push(c);
    }

    // Passos de rotação (de todas as cadeias), cada um conferido pela assinatura da chave anterior.
    const steps: { prev: string; next: string; at: number }[] = [];
    const seenStep = new Set<string>();
    for (const c of certs) {
      const chain = Array.isArray(c?.chain) ? c.chain.slice(0, MAX_CHAIN) : [];
      for (const st of chain) {
        try {
          const prev = pkHex(st.prevPk), next = pkHex(st.nextPk);
          if (!isU32(st.at)) continue;
          const k = `${prev}:${next}:${st.at}`;
          if (seenStep.has(k) || !sign.verify(fromHex(st.sig), rotationMessage(fromHex(prev), fromHex(next), st.at), fromHex(prev))) continue;
          seenStep.add(k);
          steps.push({ prev, next, at: st.at });
        } catch { /* malformado */ }
      }
    }
    // Vigência de cada chave de cada operador: a raiz vale desde 0; a nova vale a partir do passo que
    // a criou; a anterior só até o primeiro passo que a substitui. Passo anterior ao início da própria
    // chave (retroativo) não vale. Chave alcançável por dois operadores fica fora (ambígua).
    const owner = new Map<string, string>();
    const ambiguous = new Set<string>();
    for (const root of roots) {
      const from = new Map<string, number>([[root, 0]]);
      for (let changed = true; changed;) {
        changed = false;
        for (const st of steps) {
          const f = from.get(st.prev);
          if (f === undefined || st.at < f || from.has(st.next)) continue;
          from.set(st.next, st.at);
          changed = true;
        }
      }
      for (const [k, f] of from) {
        if (owner.has(k) && owner.get(k) !== root) { ambiguous.add(k); continue; }
        owner.set(k, root);
        reg.validFrom.set(k, f);
      }
      for (const st of steps) if (from.has(st.prev) && st.at >= from.get(st.prev)!) reg.validUntil.set(st.prev, Math.min(reg.validUntil.get(st.prev) ?? Infinity, st.at));
    }
    // Celular: a própria chave, sem seguir passos de rotação (o app não rotaciona a chave de operador).
    for (const k of reg.phones.keys()) {
      if (owner.has(k)) { ambiguous.add(k); continue; }
      owner.set(k, k);
      reg.validFrom.set(k, 0);
    }
    for (const k of ambiguous) { owner.delete(k); reg.phones.delete(k); }
    for (const [k, root] of owner) if (!reg.phones.has(k)) reg.opRoot.set(k, root);
    const keyOk = (k: string, issuedAt: number) => owner.has(k) && issuedAt >= (reg.validFrom.get(k) ?? Infinity) && issuedAt < (reg.validUntil.get(k) ?? Infinity);

    const candidates = new Map<string, NodeEntry[]>();
    for (const c of certs) {
      reg.stats.certs++;
      try {
        const op = pkHex(c.operatorPk), node = pkHex(c.nodePk);
        if (!isU32(c.issuedAt) || !keyOk(op, c.issuedAt)) { reg.stats.badCerts++; continue; }
        if (!sign.verify(fromHex(c.sig), certMessage(fromHex(op), fromHex(node), c.issuedAt), fromHex(op))) { reg.stats.badCerts++; continue; }
        const list = candidates.get(node);
        if (list) list.push({ operator: owner.get(op)!, issuedAt: c.issuedAt }); else candidates.set(node, [{ operator: owner.get(op)!, issuedAt: c.issuedAt }]);
      } catch { reg.stats.badCerts++; }
    }
    for (const [node, list] of candidates) {
      const ops = new Set(list.map(x => x.operator));
      if (ops.size > 1) { reg.conflicted.add(node); reg.stats.conflicts++; continue; }
      reg.nodes.set(node, { operator: list[0]!.operator, issuedAt: Math.min(...list.map(x => x.issuedAt)) });
    }
    // Revogação: a lista de número maior de cada operador, assinada por uma chave dele vigente na emissão.
    const best = new Map<string, ListJson>();
    for (const l of files.flatMap(f => (Array.isArray(f?.revocations) ? f.revocations : []))) {
      try {
        const signer = pkHex(l.operatorPk);
        if (!isU32(l.seq) || !isU32(l.issuedAt) || !Array.isArray(l.revoked) || !keyOk(signer, l.issuedAt)) continue;
        if (!sign.verify(fromHex(l.sig), listMessage(fromHex(signer), l.seq, l.issuedAt, l.revoked.map(fromHex)), fromHex(signer))) continue;
        const root = owner.get(signer)!;
        if ((best.get(root)?.seq ?? -1) < l.seq) best.set(root, l);
      } catch { /* malformado */ }
    }
    for (const [root, l] of best) {
      const set = new Set(l.revoked.map(x => x.toLowerCase()));
      reg.revoked.set(root, set);
      reg.stats.revoked += set.size;
    }
    return reg;
  }

  /** Operador do nó para um recibo do horário `at`, ou `null` (não registrado, conflito, revogado, cedo). */
  operatorOf(nodePkHex: string, at: number): string | null {
    const node = nodePkHex.toLowerCase();
    if (this.conflicted.has(node)) return null;
    const e = this.nodes.get(node);
    if (!e) return null;
    if (this.revoked.get(e.operator)?.has(node)) return null;
    if (at + CERT_SLACK_SEC < e.issuedAt) return null;
    const w = this.phones.get(e.operator);
    if (w && (at + CERT_SLACK_SEC < w.from || at >= w.until)) return null;
    return e.operator;
  }

  /** Chaves de operadores admitidos, inclusive as rotacionadas (podem avalizar celulares). */
  operatorKeys(): Set<string> { return new Set(this.opRoot.keys()); }
  /**
   * Chave de operador admitido (inclusive rotacionada) → raiz no `operadores.json`. As chaves
   * rotacionadas de um mesmo operador contam como UM avalista (revisão do modo nó, item 3).
   */
  operatorRoots(): Map<string, string> { return new Map(this.opRoot); }
  /** Caução do celular (planck), para o teto por caução. */
  bondOf(operator: string): bigint | undefined { return this.phones.get(operator.toLowerCase())?.bond; }

  /** Classe do operador: `phone` (celular habilitado) ou `node` (operador admitido de piu-node). */
  classOf(operator: string): OperatorClass { return this.phones.has(operator.toLowerCase()) ? 'phone' : 'node'; }

  /** Carteira do registro do celular dono do nó (fallback quando o nó não declarou carteira no lote). */
  walletOf(nodePkHex: string): string | undefined {
    const e = this.nodes.get(nodePkHex.toLowerCase());
    return e ? this.phones.get(e.operator)?.wallet : undefined;
  }

  /** Motivo da recusa (para o relatório). */
  why(nodePkHex: string, at: number): string {
    const node = nodePkHex.toLowerCase();
    if (this.conflicted.has(node)) return 'nó certificado por operadores diferentes';
    const e = this.nodes.get(node);
    if (!e) return 'nó não registrado';
    if (this.revoked.get(e.operator)?.has(node)) return 'nó revogado pelo operador';
    if (at + CERT_SLACK_SEC < e.issuedAt) return 'recibo anterior ao registro do nó';
    const w = this.phones.get(e.operator);
    if (w && at + CERT_SLACK_SEC < w.from) return 'recibo anterior à habilitação do celular';
    if (w && at >= w.until) return 'celular fora da habilitação (saída ou avais vencidos)';
    return '';
  }
}
