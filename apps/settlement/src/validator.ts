/**
 * Validador de contribuições (Contribution Validator, seção 7 do documento): transforma recibos de
 * retransmissão e provas de entrega em um lote de liquidação (`lote.json`) para `lot:pay`.
 *
 * Regras da proposta econômica (docs/economia/proposta-modelo-economico.md; valores [decidir] são
 * parâmetros aqui):
 * - Só gera crédito o envelope de TERCEIROS com entrega comprovada pela prova v2
 *   (docs/economia/prova-de-entrega-v2.md; `DeliveryLedgerV2` em ledger-v2.ts): prova assinada pelo
 *   destino e selada para o validador, `ackHash` do cabeçalho do envelope, recibo só de nó registrado
 *   sob operador admitido (registry.ts), excesso de recibos ou provas conflitantes não pagam ninguém,
 *   tetos por nó/dia e por destino, auditoria. Prova v1 (segredo em claro) não rende nada.
 * - Teto de 2% do orçamento por nó E por operador (N chaves do mesmo operador não multiplicam o teto).
 * - Lote v2 amarrado ao estado (`stateHash`, binding.ts): o liquidante confere antes de pagar.
 * - Cada entrega vale 1 unidade, DIVIDIDA igualmente entre os relays com recibo válido (salto falso
 *   não aumenta o total; seção 3.2).
 * - Orçamento por época `B`: valor da unidade = B ÷ unidades da época; teto por nó de 2% de B.
 * - Época = semana ISO (UTC). A época E é avaliada uma semana depois de terminar (janela para as
 *   provas chegarem) e o que ela rende só entra no lote seguinte (carência de 1 época, para uma
 *   reprovação em auditoria ainda alcançar o que não foi pago).
 * - Lote: por nó, soma do que está aguardando; precisa de pelo menos 5 LUNES (abaixo, fica para o
 *   próximo) e de uma carteira declarada para aquele lote (`PayoutClaim`, assinado pela chave do nó;
 *   o vínculo nó → carteira vale por lote). Créditos com mais de 180 dias expiram.
 * - Nó reprovado em auditoria perde o que ainda não foi pago.
 *
 * Peso por tamanho e por meio (seção 3.2): o recibo não traz tamanho nem meio, e uma declaração do
 * próprio nó não pode valer dinheiro. Por isso, aqui todo envelope pesa 1 até existir uma forma
 * verificável de saber tamanho e meio (decisão pendente).
 */
import { createHash } from 'node:crypto';
import { decodeAddress } from '@polkadot/util-crypto';
import { epochEnd, epochOf, WEEK } from './epoch.js';
import { fromHex, isU32 } from './hex.js';
import { blockedFrom, DeliveryLedgerV2, type OperatorFlag, REASON, type V2Policy } from './ledger-v2.js';
import { toHex } from './protocol/bytes.js';
import type { KeyPair } from './protocol/keys.js';
import { type CreditState, type PayoutClaim, type RelayReceipt, verifyPayoutClaim } from './protocol/receipts.js';
import type { BondRecord } from './bond.js';
import type { PhoneReport, PhoneSeenState } from './phone-nodes.js';
import type { NodeRegistry } from './registry.js';
import { planckToLunes } from './units.js';

export { epochEnd, epochOf, epochStart } from './epoch.js';
export { fromHex } from './hex.js';

// ── formatos de entrada (JSON, binários em hex) ─────────────

/**
 * Evidências de nós, gateways e aparelhos. `v: 1` continua sendo lido (os recibos são os mesmos).
 * `proofs` é o legado v1 (segredo em claro): só aparece no relatório, não valida nada.
 */
export interface EvidenceFile {
  v: 1 | 2;
  receipts?: { envelopeId: string; ackHash: string; nodePk: string; at: number; sig: string }[];
  proofs?: { envelopeId: string; ackSecret: string }[];
  sealedProofs?: { envelopeId: string; sealed: string }[];
}
export interface ClaimFile { v: 1; claims: { epoch: string; address: string; nodePk: string; sig: string }[] }
export interface AuditFile { v: 1; results: { nodePk: string; passed: boolean; reason?: string }[] }

// ── parâmetros ──────────────────────────────────────────────

export interface ValidatorParams {
  /** Teto por nó por época, em % do orçamento. */
  capPercent: number;
  /** Mínimo por carteira num lote (planck). */
  minPayout: bigint;
  /** Créditos não liquidados expiram depois disto (dias). */
  validityDays: number;
  /** Janela para as provas de entrega chegarem depois que a época termina (s). */
  proofWindowSec: number;
  /**
   * Teto de um celular (classe `phone`, docs/economia/no-celular.md) como fração do teto de um
   * operador de piu-node, por nó e por operador. Padrão: metade.
   */
  phoneCapFraction: number;
  /**
   * Teto por época de um celular como fração da CAUÇÃO dele (padrão 0,25: com caução de 10 LUNES, no
   * máximo 2,5 LUNES por época). Mantém a caução pequena (decisão de produto) sem que ela se pague em
   * poucos dias; a alternativa é subir a caução (docs/economia/no-celular.md).
   */
  phoneMaxPayoutBondRatio: number;
  ledger?: Partial<V2Policy>;
}

export const DEFAULT_PARAMS: ValidatorParams = { capPercent: 2, minPayout: 500_000_000n, validityDays: 180, proofWindowSec: WEEK, phoneCapFraction: 0.5, phoneMaxPayoutBondRatio: 0.25 };

// ── estado persistente ──────────────────────────────────────

export type AccrualState = 'aguardando' | 'em-lote' | 'pago' | 'expirado' | 'perdido';
export interface Accrual {
  node: string; epoch: string; planck: string; state: AccrualState; lot?: string;
  /** Carteira do lote em que entrou (gravada junto com `lot`; amarra o lote ao estado). */
  address?: string;
}
export interface ValidatorState {
  v: 1; closed: string[]; accruals: Accrual[];
  /** Cauções dos celulares conferidas na chain, com o estado manual (devolvida, confiscada). */
  bonds?: BondRecord[];
  /** Avais e retiradas de aval vistos pelo validador, com o horário do primeiro visto (`recordFirstSeen`). */
  phoneSeen?: PhoneSeenState;
}
export const emptyState = (): ValidatorState => ({ v: 1, closed: [], accruals: [] });

// ── evidências → livro ──────────────────────────────────────

export interface BuildOptions {
  registry: NodeRegistry;
  /** Par X25519 do validador para abrir as provas seladas (`null`: nenhuma prova abre). */
  proofKey: KeyPair | null;
  policy?: Partial<V2Policy>;
}

/** Monta o livro v2 a partir de todas as evidências (reprodutível: rodar de novo dá o mesmo resultado). */
export function buildLedger(evidence: EvidenceFile[], audits: AuditFile[], now: number, o: BuildOptions): DeliveryLedgerV2 {
  const receipts: RelayReceipt[] = [];
  const sealedProofs: { envelopeId: string; sealed: Uint8Array }[] = [];
  const legacyProofs = new Set<string>();
  // Listas de tipo errado (arquivo malformado) são ignoradas, sem derrubar o close (B-08).
  const list = <T>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : []);
  for (const e of evidence) {
    if (!e || typeof e !== 'object') continue;
    for (const r of list<NonNullable<EvidenceFile['receipts']>[number]>(e.receipts)) {
      try {
        // `at` em u32: X e X + 2^32 têm a mesma assinatura; a cópia maleável não entra (H-1).
        if (!r || typeof r.envelopeId !== 'string' || !isU32(r.at)) continue;
        receipts.push({ envelopeId: r.envelopeId, ackHash: fromHex(r.ackHash), nodePk: fromHex(r.nodePk), at: r.at, sig: fromHex(r.sig) });
      } catch { /* malformado */ }
    }
    for (const p of list<NonNullable<EvidenceFile['sealedProofs']>[number]>(e.sealedProofs)) { try { if (p && typeof p.envelopeId === 'string') sealedProofs.push({ envelopeId: p.envelopeId, sealed: fromHex(p.sealed) }); } catch { /* malformado */ } }
    for (const p of list<{ envelopeId?: unknown }>(e.proofs)) if (typeof p?.envelopeId === 'string') legacyProofs.add(p.envelopeId);
  }
  return new DeliveryLedgerV2({ receipts, sealedProofs, legacyProofs, blocked: blockedFrom(audits) }, { now, registry: o.registry, proofKey: o.proofKey, policy: o.policy });
}

/** O que o fechamento precisa do livro. */
export interface LedgerView {
  entries(): Iterable<{ receipt: RelayReceipt; state: CreditState; reason?: string; epoch?: string }>;
  isBlocked(nodePk: Uint8Array): boolean;
  operatorOf?(nodeHex: string): string | undefined;
  /** Classe do operador; `phone` recebe `phoneCapFraction` do teto. */
  classOf?(operator: string): 'node' | 'phone';
  /** Carteira do registro do celular (usada quando o nó não declarou carteira para o lote). */
  walletOf?(nodeHex: string): string | undefined;
  /** Caução do celular (planck), para o teto por caução. */
  bondOf?(operator: string): bigint | undefined;
  flagged?: readonly { envelopeId: string; reason: string }[];
  operatorFlags?: readonly OperatorFlag[];
}

/**
 * Divide o orçamento pelas unidades com teto por nó E por operador, por enchimento ("water-filling"):
 * quem bate no teto fica no teto, e o que sobra é redividido entre os outros pelas unidades deles.
 * Assim, unidades sintéticas de um operador não diluem os honestos além da fatia (com teto) dele.
 * Com todos no teto, sobra orçamento (não é distribuído).
 */
export function allocate(units: ReadonlyMap<string, bigint>, operatorOf: (node: string) => string, budget: bigint, cap: bigint | ((operator: string) => bigint)): Map<string, { amount: bigint; capped: boolean }> {
  // Teto por operador (o mesmo para cada nó dele): um número para todos ou por classe (celular).
  const capOf = typeof cap === 'bigint' ? () => cap : cap;
  const nodes = [...units.keys()].filter(n => units.get(n)! > 0n).sort();
  const frozen = new Map<string, bigint>();
  const capped = new Set<string>();
  const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);
  for (let guard = 0; guard <= nodes.length + 1; guard++) {
    const active = nodes.filter(n => !frozen.has(n));
    if (!active.length) break;
    const rest = budget - sum([...frozen.values()]);
    const U = sum(active.map(n => units.get(n)!));
    if (rest <= 0n || U === 0n) { for (const n of active) frozen.set(n, 0n); break; }
    const tent = (n: string) => (rest * units.get(n)!) / U;
    let changed = false;
    const byOp = new Map<string, string[]>();
    for (const n of nodes) byOp.set(operatorOf(n), [...(byOp.get(operatorOf(n)) ?? []), n]);
    for (const list of byOp.values()) {
      const act = list.filter(n => !frozen.has(n));
      if (!act.length) continue;
      const opFrozen = sum(list.filter(n => frozen.has(n)).map(n => frozen.get(n)!));
      const c = capOf(operatorOf(list[0]!));
      if (opFrozen + sum(act.map(tent)) <= c) continue;
      const room = c > opFrozen ? c - opFrozen : 0n;
      const Uop = sum(act.map(n => units.get(n)!));
      for (const n of act) { frozen.set(n, (room * units.get(n)!) / Uop); capped.add(n); }
      changed = true;
    }
    if (changed) continue;
    for (const n of active) { const c = capOf(operatorOf(n)); if (tent(n) > c) { frozen.set(n, c); capped.add(n); changed = true; } }
    if (changed) continue;
    for (const n of active) frozen.set(n, tent(n));
    break;
  }
  return new Map(nodes.map(n => [n, { amount: frozen.get(n) ?? 0n, capped: capped.has(n) }]));
}

// ── fechar uma época ────────────────────────────────────────

export interface CloseReport {
  epoch: string;
  lotId: string;
  budget: string;
  receipts: { validated: number; noProof: number; legacyOnly: number; rejected: Record<string, number> };
  deliveries: number;
  unitValue: string;
  accrued: { node: string; units: number; lunes: string; capped: boolean }[];
  lot: { address: string; lunes: string; nodes: number }[];
  carried: { node: string; lunes: string; reason: string }[];
  expired: number;
  lost: number;
  /** Envelopes para auditoria (excesso de recibos, provas conflitantes). */
  flagged: { envelopeId: string; reason: string }[];
  /** Operadores que causaram excesso nesta época (os `excluded` não recebem nada dela). */
  operatorFlags: OperatorFlag[];
  /** Celulares (classe `phone`): habilitados e os de fora, com o motivo (docs/economia/no-celular.md). */
  phones?: PhoneReport[];
  /** Teto de um celular nesta época pela fração do teto do nó (LUNES). */
  phoneCap?: string;
  /** Teto de cada celular com recibos nesta época: o menor entre `phoneCap` e a fração da caução (LUNES). */
  phoneCaps?: { operator: string; cap: string; bond: string }[];
  /** Raízes suspensas como avalistas (celulares confiscados na linhagem). */
  suspendedRoots?: string[];
}

/** Lote v2: amarrado ao estado do validador (`stateHash`, ver binding.ts). */
export interface LotFile { v: 2; id: string; epoch: string; payouts: { address: string; lunes: string }[]; accruals: number; stateHash: string }
export interface CloseResult { state: ValidatorState; lot: LotFile | null; report: CloseReport }

/**
 * Hash do estado coberto por um lote: os créditos com `lot = id` (nó, época, valor, carteira), em
 * ordem canônica. O liquidante recalcula a partir do `validador.json` antes de pagar.
 */
export function lotStateHash(id: string, accruals: readonly Accrual[]): string {
  const lines = accruals.filter(a => a.lot === id).map(a => `${a.node}:${a.epoch}:${a.planck}:${a.address ?? ''}`).sort();
  return createHash('sha256').update(`piu/lote/v2/estado\n${id}\n${lines.join('\n')}`).digest('hex');
}

/** Unidades em inteiros: 840 = mmc(1..8), divisível pelo número de relays (teto de 8). */
const UNIT = 840n;

export function closeEpoch(o: {
  epoch: string; budget: bigint; now: number; state: ValidatorState; ledger: LedgerView; claims: ClaimFile[]; params?: Partial<ValidatorParams>;
  /** Avaliação dos celulares (phone-nodes.ts), só para o relatório; as cauções já vêm em `state.bonds`. */
  phones?: PhoneReport[];
  suspendedRoots?: string[];
}): CloseResult {
  const P = { ...DEFAULT_PARAMS, ...o.params };
  const { epoch, budget, now } = o;
  if (o.state.closed.includes(epoch)) throw new Error(`A época ${epoch} já foi fechada.`);
  const end = epochEnd(epoch);
  if (now < end + P.proofWindowSec) throw new Error(`Cedo demais: a época ${epoch} só fecha depois de ${new Date((end + P.proofWindowSec) * 1000).toISOString()} (janela das provas de entrega).`);
  const state: ValidatorState = structuredClone(o.state);
  const lotId = `piu-lote-${epoch}`;

  // 1. Avaliar a época: entregas comprovadas, unidade dividida entre os relays.
  const rejected: Record<string, number> = {};
  let validated = 0, noProof = 0, legacyOnly = 0;
  const relaysOf = new Map<string, string[]>();
  for (const { receipt: r, state: s, reason, epoch: e } of o.ledger.entries()) {
    // A época do envelope (recibo válido mais antigo) quando o livro diz; senão, a do recibo.
    if ((e ?? epochOf(r.at)) !== epoch) continue;
    if (s === 'validado' && !o.ledger.isBlocked(r.nodePk)) {
      validated++;
      const list = relaysOf.get(r.envelopeId) ?? [];
      list.push(toHex(r.nodePk));
      relaysOf.set(r.envelopeId, list);
    } else if (s === 'pendente') { noProof++; if (reason === REASON.legacy) legacyOnly++; }
    else { const k = reason ?? (s === 'validado' ? 'reprovado em auditoria' : 'prova não confere'); rejected[k] = (rejected[k] ?? 0) + 1; }
  }
  const units = new Map<string, bigint>();
  for (const nodes of relaysOf.values()) for (const n of nodes) units.set(n, (units.get(n) ?? 0n) + UNIT / BigInt(nodes.length));
  const total = [...units.values()].reduce((a, b) => a + b, 0n);
  const cap = (budget * BigInt(Math.round(P.capPercent * 100))) / 10000n;
  // Teto por nó e por operador ANTES de dividir: o excedente de quem bate no teto vai para os outros.
  const phoneCap = (cap * BigInt(Math.round(P.phoneCapFraction * 10000))) / 10000n;
  const ratio = BigInt(Math.round(P.phoneMaxPayoutBondRatio * 10000));
  const phoneCaps = new Map<string, { cap: bigint; bond: bigint }>();
  const capOf = (op: string) => {
    if (o.ledger.classOf?.(op) !== 'phone') return cap;
    const bond = o.ledger.bondOf?.(op) ?? 0n;
    const c = (bond * ratio) / 10000n < phoneCap ? (bond * ratio) / 10000n : phoneCap;
    phoneCaps.set(op, { cap: c, bond });
    return c;
  };
  const amounts = allocate(units, n => o.ledger.operatorOf?.(n) ?? n, budget, capOf);
  const accrued: CloseReport['accrued'] = [];
  for (const [node, { amount, capped }] of amounts) {
    if (amount > 0n) state.accruals.push({ node, epoch, planck: amount.toString(), state: 'aguardando' });
    accrued.push({ node: node.slice(0, 16), units: Number(units.get(node)!) / Number(UNIT), lunes: planckToLunes(amount), capped });
  }

  // 2. Antes de montar o lote: auditoria (perde o não pago) e validade (expira).
  let expired = 0, lost = 0;
  for (const a of state.accruals) {
    if (a.state !== 'aguardando') continue;
    if (o.ledger.isBlocked(fromHex(a.node))) { a.state = 'perdido'; lost++; continue; }
    if (now - epochEnd(a.epoch) > P.validityDays * 86400) { a.state = 'expirado'; expired++; }
  }

  // 3. Carteiras declaradas para ESTE lote (assinatura do nó; conflito = nenhuma).
  const wallet = new Map<string, string | null>();
  for (const f of o.claims) for (const c of Array.isArray(f?.claims) ? f.claims : []) {
    if (!c || c.epoch !== epoch || typeof c.address !== 'string') continue;
    let claim: PayoutClaim;
    // Carteira com chave de 32 bytes (conta comum): endereço de índice ou de 33 bytes travaria o lote (M-1).
    try { claim = { epoch: c.epoch, address: c.address, nodePk: fromHex(c.nodePk), sig: fromHex(c.sig) }; if (decodeAddress(c.address).length !== 32) continue; } catch { continue; }
    if (!verifyPayoutClaim(claim)) continue;
    const node = toHex(claim.nodePk), prev = wallet.get(node);
    wallet.set(node, prev === undefined || prev === c.address ? c.address : null);
  }

  // 4. Lote: o que aguarda de épocas ANTERIORES (carência de 1 época), por nó, com mínimo.
  const due = new Map<string, Accrual[]>();
  for (const a of state.accruals) if (a.state === 'aguardando' && a.epoch < epoch) due.set(a.node, [...(due.get(a.node) ?? []), a]);
  const payouts = new Map<string, { planck: bigint; nodes: number }>();
  const carried: CloseReport['carried'] = [];
  for (const [node, list] of [...due].sort()) {
    const sum = list.reduce((s, a) => s + BigInt(a.planck), 0n);
    // Celular sem carteira declarada no lote: a carteira do registro (assinada pela carteira e pelo operador).
    const addr = wallet.has(node) ? wallet.get(node) : o.ledger.walletOf?.(node);
    const why = addr === undefined ? 'sem carteira declarada para este lote' : addr === null ? 'carteiras conflitantes' : sum < P.minPayout ? 'abaixo do mínimo' : '';
    if (why) { carried.push({ node: node.slice(0, 16), lunes: planckToLunes(sum), reason: why }); continue; }
    for (const a of list) { a.state = 'em-lote'; a.lot = lotId; a.address = addr!; }
    const cur = payouts.get(addr!) ?? { planck: 0n, nodes: 0 };
    payouts.set(addr!, { planck: cur.planck + sum, nodes: cur.nodes + 1 });
  }
  state.closed.push(epoch);
  const lotPayouts = [...payouts].map(([address, p]) => ({ address, lunes: planckToLunes(p.planck) }));
  const inLot = state.accruals.filter(a => a.lot === lotId && a.state === 'em-lote');
  return {
    state,
    lot: lotPayouts.length ? { v: 2, id: lotId, epoch, payouts: lotPayouts, accruals: inLot.length, stateHash: lotStateHash(lotId, inLot) } : null,
    report: {
      epoch, lotId, budget: planckToLunes(budget),
      receipts: { validated, noProof, legacyOnly, rejected }, deliveries: relaysOf.size,
      unitValue: relaysOf.size ? planckToLunes((budget * UNIT) / (total || 1n)) : '0',
      accrued, lot: [...payouts].map(([address, p]) => ({ address, lunes: planckToLunes(p.planck), nodes: p.nodes })), carried, expired, lost,
      flagged: [...(o.ledger.flagged ?? [])],
      operatorFlags: (o.ledger.operatorFlags ?? []).filter(f => f.epoch === epoch),
      ...(o.phones ? { phones: o.phones, phoneCap: planckToLunes(phoneCap) } : {}),
      ...(phoneCaps.size ? { phoneCaps: [...phoneCaps].sort(([a], [b]) => a.localeCompare(b)).map(([op, x]) => ({ operator: op.slice(0, 16), cap: planckToLunes(x.cap), bond: planckToLunes(x.bond) })) } : {}),
      ...(o.suspendedRoots?.length ? { suspendedRoots: o.suspendedRoots.map(r => r.slice(0, 16)) } : {}),
    },
  };
}

/**
 * Resultado da liquidação (diário do `lot:pay`): finalizado → pago; falhou → volta a aguardar para
 * o próximo lote (nada foi pago: `batchAll` é tudo ou nada).
 */
export function settleLot(state: ValidatorState, lotId: string, outcome: 'finalizado' | 'falhou'): { state: ValidatorState; changed: number } {
  const s: ValidatorState = structuredClone(state);
  let changed = 0;
  for (const a of s.accruals) {
    if (a.lot !== lotId || a.state !== 'em-lote') continue;
    changed++;
    if (outcome === 'finalizado') a.state = 'pago';
    else { a.state = 'aguardando'; delete a.lot; delete a.address; }
  }
  return { state: s, changed };
}

/** Recibos e provas em JSON (o formato que o app exporta; o piu-node exporta só recibos, `v: 1`). */
export const toEvidence = (
  receipts: RelayReceipt[], proofs: { envelopeId: string; ackSecret: Uint8Array }[] = [], sealed: { envelopeId: string; sealed: Uint8Array }[] = [],
): EvidenceFile => ({
  v: 2,
  receipts: receipts.map(r => ({ envelopeId: r.envelopeId, ackHash: toHex(r.ackHash), nodePk: toHex(r.nodePk), at: r.at, sig: toHex(r.sig) })),
  proofs: proofs.map(p => ({ envelopeId: p.envelopeId, ackSecret: toHex(p.ackSecret) })),
  sealedProofs: sealed.map(p => ({ envelopeId: p.envelopeId, sealed: toHex(p.sealed) })),
});
export const toClaims = (claims: PayoutClaim[]): ClaimFile => ({ v: 1, claims: claims.map(c => ({ epoch: c.epoch, address: c.address, nodePk: toHex(c.nodePk), sig: toHex(c.sig) })) });
