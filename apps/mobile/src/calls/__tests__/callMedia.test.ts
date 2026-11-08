import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callKeys, newCallKeypair } from '../callCrypto';
import { LOST_MS, VoiceLink, routeOfMedium, type VoiceLinkPorts } from '../callMedia';
import type { LiveRoute } from '../callMachine';
import type { Medium } from '../../transport/types';

/** Dois aparelhos ligados por enlaces simulados (o outro vizinho "x" não é da chamada). */
function world(medium: Medium = 'lan') {
  let now = 0;
  const a = newCallKeypair(), b = newCallKeypair();
  const ka = callKeys({ callId: 'call-0001', role: 'caller', mySk: a.sk, myPk: a.pk, theirPk: b.pk });
  const kb = callKeys({ callId: 'call-0001', role: 'callee', mySk: b.sk, myPk: b.pk, theirPk: a.pk });
  const log = { a: [] as string[], b: [] as string[], audioB: [] as number[], routesA: [] as (LiveRoute | null)[], latA: [] as number[], toX: 0 };
  let up = true;
  const mk = (me: 'a' | 'b'): VoiceLinkPorts => ({
    now: () => now,
    links: () => [{ peerId: me === 'a' ? 'peer-b' : 'peer-a', medium }, { peerId: 'x', medium: 'ble' }],
    send: (peerId, frame) => {
      log[me].push(peerId);
      if (peerId === 'x') { log.toX++; return; }
      if (!up) return;
      (me === 'a' ? B : A).receive(me === 'a' ? 'peer-a' : 'peer-b', medium, frame);
    },
    onAudio: (_c, p) => { if (me === 'b') log.audioB.push(p.length); },
    onRoute: (r, l) => { if (me === 'a') { log.routesA.push(r); if (l !== undefined) log.latA.push(l); } },
  });
  const A = new VoiceLink(ka, mk('a')), B = new VoiceLink(kb, mk('b'));
  return { A, B, log, tick: (ms: number) => { now += ms; }, cut: () => { up = false; }, heal: () => { up = true; } };
}

test('antes de achar o contato, manda a todos; depois, só pelo enlace dele', () => {
  const w = world();
  w.A.sendAudio('opus', new Uint8Array(40));
  assert.deepEqual(w.log.a, ['peer-b', 'x']);
  assert.deepEqual(w.log.audioB, [40]);
  w.B.sendAudio('opus', new Uint8Array(30));
  w.log.a.length = 0;
  w.A.sendAudio('opus', new Uint8Array(40));
  assert.deepEqual(w.log.a, ['peer-b'], 'aprendeu o enlace');
  assert.equal(w.A.currentRoute, 'direct');
});

test('ping/pong mede a latência e informa o caminho', () => {
  const w = world('ble');
  w.A.tick();
  assert.equal(w.A.currentRoute, 'bt');
  assert.ok(w.log.latA.length >= 1);
  assert.equal(w.A.latencyMs, 0);
});

test('sem quadros por mais de 1,5 s o caminho cai; voltando, o caminho volta', () => {
  const w = world();
  w.A.tick();
  assert.equal(w.A.currentRoute, 'direct');
  w.cut();
  w.tick(LOST_MS + 10);
  w.A.tick();
  assert.equal(w.A.currentRoute, null);
  assert.deepEqual(w.log.routesA.slice(-1), [null]);
  w.heal();
  w.tick(1000);
  w.A.tick();
  assert.equal(w.A.currentRoute, 'direct');
});

test('quadro de outra chamada ou repetido não é aceito', () => {
  const w = world(), o = world();
  let captured: Uint8Array | null = null;
  const spy = new VoiceLink((w.A as unknown as { keys: never }).keys, { now: () => 0, links: () => [{ peerId: 'p', medium: 'lan' }], send: (_p, f) => { captured = f; }, onAudio: () => {}, onRoute: () => {} });
  spy.sendAudio('pcmu', new Uint8Array(10));
  assert.equal(o.B.receive('p', 'lan', captured!), false);
  assert.equal(w.B.receive('p', 'lan', captured!), true);
  assert.equal(w.B.receive('p', 'lan', captured!), false, 'repetido');
});

test('meio do enlace → caminho: rede local = Wi-Fi; Nearby/BLE = Bluetooth; vizinho Ponto Piu = Ponto', () => {
  assert.equal(routeOfMedium('lan', false), 'direct');
  assert.equal(routeOfMedium('nearby', false), 'bt');
  assert.equal(routeOfMedium('ble', false), 'bt');
  assert.equal(routeOfMedium('lan', true), 'point');
});
