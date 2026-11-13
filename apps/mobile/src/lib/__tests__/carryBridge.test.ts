/**
 * Recibo de carga que chega com o app fechado (plano "app fechado"): o mensageiro vive no núcleo e
 * recebe sem tela, mas quem guarda o recibo é a carteira (state/wallet.tsx), que só existe com a tela.
 * Sem ouvinte, o recibo espera a carteira voltar em vez de se perder.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CarryKind, type CarryReceipt } from '../../protocol/carry';
import { carryBridge, PENDING_RECEIPTS_MAX } from '../carryBridge';

const rc = (n: number): CarryReceipt => ({ about: CarryKind.Tx, ref: new Uint8Array(32).fill(n), status: 'pool' });

test('recibo sem a carteira ouvindo: entregue quando ela volta, uma vez', () => {
  carryBridge.receipt('a', rc(1));
  carryBridge.receipt('b', rc(2));
  const got: string[] = [];
  const off = carryBridge.onReceipt(id => got.push(id));
  assert.deepEqual(got, ['a', 'b']);
  off();
  carryBridge.onReceipt(id => got.push(id))();
  assert.equal(got.length, 2, 'entregue uma vez');
});

test('recibos guardados sem tela têm limite (os mais antigos saem)', () => {
  for (let i = 0; i < PENDING_RECEIPTS_MAX + 5; i++) carryBridge.receipt(`r${i}`, rc(i));
  const got: string[] = [];
  const off = carryBridge.onReceipt(id => got.push(id));
  off();
  assert.equal(got.length, PENDING_RECEIPTS_MAX);
  assert.equal(got[0], 'r5');
});
