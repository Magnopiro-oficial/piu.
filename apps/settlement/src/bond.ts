/**
 * Caução dos celulares (docs/economia/no-celular.md, seção "Caução").
 *
 * Um celular só é habilitado com uma caução em LUNES conferida NA CHAIN (só leitura, `ChainClient`):
 * - a transferência com o hash e o bloco declarados no registro existe e executou;
 * - saiu da carteira declarada (`wallet`), foi para o endereço da caução configurado no validador e
 *   vale pelo menos o mínimo configurado;
 * - a carteira assinou (sr25519) "esta caução vale para esta chave de operador de celular"
 *   (`bondOwnerMessage`), então ninguém usa a caução de outra pessoa;
 * - a mesma transação não serve para dois celulares (os dois ficam fora);
 * - no estado do validador ela não está `devolvida` nem `confiscada`.
 *
 * Devolução e confisco são operações MANUAIS (`validator:bonds`): quem opera o validador faz a
 * transferência de volta (ou não) e marca aqui. Este módulo nunca envia transação.
 */
import { cryptoWaitReady, decodeAddress, signatureVerify } from '@polkadot/util-crypto';
import type { ChainClient } from './chain.js';
import { fromHex } from './hex.js';
import { toHex } from './protocol/bytes.js';
import { bondOwnerMessage, type PhoneRegistrationJson } from './protocol/phoneNode.js';

export type BondState = 'ativa' | 'devolvida' | 'confiscada';
/** Caução conhecida pelo validador (gravada em `validador.json`, campo `bonds`). */
export interface BondRecord {
  operatorPk: string; wallet: string; txHash: string; block: number;
  /** planck, como texto. */
  amount: string;
  /** Horário do bloco da caução (s): conta a idade mínima a partir daqui. */
  at: number;
  state: BondState;
  /** Quando o celular pediu para sair (pedido assinado no registro), em s. "Voltar a ser nó" apaga. */
  exitAt?: number;
  /** Devolução devida a partir de (s): saída + `refundDelayDays` (7). `validator:bonds due` lista. */
  refundDueAt?: number;
  /** Primeira habilitação (s) e as raízes (operadores admitidos) da linhagem de avais naquele momento. */
  enabledFrom?: number; roots?: string[];
  /** Quem mudou o estado à mão, e por quê (devolução, confisco). */
  note?: string; changedAt?: number;
  /** Hash da transação de devolução (`validator:bonds refund --refund-tx`): a mesma não vale duas vezes. */
  refundTx?: string;
}

export type BondCheck = { ok: true; at: number; amount: bigint } | { ok: false; reason: string };

export const BOND_REASON = {
  noAddress: 'endereço da caução não configurado no validador',
  notFound: 'caução não encontrada na chain',
  failed: 'transferência da caução falhou',
  from: 'caução não saiu da carteira declarada',
  to: 'caução não foi para o endereço da caução',
  amount: 'caução abaixo do mínimo',
  walletSig: 'assinatura da carteira inválida',
  reused: 'caução usada por outro celular',
  refunded: 'caução devolvida',
  slashed: 'caução confiscada',
  chain: 'chain indisponível para conferir a caução',
} as const;

/** Chave pública (hex) de um endereço SS58, em qualquer prefixo; `null` se inválido. */
export function accountHex(address: string): string | null {
  try { return toHex(decodeAddress(address)); } catch { return null; }
}

/** A carteira assinou a mensagem de dono da caução para este endereço de caução (sr25519, contexto "substrate", como no app). */
export async function walletSigned(r: PhoneRegistrationJson, bondAddress: string): Promise<boolean> {
  await cryptoWaitReady();
  try { return signatureVerify(bondOwnerMessage(r.operatorPk, r.wallet, bondAddress), fromHex(r.walletSig), r.wallet).isValid; } catch { return false; }
}

/** Chave de um registro: operador + transação da caução (um operador pode ter mais de um registro). */
export const regKey = (r: { operatorPk: string; bond: { txHash: string } }) => `${r.operatorPk}:${r.bond.txHash}`;

/**
 * Confere as cauções dos registros (já conferidos pela assinatura do operador), um a um. `records`:
 * o que o validador já sabe (estado manual). Devolve o resultado por registro (`regKey`).
 *
 * "Caução usada por outro celular" só vale entre registros que JÁ passaram em tudo (assinatura da
 * carteira, transferência da carteira declarada): copiar o hash público da caução de alguém com uma
 * assinatura qualquer não derruba a vítima (revisão, item 2). Duas chaves com a mesma caução
 * legítima só acontecem se a dona da carteira assinou as duas: as duas ficam fora.
 */
export async function checkBonds(
  regs: readonly PhoneRegistrationJson[], chain: Pick<ChainClient, 'transferOf'> | null,
  o: { bondAddress: string | null; minBondPlanck: bigint; records?: readonly BondRecord[] },
): Promise<Map<string, BondCheck>> {
  const out = new Map<string, BondCheck>();
  const target = o.bondAddress ? accountHex(o.bondAddress) : null;
  const records = o.records ?? [];
  const manual = new Map<string, BondState>(records.map(b => [`${b.operatorPk}:${b.txHash}`, b.state]));
  const owner = new Map<string, string>(); // tx → operador do registro já gravado (o primeiro que valeu)
  for (const b of records) if (!owner.has(b.txHash)) owner.set(b.txHash, b.operatorPk);
  const seen = new Set<string>();
  const good: PhoneRegistrationJson[] = [];
  for (const r of [...regs].sort((a, b) => regKey(a).localeCompare(regKey(b)))) {
    const k = regKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    const fail = (reason: string) => out.set(k, { ok: false, reason });
    const st = manual.get(k);
    if (st === 'devolvida') { fail(BOND_REASON.refunded); continue; }
    if (st === 'confiscada') { fail(BOND_REASON.slashed); continue; }
    if (!target) { fail(BOND_REASON.noAddress); continue; }
    if (!(await walletSigned(r, o.bondAddress!))) { fail(BOND_REASON.walletSig); continue; }
    if (!chain) { fail(BOND_REASON.chain); continue; }
    let t;
    try { t = await chain.transferOf(r.bond.txHash, r.bond.block); } catch { fail(BOND_REASON.chain); continue; }
    if (!t) { fail(BOND_REASON.notFound); continue; }
    if (!t.ok) { fail(BOND_REASON.failed); continue; }
    if (accountHex(t.from) !== accountHex(r.wallet)) { fail(BOND_REASON.from); continue; }
    if (accountHex(t.to) !== target) { fail(BOND_REASON.to); continue; }
    if (t.amount < o.minBondPlanck) { fail(BOND_REASON.amount); continue; }
    out.set(k, { ok: true, at: t.at, amount: t.amount });
    good.push(r);
  }
  // Mesma caução legítima em mais de uma chave (ou já gravada para outra): fora.
  const byTx = new Map<string, Set<string>>();
  for (const r of good) { const set = byTx.get(r.bond.txHash) ?? new Set<string>(); set.add(r.operatorPk); byTx.set(r.bond.txHash, set); }
  for (const r of good) {
    const prev = owner.get(r.bond.txHash);
    if ((byTx.get(r.bond.txHash)?.size ?? 0) > 1 || (prev !== undefined && prev !== r.operatorPk)) out.set(regKey(r), { ok: false, reason: BOND_REASON.reused });
  }
  return out;
}

/**
 * Grava (ou atualiza) as cauções conferidas no estado; nunca mexe no estado manual. `exits`: saída por
 * `regKey`. `lineage`: raízes da habilitação e desde quando (fica gravado: conta no teto mensal das
 * raízes e no confisco em cascata, mesmo que o celular saia depois).
 */
export function recordBonds(
  records: readonly BondRecord[], regs: readonly PhoneRegistrationJson[], checks: ReadonlyMap<string, BondCheck>,
  exits: ReadonlyMap<string, { kind: 'exit' | 'cancel'; at: number }>,
  lineage: ReadonlyMap<string, { roots: string[]; from: number }> = new Map(), refundDelayDays = 7,
): BondRecord[] {
  const out = records.map(b => ({ ...b }));
  const idx = new Map<string, BondRecord>(out.map(b => [`${b.operatorPk}:${b.txHash}`, b]));
  for (const r of regs) {
    const k = regKey(r);
    const c = checks.get(k);
    let cur = idx.get(k);
    if (!cur) {
      if (!c?.ok) continue;
      cur = { operatorPk: r.operatorPk, wallet: r.wallet, txHash: r.bond.txHash, block: r.bond.block, amount: c.amount.toString(), at: c.at, state: 'ativa' };
      out.push(cur); idx.set(k, cur);
    }
    // Vale o evento mais novo daquela caução: saída (devolução devida em 7 dias) ou "voltar a ser nó".
    const ev = exits.get(k);
    if (ev?.kind === 'exit' && cur.state === 'ativa') { cur.exitAt = ev.at; cur.refundDueAt = ev.at + refundDelayDays * 86400; }
    if (ev?.kind === 'cancel' && cur.state === 'ativa') { delete cur.exitAt; delete cur.refundDueAt; }
    const l = lineage.get(k);
    if (l && cur.enabledFrom === undefined) { cur.enabledFrom = l.from; cur.roots = [...l.roots].sort(); }
  }
  return out.sort((a, b) => a.operatorPk.localeCompare(b.operatorPk) || a.txHash.localeCompare(b.txHash));
}

/** Cauções com devolução vencida (saída há 7 dias ou mais) e ainda `ativa`: a fazer à mão. */
export const refundsDue = (records: readonly BondRecord[], now: number) =>
  records.filter(b => b.state === 'ativa' && b.refundDueAt !== undefined && b.refundDueAt <= now).sort((a, b) => a.refundDueAt! - b.refundDueAt!);

/**
 * Devolução ou confisco manual (CLI `validator:bonds`). Só de caução `ativa`.
 * - `txHash`: qual caução (obrigatório quando o celular tem mais de uma ativa; antes a primeira era a
 *   escolhida, e a marca podia cair na caução errada).
 * - `refundTx`: hash da transação de devolução, guardado para não devolver duas vezes (auditoria final, B-c).
 */
export function markBond(records: readonly BondRecord[], operatorPk: string, state: 'devolvida' | 'confiscada', note: string, now: number, o: { txHash?: string; refundTx?: string } = {}): BondRecord[] {
  const op = operatorPk.toLowerCase();
  const list = records.map(b => ({ ...b }));
  const active = list.filter(x => x.operatorPk === op && x.state === 'ativa' && (!o.txHash || x.txHash.toLowerCase() === o.txHash.toLowerCase()));
  if (!active.length) throw new Error(`Nenhuma caução ativa do celular ${op.slice(0, 16)}…${o.txHash ? ` com a tx ${o.txHash}` : ''} no estado do validador (rode validator:close antes).`);
  if (active.length > 1) throw new Error(`O celular ${op.slice(0, 16)}… tem ${active.length} cauções ativas: diga qual com --tx <hash da caução>.`);
  const b = active[0]!;
  if (state === 'confiscada' && !note.trim()) throw new Error('Confisco exige --note com o motivo (fraude comprovada).');
  if (o.refundTx !== undefined) {
    if (state !== 'devolvida' || !/^0x[0-9a-fA-F]{64}$/.test(o.refundTx)) throw new Error('--refund-tx: hash da transação de devolução (0x + 64 hex), só com refund.');
    if (list.some(x => x.refundTx?.toLowerCase() === o.refundTx!.toLowerCase())) throw new Error(`A transação ${o.refundTx} já foi usada em outra devolução.`);
    b.refundTx = o.refundTx.toLowerCase();
  }
  b.state = state; b.note = note.trim() || undefined; b.changedAt = now;
  if (!b.note) delete b.note;
  return list;
}
