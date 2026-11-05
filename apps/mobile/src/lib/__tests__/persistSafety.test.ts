import assert from 'node:assert/strict';
import { test } from 'node:test';
import { completePersistedWrite, missingStoredKeys, mustBlockWalletRecovery, persistedWriteStillValid } from '../persistSafety';
import { isWalletTransferRecord } from '../walletTransfer';

test('carteira só considera registro ausente após leitura bem-sucedida', () => {
  assert.equal(mustBlockWalletRecovery(false, undefined, isWalletTransferRecord), false);
  assert.equal(mustBlockWalletRecovery(true, undefined, isWalletTransferRecord), true, 'falha geral de leitura');
  assert.equal(mustBlockWalletRecovery(true, { status: 'signed' }, isWalletTransferRecord), true, 'falha de descriptografia');
  assert.equal(mustBlockWalletRecovery(false, { status: 'signed' }, isWalletTransferRecord), true, 'registro incompleto');
  assert.equal(mustBlockWalletRecovery(false, null, isWalletTransferRecord), true, 'null não prova que não houve envio');
  assert.equal(mustBlockWalletRecovery(false, {}, () => { throw new Error('invalid'); }), true);
});
test('gravação interrompida por redefinição não autoriza envio', () => {
  assert.equal(persistedWriteStillValid(7, 7), true);
  assert.equal(persistedWriteStillValid(7, 8), false);
});

test('registro válido continua rastreável; bytes adulterados bloqueiam novos envios', async () => {
  const { withWalletKey } = await import('../walletKey');
  const { buildTransferKeepAlive } = await import('../extrinsic');
  const { isWalletTransferRecord, LUNES_GENESIS_HASH } = await import('../walletTransfer');
  const { DEV_MNEMONIC, DEV_ADDR_57, RANDOM } = await import('./walletFixture');
  const { ALICE_57, hashOf } = await import('./lunesFake');
  const { fromHex } = await import('../lunesRpc');
  const ctx = { specVersion: 107, transactionVersion: 2, genesisHash: LUNES_GENESIS_HASH, blockHash: hashOf('block'), blockNumber: 100, nonce: 1, period: 64, tip: '0' };
  const signed = withWalletKey(DEV_MNEMONIC.split(' '), key => buildTransferKeepAlive(key, { dest: ALICE_57, value: 100n, ctx: { ...ctx, tip: 0n }, random: fromHex(RANDOM) }));
  const record = { id: signed.hash, hash: signed.hash, hex: signed.hex, from: DEV_ADDR_57, dest: ALICE_57, value: '100', fee: '1', ctx, validUntil: 164, status: 'signed', createdAt: 1, updatedAt: 1 };
  assert.equal(mustBlockWalletRecovery(false, record, isWalletTransferRecord), false);
  assert.equal(mustBlockWalletRecovery(false, { ...record, hex: record.hex.slice(0, -2) + (record.hex.endsWith('00') ? '01' : '00') }, isWalletTransferRecord), true);
});


test('redefinição durante gravação impede confirmação antes de eventual envio', async () => {
  let epoch = 1, release!: () => void, removed = false, committed = false;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  const attempt = completePersistedWrite(1, () => epoch, () => delayed, async () => { removed = true; }, () => { committed = true; });
  epoch = 2; release();
  await assert.rejects(attempt, /apagados durante/);
  assert.equal(removed, true); assert.equal(committed, false);
});

test('falha no disco não confirma registro nem permite continuar o envio', async () => {
  let committed = false;
  await assert.rejects(completePersistedWrite(1, () => 1, async () => { throw new Error('disco'); }, async () => {}, () => { committed = true; }), /disco/);
  assert.equal(committed, false);
});


test('chave listada mas ausente no resultado é tratada como ilegível', () => {
  const missing = missingStoredKeys(['piu:v1:profile', 'piu:v1:wallet.transfer'], ['piu:v1:profile']);
  assert.deepEqual(missing, ['piu:v1:wallet.transfer']);
  assert.equal(mustBlockWalletRecovery(missing.includes('piu:v1:wallet.transfer'), undefined, isWalletTransferRecord), true);
  assert.deepEqual(missingStoredKeys(['a'], ['a']), []);
});
