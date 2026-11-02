/**
 * Validador de contribuições (Contribution Validator, seção 7 do documento): transforma recibos de
 * retransmissão e provas de entrega em um lote de liquidação (`lote.json`) para `lot:pay`.
 *
 * Regras da proposta econômica (docs/economia/proposta-modelo-economico.md; valores [decidir] são
 * parâmetros aqui):
 * - Só gera crédito o envelope de TERCEIROS com entrega comprovada (`ContributionLedger`: assinatura,
 *   deduplicação por envelope+nó, prova `hash(ackSecret) = ackHash`, tetos por envelope e nó/dia,
 *   auditoria). Recibo sem prova quando a época fecha: rejeitado.
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
import { decodeAddress } from '@polkadot/util-crypto';
import { toHex } from './protocol/bytes.js';
import { ContributionLedger, type LedgerPolicy, type PayoutClaim, type RelayReceipt, verifyPayoutClaim } from './protocol/receipts.js';
import { hash } from './protocol/suite.js';
import { planckToLunes } from './units.js';

/** Hex estrito (tamanho par, só 0-9a-f): entrada malformada é descartada, não “consertada”. */
export function fromHex(h: string): Uint8Array {
  if (typeof h !== 'string' || h.length % 2 || !/^[0-9a-fA-F]*$/.test(h)) throw new Error('hex inválido');
  return Uint8Array.from(h.match(/../g) ?? [], x => parseInt(x, 16));
}

// ── formatos de entrada (JSON, binários em hex) ─────────────

export interface EvidenceFile {
  v: 1;
  receipts?: { envelopeId: string; ackHash: string; nodePk: string; at: number; sig: string }[];
  proofs?: { envelopeId: string; ackSecret: string }[];
}
export interface ClaimFile { v: 1; claims: { epoch: string; address: string; nodePk: string; sig: string }[] }
export interface AuditFile { v: 1; results: { nodePk: string; passed: boolean; reason?: string }[] }

// ── épocas ──────────────────────────────────────────────────

const WEEK = 7 * 86400;

/** Semana ISO em UTC, `AAAA-Snn`. */
export function epochOf(sec: number): string {
  const d = new Date(sec * 1000);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7)); // quinta-feira da semana
  const year = t.getUTCFullYear();
  const week = 1 + Math.floor((t.getTime() - Date.UTC(year, 0, 1)) / 86400000 / 7);
  return `${year}-S${String(week).padStart(2, '0')}`;
}

/** Início (segunda 00:00 UTC) da época, em segundos. */
export function epochStart(label: string): number {
  const m = /^(\d{4})-S(\d{2})$/.exec(label);
  if (!m) throw new Error(`Época inválida: ${label} (use AAAA-Snn).`);
  const jan4 = Date.UTC(Number(m[1]), 0, 4) / 1000;
  const monday1 = jan4 - ((new Date(jan4 * 1000).getUTCDay() + 6) % 7) * 86400;
  const start = monday1 + (Number(m[2]) - 1) * WEEK;
  if (epochOf(start) !== label) throw new Error(`Época inexistente: ${label}.`);
  return start;
}
export const epochEnd = (label: string) => epochStart(label) + WEEK;

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
  ledger?: Partial<LedgerPolicy>;
}

export const DEFAULT_PARAMS: ValidatorParams = { capPercent: 2, minPayout: 500_000_000n, validityDays: 180, proofWindowSec: WEEK };

// ── estado persistente ──────────────────────────────────────

export type AccrualState = 'aguardando' | 'em-lote' | 'pago' | 'expirado' | 'perdido';
export interface Accrual { node: string; epoch: string; planck: string; state: AccrualState; lot?: string }
export interface ValidatorState { v: 1; closed: string[]; accruals: Accrual[] }
export const emptyState = (): ValidatorState => ({ v: 1, closed: [], accruals: [] });

// ── evidências → livro ──────────────────────────────────────

/** Monta o livro a partir de todas as evidências (reprodutível: rodar de novo dá o mesmo resultado). */
export function buildLedger(evidence: EvidenceFile[], audits: AuditFile[], now: number, policy: Partial<LedgerPolicy> = {}): ContributionLedger {
  const ledger = new ContributionLedger(policy);
  for (const e of evidence) for (const p of e.proofs ?? []) {
    try { const secret = fromHex(p.ackSecret); ledger.confirmDelivery(p.envelopeId, secret, hash(secret).slice(0, 16)); } catch { /* prova malformada: ignora */ }
  }
  const receipts: RelayReceipt[] = [];
  for (const e of evidence) for (const r of e.receipts ?? []) {
    try { receipts.push({ envelopeId: r.envelopeId, ackHash: fromHex(r.ackHash), nodePk: fromHex(r.nodePk), at: r.at, sig: fromHex(r.sig) }); } catch { /* malformado */ }
  }
  // Ordem estável (horário, envelope, nó): os tetos por dia dão o mesmo resultado em qualquer máquina.
  receipts.sort((a, b) => a.at - b.at || a.envelopeId.localeCompare(b.envelopeId) || toHex(a.nodePk).localeCompare(toHex(b.nodePk)));
  for (const r of receipts) ledger.submit(r, now);
  for (const a of audits) for (const x of a.results) { try { ledger.auditResult(fromHex(x.nodePk), x.passed); } catch { /* ignora */ } }
  return ledger;
}

// ── fechar uma época ────────────────────────────────────────

export interface CloseReport {
  epoch: string;
  lotId: string;
  budget: string;
  receipts: { validated: number; noProof: number; rejected: Record<string, number> };
  deliveries: number;
  unitValue: string;
  accrued: { node: string; units: number; lunes: string; capped: boolean }[];
  lot: { address: string; lunes: string; nodes: number }[];
  carried: { node: string; lunes: string; reason: string }[];
  expired: number;
  lost: number;
}

export interface CloseResult { state: ValidatorState; lot: { id: string; payouts: { address: string; lunes: string }[] } | null; report: CloseReport }

/** Unidades em inteiros: 840 = mmc(1..8), divisível pelo número de relays (teto de 8). */
const UNIT = 840n;

export function closeEpoch(o: {
  epoch: string; budget: bigint; now: number; state: ValidatorState; ledger: ContributionLedger; claims: ClaimFile[]; params?: Partial<ValidatorParams>;
}): CloseResult {
  const P = { ...DEFAULT_PARAMS, ...o.params };
  const { epoch, budget, now } = o;
  if (o.state.closed.includes(epoch)) throw new Error(`A época ${epoch} já foi fechada.`);
  const start = epochStart(epoch), end = epochEnd(epoch);
  if (now < end + P.proofWindowSec) throw new Error(`Cedo demais: a época ${epoch} só fecha depois de ${new Date((end + P.proofWindowSec) * 1000).toISOString()} (janela das provas de entrega).`);
  const state: ValidatorState = structuredClone(o.state);
  const lotId = `piu-lote-${epoch}`;

  // 1. Avaliar a época: entregas comprovadas, unidade dividida entre os relays.
  const rejected: Record<string, number> = {};
  let validated = 0, noProof = 0;
  const relaysOf = new Map<string, string[]>();
  for (const { receipt: r, state: s, reason } of o.ledger.entries()) {
    if (r.at < start || r.at >= end) continue;
    if (s === 'validado' && !o.ledger.isBlocked(r.nodePk)) {
      validated++;
      const list = relaysOf.get(r.envelopeId) ?? [];
      list.push(toHex(r.nodePk));
      relaysOf.set(r.envelopeId, list);
    } else if (s === 'pendente') noProof++;
    else { const k = reason ?? (s === 'validado' ? 'reprovado em auditoria' : 'prova não confere'); rejected[k] = (rejected[k] ?? 0) + 1; }
  }
  const units = new Map<string, bigint>();
  for (const nodes of relaysOf.values()) for (const n of nodes) units.set(n, (units.get(n) ?? 0n) + UNIT / BigInt(nodes.length));
  const total = [...units.values()].reduce((a, b) => a + b, 0n);
  const cap = (budget * BigInt(Math.round(P.capPercent * 100))) / 10000n;
  const accrued: CloseReport['accrued'] = [];
  for (const [node, u] of [...units].sort()) {
    const raw = total ? (budget * u) / total : 0n;
    const amount = raw > cap ? cap : raw;
    if (amount > 0n) state.accruals.push({ node, epoch, planck: amount.toString(), state: 'aguardando' });
    accrued.push({ node: node.slice(0, 16), units: Number(u) / Number(UNIT), lunes: planckToLunes(amount), capped: raw > cap });
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
  for (const f of o.claims) for (const c of f.claims) {
    if (c.epoch !== epoch) continue;
    let claim: PayoutClaim;
    try { claim = { epoch: c.epoch, address: c.address, nodePk: fromHex(c.nodePk), sig: fromHex(c.sig) }; decodeAddress(c.address); } catch { continue; }
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
    const addr = wallet.get(node);
    const why = addr === undefined ? 'sem carteira declarada para este lote' : addr === null ? 'carteiras conflitantes' : sum < P.minPayout ? 'abaixo do mínimo' : '';
    if (why) { carried.push({ node: node.slice(0, 16), lunes: planckToLunes(sum), reason: why }); continue; }
    for (const a of list) { a.state = 'em-lote'; a.lot = lotId; }
    const cur = payouts.get(addr!) ?? { planck: 0n, nodes: 0 };
    payouts.set(addr!, { planck: cur.planck + sum, nodes: cur.nodes + 1 });
  }
  state.closed.push(epoch);
  const lotPayouts = [...payouts].map(([address, p]) => ({ address, lunes: planckToLunes(p.planck) }));
  return {
    state,
    lot: lotPayouts.length ? { id: lotId, payouts: lotPayouts } : null,
    report: {
      epoch, lotId, budget: planckToLunes(budget),
      receipts: { validated, noProof, rejected }, deliveries: relaysOf.size,
      unitValue: relaysOf.size ? planckToLunes((budget * UNIT) / (total || 1n)) : '0',
      accrued, lot: [...payouts].map(([address, p]) => ({ address, lunes: planckToLunes(p.planck), nodes: p.nodes })), carried, expired, lost,
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
    else { a.state = 'aguardando'; delete a.lot; }
  }
  return { state: s, changed };
}

/** Recibo/prova/carteira em JSON (o que o piu-node e o app exportam para o validador). */
export const toEvidence = (receipts: RelayReceipt[], proofs: { envelopeId: string; ackSecret: Uint8Array }[]): EvidenceFile => ({
  v: 1,
  receipts: receipts.map(r => ({ envelopeId: r.envelopeId, ackHash: toHex(r.ackHash), nodePk: toHex(r.nodePk), at: r.at, sig: toHex(r.sig) })),
  proofs: proofs.map(p => ({ envelopeId: p.envelopeId, ackSecret: toHex(p.ackSecret) })),
});
export const toClaims = (claims: PayoutClaim[]): ClaimFile => ({ v: 1, claims: claims.map(c => ({ epoch: c.epoch, address: c.address, nodePk: toHex(c.nodePk), sig: toHex(c.sig) })) });
