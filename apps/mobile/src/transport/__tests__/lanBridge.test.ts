/// <reference types="node" />
/**
 * Rede local junto com Bluetooth/Nearby: seleção do meio, fonte combinada, ponte entre meios (o mesmo
 * celular pelos dois vira um vizinho só), política de ligar/desligar e o controle usado pelo app.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveNodeKey, newSeed } from '../../protocol/keys';
import { combineSources } from '../composite';
import { createLanController } from '../lan/controller';
import { lanLowPower, lanWanted } from '../lan/policy';
import { createMultiTransport, type LinkEvent, type LinkSource } from '../multi';
import { MEDIA, rankLinks, SMALL_ENVELOPE_BYTES, type LinkInfo } from '../select';
import type { Medium, TransportEvent } from '../types';
import { FakeLan } from './lanFake';

const L = (medium: Medium, extra: Partial<LinkInfo> = {}): LinkInfo => ({ medium, up: true, failures: 0, ...extra });
async function until(cond: () => boolean, what: string, ms = 4000) {
  const end = Date.now() + ms;
  while (!cond()) { if (Date.now() > end) throw new Error(`Tempo esgotado esperando: ${what}`); await new Promise(r => setTimeout(r, 10)); }
}

test('seleção: envelope grande prefere a rede local; pequeno e bateria baixa seguem no BLE; Nearby fica atrás do LAN', () => {
  const links = [L('nearby'), L('ble'), L('lan')];
  assert.deepEqual(rankLinks(links, { size: SMALL_ENVELOPE_BYTES + 1, lowBattery: false, now: 0 }).map(l => l.medium), ['lan', 'nearby', 'ble']);
  assert.deepEqual(rankLinks(links, { size: 200, lowBattery: false, now: 0 }).map(l => l.medium), ['ble', 'lan', 'nearby']);
  assert.deepEqual(rankLinks(links, { size: 20_000, lowBattery: true, now: 0 }).map(l => l.medium), ['ble', 'lan', 'nearby']);
  assert.ok(MEDIA.lan.approxBytesPerSec > MEDIA.nearby.approxBytesPerSec && MEDIA.lan.energyCost < MEDIA.nearby.energyCost);
  assert.equal(MEDIA.lan.maxEnvelopeBytes, 32 * 1024);
});

function fakePrimary() {
  const subs = new Set<(e: LinkEvent) => void>();
  const sent: string[] = [];
  const src: LinkSource = {
    kind: 'nearby', media: [MEDIA.nearby, MEDIA.ble],
    start: async () => { emit({ type: 'state', state: 'running' }); },
    stop: async () => { emit({ type: 'state', state: 'off' }); },
    sendVia: async (m, id) => { sent.push(`${m}:${id}`); },
    subscribe: fn => { subs.add(fn); return () => { subs.delete(fn); }; },
  };
  const emit = (e: LinkEvent) => subs.forEach(fn => fn(e));
  return { src, emit, sent };
}
function fakeLanLinks() {
  const subs = new Set<(e: LinkEvent) => void>();
  const sent: string[] = [];
  return {
    links: { subscribe: (fn: (e: LinkEvent) => void) => { subs.add(fn); return () => { subs.delete(fn); }; }, send: async (id: string) => { sent.push(`lan:${id}`); } },
    emit: (e: LinkEvent) => subs.forEach(fn => fn(e)),
    sent,
  };
}

test('fonte combinada: mesmo celular pelo BLE e pela rede local = um vizinho; envelope grande sai pelo LAN; desligar o Bluetooth não derruba o LAN', async () => {
  const p = fakePrimary(), l = fakeLanLinks();
  const t = createMultiTransport(combineSources(p.src, l.links));
  const ev: TransportEvent[] = [];
  t.subscribe(e => ev.push(e));
  assert.ok(t.media.some(m => m.medium === 'lan'));
  await t.start('piu-aaaaaa', 'x');
  p.emit({ type: 'up', medium: 'ble', id: 'AA:BB', name: 'piu-bbbbbb' });
  l.emit({ type: 'state', state: 'running' });
  l.emit({ type: 'up', medium: 'lan', id: '0123456789abcdef', name: 'piu-bbbbbb' });
  const peers = new Set(ev.filter(e => e.type === 'peerFound').map(e => (e as { peer: { id: string } }).peer.id));
  assert.deepEqual([...peers], ['n:piu-bbbbbb'], 'um vizinho lógico só');
  await t.send('n:piu-bbbbbb', new Uint8Array(10_000));
  assert.deepEqual(l.sent, ['lan:0123456789abcdef']);
  await t.send('n:piu-bbbbbb', new Uint8Array(100));
  assert.deepEqual(p.sent, ['ble:AA:BB']);

  // Bluetooth/Nearby param: o enlace BLE cai, o LAN segue e o vizinho continua conectado.
  ev.length = 0;
  await t.stop();
  assert.ok(!ev.some(e => e.type === 'state' && e.state === 'off'), 'estado agregado segue rodando');
  assert.ok(!ev.some(e => e.type === 'disconnected'));
  await t.send('n:piu-bbbbbb', new Uint8Array(100));
  assert.equal(l.sent.length, 2, 'sem BLE, o pequeno também vai pela rede local');

  // Rede local sai (Wi-Fi caiu) com o Bluetooth já parado: tudo desligado, como hoje (o app limpa os vizinhos).
  l.emit({ type: 'state', state: 'unavailable', reason: 'Sem Wi-Fi' });
  assert.ok(ev.some(e => e.type === 'state' && e.state === 'off'));
  await assert.rejects(t.send('n:piu-bbbbbb', new Uint8Array(1)), /não está conectado/);
});

test('ponte: o que chega pela rede local sai como envelope do vizinho (o roteador do mensageiro repassa pelos outros meios)', async () => {
  const p = fakePrimary(), l = fakeLanLinks();
  const t = createMultiTransport(combineSources(p.src, l.links));
  const ev: TransportEvent[] = [];
  t.subscribe(e => ev.push(e));
  l.emit({ type: 'state', state: 'running' });
  l.emit({ type: 'up', medium: 'lan', id: 'feedfacecafebeef' });
  p.emit({ type: 'state', state: 'running' });
  p.emit({ type: 'up', medium: 'ble', id: 'CC', name: 'piu-cccccc' });
  l.emit({ type: 'data', medium: 'lan', id: 'feedfacecafebeef', data: Uint8Array.of(7) });
  const env = ev.find(e => e.type === 'envelope');
  assert.ok(env && env.type === 'envelope' && env.via === 'lan');
  // O mensageiro manda adiante para o vizinho do BLE: cada vizinho sai pelo meio que ele tem.
  await t.send('n:piu-cccccc', Uint8Array.of(7));
  assert.deepEqual(p.sent, ['ble:CC']);
});

test('política: liga só com Wi-Fi, chave ligada, chaves e onboarding; bateria baixa = modo econômico', () => {
  const wifi = { connected: true, internet: false, ip: '192.168.1.2', prefix: 24, gateway: '192.168.1.1' };
  const on = { available: true, onboarded: true, hasNode: true, pref: true, wifi };
  assert.deepEqual(lanWanted(on), { on: true, reason: null });
  assert.equal(lanWanted({ ...on, wifi: { ...wifi, connected: false } }).reason, 'noWifi', 'dados móveis: desligado');
  assert.equal(lanWanted({ ...on, wifi: null }).reason, 'noWifi');
  assert.equal(lanWanted({ ...on, pref: false }).reason, 'userOff');
  assert.equal(lanWanted({ ...on, available: false }).reason, 'unavailable');
  assert.equal(lanWanted({ ...on, onboarded: false }).reason, 'onboarding');
  assert.equal(lanWanted({ ...on, hasNode: false }).reason, 'keys');
  assert.equal(lanLowPower({ level: 0.25, charging: false, limitPct: 30 }), true);
  assert.equal(lanLowPower({ level: 0.25, charging: true, limitPct: 30 }), false, 'na tomada não economiza');
  assert.equal(lanLowPower({ level: 0.8, charging: false, limitPct: 30, saver: true }), true, 'economia do sistema');
  assert.equal(lanLowPower({ level: -1, charging: null, limitPct: 30 }), false);
});

test('controle do app: liga com a chave do nó, vizinho manual validado, estado e teste de compatibilidade', async t => {
  const lan = new FakeLan();
  const a = lan.add('192.168.1.10'), b = lan.add('192.168.1.20');
  const A = createLanController(a, { beaconMs: 50, hintWaitMs: 20 });
  const B = createLanController(b, { beaconMs: 50, hintWaitMs: 20 });
  t.after(async () => { await A.stop(); await B.stop(); });
  assert.throws(() => A.addPeer('8.8.8.8:8422'), /rede local/);
  let changes = 0;
  A.onChange(() => { changes++; });
  await A.start({ node: deriveNodeKey(newSeed()), name: 'piu-aaaaaa', relay: true });
  await B.start({ node: deriveNodeKey(newSeed()), name: 'piu-bbbbbb', relay: false });
  await until(() => A.status().peers[0]?.name === 'piu-bbbbbb', 'vizinho pela rede local, com o nome curto');
  assert.equal(A.status().state, 'running');
  assert.equal(A.status().peers[0]?.name, 'piu-bbbbbb');
  assert.ok(changes > 0);
  const r = await A.runLanCheck({ listenMs: 60 });
  assert.equal(r.wifi, true);
  assert.equal(r.isolation, 'none');
  assert.equal(createLanController(null).available, false);
  assert.equal(createLanController(null).status().state, 'unavailable');
});
