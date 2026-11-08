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

test('anúncio repetido (o mesmo ou mais antigo) não renova o Super Node; lista cheia tira o que está calado há mais tempo', () => {
  const s = new NodeSightings();
  const a = deriveNodeKey(newSeed());
  const old = decodeNodeBeacon(encodeNodeBeacon(a, { at: T, relay: true, gateway: false }), T)!;
  s.saw(old, T);
  // Quem gravou o anúncio do ar e repete: continua valendo a hora do anúncio de verdade.
  s.saw(decodeNodeBeacon(encodeNodeBeacon(a, { at: T, relay: true, gateway: false }), T + 30 * 60)!, T + 30 * 60);
  assert.equal(s.near(T + 40 * 60 + 1).length, 0);
  // Enxurrada de 64 chaves novas não expulsa o nó real que segue anunciando.
  const real = deriveNodeKey(newSeed());
  s.saw(decodeNodeBeacon(encodeNodeBeacon(real, { at: T, relay: true, gateway: true }), T)!, T);
  for (let i = 0; i < 63; i++) s.saw(decodeNodeBeacon(encodeNodeBeacon(deriveNodeKey(newSeed()), { at: T + 1, relay: false, gateway: false }), T + 1)!, T + 1);
  s.saw(decodeNodeBeacon(encodeNodeBeacon(real, { at: T + 2, relay: true, gateway: true }), T + 2)!, T + 2);
  s.saw(decodeNodeBeacon(encodeNodeBeacon(deriveNodeKey(newSeed()), { at: T + 3, relay: false, gateway: false }), T + 3)!, T + 3);
  assert.ok(s.near(T + 4).some(n => n.gateway), 'o nó real ficou');
});

test('Super Nodes ouvidos para o mapa: id da chave, gateway e quando foi o último anúncio (só os de 40 min)', () => {
  const s = new NodeSightings();
  const a = deriveNodeKey(newSeed()), b = deriveNodeKey(newSeed());
  s.saw(decodeNodeBeacon(encodeNodeBeacon(a, { at: T, relay: true, gateway: false }), T)!, T);
  s.saw(decodeNodeBeacon(encodeNodeBeacon(b, { at: T + 30, relay: false, gateway: true }), T + 30)!, T + 30);
  s.saw(decodeNodeBeacon(encodeNodeBeacon(a, { at: T + 60, relay: true, gateway: false }), T + 60)!, T + 60);
  const hex = (x: Uint8Array) => Array.from(x, v => v.toString(16).padStart(2, '0')).join('');
  const l = s.heard(T + 100);
  assert.deepEqual(l.map(n => [n.id, n.gateway, n.last]).sort(), [[hex(a.pk), false, T + 60], [hex(b.pk), true, T + 30]].sort());
  assert.equal(s.heard(T + 30 + 40 * 60 + 1).length, 1);
});
