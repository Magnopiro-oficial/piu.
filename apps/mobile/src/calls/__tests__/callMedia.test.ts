import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callKeys, newCallKeypair } from '../callCrypto';
import { LOST_MS, VoiceLink, hintOfMedium, routeOfMedium, type VoiceLinkPorts } from '../callMedia';
import type { LiveRoute } from '../callMachine';
import type { Medium } from '../../transport/types';

/** Dois aparelhos ligados por enlaces simulados (o outro vizinho "x" não é da chamada). */
function world(medium: Medium = 'lan') {
  let now = 0;
  const a = newCallKeypair(), b = newCallKeypair();
  const ka = callKeys({ callId: 'call-0001', role: 'caller', mySk: a.sk, myPk: a.pk, theirPk: b.pk });
  const kb = callKeys({ callId: 'call-0001', role: 'callee', mySk: b.sk, myPk: b.pk, theirPk: a.pk });
  const log = { a: [] as string[], b: [] as string[], audioB: [] as number[], routesA: [] as (LiveRoute | null)[], latA: [] as number[], toX: 0, sizesX: [] as number[] };
  let up = true;
  const mk = (me: 'a' | 'b'): VoiceLinkPorts => ({
    now: () => now,
    links: () => [{ peerId: me === 'a' ? 'peer-b' : 'peer-a', medium }, { peerId: 'x', medium: 'ble' }],
    send: (peerId, frame) => {
      log[me].push(peerId);
      if (peerId === 'x') { log.toX++; log.sizesX.push(frame.length); return; }
      if (!up) return;
      (me === 'a' ? B : A).receive(me === 'a' ? 'peer-a' : 'peer-b', medium, frame);
    },
    onAudio: (_c, p) => { if (me === 'b') log.audioB.push(p.length); },
    onRoute: (r, l) => { if (me === 'a') { log.routesA.push(r); if (l !== undefined) log.latA.push(l); } },
  });
  const A = new VoiceLink(ka, mk('a')), B = new VoiceLink(kb, mk('b'));
  return { A, B, log, tick: (ms: number) => { now += ms; }, cut: () => { up = false; }, heal: () => { up = true; } };
}

test('antes de achar o contato, só o ping vai a todos (áudio nunca); depois, áudio só pelo enlace dele', () => {
  const w = world();
  const ping = (() => { const o = world(); o.A.tick(); return o.log.sizesX[0]; })();
  // Auditoria 2026-11-09: áudio a vizinhos alheios mostrava a cadência da fala. Sem enlace, o quadro
  // de áudio não sai: no lugar dele vai um ping de busca (o mesmo tamanho para todos).
  w.A.sendAudio('opus', new Uint8Array(40));
  assert.deepEqual(w.log.audioB, [], 'áudio sem enlace não sai');
  assert.deepEqual(w.log.sizesX, [ping], 'ao vizinho alheio só foi o ping');
  w.log.a.length = 0;
  w.A.sendAudio('opus', new Uint8Array(40));
  assert.deepEqual(w.log.a, ['peer-b'], 'aprendeu o enlace pelo pong');
  assert.deepEqual(w.log.audioB, [40]);
  assert.equal(w.A.currentRoute, 'direct');
});

test('caminho caiu: áudio para de ir a todos e a busca (ping) recomeça na hora', () => {
  const w = world();
  w.A.tick();
  w.tick(200); w.A.tick(); // ainda dentro do 1 s do ping
  w.cut();
  w.tick(LOST_MS + 10);
  w.A.tick(); // detecta a queda
  assert.equal(w.A.currentRoute, null);
  w.heal();
  w.log.sizesX.length = 0;
  w.tick(250);
  w.A.sendAudio('opus', new Uint8Array(40));
  w.A.sendAudio('opus', new Uint8Array(40));
  assert.ok(w.log.sizesX.every(n => n < 40), 'ao vizinho alheio nunca vai áudio');
  assert.equal(w.A.currentRoute, 'direct', 'não espera o 1 s inteiro para procurar');
  assert.deepEqual(w.log.audioB, [40]);
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
  spy.tick();
  assert.equal(o.B.receive('p', 'lan', captured!), false);
  assert.equal(w.B.receive('p', 'lan', captured!), true);
  assert.equal(w.B.receive('p', 'lan', captured!), false, 'repetido');
});

test('meio do enlace → caminho: rede local = Wi-Fi; Nearby/BLE = direto sem rede ("bt"); vizinho Ponto Piu = Ponto', () => {
  assert.equal(routeOfMedium('lan', false), 'direct');
  assert.equal(routeOfMedium('nearby', false), 'bt');
  assert.equal(routeOfMedium('ble', false), 'bt');
  assert.equal(routeOfMedium('lan', true), 'point');
});

test('voz nunca pelo LoRa: quadro que chega pelo rádio não vira o enlace, e o envio a todos pula o rádio', () => {
  const a = newCallKeypair(), b = newCallKeypair();
  const ka = callKeys({ callId: 'call-0001', role: 'caller', mySk: a.sk, myPk: a.pk, theirPk: b.pk });
  const kb = callKeys({ callId: 'call-0001', role: 'callee', mySk: b.sk, myPk: b.pk, theirPk: a.pk });
  const outA: string[] = [];
  let frame: Uint8Array | null = null;
  const B = new VoiceLink(kb, { now: () => 0, links: () => [{ peerId: 'peer-a', medium: 'lora' }, { peerId: 'peer-a2', medium: 'ble' }], send: (_p, f) => { frame = f; }, onAudio: () => {}, onRoute: () => {} });
  B.tick();
  const A = new VoiceLink(ka, {
    now: () => 0, links: () => [{ peerId: 'lora:mesh', medium: 'lora' }, { peerId: 'radio-piu', medium: 'piulora' }, { peerId: 'peer-b', medium: 'ble' }],
    send: p => outA.push(p), onAudio: () => {}, onRoute: () => {},
  });
  assert.equal(A.receive('lora:mesh', 'lora', frame!), false);
  assert.equal(A.currentRoute, null);
  A.tick();
  assert.deepEqual(outA, ['peer-b']);
});

test('Nearby (Wi-Fi Direct) não aparece como Bluetooth: o caminho é "bt" com a marca de Wi-Fi Direct', () => {
  assert.equal(hintOfMedium('nearby', false), 'wifiDirect');
  assert.equal(hintOfMedium('ble', false), 'bt');
  assert.equal(hintOfMedium('nearby', true), 'point');
  const seen: [LiveRoute | null, boolean | undefined][] = [];
  const a = newCallKeypair(), b = newCallKeypair();
  const kb = callKeys({ callId: 'call-0001', role: 'callee', mySk: b.sk, myPk: b.pk, theirPk: a.pk });
  const ka = callKeys({ callId: 'call-0001', role: 'caller', mySk: a.sk, myPk: a.pk, theirPk: b.pk });
  let frame: Uint8Array | null = null;
  new VoiceLink(kb, { now: () => 0, links: () => [{ peerId: 'x', medium: 'nearby' }], send: (_p, f) => { frame = f; }, onAudio: () => {}, onRoute: () => {} }).tick();
  const A = new VoiceLink(ka, { now: () => 0, links: () => [], send: () => {}, onAudio: () => {}, onRoute: (r, _l, wd) => seen.push([r, wd]) });
  A.receive('peer-b', 'nearby', frame!);
  assert.deepEqual(seen, [['bt', true]]);
  assert.equal(A.isWifiDirect, true);
});
