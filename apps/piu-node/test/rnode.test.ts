import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeNodeBeacon, encodeNodeBeacon } from '../src/meshtastic/nodeBeacon.js';
import { Reassembler, splitEnvelope } from '../src/meshtastic/fragments.js';
import { utf8 } from '../src/protocol/bytes.js';
import { envelopeId, MsgType, sealDirect } from '../src/protocol/envelope.js';
import { deriveIdentity, deriveNodeKey, newSeed, toPublic } from '../src/protocol/keys.js';
import { CMD, KissReader, kissFrame } from '../src/rnode/rnode.js';
import { piuRadio, type PiuRadio } from '../src/rnode/regions.js';
import { RelayEngine } from '../src/relay/engine.js';
import { PIU_PEER, RNodeAdapter } from '../src/relay/rnode.js';
import { parseSerialSpec } from '../src/relay/serial.js';
import { loadLnnpConfig } from '../src/config.js';

/** RNode pela serial: responde cada ajuste com o valor em vigor e guarda os pacotes que foram ao ar. */
class FakeRNode {
  label = '/dev/ttyUSB0';
  private cb: ((b: Uint8Array) => void) | null = null;
  private rd = new KissReader();
  aired: Uint8Array[] = [];
  configs = 0;
  /** Muda o que o rádio responde (ex.: placa que não aceita a frequência). */
  override: Partial<Record<number, Uint8Array>> = {};
  silent = false;
  write(bytes: Uint8Array) {
    for (const { cmd, data } of this.rd.push(bytes)) {
      if (cmd === CMD.DATA) { this.aired.push(data); continue; }
      if (cmd === CMD.DETECT) this.configs++;
      if (this.silent) continue;
      this.send(cmd, this.override[cmd] ?? (cmd === CMD.DETECT ? Uint8Array.of(0x46) : data));
    }
  }
  onData(cb: (b: Uint8Array) => void) { this.cb = cb; }
  close() {}
  /** O rádio entrega um quadro (partido em dois, como chega pela serial). */
  send(cmd: number, data: Uint8Array) { const f = kissFrame(cmd, data); this.cb?.(f.subarray(0, 2)); this.cb?.(f.subarray(2)); }
  hear(packet: Uint8Array) { this.send(CMD.DATA, packet); }
}

const T = 1_800_000_000_000;

function setup(radio: PiuRadio = piuRadio('BR_902'), fake = new FakeRNode()) {
  const now = { t: T };
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

test('rnode: rádio que não aceita o ajuste não entra na malha; tenta de novo depois', () => {
  const fake = new FakeRNode();
  fake.override[CMD.FREQUENCY] = Uint8Array.of(0x36, 0x89, 0xca, 0xc0); // 915 MHz
  const { engine, a, now } = setup(piuRadio('BR_902'), fake);
  assert.equal(a.stats().state, 'failed');
  assert.match(a.stats().problem ?? '', /frequência/);
  assert.equal(engine.meshCount, 0);
  delete fake.override[CMD.FREQUENCY];
  now.t += 61_000;
  a.tick();
  assert.equal(fake.configs, 2);
  assert.equal(a.stats().state, 'up');
  assert.equal(engine.meshCount, 1);
});

test('rnode: erro do firmware derruba a malha', () => {
  const { engine, fake, a } = setup();
  fake.send(CMD.ERROR, Uint8Array.of(0x03));
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
