/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Reassembler, splitEnvelope } from '../meshtastic/fragments';
import { encodeNodeBeacon } from '../meshtastic/nodeBeacon';
import { LORA_PEER } from '../meshtastic/link';
import { CMD, KissReader, kissFrame } from '../rnode/rnode';
import { PiuLoraLink, type ByteStream } from '../rnode/link';
import { piuRadio } from '../rnode/regions';
import { countryFromLocale, initialRegion } from '../rnode/region';
import { isLora, MEDIA, rankLinks, type LinkInfo } from '../select';
import type { LinkEvent } from '../multi';
import { deriveNodeKey, newSeed } from '../../protocol/keys';

/** RNode pelo Bluetooth: responde cada ajuste com o valor em vigor e guarda o que foi ao ar. */
class FakeRNodeBle implements ByteStream {
  private fn: ((b: Uint8Array) => void) | null = null;
  private rd = new KissReader();
  aired: Uint8Array[] = [];
  override: Partial<Record<number, Uint8Array>> = {};
  async write(bytes: Uint8Array) {
    for (const { cmd, data } of this.rd.push(bytes)) {
      if (cmd === CMD.DATA) { this.aired.push(data); continue; }
      this.send(cmd, this.override[cmd] ?? (cmd === CMD.DETECT ? Uint8Array.of(0x46) : data));
    }
  }
  onData(fn: (b: Uint8Array) => void) { this.fn = fn; return () => { this.fn = null; }; }
  send(cmd: number, data: Uint8Array) { const f = kissFrame(cmd, data); this.fn?.(f.subarray(0, 3)); this.fn?.(f.subarray(3)); }
  hear(p: Uint8Array) { this.send(CMD.DATA, p); }
}

const T = 1_800_000_000_000;

async function setup(region = 'BR_902') {
  const now = { t: T };
  const link = new PiuLoraLink({ now: () => now.t, region });
  const ev: LinkEvent[] = [];
  link.subscribe(e => ev.push(e));
  const radio = new FakeRNodeBle();
  await link.attach(radio);
  return { now, link, ev, radio };
}

test('meio piulora: o seletor prefere o LoRa próprio ao Meshtastic para o mesmo vizinho', () => {
  assert.equal(MEDIA.piulora.energyCost, 3);
  assert.equal(MEDIA.piulora.maxEnvelopeBytes, MEDIA.lora.maxEnvelopeBytes);
  const L = (medium: LinkInfo['medium'], failures = 0, lastFailureAt?: number): LinkInfo => ({ medium, up: true, failures, lastFailureAt });
  for (const size of [300, 900]) assert.deepEqual(rankLinks([L('lora'), L('piulora')], { size, lowBattery: false, now: 0 }).map(l => l.medium), ['piulora', 'lora']);
  assert.deepEqual(rankLinks([L('lora'), L('piulora', 1, 0)], { size: 300, lowBattery: false, now: 1000 }).map(l => l.medium), ['lora', 'piulora'], 'falhou há pouco: o Meshtastic fica de reserva');
  assert.ok(isLora('lora') && isLora('piulora') && !isLora('ble'));
});

test('enlace piulora: configura o rádio da região e sobe como a malha LoRa', async () => {
  const { link, ev } = await setup();
  assert.equal(link.status().state, 'up');
  assert.equal(link.status().region, 'BR_902');
  assert.deepEqual(ev.filter(e => e.type === 'up').map(e => [e.medium, (e as { id: string }).id]), [['piulora', LORA_PEER]]);
});

test('enlace piulora: rádio que recusa o ajuste não sobe e diz o motivo', async () => {
  const now = { t: T };
  const link = new PiuLoraLink({ now: () => now.t, region: 'BR_902' });
  const radio = new FakeRNodeBle();
  radio.override[CMD.FREQUENCY] = Uint8Array.of(0, 0, 0, 1);
  await link.attach(radio);
  assert.equal(link.status().state, 'failed');
  assert.match(link.status().problem ?? '', /frequência/);
});

test('enlace piulora: envia em pedaços KISS dentro do tempo de rádio; recebe e conta Super Nodes', async () => {
  const { link, ev, radio } = await setup();
  const env = Uint8Array.from({ length: 300 }, (_, i) => i & 0xff);
  await link.send(LORA_PEER, env);
  const re = new Reassembler();
  assert.deepEqual([...radio.aired.map(p => re.push(p, T)).find(Boolean)!], [...env]);
  await assert.rejects(link.send(LORA_PEER, new Uint8Array(3000)), 'grande demais para o LoRa');
  for (const p of splitEnvelope(env.map(x => x ^ 1), 5)) radio.hear(p);
  assert.equal(ev.filter(e => e.type === 'data').length, 1);
  radio.hear(encodeNodeBeacon(deriveNodeKey(newSeed()), { at: Math.floor(T / 1000), relay: true, gateway: true }));
  assert.equal(link.status().superNodes, 1);
  assert.equal(link.status().gateways, 1);
  let busy = 0;
  for (let i = 0; i < 10; i++) await link.send(LORA_PEER, env).catch(() => { busy++; });
  assert.ok(busy > 0, 'o balde de tempo de rádio segura a rajada');
});

test('enlace piulora: trocar de região reconfigura o rádio; desconectar derruba o vizinho', async () => {
  const { link, ev, radio } = await setup();
  await link.setRegion('EU_868');
  assert.equal(link.status().region, 'EU_868');
  assert.equal(link.status().state, 'up');
  const before = radio.aired.length;
  await link.send(LORA_PEER, new Uint8Array(100));
  assert.equal(radio.aired.length, before + 1, 'segue enviando depois de reconfigurar');
  link.detach();
  assert.equal(link.status().state, 'off');
  assert.ok(ev.some(e => e.type === 'down' && e.medium === 'piulora'));
  assert.throws(() => new PiuLoraLink({ region: 'XX' }), /região/i);
});

test('região inicial: a escolhida pela pessoa; senão a do país; senão nenhuma (a pessoa escolhe)', () => {
  assert.equal(initialRegion({ saved: 'EU_433', country: 'BR' }), 'EU_433');
  assert.equal(initialRegion({ saved: 'XX', country: 'BR' }), 'BR_902', 'salva inválida é ignorada');
  assert.equal(initialRegion({ country: 'de' }), 'EU_868');
  assert.equal(initialRegion({ country: 'AR' }), null);
  assert.equal(initialRegion({}), null);
  assert.equal(piuRadio('BR_902').freqHz, 904_750_000);
  assert.deepEqual(['pt-BR', 'en_US', 'de-Latn-DE', 'pt', '', undefined].map(countryFromLocale), ['BR', 'US', 'DE', null, null, null]);
});

// ---- Rádio (rnode/radio.ts): busca, conexão pelo Nordic UART e queda ----

import { PiuLoraRadio, type RNodeClient } from '../rnode/radio';
import type { RadioDevice } from '../meshtastic/radio';

/** Módulo nativo falso: o Nordic UART entrega as respostas do RNode (FakeRNodeBle) como notificações. */
function fakeNus(fail?: string) {
  const ble = new FakeRNodeBle();
  const dev = new Set<(d: RadioDevice) => void>(), st = new Set<(s: string, r?: string) => void>();
  const data = new Set<(b: Uint8Array) => void>();
  const sub = <T,>(s: Set<T>, f: T) => { s.add(f); return { remove: () => { s.delete(f); } }; };
  ble.onData(b => data.forEach(f => f(b)));
  const client: RNodeClient & { state(s: string, r?: string): void; ble: FakeRNodeBle } = {
    ble,
    async scan() { dev.forEach(f => f({ id: 'A', name: 'RNode 3F2A', rssi: -90 })); dev.forEach(f => f({ id: 'B', name: 'RNode 77C1', rssi: -60 })); },
    async connect() { if (fail) throw Object.assign(new Error(fail), { code: fail }); },
    async write(b) { await ble.write(b); },
    disconnect() {},
    addDeviceListener: f => sub(dev, f), addDataListener: f => sub(data, f), addStateListener: f => sub(st, f),
    state: (s, r) => st.forEach(f => f(s, r)),
  };
  return client;
}

test('rádio RNode: busca ordena pelo sinal; conecta, configura e a malha sobe; queda derruba', async () => {
  const c = fakeNus();
  const r = new PiuLoraRadio(c, new PiuLoraLink({ now: () => T, region: 'BR_902' }));
  await r.scan(1);
  assert.deepEqual(r.status().devices.map(d => d.id), ['B', 'A']);
  await r.connect('B');
  assert.equal(r.status().phase, 'connected');
  assert.equal(r.link.status().state, 'up', 'o RNode confirmou cada ajuste pelo Bluetooth');
  await r.link.send(LORA_PEER, new Uint8Array(50));
  assert.equal(c.ble.aired.length, 1);
  c.state('disconnected');
  assert.equal(r.status().phase, 'away', 'mantém o rádio para reconectar');
  assert.equal(r.status().device?.id, 'B');
  assert.equal(r.link.status().state, 'off');
  const got: LinkEvent[] = [];
  r.link.subscribe(e => got.push(e));
  for (const p of splitEnvelope(new Uint8Array(40), 3)) c.ble.hear(p);
  assert.equal(got.filter(e => e.type === 'data').length, 0, 'depois da queda nada mais chega ao enlace');
});

test('rádio RNode: pareamento por PIN aparece; erro de conexão vira estado com código; sem região não sobe', async () => {
  const c = fakeNus('TIMEOUT');
  const r = new PiuLoraRadio(c, new PiuLoraLink({ now: () => T, region: 'BR_902' }));
  c.state('connecting', 'bond');
  assert.equal(r.status().phase, 'pairing');
  await r.connect('A');
  assert.equal(r.status().phase, 'error');
  assert.equal(r.status().error, 'TIMEOUT');
  const r2 = new PiuLoraRadio(fakeNus(), new PiuLoraLink({ now: () => T }));
  await r2.connect('A');
  assert.equal(r2.status().phase, 'connected');
  assert.equal(r2.link.status().state, 'failed');
  assert.match(r2.link.status().problem ?? '', /região/);
});
