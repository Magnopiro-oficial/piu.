import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeExecution, readExecution } from '../src/lunes/execution.js';
import { LunesRpc } from '../src/lunes/lunesRpc.js';
import { executionEvents, SIGNING_METADATA } from './lunes-signing-fixture.js';
import { fakeConnect, hashOf } from './lunes-fake.js';

test('eventos usam metadata v14 e phase ApplyExtrinsic, sem supor índices de pallet/variante', async () => {
  const events = executionEvents([{ index: 1, success: false }, { index: 2, success: true }]);
  assert.deepEqual(await decodeExecution(SIGNING_METADATA, events, 2), { ok: true });
  assert.deepEqual(await decodeExecution(SIGNING_METADATA, events, 1), { ok: false, error: 'Other' });
  assert.equal((await decodeExecution(SIGNING_METADATA, events, 0)).ok, null);
  assert.equal((await decodeExecution('0x00', events, 2)).ok, null);
  assert.equal((await decodeExecution(SIGNING_METADATA, events + '00', 2)).ok, null, 'bytes extras não são aceitos');
});

test('leitura solicita metadata e System.Events no hash exato do bloco', async () => {
  const block = hashOf('finalizado');
  const calls: { method: string; params: unknown[] }[] = [];
  const connect = fakeConnect((method, params) => {
    calls.push({ method, params });
    if (method === 'state_getMetadata') return { result: SIGNING_METADATA };
    if (method === 'state_getStorage') return { result: executionEvents([{ index: 3, success: true }]) };
    throw new Error('RPC não esperado: ' + method);
  }).connect;
  const rpc = new LunesRpc({ endpoints: ['ws://fixture'], connect });
  try { assert.deepEqual(await readExecution(rpc, block, 3), { ok: true }); } finally { rpc.close(); }
  assert.deepEqual(calls.find(c => c.method === 'state_getMetadata')!.params, [block]);
  assert.deepEqual(calls.find(c => c.method === 'state_getStorage')!.params, ['0x26aa394eea5630e07c48ae0c9558cef780d41e5e16056765bc8461851072c9d7', block]);
});
