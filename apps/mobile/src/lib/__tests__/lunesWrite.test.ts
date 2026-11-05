/// <reference types="node" />
/**
 * Etapa 3 da carteira própria: RPC de escrita em lunesRpc.ts, com o nó falso (lunesFake.ts) estendido
 * para `system_accountNextIndex`, `payment_queryInfo`, `state_call` e `author_submitExtrinsic`.
 * Respostas no formato que a Lunes devolveu ao spike (tx.mjs, validate.mjs): `partialFee` decimal em
 * string; `state_call` de TaggedTransactionQueue_validate_transaction em hex SCALE (`0x010001` = Payment,
 * `0x010004` = BadProof).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  accountNextIndex, decodeTransactionValidity, extrinsicHash, findExtrinsic, findExtrinsicInBlock, fromHex, LunesRpc, paymentQueryInfo, RpcError,
  submitExtrinsic, toHex, validateTransaction,
} from '../lunesRpc';
import { ALICE_42, ALICE_57, fakeSockets, hashOf, substrateHandler } from './lunesFake';
import { DEV_ADDR_42, DEV_ADDR_57, EXTRINSIC, EXTRINSIC_HASH } from './walletFixture';

const OTHER_XT = '0x08aabb';

/** Nó falso com os métodos de escrita por cima do leitor já existente. */
function writerChain(o: { nonce?: Record<string, number>; validity?: string; submitError?: boolean } = {}) {
  const base = substrateHandler({ finalized: 100, best: 102, storage: {}, extrinsics: { 99: [OTHER_XT, EXTRINSIC], 101: [OTHER_XT] } });
  const submitted: string[] = [];
  const handler = (method: string, params: unknown[]) => {
    switch (method) {
      case 'system_accountNextIndex': return { result: o.nonce?.[params[0] as string] ?? 0 };
      case 'payment_queryInfo': return { result: { weight: { refTime: 157_000_000, proofSize: 3593 }, class: 'Normal', partialFee: String(((params[0] as string).length - 2) / 2 * 1000) } };
      case 'state_call': {
        if (params[0] !== 'TaggedTransactionQueue_validate_transaction') return { error: { code: -32601, message: 'Method not found' } };
        return { result: o.validity ?? '0x010001' };
      }
      case 'author_submitExtrinsic': {
        if (o.submitError) return { error: { code: 1010, message: 'Invalid Transaction: Inability to pay some fees (e.g. account balance too low)' } };
        submitted.push(params[0] as string);
        return { result: extrinsicHash(fromHex(params[0] as string)) };
      }
      default: return base(method, params);
    }
  };
  return { handler, submitted };
}

test('accountNextIndex: pede ao nó com o endereço no prefixo 57, aceita 42 na entrada, recusa inválido', async () => {
  const c = writerChain({ nonce: { [DEV_ADDR_57]: 7 } });
  const f = fakeSockets({ 'wss://ws.lunes.io': 'ok' }, c.handler);
  const rpc = new LunesRpc({ connect: f.connect });
  assert.equal(await accountNextIndex(rpc, DEV_ADDR_57), 7);
  assert.equal(await accountNextIndex(rpc, DEV_ADDR_42), 7, 'mesma conta, endereço 42 → 57 antes de perguntar');
  assert.equal(await accountNextIndex(rpc, ALICE_42), 0);
  assert.deepEqual(f.log.filter(x => x.method === 'system_accountNextIndex').map(x => x.params), [[DEV_ADDR_57], [DEV_ADDR_57], [ALICE_57]]);
  await assert.rejects(accountNextIndex(rpc, 'xyz'), /caracteres|tamanho/);
  rpc.close();
});

test('paymentQueryInfo: taxa em planck (bigint) e classe, no bloco pedido ou no melhor', async () => {
  const c = writerChain();
  const f = fakeSockets({ 'wss://ws.lunes.io': 'ok' }, c.handler);
  const rpc = new LunesRpc({ connect: f.connect });
  const fee = await paymentQueryInfo(rpc, EXTRINSIC);
  assert.equal(fee.partialFee, 144_000n, '144 bytes × 1000 planck/byte, como na Mainnet');
  assert.equal(fee.class, 'Normal');
  assert.deepEqual(f.log.at(-1)!.params, [EXTRINSIC]);
  await paymentQueryInfo(rpc, EXTRINSIC, hashOf('bloco 100'));
  assert.deepEqual(f.log.at(-1)!.params, [EXTRINSIC, hashOf('bloco 100')]);
  await assert.rejects(paymentQueryInfo(rpc, 'zz'), /Hex inválido/);
  rpc.close();
});

test('decodeTransactionValidity: Ok com prioridade/longevidade, Invalid e Unknown com o motivo', () => {
  // Ok: priority u64=5, requires [], provides [[0xaa,0xbb]], longevity u64=64, propagate true
  const ok = decodeTransactionValidity('0x00' + '0500000000000000' + '00' + '04' + '08aabb' + '4000000000000000' + '01');
  assert.deepEqual(ok, { ok: true, priority: 5n, longevity: 64, propagate: true, provides: ['0xaabb'], requires: [] });
  assert.deepEqual(decodeTransactionValidity('0x010001'), { ok: false, kind: 'invalid', code: 1, reason: 'Payment' });
  assert.deepEqual(decodeTransactionValidity('0x010004'), { ok: false, kind: 'invalid', code: 4, reason: 'BadProof' });
  assert.deepEqual(decodeTransactionValidity('0x010003'), { ok: false, kind: 'invalid', code: 3, reason: 'Stale' });
  assert.deepEqual(decodeTransactionValidity('0x010002'), { ok: false, kind: 'invalid', code: 2, reason: 'Future' });
  assert.deepEqual(decodeTransactionValidity('0x01000709'), { ok: false, kind: 'invalid', code: 7, reason: 'Custom(9)' });
  assert.deepEqual(decodeTransactionValidity('0x010100'), { ok: false, kind: 'unknown', code: 0, reason: 'CannotLookup' });
  assert.throws(() => decodeTransactionValidity('0x0200'), /desconhecid/);
  assert.throws(() => decodeTransactionValidity('0x0102'), /desconhecid|curt/);
  assert.throws(() => decodeTransactionValidity('0x00'), /curta/);
});

test('validateTransaction: state_call com fonte ‖ extrinsic ‖ hash do bloco, no bloco finalizado', async () => {
  const c = writerChain({ validity: '0x010004' });
  const f = fakeSockets({ 'wss://ws.lunes.io': 'ok' }, c.handler);
  const rpc = new LunesRpc({ connect: f.connect });
  const v = await validateTransaction(rpc, EXTRINSIC);
  assert.deepEqual(v, { ok: false, kind: 'invalid', code: 4, reason: 'BadProof' });
  const call = f.log.find(x => x.method === 'state_call')!;
  const head = hashOf('bloco 100');
  assert.equal(call.params[0], 'TaggedTransactionQueue_validate_transaction');
  assert.equal(call.params[1], '0x01' + EXTRINSIC.slice(2) + head.slice(2), 'TransactionSource::Local(1) ‖ xt ‖ blockHash');
  assert.equal(call.params[2], head);
  // Em outro bloco, se pedido.
  await validateTransaction(rpc, EXTRINSIC, hashOf('bloco 99'));
  assert.equal(f.log.at(-1)!.params[2], hashOf('bloco 99'));
  await assert.rejects(validateTransaction(rpc, EXTRINSIC, '0x12'), /Hash de bloco inválido/);
  rpc.close();
});

test('submitExtrinsic: devolve o hash (confere com o calculado); erro do nó vira RpcError sem trocar de endereço', async () => {
  const c = writerChain();
  const f = fakeSockets({ 'wss://ws.lunes.io': 'ok', 'wss://ws-lunes-main-01.lunes.io': 'ok' }, c.handler);
  const rpc = new LunesRpc({ connect: f.connect });
  const h = await submitExtrinsic(rpc, EXTRINSIC);
  assert.equal(h, EXTRINSIC_HASH);
  assert.deepEqual(c.submitted, [EXTRINSIC]);
  // Também aceita os bytes.
  assert.equal(await submitExtrinsic(rpc, fromHex(EXTRINSIC)), EXTRINSIC_HASH);
  rpc.close();

  const bad = writerChain({ submitError: true });
  const g = fakeSockets({ 'wss://ws.lunes.io': 'ok', 'wss://ws-lunes-main-01.lunes.io': 'ok' }, bad.handler);
  const rpc2 = new LunesRpc({ connect: g.connect });
  await assert.rejects(submitExtrinsic(rpc2, EXTRINSIC), (e: unknown) => e instanceof RpcError && e.code === 1010 && /pay some fees/.test(e.message));
  assert.deepEqual(g.opened, ['wss://ws.lunes.io'], 'erro do nó não troca de endereço (reenviar em outro nó seria arriscado)');
  await assert.rejects(submitExtrinsic(rpc2, 'zz'), /Hex inválido/);
  rpc2.close();
});

test('findExtrinsicInBlock e findExtrinsic: posição no bloco, varredura por faixa, bloco desconhecido', async () => {
  const c = writerChain();
  const f = fakeSockets({ 'wss://ws.lunes.io': 'ok' }, c.handler);
  const rpc = new LunesRpc({ connect: f.connect });
  assert.equal(await findExtrinsicInBlock(rpc, hashOf('bloco 99'), EXTRINSIC_HASH), 1);
  assert.equal(await findExtrinsicInBlock(rpc, hashOf('bloco 101'), EXTRINSIC_HASH), -1);
  assert.equal(await findExtrinsicInBlock(rpc, hashOf('outra cadeia'), EXTRINSIC_HASH), null, 'bloco que o nó não conhece');
  await assert.rejects(findExtrinsicInBlock(rpc, hashOf('bloco 99'), '0x12'), /Hash de transação inválido/);

  // Varredura: do bloco 97 ao 102 (o melhor), acha no 99, finalizado (99 ≤ 100).
  const found = await findExtrinsic(rpc, EXTRINSIC_HASH, { from: 97, to: 102 });
  assert.deepEqual(found, { blockNumber: 99, blockHash: hashOf('bloco 99'), index: 1, finalized: true });
  // Não está em nenhum: null; e não passa do melhor bloco (103 não existe).
  assert.equal(await findExtrinsic(rpc, toHex(new Uint8Array(32)), { from: 97, to: 110 }), null);
  assert.ok(!f.log.some(x => x.method === 'chain_getBlockHash' && x.params[0] === 104), 'para no melhor bloco');
  rpc.close();
});
