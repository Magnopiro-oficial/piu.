/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REGIONS, piuRadio } from '../../transport/rnode/regions';
import { RNodeSetup, CMD } from '../../transport/rnode/rnode';
import type { PiuLoraStatus } from '../../transport/rnode/link';
import type { RadioStatus } from '../../transport/meshtastic/radio';
import { PiuLoraLink } from '../../transport/rnode/link';
import { bench, settle } from '../../transport/__tests__/support/rnodeBench';
import { freqLabel, inUse, loraMedia, nominalBand, piuProblem, piuRowState, REGION_GROUPS, regionRows, waitingFor } from '../piuLora';

test('caminho LoRa: a chave desliga os dois; "Só …" desliga o outro rádio', () => {
  assert.deepEqual(loraMedia('auto', true), { lora: true, piulora: true });
  assert.deepEqual(loraMedia('piu', true), { lora: false, piulora: true });
  assert.deepEqual(loraMedia('mesh', true), { lora: true, piulora: false });
  for (const m of ['auto', 'piu', 'mesh'] as const) assert.deepEqual(loraMedia(m, false), { lora: false, piulora: false });
});

test('caminho LoRa: rádio em uso e espera no modo "Só …"', () => {
  assert.equal(inUse('auto', { piu: true, mesh: true }), 'piu');
  assert.equal(inUse('auto', { piu: false, mesh: true }), 'mesh', 'Automático segue pelo Meshtastic');
  assert.equal(inUse('mesh', { piu: true, mesh: true }), 'mesh');
  assert.equal(inUse('piu', { piu: false, mesh: true }), null);
  assert.equal(waitingFor('piu', { piu: false, mesh: true }), 'piu');
  assert.equal(waitingFor('piu', { piu: true, mesh: true }), null);
  assert.equal(waitingFor('auto', { piu: false, mesh: false }), null, 'no Automático não há espera própria');
});

/** Motivo de verdade: a placa emulada responde e o enlace diz por que não subiu. */
async function problemOf(name: string, o: Parameters<typeof bench>[1] = {}, region = 'BR_902') {
  const { ble } = bench(name, { now: () => 0, ...o });
  const link = new PiuLoraLink({ now: () => 0, region, answerMs: 40 });
  await link.attach(ble);
  await settle();
  if (link.status().state === 'configuring') await new Promise(r => setTimeout(r, 60));
  return link.status().problem;
}

test('motivo do rádio do Piu: cada problema real da placa vira uma tela com o que fazer', async () => {
  // A faixa da placa vem junto (desenho 3h: ficha "placa · 433 MHz").
  assert.deepEqual(piuProblem(await problemOf('Heltec V3 (433)')), { kind: 'band', board: '433 MHz' });
  assert.deepEqual(piuProblem(await problemOf('Heltec V3 (915)', { radioFault: true })), { kind: 'code', code: '0x01' });
  assert.deepEqual(piuProblem(await problemOf('Heltec V3 (915)', { fw: [1, 50] })), { kind: 'old', version: '1.50' });
  assert.deepEqual(piuProblem(await problemOf('Heltec V3 (915)', { tnc: { freqHz: 869_525_000, bwHz: 125_000, sf: 8, cr: 5, txDbm: 14 } })), { kind: 'tnc' });
  assert.deepEqual(piuProblem(await problemOf('Heltec V3 (915)', { provisioned: false })), { kind: 'setup' });
  assert.deepEqual(piuProblem('o rádio da placa não ligou'), { kind: 'setup' });
  assert.deepEqual(piuProblem('o rádio não respondeu'), { kind: 'silent' });
  assert.deepEqual(piuProblem('frequência diferente do pedido (433)'), { kind: 'band' });
  const s = new RNodeSetup(piuRadio('BR_902'));
  s.push(CMD.DETECT, Uint8Array.of(0x00));
  assert.deepEqual(piuProblem(s.problem), { kind: 'notRNode' });
  assert.deepEqual(piuProblem('escolha a região do rádio'), { kind: 'region' });
  assert.deepEqual(piuProblem('SF diferente do pedido (7)'), { kind: 'other' });
});

const R = (p: Partial<RadioStatus>): RadioStatus => ({ phase: 'idle', device: null, devices: [], ...p });
const L = (p: Partial<PiuLoraStatus>): PiuLoraStatus => ({ state: 'off', region: 'BR_902', sent: 0, received: 0, superNodes: 0, gateways: 0, ...p });
const dev = { id: 'A', name: 'RNode 3F2A', rssi: -60 };

test('linha do rádio do Piu: conectado com canal, sem tempo de rádio, não configurou, perdido', () => {
  const o = { granted: true, now: 1000 };
  assert.equal(piuRowState(R({}), L({}), o).kind, 'none');
  assert.equal(piuRowState(R({}), L({}), { ...o, granted: false }).kind, 'noPerm');
  assert.equal(piuRowState(R({ phase: 'pairing', device: dev }), L({}), o).kind, 'searching');
  const up = piuRowState(R({ phase: 'connected', device: dev }), L({ state: 'up', superNodes: 2, gateways: 1, busyUntil: 41_000 }), o);
  assert.deepEqual(up, { kind: 'connected', radio: 'RNode 3F2A', region: 'BR_902', freqHz: 904_750_000, superNodes: { count: 2, gateways: 1 }, busySec: 40 });
  const failed = piuRowState(R({ phase: 'connected', device: dev }), L({ state: 'failed', problem: 'erro do RNode 0x03' }), o);
  assert.deepEqual(failed, { kind: 'failed', radio: 'RNode 3F2A', region: 'BR_902', problem: { kind: 'code', code: '0x03' } });
  assert.equal(piuRowState(R({ phase: 'connected', device: dev }), L({ state: 'configuring' }), o).kind, 'searching');
  assert.deepEqual(piuRowState(R({ phase: 'away', device: dev }), L({}), o), { kind: 'away', radio: 'RNode 3F2A' });
});

test('regiões: todas as 27 num grupo só; busca sem acento, pelo nome e pelo país', () => {
  const ids = REGION_GROUPS.flatMap(g => g.ids);
  assert.equal(ids.length, REGIONS.length);
  assert.deepEqual([...ids].sort(), REGIONS.map(r => r.id).sort());
  const name = (id: string) => ({ BR_902: 'Brasil', JP: 'Japão', EU_868: 'Europa 868 MHz', EU_433: 'Europa 433 MHz' } as Record<string, string>)[id] ?? id;
  const country = (cc: string) => ({ PT: 'Portugal', BR: 'Brasil', JP: 'Japão' } as Record<string, string>)[cc];
  const hits = (q: string) => regionRows(q, { name, country }).flatMap(g => g.rows.map(r => r.id));
  assert.deepEqual(hits('japao'), ['JP']);
  assert.deepEqual(hits('portugal'), ['EU_868', 'EU_433'], 'país dentro dos blocos');
  assert.ok(hits('').length === 27);
  assert.deepEqual(hits('xyz'), []);
  const br = regionRows('bras', { name, country })[0]!.rows[0]!;
  assert.deepEqual(br, { id: 'BR_902', name: 'Brasil', band: '902–907,5 MHz', maxDbm: 30, dutyPct: 100 });
  assert.equal(freqLabel(904_750_000), '904,75 MHz');
  assert.equal(freqLabel(2_441_000_000), '2441 MHz');
});

test('faixa nominal: placa e região viram "433 MHz", "868 MHz", "915 MHz" ou "2,4 GHz"; fora disso, a faixa exata', () => {
  assert.equal(nominalBand(904_750_000), '915 MHz');
  assert.equal(nominalBand(869_525_000), '868 MHz');
  assert.equal(nominalBand(433_875_000), '433 MHz');
  assert.equal(nominalBand(2_427_000_000), '2,4 GHz');
  assert.equal(nominalBand(490_000_000), undefined, 'China 470–510: sem faixa nominal');
  assert.deepEqual(piuProblem('frequência fora da faixa da placa (420–450 MHz)'), { kind: 'band', board: '433 MHz' });
  assert.deepEqual(piuProblem('frequência fora da faixa da placa (430–510 MHz)'), { kind: 'band', board: '433 MHz' });
  assert.deepEqual(piuProblem('frequência fora da faixa da placa (850–950 MHz)'), { kind: 'band', board: '850–950 MHz' }, 'serve para 868 e 915');
  assert.deepEqual(piuProblem('frequência fora da faixa da placa (470–510 MHz)'), { kind: 'band', board: '470–510 MHz' });
});
