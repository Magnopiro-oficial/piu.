/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveNodeKey, newSeed } from '../../protocol/keys';
import { BEACON_BYTES, decodeNodeBeacon, encodeNodeBeacon, NodeSightings } from '../meshtastic/nodeBeacon';
import { DATA_PAYLOAD_LEN } from '../meshtastic/proto';

const T = 1_800_000_000;

test('anúncio PN: 104 bytes num pacote só, assinado pela chave técnica do nó', () => {
  const node = deriveNodeKey(newSeed());
  const b = encodeNodeBeacon(node, { at: T, relay: true, gateway: false });
  assert.equal(b.length, BEACON_BYTES);
  assert.ok(b.length <= DATA_PAYLOAD_LEN);
  assert.deepEqual([b[0], b[1]], [0x50, 0x4e]);
  const d = decodeNodeBeacon(b, T + 30);
  assert.ok(d);
  assert.deepEqual(d.pk, node.pk);
  assert.equal(d.relay, true);
  assert.equal(d.gateway, false);
});

test('anúncio PN: recusa assinatura errada, horário longe e o que não é anúncio', () => {
  const node = deriveNodeKey(newSeed());
  const b = encodeNodeBeacon(node, { at: T, relay: false, gateway: true });
  const bad = b.slice(); bad[39] ^= 1; // muda os bits sem nova assinatura
  assert.equal(decodeNodeBeacon(bad, T), null);
  assert.equal(decodeNodeBeacon(b, T + 3601), null);
  assert.equal(decodeNodeBeacon(b, T - 3601), null);
  assert.equal(decodeNodeBeacon(b.subarray(0, 50), T), null);
  const p1 = b.slice(); p1[1] = 0x31; // "P1" é pedaço de envelope
  assert.equal(decodeNodeBeacon(p1, T), null);
});

test('Super Nodes por perto: 40 min depois do último anúncio, um por chave', () => {
  const s = new NodeSightings();
  const a = deriveNodeKey(newSeed()), b = deriveNodeKey(newSeed());
  s.saw(decodeNodeBeacon(encodeNodeBeacon(a, { at: T, relay: true, gateway: false }), T)!, T);
  s.saw(decodeNodeBeacon(encodeNodeBeacon(a, { at: T + 60, relay: true, gateway: true }), T + 60)!, T + 60);
  s.saw(decodeNodeBeacon(encodeNodeBeacon(b, { at: T + 100, relay: false, gateway: false }), T + 100)!, T + 100);
  assert.deepEqual(s.near(T + 200).map(n => n.gateway), [true, false]);
  assert.equal(s.near(T + 60 + 40 * 60 + 1).length, 1);
  assert.equal(s.near(T + 100 + 40 * 60 + 1).length, 0);
});
