/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CMD, configFrames, KissReader, kissFrame, probeFrames, RNodeSetup } from '../rnode/rnode';
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

test('configuração: pergunta quem é a placa, depois ajusta o rádio da região e liga por último', () => {
  const r = new KissReader();
  assert.deepEqual(probeFrames().flatMap(f => r.push(f)).map(c => [c.cmd, [...c.data]]),
    [[CMD.DETECT, [0x73]], [CMD.FW_VERSION, [0]], [CMD.PLATFORM, [0]], [CMD.MCU, [0]], [CMD.ROM_READ, [0]]]);
  const p = piuRadio('BR_902');
  const cmds = configFrames(p).flatMap(f => r.push(f));
  assert.deepEqual(cmds.map(c => c.cmd), [CMD.FREQUENCY, CMD.BANDWIDTH, CMD.TXPOWER, CMD.SF, CMD.CR, CMD.LT_ALOCK, CMD.RADIO_STATE]);
  assert.deepEqual([...cmds[0]!.data], u32(904_750_000));
  assert.deepEqual([...cmds[1]!.data], u32(125_000));
  assert.deepEqual([...cmds[2]!.data], [17]);
  assert.deepEqual([...cmds[5]!.data], [0x03, 0xe8], '10 % em centésimos');
  assert.deepEqual([...cmds[6]!.data], [0x01]);
  assert.deepEqual([...r.push(configFrames(piuRadio('EU_866'))[5]!)[0]!.data], [0x00, 0xfa], '2,5 % na EU 866');
});

/** Memória da placa (ROM.h): modelo em 0x01, trava de provisionamento em 0x9B, configuração salva em 0xA7. */
function rom(model = 0xca, o: { lock?: boolean; tnc?: boolean } = {}) {
  const r = new Uint8Array(200);
  r[0] = 0x03; r[1] = model;
  if (o.lock !== false) r[0x9b] = 0x73;
  if (o.tnc) r[0xa7] = 0x73;
  return r;
}

function probe(s: RNodeSetup, o: { fw?: number[]; rom?: Uint8Array } = {}) {
  s.push(CMD.DETECT, Uint8Array.of(0x46));
  if (o.fw?.length !== 0) s.push(CMD.FW_VERSION, Uint8Array.from(o.fw ?? [1, 86]));
  s.push(CMD.PLATFORM, Uint8Array.of(0x80));
  s.push(CMD.MCU, Uint8Array.of(0x81));
  return s.push(CMD.ROM_READ, o.rom ?? rom());
}

/** O RNode responde cada ajuste com o valor em vigor. */
function echo(s: RNodeSetup, p = piuRadio('BR_902'), over: Partial<Record<number, number[]>> = {}) {
  const at = Math.round(p.airtimePct * 100);
  const replies: [number, number[]][] = [
    [CMD.FREQUENCY, u32(p.freqHz)], [CMD.BANDWIDTH, u32(p.bwHz)], [CMD.TXPOWER, [p.txDbm]],
    [CMD.SF, [p.sf]], [CMD.CR, [p.cr]], [CMD.LT_ALOCK, [at >> 8, at & 0xff]], [CMD.RADIO_STATE, [1]],
  ];
  for (const [c, d] of replies) s.push(c, Uint8Array.from(over[c] ?? d));
}

test('placa: detectada e na faixa, a configuração segue; o modelo diz o nome', () => {
  const s = new RNodeSetup(piuRadio('BR_902'));
  assert.equal(s.state, 'detecting');
  s.push(CMD.FREQUENCY, Uint8Array.from(u32(1)));
  assert.equal(s.state, 'detecting', 'antes da detecção, nada conta');
  assert.equal(probe(s), 'probed');
  assert.equal(s.state, 'configuring');
  assert.equal(s.board.product, 'Heltec LoRa32 v3');
  assert.deepEqual(s.board.fw, [1, 86]);
  s.push(CMD.FREQUENCY, Uint8Array.from(u32(904_750_000)));
  assert.equal(s.state, 'configuring', 'falta o resto');
  echo(s);
  assert.equal(s.state, 'up');
  s.push(CMD.STAT_RSSI, Uint8Array.of(0x50));
  assert.equal(s.state, 'up', 'estatística não mexe no estado');
});

test('placa: firmware antigo, sem provisionar, em modo TNC ou de outra faixa não segue', () => {
  const cases: [string, Parameters<typeof probe>[1], RegExp][] = [
    ['BR_902', { fw: [1, 51] }, /firmware antigo \(1\.51\); precisa de 1\.52/],
    ['BR_902', { fw: [] }, /firmware antigo \(\?\)/],
    ['BR_902', { rom: rom(0xca, { lock: false }) }, /sem provisionar/],
    ['BR_902', { rom: rom(0xca, { tnc: true }) }, /modo TNC/],
    ['BR_902', { rom: rom(0xc5) }, /fora da faixa da placa \(420–520 MHz\)/],
    ['EU_433', { rom: rom(0xca) }, /fora da faixa da placa \(850–950 MHz\)/],
    ['LORA_24', { rom: rom(0xdc) }, /fora da faixa/],
  ];
  for (const [region, o, why] of cases) {
    const s = new RNodeSetup(piuRadio(region));
    assert.equal(probe(s, o), undefined, region);
    assert.equal(s.state, 'failed');
    assert.match(s.problem ?? '', why);
  }
  const ok = (region: string, model: number) => { const s = new RNodeSetup(piuRadio(region)); return probe(s, { rom: rom(model) }); };
  assert.equal(ok('BR_902', 0xfe), 'probed', 'montada em casa: faixa desconhecida, segue');
  assert.equal(ok('LORA_24', 0xac), 'probed', 'SX1280 no 2,4 GHz');
  assert.equal(ok('BR_902', 0x12), 'probed', 'RAK4631 915');
  assert.equal(ok('BR_902', 0xc8), 'probed', 'Heltec V4 860–930 MHz');
  assert.equal(probe(new RNodeSetup(piuRadio('BR_902')), { rom: new Uint8Array(0) }), 'probed', 'memória curta: não dá para conferir, segue');
  const not = new RNodeSetup(piuRadio('BR_902'));
  not.push(CMD.DETECT, Uint8Array.of(0x00));
  assert.equal(not.state, 'failed');
  assert.equal(not.problem, 'não é um RNode');
});

test('ajuste diferente, rádio desligado ou erro na configuração derrubam; potência menor serve', () => {
  const run = (over: Partial<Record<number, number[]>>, err?: number) => {
    const s = new RNodeSetup(piuRadio('BR_902'));
    probe(s);
    if (err !== undefined) s.push(CMD.ERROR, Uint8Array.of(err));
    echo(s, undefined, over);
    return s;
  };
  const freq = run({ [CMD.FREQUENCY]: u32(915_000_000) });
  assert.equal(freq.state, 'failed');
  assert.match(freq.problem ?? '', /frequência diferente/);
  assert.equal(run({ [CMD.RADIO_STATE]: [0] }).problem, 'o rádio da placa não ligou');
  assert.match(run({}, 0x01).problem ?? '', /erro do RNode 0x01/);
  assert.equal(run({ [CMD.TXPOWER]: [14] }).state, 'up', 'placa que limita a potência abaixo do pedido ainda serve');
  assert.equal(run({ [CMD.TXPOWER]: [20] }).state, 'failed', 'acima do pedido, não');
});

test('tempo no ar: aceita o arredondamento do firmware (float de 32 bits truncado)', () => {
  const f = Math.fround, fw = (at: number) => { const x = f(at / 10_000); return x >= 1 ? 0 : Math.trunc(f(f(x * 100) * 100)); };
  for (const pct of [0.53, 1.05, 2.13, 10]) {
    const p = { ...piuRadio('BR_902'), airtimePct: pct }, at = Math.round(pct * 100), back = fw(at);
    const s = new RNodeSetup(p);
    probe(s);
    echo(s, p, { [CMD.LT_ALOCK]: [back >> 8, back & 0xff] });
    assert.equal(s.state, 'up', `${pct} % volta ${back}`);
  }
  const all = { ...piuRadio('BR_902'), airtimePct: 100 }, s = new RNodeSetup(all);
  probe(s);
  echo(s, all, { [CMD.LT_ALOCK]: [0, 0] });
  assert.equal(s.state, 'up', '100 % volta 0 (sem limite)');
});

test('rádio no ar: falha de transmissão pede reconfigurar; fila e memória só contam; erro de rádio derruba', () => {
  const s = new RNodeSetup(piuRadio('BR_902'));
  probe(s); echo(s);
  assert.equal(s.push(CMD.ERROR, Uint8Array.of(0x02)), 'reconfigure');
  for (const e of [0x04, 0x05, 0x06]) assert.equal(s.push(CMD.ERROR, Uint8Array.of(e)), undefined);
  assert.equal(s.state, 'up');
  assert.equal(s.hwErrors, 4);
  s.push(CMD.ERROR, Uint8Array.of(0x01));
  assert.equal(s.state, 'failed');
});
