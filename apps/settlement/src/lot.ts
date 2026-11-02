/**
 * Lote de liquidação: o que o validador de créditos entrega (JSON) e o que vai para a chain.
 *
 * Entrada:
 *   { "id": "2026-W44", "payouts": [{ "address": "5F…", "lunes": "12.34" }, …] }
 *
 * Regras (FUN-018, seção 11 do documento):
 * - endereço SS58 válido; repetido é somado (um pagamento por carteira);
 * - cada pagamento ≥ mínimo do lote (padrão 5 LUNES, proposta econômica) e ≥ depósito existencial;
 * - até `maxPayouts` por lote (uma transação só; lotes maiores o validador divide);
 * - o remark identifica o lote e o hash dos pagamentos: qualquer pessoa confere no explorador o que
 *   foi pago em cada lote (estado on-chain).
 */
import { createHash } from 'node:crypto';
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';
import { lunesToPlanck } from './units.js';

export interface LotInput { id: string; payouts: { address: string; lunes: string | number }[] }
export interface Payout { address: string; planck: bigint }
export interface PlannedLot { id: string; payouts: Payout[]; total: bigint; digest: string; remark: string }

export interface PlanOptions {
  /** Prefixo SS58 dos endereços no lote (padrão 42, o formato que o explorador mostra). */
  ss58?: number;
  minPayout?: bigint;
  existentialDeposit?: bigint;
  maxPayouts?: number;
}

const LOT_ID = /^[0-9A-Za-z][0-9A-Za-z._-]{0,47}$/;

export function normalizeAddress(a: string, ss58 = 42): string {
  try { return encodeAddress(decodeAddress(a.trim()), ss58); } catch { throw new Error(`Endereço inválido: ${a}`); }
}

export function planLot(input: LotInput, o: PlanOptions = {}): PlannedLot {
  if (!input || typeof input.id !== 'string' || !LOT_ID.test(input.id)) throw new Error('Lote sem id válido (letras, números, . _ -; até 48).');
  if (!Array.isArray(input.payouts) || input.payouts.length === 0) throw new Error('Lote sem pagamentos.');
  const min = o.minPayout ?? lunesToPlanck('5');
  const ed = o.existentialDeposit ?? 500n;
  const sums = new Map<string, bigint>();
  for (const p of input.payouts) {
    const addr = normalizeAddress(p.address, o.ss58 ?? 42);
    const v = lunesToPlanck(p.lunes);
    if (v <= 0n) throw new Error(`Pagamento zero para ${addr}.`);
    sums.set(addr, (sums.get(addr) ?? 0n) + v);
  }
  const payouts = [...sums].map(([address, planck]) => ({ address, planck })).sort((a, b) => (a.address < b.address ? -1 : 1));
  for (const p of payouts) {
    if (p.planck < min) throw new Error(`Pagamento abaixo do mínimo do lote para ${p.address}.`);
    if (p.planck < ed) throw new Error(`Pagamento abaixo do depósito existencial para ${p.address}.`);
  }
  if (payouts.length > (o.maxPayouts ?? 500)) throw new Error(`Pagamentos demais num lote (${payouts.length}); divida o lote.`);
  const total = payouts.reduce((s, p) => s + p.planck, 0n);
  // Hash canônico (endereço em hex da chave pública + valor), independente do prefixo SS58.
  const canon = payouts.map(p => `${Buffer.from(decodeAddress(p.address)).toString('hex')}:${p.planck}`).join('\n');
  const digest = createHash('sha256').update(`piu/lote/v1\n${input.id}\n${canon}`).digest('hex');
  return { id: input.id, payouts, total, digest, remark: `piu/lote/v1 ${input.id} ${digest}` };
}
