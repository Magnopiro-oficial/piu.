/// <reference types="node" />
/**
 * Conferência do pedido de pagamento pela via "transação" (auditoria 2026-11-09, achado 4): o hash que
 * o pagador informa só vale como prova se a transação for uma transferência para o endereço do pedido,
 * de valor igual ou maior, com execução confirmada. Transação alheia num bloco finalizado não prova nada.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LunesRpc } from '../lunesRpc';
import { checkPaymentTx, judgementText, judgePayment } from '../paymentRequest';
import { ALICE_42, ALICE_57, fakeSockets, hashOf, substrateHandler } from './lunesFake';
import { DEV_ADDR_57, EXTRINSIC, EXTRINSIC_HASH, VALUE } from './walletFixture';

// EXTRINSIC: transfer_keep_alive de 1 LUNES (VALUE) da conta dev para a Alice.
const found = { blockFound: true, blockNumber: 99, finalized: true, txIndex: 1, endpoint: 'wss://ws.lunes.io', extrinsic: EXTRINSIC, executed: true };

test('via transação: só é "recebido" com transferência para o endereço do pedido, valor suficiente e execução confirmada', () => {
  const base = { baseline: null, free: 0n };
  assert.deepEqual(judgePayment({ ...base, planck: VALUE, address: ALICE_57, tx: found }), { state: 'recebido', via: 'transacao', block: 99 });
  // O mesmo endereço no prefixo 42 e pedido sem valor fixo: qualquer transferência para ele conta.
  assert.deepEqual(judgePayment({ ...base, planck: null, address: ALICE_42, tx: found }), { state: 'recebido', via: 'transacao', block: 99 });
  // Transação de terceiros para OUTRO destinatário, num bloco finalizado: não é prova.
  assert.deepEqual(judgePayment({ ...base, planck: VALUE, address: DEV_ADDR_57, tx: found }), { state: 'indeterminado', reason: 'transacao-ausente' });
  // Valor menor que o pedido.
  assert.deepEqual(judgePayment({ ...base, planck: VALUE + 1n, address: ALICE_57, tx: found }), { state: 'indeterminado', reason: 'transacao-ausente' });
  // Extrínseco que não é uma transferência (ou que nem foi lido).
  assert.deepEqual(judgePayment({ ...base, planck: VALUE, address: ALICE_57, tx: { ...found, extrinsic: '0x0c010203' } }), { state: 'indeterminado', reason: 'transacao-ausente' });
  assert.deepEqual(judgePayment({ ...base, planck: VALUE, address: ALICE_57, tx: { ...found, extrinsic: null } }), { state: 'indeterminado', reason: 'transacao-ausente' });
  // Só o hash do bloco, sem o da transação: bloco finalizado qualquer não prova pagamento.
  assert.deepEqual(judgePayment({ ...base, planck: VALUE, address: ALICE_57, tx: { ...found, txIndex: null } }), { state: 'indeterminado', reason: 'transacao-ausente' });
  // Sem o endereço do pedido não há com o que comparar.
  assert.deepEqual(judgePayment({ ...base, planck: VALUE, tx: found }), { state: 'indeterminado', reason: 'transacao-ausente' });
  // Execução que falhou (a transferência entra no bloco e não move saldo) ou ainda não comprovada.
  assert.deepEqual(judgePayment({ ...base, planck: VALUE, address: ALICE_57, tx: { ...found, executed: false } }), { state: 'indeterminado', reason: 'transacao-ausente' });
  assert.deepEqual(judgePayment({ ...base, planck: VALUE, address: ALICE_57, tx: { ...found, executed: null } }), { state: 'indeterminado', reason: 'transacao-ausente' });
  const { executed: _e, ...noExec } = found;
  assert.deepEqual(judgePayment({ ...base, planck: VALUE, address: ALICE_57, tx: noExec }), { state: 'indeterminado', reason: 'transacao-ausente' });
  assert.ok(!/chegou|confirmad/i.test(judgementText(judgePayment({ ...base, planck: VALUE, address: DEV_ADDR_57, tx: found }))));
});

test('via transação que não confere: com base de saldo, vale o que o saldo diz', () => {
  const wrong = { planck: VALUE, address: DEV_ADDR_57, tx: found };
  assert.deepEqual(judgePayment({ ...wrong, baseline: 10n, free: 10n }), { state: 'nada' });
  assert.deepEqual(judgePayment({ ...wrong, baseline: 10n, free: 11n }), { state: 'parcial', delta: 1n });
  // Bloco ausente ou não finalizado continuam dizendo o que faltou.
  assert.deepEqual(judgePayment({ ...wrong, baseline: 10n, free: 10n, tx: { ...found, finalized: false } }), { state: 'indeterminado', reason: 'nao-finalizado' });
});

test('checkPaymentTx: devolve o extrínseco encontrado no bloco para a conferência de destino e valor', async () => {
  const other = '0x08aabb';
  const f = fakeSockets({ 'wss://ws.lunes.io': 'ok' }, substrateHandler({ finalized: 100, best: 102, storage: {}, extrinsics: { 99: [other, EXTRINSIC] } }));
  const rpc = new LunesRpc({ connect: f.connect });
  const tx = await checkPaymentTx(rpc, { blockHash: hashOf('bloco 99'), txHash: EXTRINSIC_HASH });
  assert.deepEqual(tx, { blockFound: true, blockNumber: 99, finalized: true, txIndex: 1, endpoint: 'wss://ws.lunes.io', extrinsic: EXTRINSIC });
  // Sozinho ainda não basta: falta a execução confirmada.
  assert.equal(judgePayment({ planck: VALUE, baseline: null, free: 0n, address: ALICE_57, tx }).state, 'indeterminado');
  assert.equal(judgePayment({ planck: VALUE, baseline: null, free: 0n, address: ALICE_57, tx: { ...tx, executed: true } }).state, 'recebido');
  // Transação fora do bloco, só o hash do bloco, bloco desconhecido: sem extrínseco.
  assert.equal((await checkPaymentTx(rpc, { blockHash: hashOf('bloco 99'), txHash: '0x' + '00'.repeat(32) })).extrinsic, null);
  assert.equal((await checkPaymentTx(rpc, { blockHash: hashOf('bloco 99') })).extrinsic, null);
  assert.equal((await checkPaymentTx(rpc, { blockHash: hashOf('outra cadeia'), txHash: EXTRINSIC_HASH })).extrinsic, null);
  rpc.close();
});
