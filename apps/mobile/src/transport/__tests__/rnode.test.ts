/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CMD, configFrames, KissReader, kissFrame, RNodeSetup } from '../rnode/rnode';
import { piuRadio } from '../rnode/regions';

const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

test('KISS: quadro com escape e leitura partida, com ruído entre quadros', () => {
  const f = kissFrame(CMD.DATA, Uint8Array.of(1, 0xc0, 0xdb, 2));
  assert.deepEqual([...f], [0xc0, 0x00, 1, 0xdb, 0xdc, 0xdb, 0xdd, 2, 0xc0]);
  const r = new KissReader();
  assert.deepEqual(r.push(Uint8Array.of(0x41, 0x42, ...f.subarray(0, 4))), []);
  const got = r.push(Uint8Array.of(...f.subarray(4), 0xc0, 0xc0));
  assert.equal(got.length, 1, 'quadros vazios entre FENDs são ignorados');
  assert.equal(got[0]!.cmd, CMD.DATA);
  assert.deepEqual([...got[0]!.data], [1, 0xc0, 0xdb, 2]);
});

test('configuração: detecta, ajusta o rádio da região e liga por último', () => {
  const p = piuRadio('BR_902');
  const frames = configFrames(p);
  const r = new KissReader();
  const cmds = frames.flatMap(f => r.push(f));
  assert.deepEqual(cmds.map(c => c.cmd), [CMD.DETECT, CMD.FREQUENCY, CMD.BANDWIDTH, CMD.TXPOWER, CMD.SF, CMD.CR, CMD.LT_ALOCK, CMD.RADIO_STATE]);
  assert.deepEqual([...cmds[0]!.data], [0x73]);
  assert.deepEqual([...cmds[1]!.data], u32(904_750_000));
  assert.deepEqual([...cmds[2]!.data], u32(125_000));
  assert.deepEqual([...cmds[3]!.data], [17]);
  assert.deepEqual([...cmds[6]!.data], [0x03, 0xe8], '10 % em centésimos');
  assert.deepEqual([...cmds[7]!.data], [0x01]);
  assert.deepEqual([...kissFrame(CMD.LT_ALOCK, Uint8Array.of())].slice(0, 2), [0xc0, CMD.LT_ALOCK]);
  assert.deepEqual([...r.push(configFrames(piuRadio('EU_866'))[6]!)[0]!.data], [0x00, 0xfa], '2,5 % na EU 866');
});

/** O RNode responde cada ajuste com o valor em vigor. */
function echo(s: RNodeSetup, p = piuRadio('BR_902'), over: Partial<Record<number, number[]>> = {}) {
  const replies: [number, number[]][] = [
    [CMD.DETECT, [0x46]], [CMD.FREQUENCY, u32(p.freqHz)], [CMD.BANDWIDTH, u32(p.bwHz)], [CMD.TXPOWER, [p.txDbm]],
    [CMD.SF, [p.sf]], [CMD.CR, [p.cr]], [CMD.LT_ALOCK, [(p.airtimePct * 100) >> 8, (p.airtimePct * 100) & 0xff]], [CMD.RADIO_STATE, [1]],
  ];
  for (const [c, d] of replies) s.push(c, Uint8Array.from(over[c] ?? d));
}

test('enlace só sobe quando todos os ajustes conferem e o rádio está ligado', () => {
  const s = new RNodeSetup(piuRadio('BR_902'));
  assert.equal(s.state, 'detecting');
  s.push(CMD.DETECT, Uint8Array.of(0x46));
  assert.equal(s.state, 'configuring');
  s.push(CMD.FREQUENCY, Uint8Array.from(u32(904_750_000)));
  assert.equal(s.state, 'configuring', 'falta o resto');
  echo(s);
  assert.equal(s.state, 'up');
  s.push(CMD.STAT_RSSI, Uint8Array.of(0x50));
  assert.equal(s.state, 'up', 'estatística não mexe no estado');
});

test('valor diferente, rádio desligado ou erro do firmware derrubam o enlace', () => {
  const freq = new RNodeSetup(piuRadio('BR_902'));
  echo(freq, undefined, { [CMD.FREQUENCY]: u32(915_000_000) });
  assert.equal(freq.state, 'failed');
  assert.match(freq.problem ?? '', /frequência/);

  const off = new RNodeSetup(piuRadio('BR_902'));
  echo(off, undefined, { [CMD.RADIO_STATE]: [0] });
  assert.equal(off.state, 'failed');

  const err = new RNodeSetup(piuRadio('BR_902'));
  echo(err);
  err.push(CMD.ERROR, Uint8Array.of(0x02));
  assert.equal(err.state, 'failed');
  assert.match(err.problem ?? '', /0x02/);

  const low = new RNodeSetup(piuRadio('BR_902'));
  echo(low, undefined, { [CMD.TXPOWER]: [14] });
  assert.equal(low.state, 'up', 'placa que limita a potência abaixo do pedido ainda serve');
});
