/**
 * Lote amarrado ao estado do validador (docs/economia/prova-de-entrega-v2.md, seção 7; auditoria
 * 2026-11-06, M-05). Antes de pagar um lote v2, o liquidante confere contra o `validador.json`:
 * - há créditos `em-lote` com ESTE id (um lote renomeado não tem nenhum);
 * - o `stateHash` do lote é o dos créditos com este id (nó, época, valor, carteira);
 * - a soma por carteira desses créditos é exatamente a do lote (carteira ou valor editado não passa).
 */
import { normalizeAddress, type PlannedLot } from './lot.js';
import { SettlementError } from './settler.js';
import { lotStateHash, type ValidatorState } from './validator.js';

export interface BoundLot { v?: number; id: string; stateHash?: string }

export function checkLotBinding(raw: BoundLot, lot: PlannedLot, state: ValidatorState): void {
  if (raw.v !== 2 || typeof raw.stateHash !== 'string') throw new SettlementError('Lote sem vínculo com o validador (v2). Para um lote manual, use --manual.');
  const all = state.accruals.filter(a => a.lot === lot.id);
  const mine = all.filter(a => a.state === 'em-lote');
  if (!mine.length) {
    const st = [...new Set(all.map(a => a.state))].join(', ');
    throw new SettlementError(`Nenhum crédito em lote com o id ${lot.id} no estado do validador${st ? ` (estado: ${st})` : ''}. Lote renomeado, já pago ou de outro validador.`);
  }
  if (mine.length !== all.length) throw new SettlementError(`Parte dos créditos do lote ${lot.id} já saiu de "em lote" no validador.`);
  if (lotStateHash(lot.id, mine) !== raw.stateHash) throw new SettlementError(`O lote ${lot.id} não bate com o estado do validador (stateHash).`);
  const sums = new Map<string, bigint>();
  for (const a of mine) {
    if (!a.address) throw new SettlementError(`Crédito do lote ${lot.id} sem carteira no estado do validador.`);
    const addr = normalizeAddress(a.address);
    sums.set(addr, (sums.get(addr) ?? 0n) + BigInt(a.planck));
  }
  const want = [...sums].sort(([x], [y]) => (x < y ? -1 : 1)).map(([address, planck]) => `${address}:${planck}`).join('\n');
  const got = lot.payouts.map(p => `${p.address}:${p.planck}`).join('\n');
  if (want !== got) throw new SettlementError(`Os pagamentos do lote ${lot.id} não batem com os créditos do validador.`);
}
