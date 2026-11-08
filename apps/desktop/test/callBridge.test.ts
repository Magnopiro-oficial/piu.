import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readCallAct, readCallFrame } from '../src/shared/callBridge';

const peer = 'piu:' + 'ab'.repeat(16);

test('ponte da chamada: a tela só pede o que um botão pede', () => {
  assert.deepEqual(readCallAct({ a: 'open', peer }), { a: 'open', peer });
  assert.deepEqual(readCallAct({ a: 'dial', extra: 1 }), { a: 'dial' });
  assert.deepEqual(readCallAct({ a: 'decline', how: 'later' }), { a: 'decline', how: 'later' });
  assert.deepEqual(readCallAct({ a: 'event', event: { type: 'mute', now: 5 } }), { a: 'event', event: { type: 'mute' } });
  // Eventos da rede ou com dados não passam: a tela não forja "atendeu" nem "chegou chamada".
  for (const type of ['connected', 'incoming', 'remoteEnd', 'requestAccepted', 'handoff', 'endDone', 'dial']) assert.equal(readCallAct({ a: 'event', event: { type } }), null, type);
  assert.equal(readCallAct({ a: 'open', peer: 'piu:../x' }), null);
  assert.equal(readCallAct({ a: 'decline', how: 'busy' }), null);
  assert.equal(readCallAct({ a: 'dispose' }), null);
  assert.equal(readCallAct(null), null);
  assert.equal(readCallAct('hangup'), null);
});

test('ponte da chamada: quadro do microfone só Opus/PCMU, de 1 byte a 1 KB', () => {
  assert.ok(readCallFrame('opus', new Uint8Array(60)));
  assert.ok(readCallFrame('pcmu', new Uint8Array(160)));
  assert.equal(readCallFrame('opus', new Uint8Array(0)), null);
  assert.equal(readCallFrame('opus', new Uint8Array(1025)), null);
  assert.equal(readCallFrame('aac', new Uint8Array(10)), null);
  assert.equal(readCallFrame('opus', [1, 2, 3]), null);
});
