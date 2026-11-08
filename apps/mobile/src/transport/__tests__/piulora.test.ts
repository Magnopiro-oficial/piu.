/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Reassembler, splitEnvelope } from '../meshtastic/fragments';
import { encodeNodeBeacon } from '../meshtastic/nodeBeacon';
import { LORA_PEER } from '../meshtastic/link';
import { PiuLoraLink } from '../rnode/link';
import { bench, settle } from './support/rnodeBench';
import { piuRadio } from '../rnode/regions';
import { countryFromLocale } from '../rnode/region';
import { isLora, MEDIA, rankLinks, type LinkInfo } from '../select';
import type { LinkEvent } from '../multi';
import { deriveNodeKey, newSeed } from '../../protocol/keys';

const T = 1_800_000_000_000;

async function setup(region = 'BR_902', boardName = 'Heltec V3 (915)') {
  const now = { t: T };
  const link = new PiuLoraLink({ now: () => now.t, region });
  const ev: LinkEvent[] = [];
  link.subscribe(e => ev.push(e));
  const radio = bench(boardName, { now: () => now.t });
  await link.attach(radio.ble);
  await settle();
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
  const { link, ev, radio } = await setup();
  assert.equal(link.status().state, 'up');
  assert.equal(link.status().region, 'BR_902');
  assert.equal(link.status().board, 'Heltec LoRa32 v3', 'a placa diz o modelo pela memória');
  assert.deepEqual(radio.emu.phy(), { freqHz: 904_750_000, bwHz: 125_000, sf: 9, cr: 5, txDbm: 17 }, 'no ar com o canal do Brasil');
  assert.deepEqual(ev.filter(e => e.type === 'up').map(e => [e.medium, (e as { id: string }).id]), [['piulora', LORA_PEER]]);
});

test('enlace piulora: placa de outra faixa não sobe e diz o motivo', async () => {
  const { link, radio } = await setup('BR_902', 'Heltec V3 (433)');
  assert.equal(link.status().state, 'failed');
  assert.match(link.status().problem ?? '', /fora da faixa da placa \(420–520 MHz\)/);
  assert.equal(radio.emu.online, false, 'nem chega a ligar o rádio');
});

test('enlace piulora: envia em pedaços KISS dentro do tempo de rádio; recebe e conta Super Nodes', async () => {
  const { link, ev, radio } = await setup();
  const env = Uint8Array.from({ length: 300 }, (_, i) => i & 0xff);
  await link.send(LORA_PEER, env);
  await settle();
  const re = new Reassembler();
  assert.deepEqual([...radio.aired.map(p => re.push(p, T)).find(Boolean)!], [...env]);
  await assert.rejects(link.send(LORA_PEER, new Uint8Array(3000)), 'grande demais para o LoRa');
  for (const p of splitEnvelope(env.map(x => x ^ 1), 5)) radio.hear(p);
  await settle();
  assert.equal(ev.filter(e => e.type === 'data').length, 1);
  radio.hear(encodeNodeBeacon(deriveNodeKey(newSeed()), { at: Math.floor(T / 1000), relay: true, gateway: true }));
  await settle();
  assert.equal(link.status().superNodes, 1);
  assert.equal(link.status().gateways, 1);
  let busy = 0;
  for (let i = 0; i < 10; i++) await link.send(LORA_PEER, env).catch(() => { busy++; });
  assert.ok(busy > 0, 'o balde de tempo de rádio segura a rajada');
});

test('enlace piulora: trocar de região reconfigura o rádio; desconectar derruba o vizinho', async () => {
  const { link, ev, radio } = await setup();
  await link.setRegion('EU_868');
  await settle();
  assert.equal(link.status().region, 'EU_868');
  assert.equal(link.status().state, 'up');
  assert.equal(radio.emu.phy()?.freqHz, 869_525_000, 'o rádio já está no canal novo');
  const before = radio.aired.length;
  await link.send(LORA_PEER, new Uint8Array(100));
  await settle();
  assert.equal(radio.aired.length, before + 1, 'segue enviando depois de reconfigurar');
  link.detach();
  assert.equal(link.status().state, 'off');
  assert.ok(ev.some(e => e.type === 'down' && e.medium === 'piulora'));
  assert.throws(() => new PiuLoraLink({ region: 'XX' }), /região/i);
});

test('região: o idioma só sugere; sem a escolha da pessoa o rádio não liga nem transmite', async () => {
  assert.equal(piuRadio('BR_902').freqHz, 904_750_000);
  assert.deepEqual(['pt-BR', 'en_US', 'de-Latn-DE', 'pt', '', undefined].map(countryFromLocale), ['BR', 'US', 'DE', null, null, null]);
  const link = new PiuLoraLink({ now: () => T });
  const radio = bench('Heltec V3 (915)', { now: () => T });
  await link.attach(radio.ble); await settle();
  assert.equal(link.status().state, 'failed');
  assert.match(link.status().problem ?? '', /escolha a região/);
  assert.equal(radio.emu.online, false, 'nenhum comando de rádio foi mandado');
  await link.setRegion('BR_902'); await settle();
  assert.equal(link.status().state, 'up');
});

// ---- Rádio (rnode/radio.ts): busca, conexão pelo Nordic UART e queda ----

import { PiuLoraRadio, type RNodeClient } from '../rnode/radio';
import type { RadioDevice } from '../meshtastic/radio';

/** Módulo nativo de teste: o Nordic UART liga a placa emulada (support/rnodeBench.ts). */
function fakeNus(fail?: string) {
  const b = bench(), ble = Object.assign(b.ble, { aired: b.aired, hear: b.hear });
  const dev = new Set<(d: RadioDevice) => void>(), st = new Set<(s: string, r?: string) => void>();
  const data = new Set<(b: Uint8Array) => void>();
  const sub = <T,>(s: Set<T>, f: T) => { s.add(f); return { remove: () => { s.delete(f); } }; };
  ble.onData(b => data.forEach(f => f(b)));
  const client: RNodeClient & { state(s: string, r?: string): void; ble: typeof ble } = {
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
  await settle();
  assert.equal(r.status().phase, 'connected');
  assert.equal(r.link.status().state, 'up', 'o RNode confirmou cada ajuste pelo Bluetooth');
  await r.link.send(LORA_PEER, new Uint8Array(50));
  await settle();
  assert.equal(c.ble.aired.length, 1);
  c.state('disconnected');
  assert.equal(r.status().phase, 'away', 'mantém o rádio para reconectar');
  assert.equal(r.status().device?.id, 'B');
  assert.equal(r.link.status().state, 'off');
  const got: LinkEvent[] = [];
  r.link.subscribe(e => got.push(e));
  for (const p of splitEnvelope(new Uint8Array(40), 3)) c.ble.hear(p);
  await settle();
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
