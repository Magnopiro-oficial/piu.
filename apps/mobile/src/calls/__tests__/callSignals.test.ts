import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callWire, isLiveSignal, readCallWire } from '../callSignals';

const K = 'A'.repeat(43);

test('ida e volta de todos os sinais', () => {
  const all = [
    callWire({ t: 'invite', callId: 'call-0001', route: 'bt', requestId: 'req-00001' }, K),
    callWire({ t: 'accept', callId: 'call-0001' }, K),
    callWire({ t: 'ringing', callId: 'call-0001' }),
    callWire({ t: 'decline', callId: 'call-0001', reason: 'message' }),
    callWire({ t: 'cancel', callId: 'call-0001', rangMs: 22_000 }),
    callWire({ t: 'end', callId: 'call-0001', reason: 'sas' }),
    callWire({ t: 'request', requestId: 'req-00001' }),
    callWire({ t: 'requestAnswer', requestId: 'req-00001', ok: false }),
  ];
  for (const w of all) {
    const back = readCallWire(JSON.parse(JSON.stringify(w)));
    assert.deepEqual(back, { signal: w.s, ...(w.k ? { key: w.k } : {}) });
  }
});

test('recusa o malformado: sem chave no convite/aceite, id curto, rota ou motivo desconhecidos', () => {
  assert.equal(readCallWire({ t: 'cl', s: { t: 'invite', callId: 'call-0001', route: 'direct' } }), null);
  assert.equal(readCallWire({ t: 'cl', s: { t: 'accept', callId: 'call-0001' } }), null);
  assert.equal(readCallWire({ t: 'cl', s: { t: 'ringing', callId: 'x' } }), null);
  assert.equal(readCallWire({ t: 'cl', s: { t: 'invite', callId: 'call-0001', route: 'mesh' }, k: K }), null);
  assert.equal(readCallWire({ t: 'cl', s: { t: 'end', callId: 'call-0001', reason: 'boom' } }), null);
  assert.equal(readCallWire({ t: 'cl', s: { t: 'ringing', callId: 'call-0001' }, k: 'curta' }), null);
  assert.equal(readCallWire({ t: 'm', s: {} }), null);
  assert.equal(readCallWire(null), null);
});

test('só o pedido e a resposta ao pedido viajam pela fila da malha', () => {
  assert.equal(isLiveSignal({ t: 'request', requestId: 'req-00001' }), false);
  assert.equal(isLiveSignal({ t: 'requestAnswer', requestId: 'req-00001', ok: true }), false);
  assert.equal(isLiveSignal({ t: 'invite', callId: 'call-0001', route: 'direct' }), true);
});
