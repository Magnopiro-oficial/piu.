/**
 * Livro de contribuições v2 (docs/economia/prova-de-entrega-v2.md, seção 6; auditoria 2026-11-06,
 * C-01 e A-01). Monta, a partir de TODAS as evidências de uma vez, o estado de cada recibo:
 *
 * 1. Recibos: assinatura (os inválidos saem antes de tudo), uma vez por (envelope, nó), nó registrado
 *    sob operador admitido.
 * 2. Provas: só a prova v2 selada para o validador, assinada pelo pseudônimo do destino, com
 *    `H(ackSecret)` igual ao `ackHash` do cabeçalho. E só CONTA (inclusive para conflito) a prova cujo
 *    `ackHash` é o de algum recibo de nó registrado daquele envelope: quem forja um cabeçalho com outro
 *    `ackHash` (o validador não vê a assinatura do remetente) só faz ruído, sem custo para os honestos.
 * 3. A primeira prova que conta vence; outra DIFERENTE que também conta = conflito (ninguém ganha).
 * 4. Recibo validado: `ackHash` do cabeçalho comprovado, horário dentro da vida do envelope.
 * 5. Vagas: com mais de `maxRelaysPerEnvelope` recibos, saem os dos operadores com mais de um recibo
 *    naquele envelope (e cada um desses operadores leva uma marca); se ainda passar, ninguém ganha
 *    (auditar). Operador com `maxFlagsPerOperator` marcas na época fica fora da época inteira.
 * 6. Tetos por destino (pseudônimo) por época e por nó por dia, em ordem de `envelopeId`.
 * A época de um envelope é a do recibo válido mais antigo dele; o fechamento usa a mesma regra.
 */
import { toHex } from './protocol/bytes.js';
import { CLOCK_SKEW_SEC, type Header, MAX_TTL_SEC } from './protocol/envelope.js';
import type { KeyPair } from './protocol/keys.js';
import { openSealedProof, verifyDeliveryProof } from './protocol/proof.js';
import { type CreditState, type RelayReceipt, verifyRelayReceipt } from './protocol/receipts.js';
import { epochOf } from './epoch.js';
import { fromHex } from './hex.js';
import type { NodeRegistry } from './registry.js';

export interface V2Policy {
  maxRelaysPerEnvelope: number;
  maxPerNodePerDay: number;
  /** Entregas creditadas por destino (pseudônimo) por época (tráfego sintético para si mesmo). */
  maxPerRecipientPerEpoch: number;
  /** Envelopes em excesso causados por um operador numa época até ele ficar fora dela. */
  maxFlagsPerOperator: number;
  clockSkewSec: number;
}
export const DEFAULT_V2_POLICY: V2Policy = { maxRelaysPerEnvelope: 8, maxPerNodePerDay: 5000, maxPerRecipientPerEpoch: 1000, maxFlagsPerOperator: 3, clockSkewSec: 300 };

export const REASON = {
  sig: 'assinatura inválida',
  dupConflict: 'recibos conflitantes do mesmo nó',
  future: 'horário no futuro',
  conflict: 'provas conflitantes',
  mismatch: 'prova não confere',
  window: 'horário fora da vida do envelope',
  excess: 'excesso de recibos (auditar)',
  sameOperator: 'vários recibos do mesmo operador num envelope em excesso',
  excluded: 'operador fora da época (excessos demais)',
  nodeDay: 'teto diário do nó',
  recipient: 'teto do destino',
  audit: 'reprovado em auditoria',
  legacy: 'só prova v1 (legado, sem recompensa)',
} as const;

/** Entrada de evidência já decodificada (o que `validator.ts` lê dos arquivos). */
export interface V2Input {
  receipts: RelayReceipt[];
  sealedProofs: { envelopeId: string; sealed: Uint8Array }[];
  /** Ids de envelope com prova v1 (só para o relatório). */
  legacyProofs: Set<string>;
  blocked: Set<string>;
}

export interface V2Entry {
  receipt: RelayReceipt; state: CreditState; reason?: string; operator?: string;
  /** Época do envelope (a do recibo válido mais antigo dele). */
  epoch?: string;
}

export interface OperatorFlag { operator: string; epoch: string; envelopes: number; excluded: boolean }

interface Proven { header: Header; pseudonym: string; key: string }

export class DeliveryLedgerV2 {
  private list: V2Entry[] = [];
  private blocked: Set<string>;
  private operators = new Map<string, string>();
  private registry: NodeRegistry;
  /** Envelopes que vão para auditoria (excesso de recibos, provas conflitantes). */
  readonly flagged: { envelopeId: string; reason: string }[] = [];
  /** Operadores que causaram excesso, por época (e se ficaram fora dela). */
  readonly operatorFlags: OperatorFlag[] = [];
  readonly stats = { proofs: 0, badProofs: 0, conflicts: 0, legacyOnly: 0 };

  constructor(input: V2Input, o: { now: number; registry: NodeRegistry; proofKey: KeyPair | null; policy?: Partial<V2Policy> }) {
    const P = { ...DEFAULT_V2_POLICY, ...o.policy };
    this.blocked = input.blocked;
    this.registry = o.registry;
    const reject = (r: RelayReceipt, reason: string, state: CreditState = 'rejeitado', extra: Partial<V2Entry> = {}) => { this.list.push({ receipt: r, state, reason, ...extra }); };

    // 1. Recibos de nós registrados (uma vez por envelope e nó; dois diferentes do mesmo nó = fora).
    // Assinatura conferida ANTES de agrupar: recibo forjado (qualquer um monta, envelope e nó são públicos)
    // não conflita com o honesto nem ocupa o lugar dele; só aparece no relatório se o nó não tiver nenhum
    // válido naquele envelope. Cópia idêntica não é conferida de novo.
    const byKey = new Map<string, RelayReceipt[]>();
    const forged = new Map<string, RelayReceipt>();
    const seenReceipt = new Set<string>();
    for (const r of input.receipts) {
      const k = `${r.envelopeId}:${toHex(r.nodePk)}`;
      const id = `${k}:${toHex(r.ackHash)}:${r.at}:${toHex(r.sig)}`;
      if (seenReceipt.has(id)) continue;
      seenReceipt.add(id);
      if (!verifyRelayReceipt(r)) {
        const f = forged.get(k);
        if (!f || id < `${k}:${toHex(f.ackHash)}:${f.at}:${toHex(f.sig)}`) forged.set(k, r); // o mesmo em qualquer ordem
        continue;
      }
      const cur = byKey.get(k) ?? [];
      if (!cur.some(x => toHex(x.sig) === toHex(r.sig))) cur.push(r);
      byKey.set(k, cur);
    }
    const registered: { r: RelayReceipt; op: string }[] = [];
    const regAcks = new Map<string, Set<string>>(); // envelope → ackHashes de recibos registrados
    for (const k of [...new Set([...byKey.keys(), ...forged.keys()])].sort()) {
      const rs = byKey.get(k);
      if (!rs) { reject(forged.get(k)!, REASON.sig); continue; }
      const r = rs[0]!;
      const node = toHex(r.nodePk);
      if (rs.length > 1) { reject(r, REASON.dupConflict); continue; }
      const op = o.registry.operatorOf(node, r.at);
      if (!op) { reject(r, o.registry.why(node, r.at)); continue; }
      if (this.blocked.has(node)) { reject(r, REASON.audit); continue; }
      if (r.at > o.now + P.clockSkewSec) { reject(r, REASON.future); continue; }
      registered.push({ r, op });
      const set = regAcks.get(r.envelopeId) ?? new Set<string>();
      set.add(toHex(r.ackHash));
      regAcks.set(r.envelopeId, set);
    }

    // 2-3. Provas: só contam as que batem com o ackHash de algum recibo registrado.
    const proven = new Map<string, Proven>();
    const conflicted = new Set<string>();
    for (const s of input.sealedProofs) {
      const p = o.proofKey ? openSealedProof(s.sealed, s.envelopeId, o.proofKey) : null;
      const h = p ? verifyDeliveryProof(p, o.now) : null;
      if (!p || !h || !regAcks.get(p.envelopeId)?.has(toHex(h.ackHash))) { this.stats.badProofs++; continue; }
      this.stats.proofs++;
      const pseudonym = toHex(p.pseudonym);
      const key = `${toHex(p.header)}:${pseudonym}`;
      const prev = proven.get(p.envelopeId);
      if (!prev) proven.set(p.envelopeId, { header: h, pseudonym, key });
      else if (prev.key !== key) conflicted.add(p.envelopeId);
    }
    for (const id of [...conflicted].sort()) { proven.delete(id); this.flagged.push({ envelopeId: id, reason: REASON.conflict }); this.stats.conflicts++; }

    // 4. Recibo contra a prova.
    let candidates: V2Entry[] = [];
    for (const { r, op } of registered) {
      if (conflicted.has(r.envelopeId)) { reject(r, REASON.conflict); continue; }
      const pr = proven.get(r.envelopeId);
      if (!pr) {
        if (input.legacyProofs.has(r.envelopeId)) { this.stats.legacyOnly++; reject(r, REASON.legacy, 'pendente'); } else reject(r, '', 'pendente');
        continue;
      }
      if (toHex(r.ackHash) !== toHex(pr.header.ackHash)) { reject(r, REASON.mismatch); continue; }
      const exp = pr.header.expiresAt;
      if (r.at < exp - MAX_TTL_SEC - 3600 - CLOCK_SKEW_SEC || r.at > exp + CLOCK_SKEW_SEC) { reject(r, REASON.window); continue; }
      candidates.push({ receipt: r, state: 'validado', operator: op });
    }
    // Época do envelope: a do recibo válido mais antigo (a mesma regra no fechamento e nos tetos).
    const firstAt = new Map<string, number>();
    for (const c of candidates) firstAt.set(c.receipt.envelopeId, Math.min(firstAt.get(c.receipt.envelopeId) ?? Infinity, c.receipt.at));
    for (const c of candidates) c.epoch = epochOf(firstAt.get(c.receipt.envelopeId)!);

    // 5. Vagas. 1ª passada só para marcar operadores; quem passa do limite sai da época; 2ª passada vale.
    const flags = new Map<string, number>(); // `${op}|${época}` → envelopes
    this.slots(candidates, P.maxRelaysPerEnvelope, (op, epoch) => flags.set(`${op}|${epoch}`, (flags.get(`${op}|${epoch}`) ?? 0) + 1));
    const excluded = new Set<string>();
    for (const [k, n] of [...flags].sort()) {
      const [operator, epoch] = k.split('|') as [string, string];
      const out = n >= P.maxFlagsPerOperator;
      if (out) excluded.add(k);
      this.operatorFlags.push({ operator, epoch, envelopes: n, excluded: out });
    }
    for (const c of candidates) {
      if (excluded.has(`${c.operator}|${c.epoch}`)) { c.state = 'rejeitado'; c.reason = REASON.excluded; } else { c.state = 'validado'; delete c.reason; }
    }
    this.list.push(...candidates.filter(c => c.reason === REASON.excluded));
    candidates = candidates.filter(c => c.reason !== REASON.excluded);
    for (const id of this.slots(candidates, P.maxRelaysPerEnvelope)) this.flagged.push({ envelopeId: id, reason: REASON.excess });

    // 6. Tetos: por destino por época (envelopes ainda creditados) e por nó por dia.
    const byRecipient = new Map<string, string[]>();
    for (const c of candidates) {
      if (c.state !== 'validado') continue;
      const k = `${proven.get(c.receipt.envelopeId)!.pseudonym}:${c.epoch}`;
      const ids = byRecipient.get(k) ?? [];
      if (!ids.includes(c.receipt.envelopeId)) ids.push(c.receipt.envelopeId);
      byRecipient.set(k, ids);
    }
    const overRecipient = new Set<string>();
    for (const ids of byRecipient.values()) ids.sort().slice(P.maxPerRecipientPerEpoch).forEach(id => overRecipient.add(id));
    const perNodeDay = new Map<string, number>();
    for (const c of candidates) {
      if (c.state !== 'validado') continue;
      if (overRecipient.has(c.receipt.envelopeId)) { c.state = 'rejeitado'; c.reason = REASON.recipient; continue; }
      const dk = `${toHex(c.receipt.nodePk)}:${Math.floor(c.receipt.at / 86400)}`;
      const n = (perNodeDay.get(dk) ?? 0) + 1;
      perNodeDay.set(dk, n);
      if (n > P.maxPerNodePerDay) { c.state = 'rejeitado'; c.reason = REASON.nodeDay; continue; }
      this.operators.set(toHex(c.receipt.nodePk), c.operator!);
    }
    this.list.push(...candidates);
  }

  /**
   * Regra das vagas sobre `candidates` (muda estados). Envelope com recibos demais: saem os recibos dos
   * operadores com mais de um recibo nele (`onFlag` para cada um); se ainda passar, saem todos.
   * Devolve os envelopes em que ninguém ganha.
   */
  private slots(candidates: V2Entry[], max: number, onFlag?: (op: string, epoch: string) => void): string[] {
    const byEnv = new Map<string, V2Entry[]>();
    for (const c of candidates) byEnv.set(c.receipt.envelopeId, [...(byEnv.get(c.receipt.envelopeId) ?? []), c]);
    const zeroed: string[] = [];
    for (const [id, cs] of [...byEnv].sort(([a], [b]) => a.localeCompare(b))) {
      if (cs.length <= max) continue;
      const perOp = new Map<string, number>();
      for (const c of cs) perOp.set(c.operator!, (perOp.get(c.operator!) ?? 0) + 1);
      const heavy = new Set([...perOp].filter(([, n]) => n > 1).map(([op]) => op));
      for (const op of [...heavy].sort()) onFlag?.(op, cs[0]!.epoch!);
      for (const c of cs) if (heavy.has(c.operator!)) { c.state = 'rejeitado'; c.reason = REASON.sameOperator; }
      const left = cs.filter(c => c.state === 'validado');
      if (left.length > max) { for (const c of left) { c.state = 'rejeitado'; c.reason = REASON.excess; } zeroed.push(id); }
    }
    return zeroed;
  }

  *entries(): Generator<V2Entry> { yield* this.list; }
  isBlocked(nodePk: Uint8Array) { return this.blocked.has(toHex(nodePk)); }
  /** Operador admitido do nó (só para nós com algum recibo validado). */
  operatorOf(nodeHex: string) { return this.operators.get(nodeHex); }
  /** Classe do operador (`phone`: celular habilitado, teto menor). */
  classOf(operator: string) { return this.registry.classOf(operator); }
  /** Carteira do registro do celular dono do nó (sem `PayoutClaim` do nó). */
  walletOf(nodeHex: string) { return this.registry.walletOf(nodeHex); }
  /** Caução do celular (planck). */
  bondOf(operator: string) { return this.registry.bondOf(operator); }
}

/** Nós reprovados em auditoria (hex), a partir dos arquivos de auditoria. */
export function blockedFrom(audits: { results?: { nodePk: string; passed: boolean }[] }[]): Set<string> {
  const out = new Set<string>();
  for (const a of audits) for (const x of a?.results ?? []) { try { if (x.passed === false) out.add(toHex(fromHex(x.nodePk))); } catch { /* ignora */ } }
  return out;
}
