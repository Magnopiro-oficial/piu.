/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REGIONS, piuRadio } from '../../transport/rnode/regions';
import { RNodeSetup, CMD } from '../../transport/rnode/rnode';
import type { PiuLoraStatus } from '../../transport/rnode/link';
import type { RadioStatus } from '../../transport/meshtastic/radio';
import { freqLabel, inUse, loraMedia, piuProblem, piuRowState, REGION_GROUPS, regionRows, waitingFor } from '../piuLora';

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

/** Motivo de verdade, saído do RNodeSetup. */
function problemOf(cmd: number, data: number[]) {
  const s = new RNodeSetup(piuRadio('BR_902'));
  s.push(CMD.DETECT, Uint8Array.of(0x46));
  s.push(cmd, Uint8Array.from(data));
  return s.problem;
}

test('motivo do rádio do Piu: faixa errada, código do firmware, firmware errado, sem região', () => {
  assert.deepEqual(piuProblem(problemOf(CMD.FREQUENCY, [0x19, 0xd1, 0x4a, 0x40])), { kind: 'band' });
  assert.deepEqual(piuProblem(problemOf(CMD.ERROR, [0x03])), { kind: 'code', code: '0x03' });
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
  assert.deepEqual(up, { kind: 'connected', radio: 'RNode 3F2A', region: 'BR_902', freqHz: 904_750_000, superNodes: { count: 2, gateway: true }, busySec: 40 });
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
