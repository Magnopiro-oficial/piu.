import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeNodeBeacon, encodeNodeBeacon } from '../src/meshtastic/nodeBeacon.js';
import { Reassembler, splitEnvelope } from '../src/meshtastic/fragments.js';
import { utf8 } from '../src/protocol/bytes.js';
import { envelopeId, MsgType, sealDirect } from '../src/protocol/envelope.js';
import { deriveIdentity, deriveNodeKey, newSeed, toPublic } from '../src/protocol/keys.js';
import { CMD, KissReader, kissFrame } from '../src/rnode/rnode.js';
import { RNODE_BOARDS, RNodeEmulator, type EmulatorOptions } from '../../mobile/src/transport/rnode/emulator';
import { piuRadio, type PiuRadio } from '../src/rnode/regions.js';
import { RelayEngine } from '../src/relay/engine.js';
import { PIU_PEER, RNodeAdapter } from '../src/relay/rnode.js';
import { parseSerialSpec } from '../src/relay/serial.js';
import { loadLnnpConfig } from '../src/config.js';

/**
 * RNode no USB: a placa emulada byte a byte do app (apps/mobile/src/transport/rnode/emulator.ts), com a
 * serial entregando os quadros partidos. `silent`: cabo sem placa respondendo.
 */
class SerialRNode {
  label = '/dev/ttyUSB0';
  private cb: ((b: Uint8Array) => void) | null = null;
  private rd = new KissReader();
  aired: Uint8Array[] = [];
  configs = 0;
  silent = false;
  readonly emu: RNodeEmulator;
  constructor(boardName = 'LILYGO T-Beam SX1276', o: EmulatorOptions = {}) {
    this.emu = new RNodeEmulator(RNODE_BOARDS.find(b => b.name === boardName)!, { now: () => clock.t, ...o });
    this.emu.onOutput(b => { if (!this.silent) { this.cb?.(b.subarray(0, 2)); this.cb?.(b.subarray(2)); } });
    this.emu.onTransmit(p => this.aired.push(p));
  }
  write(bytes: Uint8Array) {
    for (const { cmd } of this.rd.push(bytes)) if (cmd === CMD.DETECT) this.configs++;
    this.emu.input(bytes);
  }
  onData(cb: (b: Uint8Array) => void) { this.cb = cb; }
  close() {}
  /** Um quadro solto vindo da placa (ex.: erro do firmware). */
  send(cmd: number, data: Uint8Array) { this.cb?.(kissFrame(cmd, data)); }
  hear(packet: Uint8Array) { this.emu.receive(packet); }
}

const clock = { t: 0 };
const T = 1_800_000_000_000;

function setup(radio: PiuRadio = piuRadio('BR_902'), fake = new SerialRNode()) {
  clock.t = T;
  const now = clock;
  const bob = deriveIdentity(newSeed(), 'public');
  const node = deriveNodeKey(newSeed());
  const engine = new RelayEngine({ node, relay: true, memoryBytes: 1 << 20, identities: [bob], now: () => now.t });
  const a = new RNodeAdapter(engine, { modem: fake, node, radio, now: () => now.t, tickMs: 60_000, retryMs: 60_000 });
  a.start();
  return { now, bob, node, engine, fake, a };
}

const letter = (n: number, at: number) => sealDirect({ from: deriveIdentity(newSeed(), 'public'), to: toPublic(deriveIdentity(newSeed(), 'public')), type: MsgType.Text, body: utf8('x'.repeat(n)), now: at }).bytes;

test('rnode: PIU_SERIAL e região do rádio próprio pelo ambiente', () => {
  assert.deepEqual(parseSerialSpec('rnode:/dev/ttyUSB0'), { kind: 'rnode', path: '/dev/ttyUSB0', baud: 115200 });
  assert.deepEqual(loadLnnpConfig({}).rnode, piuRadio('BR_902'), 'Brasil é o padrão');
  assert.equal(loadLnnpConfig({ PIU_RNODE_REGION: 'eu_868' }).rnode?.freqHz, 869_525_000);
  assert.equal(loadLnnpConfig({ PIU_RNODE_REGION: 'US', PIU_RNODE_FREQ_HZ: '903000000' }).rnode?.freqHz, 903_000_000);
  assert.equal(loadLnnpConfig({ PIU_RNODE_REGION: 'US', PIU_RNODE_TX_DBM: '20' }).rnode?.txDbm, 20);
  assert.throws(() => loadLnnpConfig({ PIU_RNODE_REGION: 'XX' }), /PIU_RNODE_REGION/);
  assert.throws(() => loadLnnpConfig({ PIU_RNODE_REGION: 'BR_902', PIU_RNODE_FREQ_HZ: '915000000' }), /PIU_RNODE_FREQ_HZ/, 'fora da faixa da região');
  assert.throws(() => loadLnnpConfig({ PIU_RNODE_REGION: 'JP', PIU_RNODE_TX_DBM: '20' }), /PIU_RNODE_TX_DBM/, 'acima do limite da região');
});

test('rnode: configura o rádio da região, entra como malha lora:piu e se anuncia ("PN")', () => {
  const { engine, fake, a, node } = setup();
  assert.equal(a.stats().state, 'up');
  assert.equal(a.stats().region, 'BR_902');
  assert.equal(engine.meshCount, 1);
  assert.equal(PIU_PEER, 'lora:piu');
  const b = decodeNodeBeacon(fake.aired[0]!, Math.floor(T / 1000));
  assert.ok(b, 'o primeiro pacote no ar é o anúncio');
  assert.deepEqual(b.pk, node.pk);
});

test('rnode: placa calada não entra na malha; quando volta a responder, a nova tentativa sobe', () => {
  const fake = new SerialRNode();
  fake.silent = true;
  const { engine, a, now } = setup(piuRadio('BR_902'), fake);
  assert.equal(a.stats().state, 'detecting');
  assert.equal(engine.meshCount, 0);
  fake.silent = false;
  now.t += 61_000;
  a.tick();
  assert.equal(fake.configs, 2);
  assert.equal(a.stats().state, 'up');
  assert.equal(a.stats().board, 'LilyGO T-Beam');
  assert.equal(engine.meshCount, 1);
});

test('rnode: placa de outra faixa, em modo TNC ou com firmware antigo não entra; o motivo fica no painel', () => {
  for (const [fake, why] of [
    [new SerialRNode('LILYGO T-Beam SX1278'), /fora da faixa da placa/],
    [new SerialRNode('LILYGO T-Beam SX1276', { tnc: { freqHz: 869_525_000, bwHz: 125_000, sf: 8, cr: 5, txDbm: 14 } }), /modo TNC/],
    [new SerialRNode('LILYGO T-Beam SX1276', { fw: [1, 40] }), /firmware antigo/],
    [new SerialRNode('ATmega1284p montada em casa', { provisioned: false }), /sem provisionar/],
  ] as const) {
    const { engine, a } = setup(piuRadio('BR_902'), fake);
    assert.equal(a.stats().state, 'failed');
    assert.match(a.stats().problem ?? '', why);
    assert.equal(engine.meshCount, 0);
    if (String(why).includes('TNC')) assert.equal(fake.emu.phy()?.freqHz, 869_525_000, 'TNC fica no canal salvo; o Piu não manda nada por ele');
    else assert.equal(fake.emu.online, false, 'o rádio não liga');
    assert.equal(fake.aired.length, 0);
  }
});

test('rnode: falha de transmissão reconfigura e volta; fila cheia só conta; erro do rádio derruba', () => {
  const { engine, fake, a } = setup();
  fake.send(CMD.ERROR, Uint8Array.of(0x02));
  assert.equal(a.stats().state, 'up', 'reconfigurou na hora');
  assert.equal(fake.configs, 2);
  assert.equal(engine.meshCount, 1);
  fake.send(CMD.ERROR, Uint8Array.of(0x04));
  assert.equal(a.stats().state, 'up');
  assert.equal(a.stats().hwErrors, 2);
  fake.send(CMD.ERROR, Uint8Array.of(0x01));
  assert.equal(a.stats().state, 'failed');
  assert.equal(engine.meshCount, 0);
});

test('rnode: envelope em pedaços vai ao roteador uma vez; anúncio de outro nó é contado', () => {
  const { engine, fake, a, bob } = setup();
  const env = sealDirect({ from: deriveIdentity(newSeed(), 'public'), to: toPublic(bob), type: MsgType.Text, body: utf8('Ponte caiu'), now: Math.floor(T / 1000) }).bytes;
  const parts = splitEnvelope(env, 7);
  for (const p of parts) fake.hear(p);
  for (const p of parts) fake.hear(p);
  assert.equal(engine.inbox.length, 1);
  fake.hear(encodeNodeBeacon(deriveNodeKey(newSeed()), { at: Math.floor(T / 1000), relay: true, gateway: true }));
  assert.equal(a.stats().superNodes, 1);
  assert.equal(engine.inbox.length, 1);
});

test('rnode: repassa dentro do tempo de rádio da região, nunca envelope grande', () => {
  const { engine, fake, now } = setup();
  const before = fake.aired.length, sec = Math.floor(now.t / 1000);
  for (let i = 0; i < 4; i++) engine.router.ingest(letter(20, sec), 'vizinho-lan', sec);
  engine.router.ingest(letter(3000, sec), 'vizinho-lan', sec);
  engine.flushAll();
  const re = new Reassembler();
  const got = () => fake.aired.splice(before).map(x => re.push(x, now.t)).filter(Boolean).length;
  const first = got();
  assert.ok(first >= 1 && first < 4, `rajada limitada (${first})`);
  now.t += 10 * 60_000;
  engine.flushAll();
  assert.equal(first + got(), 4);
  assert.ok(fake.aired.every(p => p.length <= 255), 'cada pedaço é um pacote no ar');
});

test('rnode: região com menos tempo no ar manda menos por minuto', () => {
  const br = setup(piuRadio('BR_902')), eu = setup(piuRadio('EU_866'));
  for (const s of [br, eu]) {
    const sec = Math.floor(s.now.t / 1000);
    for (let i = 0; i < 8; i++) s.engine.router.ingest(letter(20, sec), 'vizinho-lan', sec);
    s.engine.flushAll();
  }
  assert.ok(eu.a.stats().sent < br.a.stats().sent, `EU 866 (2,5 %) ${eu.a.stats().sent} < Brasil ${br.a.stats().sent}`);
});

test('ponte: o que chega pelo Meshtastic sai pelo rádio próprio e vice-versa, sem voltar', () => {
  const { engine, fake, now } = setup();
  const sent: Uint8Array[] = [];
  engine.attachMesh({ id: 'lora:mesh', medium: 'lora', address: 'meshtastic', since: now.t, maxEnvelope: 904, capacity: () => 4 * 226, send: e => { sent.push(e); return true; } });
  const sec = Math.floor(now.t / 1000);
  const before = fake.aired.length;
  const fromMesh = letter(20, sec);
  engine.receiveMesh('lora:mesh', fromMesh);
  engine.flushAll();
  const re = new Reassembler();
  // Mesmo envelope (o id não muda), com um salto a menos.
  const id = (e: Uint8Array) => [...envelopeId(e)].join();
  const aired = fake.aired.slice(before).map(x => re.push(x, now.t)).filter((x): x is Uint8Array => !!x);
  assert.deepEqual(aired.map(id), [id(fromMesh)], 'Meshtastic → rádio próprio');
  assert.equal(sent.length, 0, 'não volta para a malha de onde veio');
  const fromPiu = letter(20, sec);
  for (const p of splitEnvelope(fromPiu, 9)) fake.hear(p);
  engine.flushAll();
  assert.deepEqual(sent.map(id), [id(fromPiu)], 'rádio próprio → Meshtastic');
});

test('rnode: placa que falha toda transmissão para de reconfigurar e tenta de novo só no tick', () => {
  const fake = new SerialRNode('LILYGO T-Beam SX1276', { txFault: () => true });
  const { a, engine, now } = setup(piuRadio('BR_902'), fake);
  for (let i = 0; i < 6; i++) fake.send(CMD.ERROR, Uint8Array.of(0x02));
  assert.ok(fake.configs <= 3, `${fake.configs} configurações`);
  assert.equal(a.stats().state, 'failed');
  assert.equal(engine.meshCount, 0);
  const before = fake.configs;
  now.t += 61_000;
  a.tick();
  assert.ok(fake.configs > before && fake.configs <= before + 3, 'depois do tempo de espera, tenta de novo, no máximo 3 vezes por minuto');
  assert.equal(a.stats().state, 'failed');
});
