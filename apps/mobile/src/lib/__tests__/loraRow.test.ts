import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loraRowState, radioErrorKind, signalOf } from '../loraRow';
import type { LoraStatus } from '../../transport/meshtastic/link';
import type { RadioStatus } from '../../transport/meshtastic/radio';

const link = (p: Partial<LoraStatus> = {}): LoraStatus => ({ state: 'up', myNode: 1, sent: 0, received: 0, nodesHeard: 7, battery: 82, region: 1, ...p });
const radio = (p: Partial<RadioStatus> = {}): RadioStatus => ({ phase: 'idle', device: null, devices: [], ...p });
const dev = { id: 'x', name: 'Meshtastic_3F2A', rssi: -55 };

test('linha LoRa: sem rádio, procurando, conectado com bateria/nós/região, fora de alcance, sem permissão', () => {
  assert.equal(loraRowState(radio(), link(), { granted: true, now: 0 }).kind, 'none');
  assert.equal(loraRowState(radio({ phase: 'pairing' }), link(), { granted: true, now: 0 }).kind, 'searching');
  assert.deepEqual(loraRowState(radio({ phase: 'connected', device: dev }), link(), { granted: true, now: 0 }),
    { kind: 'connected', radio: 'Meshtastic_3F2A', nodes: 7, region: '902–928 MHz', battery: 82 });
  assert.deepEqual(loraRowState(radio({ phase: 'away', device: dev }), link(), { granted: true, now: 0 }), { kind: 'away', radio: 'Meshtastic_3F2A' });
  assert.equal(loraRowState(radio({ phase: 'connected', device: dev }), link(), { granted: false, now: 0 }).kind, 'noPerm');
});

test('linha LoRa: "ocupado" só enquanto há algo esperando a vez; bateria na tomada (101) vira 100', () => {
  const r = radio({ phase: 'connected', device: dev });
  assert.equal(loraRowState(r, link({ busyUntil: 40_000 }), { granted: true, now: 0 }).busySec, 40);
  assert.equal(loraRowState(r, link({ busyUntil: 40_000 }), { granted: true, now: 41_000 }).busySec, undefined);
  assert.equal(loraRowState(r, link({ battery: 101 }), { granted: true, now: 0 }).battery, 100);
});

test('linha LoRa: Super Nodes do Piu ouvidos pelo anúncio, e se algum é gateway', () => {
  const r = radio({ phase: 'connected', device: dev });
  assert.equal(loraRowState(r, link(), { granted: true, now: 0 }).superNodes, undefined);
  assert.deepEqual(loraRowState(r, link({ superNodes: 2, gateways: 1 }), { granted: true, now: 0 }).superNodes, { count: 2, gateway: true });
  assert.deepEqual(loraRowState(r, link({ superNodes: 1, gateways: 0 }), { granted: true, now: 0 }).superNodes, { count: 1, gateway: false });
});

test('sinal do rádio e motivo do erro', () => {
  assert.deepEqual(signalOf(-50), { bars: 4, word: 'strong' });
  assert.deepEqual(signalOf(-90), { bars: 1, word: 'weak' });
  assert.equal(signalOf(-70).word, 'medium');
  assert.equal(radioErrorKind('TIMEOUT'), 'timeout');
  assert.equal(radioErrorKind(undefined), 'other');
});
