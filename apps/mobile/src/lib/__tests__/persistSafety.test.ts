import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { completePersistedWrite, createDelayedWrites, createResetGuard, missingStoredKeys, mustBlockWalletRecovery, persistedWriteStillValid } from '../persistSafety';
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

test('"Apagar dados locais": nada regrava o estado apagado e a identidade seguinte não o herda', async () => {
  // Mesmo desenho de lib/persist.ts: um snapshot em memória e gravações que passam pela guarda.
  const guard = createResetGuard();
  let snapshot: Record<string, unknown> = { 'msg.state': 'contatos-da-identidade-antiga' };
  const write = (key: string, value: unknown) => { guard.assertWritable(); snapshot[key] = value; };
  const startedAt = guard.epoch();
  let release!: () => void;
  const erasing = new Promise<void>(resolve => { release = resolve; });
  const reset = guard.run(() => { snapshot = {}; }, () => erasing);
  assert.equal(guard.resetting(), true);
  assert.deepEqual(snapshot, {}, 'a limpeza inicial é síncrona');
  // Desmonte do MessagingProvider causado pelo reset: a gravação é recusada.
  assert.throws(() => write('msg.state', 'contatos-da-identidade-antiga'), /sendo apagados/);
  assert.equal(persistedWriteStillValid(startedAt, guard.epoch()), false, 'o desmonte reconhece que veio de um reset');
  // Mesmo que algo escreva direto na memória durante o apagamento, a limpeza final remove.
  snapshot['msg.state'] = 'contatos-da-identidade-antiga';
  release(); await reset;
  assert.equal(guard.resetting(), false);
  assert.equal(snapshot['msg.state'], undefined, 'a identidade seguinte não encontra o estado antigo');
  write('msg.state', 'identidade-nova');
  assert.equal(snapshot['msg.state'], 'identidade-nova');
});

test('falha ao apagar o armazenamento não deixa as gravações travadas', async () => {
  const guard = createResetGuard();
  let wipes = 0;
  await assert.rejects(guard.run(() => { wipes += 1; }, async () => { throw new Error('disco'); }), /disco/);
  assert.equal(wipes, 2);
  assert.equal(guard.resetting(), false);
  assert.doesNotThrow(() => guard.assertWritable());
});

test('valor salvo só vale se abrir com a chave: texto puro sem o prefixo cifrado é ilegível', async () => {
  const { readSealedValue } = await import('../persistSafety');
  const open = (s: string) => (s === 'e1:ok' ? { lock: true } : undefined);
  assert.deepEqual(readSealedValue('e1:ok', open), { ok: true, value: { lock: true } });
  assert.deepEqual(readSealedValue('e1:adulterado', open), { ok: false }, 'GCM inválido');
  assert.deepEqual(readSealedValue('{"lock":false}', open), { ok: false }, 'JSON em claro injetado não é aceito');
  assert.deepEqual(readSealedValue('', open), { ok: false });
});

test('gravação com atraso: a memória (o que o núcleo lê) muda na hora, o disco depois do atraso', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    // Mudar "Pré-visualização" para "Nunca": um aviso logo depois já não mostra o conteúdo.
    const mem: Record<string, unknown> = { 'set.preview': 'always' }, disk: Record<string, unknown> = {};
    const guard = createResetGuard();
    const w = createDelayedWrites({ delay: 250, guard, mem: (k, v) => { mem[k] = v; }, write: (k, v) => { disk[k] = v; } });
    w.schedule('set.preview', 'never');
    assert.equal(mem['set.preview'], 'never');
    assert.equal(disk['set.preview'], undefined);
    w.schedule('set.preview', 'unlocked'); // a última vence, uma gravação só
    mock.timers.tick(250);
    assert.deepEqual(disk, { 'set.preview': 'unlocked' });
    // Cancelada (persistNow, forget): não grava.
    w.schedule('a', 1); w.cancel('a');
    w.schedule('b', 2); w.cancelAll();
    mock.timers.tick(250);
    assert.deepEqual(Object.keys(disk), ['set.preview']);
  } finally { mock.timers.reset(); }
});

test('gravação com atraso durante "Apagar dados locais": nada na memória apagada; grava só no estado novo', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const mem: Record<string, unknown> = {}, disk: Record<string, unknown> = {};
    const guard = createResetGuard();
    const w = createDelayedWrites({ delay: 250, guard, mem: (k, v) => { mem[k] = v; }, write: (k, v) => { disk[k] = v; } });
    // Agendada antes do apagamento: o apagamento leva a memória e a gravação não acontece.
    w.schedule('old', 1);
    let finish!: () => void;
    const reset = guard.run(() => { for (const k of Object.keys(mem)) delete mem[k]; }, () => new Promise<void>(r => { finish = r; }));
    w.schedule('new', 2);
    assert.deepEqual(mem, {}, 'durante o apagamento a memória fica vazia');
    mock.timers.tick(250);
    assert.deepEqual(disk, {});
    finish(); await reset;
    mock.timers.tick(250);
    assert.deepEqual(disk, { new: 2 });
    assert.deepEqual(mem, { new: 2 });
  } finally { mock.timers.reset(); }
});
