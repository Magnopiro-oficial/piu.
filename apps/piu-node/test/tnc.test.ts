import assert from 'node:assert/strict';
import { createServer, type Socket } from 'node:net';
import { test } from 'node:test';
import { decodeNodeBeacon, encodeNodeBeacon } from '../src/meshtastic/nodeBeacon.js';
import { Reassembler, splitEnvelope } from '../src/meshtastic/fragments.js';
import { utf8 } from '../src/protocol/bytes.js';
import { MsgType, Priority, sealDirect } from '../src/protocol/envelope.js';
import { deriveIdentity, deriveNodeKey, newSeed, toPublic } from '../src/protocol/keys.js';
import { KissReader } from '../src/rnode/rnode.js';
import { ax25Decode, ax25Encode, AX25_HEADER } from '../src/relay/ax25.js';
import { RelayEngine } from '../src/relay/engine.js';
import { startRelay } from '../src/relay/index.js';
import { kissEncode } from '../src/relay/kiss.js';
import { parseSerialSpec } from '../src/relay/serial.js';
import { openTcpModem } from '../src/relay/tcpModem.js';
import { TNC_PEER, TncAdapter, tncAirtimeMs, type TncRadio } from '../src/relay/tnc.js';
import { loadLnnpConfig } from '../src/config.js';
import { DEFAULT_SETTINGS } from '../src/store.js';

/** Modem KISS em memória (um Direwolf ou NinoTNC de mentira): guarda o que iria ao ar e os parâmetros recebidos. */
class FakeTnc {
  label = '/dev/ttyACM0';
  private cb: ((b: Uint8Array) => void) | null = null;
  private rd = new KissReader();
  /** Quadros de dados (cada um seria uma transmissão). */
  aired: Uint8Array[] = [];
  /** Comandos KISS que não são dados (TXDELAY etc.): [comando, valor]. */
  params: [number, number][] = [];
  closed = false;
  write(bytes: Uint8Array) {
    for (const { cmd, data } of this.rd.push(bytes)) {
      if (cmd === 0) this.aired.push(data); else this.params.push([cmd, data[0] ?? -1]);
    }
  }
  onData(cb: (b: Uint8Array) => void) { this.cb = cb; }
  close() { this.closed = true; }
  /** Um quadro ouvido no ar, entregue pela serial em dois pedaços. */
  hear(frame: Uint8Array) { const k = kissEncode(frame); this.cb?.(k.subarray(0, 3)); this.cb?.(k.subarray(3)); }
}

const T = 1_800_000_000_000;
const RADIO: TncRadio = { band: 'licensed', bps: 1200, txDelayMs: 300, dutyPercent: 10, call: 'PIU', ax25: true };

function setup(radio: Partial<TncRadio> = {}, fake = new FakeTnc()) {
  const now = { t: T };
  const bob = deriveIdentity(newSeed(), 'public');
  const node = deriveNodeKey(newSeed());
  const engine = new RelayEngine({ node, relay: true, memoryBytes: 1 << 20, identities: [bob], now: () => now.t });
  const r = { ...RADIO, ...radio };
  const a = new TncAdapter(engine, { modem: fake, node, radio: r, now: () => now.t, tickMs: 60_000 });
  a.start();
  return { now, bob, node, engine, fake, a, radio: r };
}

const letter = (n: number, at: number, priority?: Priority) => sealDirect({
  from: deriveIdentity(newSeed(), 'public'), to: toPublic(deriveIdentity(newSeed(), 'public')), type: MsgType.Text, body: utf8('x'.repeat(n)), now: at, priority,
}).bytes;
/** Tira o cabeçalho AX.25 de tudo o que foi ao ar e remonta os envelopes. */
function airedEnvelopes(frames: Uint8Array[], now: number) {
  const re = new Reassembler();
  return frames.map(f => ax25Decode(f, 'PIU')).filter((p): p is Uint8Array => !!p).map(p => re.push(p, now)).filter(Boolean).length;
}
function flushMany(engine: RelayEngine, times = 80) { for (let i = 0; i < times; i++) engine.flushAll(); }

test('tnc: PIU_SERIAL aceita o tipo tnc por serial e por TCP', () => {
  assert.deepEqual(parseSerialSpec('tnc:/dev/ttyACM0@57600'), { kind: 'tnc', path: '/dev/ttyACM0', baud: 57600 });
  assert.deepEqual(parseSerialSpec('tnc:tcp://127.0.0.1:8001'), { kind: 'tnc', path: 'tcp://127.0.0.1:8001', baud: 115200 });
});

test('tnc: desligado por padrão; só sobe com a faixa declarada, e nunca em faixa de radioamador', () => {
  assert.equal(loadLnnpConfig({}).tnc, undefined, 'sem PIU_TNC_BAND não há configuração de modem');
  assert.throws(() => loadLnnpConfig({ PIU_SERIAL: 'tnc:/dev/ttyACM0' }), /PIU_TNC_BAND/, 'tnc no PIU_SERIAL sem declarar a faixa recusa a subida');
  assert.throws(() => loadLnnpConfig({ PIU_SERIAL: 'tnc:/dev/ttyACM0', PIU_TNC_BAND: 'amateur' }), /radioamador/i);
  assert.throws(() => loadLnnpConfig({ PIU_TNC_BAND: 'qualquer' }), /PIU_TNC_BAND/);
  assert.deepEqual(loadLnnpConfig({ PIU_SERIAL: 'tnc:/dev/ttyACM0', PIU_TNC_BAND: 'licensed' }).tnc, RADIO);
  const c = loadLnnpConfig({ PIU_TNC_BAND: 'free', PIU_TNC_BPS: '9600', PIU_TNC_TXDELAY_MS: '150', PIU_TNC_DUTY: '1', PIU_TNC_CALL: 'piu-7', PIU_TNC_AX25: '0' }).tnc;
  assert.deepEqual(c, { band: 'free', bps: 9600, txDelayMs: 150, dutyPercent: 1, call: 'PIU-7', ax25: false });
  assert.throws(() => loadLnnpConfig({ PIU_TNC_BAND: 'free', PIU_TNC_BPS: '50' }), /PIU_TNC_BPS/);
  assert.throws(() => loadLnnpConfig({ PIU_TNC_BAND: 'free', PIU_TNC_CALL: 'NOME-LONGO-DEMAIS' }), /PIU_TNC_CALL/);
});

test('ax25: cabeçalho UI de 16 bytes vai e volta; quadro de outro destino ou de outro tipo é ignorado', () => {
  const body = Uint8Array.of(0xc0, 1, 2, 0xdb, 255);
  const f = ax25Encode(body, { dst: 'PIU', src: 'PIU-7' });
  assert.equal(AX25_HEADER, 16);
  assert.equal(f.length, 16 + body.length);
  assert.deepEqual(ax25Decode(f, 'PIU'), body);
  assert.equal(ax25Decode(f, 'APRS'), null, 'destino de outro serviço');
  assert.equal(ax25Decode(f.subarray(0, 10), 'PIU'), null, 'curto demais');
  const notUi = Uint8Array.from(f); notUi[14] = 0x3f;
  assert.equal(ax25Decode(notUi, 'PIU'), null, 'só quadros UI');
  assert.throws(() => ax25Encode(body, { dst: 'PIU', src: 'ÇÇ' }), /indicativo/i);
});

test('tnc: tempo no ar pela taxa do modem (bps) e pelo TXDELAY', () => {
  const slow = tncAirtimeMs(233, RADIO), fast = tncAirtimeMs(233, { ...RADIO, bps: 9600 });
  assert.ok(slow > 1900 && slow < 2100, `1200 bps: ~2 s por pedaço (${slow})`);
  assert.ok(fast > 450 && fast < 600, `9600 bps: ~0,5 s por pedaço (${fast})`);
  assert.ok(tncAirtimeMs(233, { ...RADIO, ax25: false }) < slow, 'sem cabeçalho AX.25 o quadro é menor');
});

test('tnc: manda o TXDELAY ao modem, entra como malha lora:tnc e se anuncia ("PN") dentro de um quadro AX.25', () => {
  const { engine, fake, a, node } = setup();
  assert.equal(TNC_PEER, 'lora:tnc');
  assert.equal(engine.meshCount, 1);
  assert.deepEqual(fake.params, [[0x01, 30]], 'TXDELAY em unidades de 10 ms');
  const pn = ax25Decode(fake.aired[0]!, 'PIU');
  assert.ok(pn, 'o primeiro quadro no ar tem cabeçalho AX.25 para PIU');
  assert.deepEqual(decodeNodeBeacon(pn, Math.floor(T / 1000))?.pk, node.pk);
  assert.equal(a.stats().kind, 'tnc');
  assert.equal(a.stats().bps, 1200);
});

test('tnc: sem AX.25 (modem transparente) os pedaços vão crus', () => {
  const { fake, node } = setup({ ax25: false });
  assert.deepEqual(decodeNodeBeacon(fake.aired[0]!, Math.floor(T / 1000))?.pk, node.pk);
});

test('tnc: envelope em pedaços vai ao roteador uma vez; tráfego de outros (APRS) é ignorado; anúncio de outro nó é contado', () => {
  const { engine, fake, a, bob } = setup();
  const env = sealDirect({ from: deriveIdentity(newSeed(), 'public'), to: toPublic(bob), type: MsgType.Text, body: utf8('Ponte caiu'), now: Math.floor(T / 1000) }).bytes;
  const frames = splitEnvelope(env, 7).map(p => ax25Encode(p, { dst: 'PIU', src: 'PIU-3' }));
  for (const f of frames) fake.hear(f);
  for (const f of frames) fake.hear(f);
  assert.equal(engine.inbox.length, 1);
  fake.hear(ax25Encode(utf8('!2330.00S/04630.00W-teste'), { dst: 'APRS', src: 'PY2XXX' }));
  fake.hear(Uint8Array.of(1, 2, 3));
  assert.equal(a.stats().ignored, 2);
  assert.equal(engine.inbox.length, 1);
  fake.hear(ax25Encode(encodeNodeBeacon(deriveNodeKey(newSeed()), { at: Math.floor(T / 1000), relay: true, gateway: true }), { dst: 'PIU', src: 'PIU-3' }));
  assert.equal(a.stats().superNodes, 1);
  assert.equal(a.stats().received, 1);
});

test('tnc: repassa só dentro do tempo no ar por hora, nunca envelope grande; a hora seguinte libera o resto', () => {
  const { engine, fake, now, a } = setup();
  const before = fake.aired.length, sec = Math.floor(now.t / 1000);
  for (let i = 0; i < 100; i++) engine.router.ingest(letter(20, sec), 'vizinho-lan', sec);
  engine.router.ingest(letter(3000, sec), 'vizinho-lan', sec);
  flushMany(engine);
  const first = airedEnvelopes(fake.aired.slice(before), now.t);
  // 10 % de uma hora = 360 s; um texto curto = 3 pedaços ≈ 6 s; a reserva de prioridade deixa 80 % para o resto.
  assert.ok(first >= 40 && first <= 56, `~50 textos curtos por hora a 1200 bps (${first})`);
  assert.ok(a.stats().airtimeMs <= 0.1 * 3_600_000, 'nunca passa do limite por hora');
  assert.ok(fake.aired.every(f => f.length <= 255 + 16), 'cada pedaço é um quadro');
  const mark = fake.aired.length;
  now.t += 3_600_000 + 1000;
  flushMany(engine);
  assert.ok(airedEnvelopes(fake.aired.slice(mark), now.t) >= 40, 'na hora seguinte o canal abre de novo');
});

test('tnc: com o canal cheio para o tráfego comum, alerta de prioridade alta ainda passa (reserva)', () => {
  const { engine, fake, now, a } = setup();
  const sec = Math.floor(now.t / 1000);
  for (let i = 0; i < 100; i++) engine.router.ingest(letter(20, sec), 'vizinho-lan', sec);
  flushMany(engine);
  const busy = a.stats().busy, mark = fake.aired.length;
  assert.ok(busy > 0, 'o tráfego comum bateu no teto dele');
  engine.router.ingest(letter(20, sec, Priority.Critical), 'vizinho-lan', sec);
  flushMany(engine, 3);
  assert.equal(airedEnvelopes(fake.aired.slice(mark), now.t), 1, 'o alerta saiu');
});

test('tnc: modem mais rápido leva mais mensagens na mesma hora', () => {
  const slow = setup(), fast = setup({ bps: 9600 });
  for (const s of [slow, fast]) {
    const sec = Math.floor(s.now.t / 1000);
    for (let i = 0; i < 110; i++) s.engine.router.ingest(letter(20, sec), 'vizinho-lan', sec);
    flushMany(s.engine, 120);
  }
  assert.ok(fast.a.stats().sent > slow.a.stats().sent, `9600 bps ${fast.a.stats().sent} > 1200 bps ${slow.a.stats().sent}`);
});

test('tnc: o nó sobe o adaptador pelo PIU_SERIAL e mostra o estado em stats(); sem a faixa declarada, não sobe', async () => {
  const base = { enabled: true, relay: true, listen: '127.0.0.1', port: 0, discoveryPort: null, broadcast: [], peers: [], memoryMB: 16, allow: null, beaconMs: 60_000 };
  const serial = [{ kind: 'tnc' as const, path: '/dev/ttyACM0', baud: 57600 }];
  const fake = new FakeTnc(), logs: string[] = [];
  const on = await startRelay(deriveNodeKey(newSeed()), { ...base, serial, tnc: RADIO }, DEFAULT_SETTINGS, { openModem: async () => fake, log: m => logs.push(m) });
  try {
    assert.equal(on.tnc.length, 1);
    assert.equal(on.stats().tnc[0]!.kind, 'tnc');
    assert.equal(on.engine.meshCount, 1);
  } finally { await on.close(); }
  assert.equal(fake.closed, true);
  const off = await startRelay(deriveNodeKey(newSeed()), { ...base, serial }, DEFAULT_SETTINGS, { openModem: async () => new FakeTnc(), log: m => logs.push(m) });
  try {
    assert.equal(off.tnc.length, 0);
    assert.ok(logs.some(l => /PIU_TNC_BAND/.test(l)), 'o log diz o que falta');
  } finally { await off.close(); }
});

test('tcpModem: fala com um TNC por TCP (Direwolf, porta KISS) nos dois sentidos', async () => {
  const got: Buffer[] = [];
  let peer: Socket | null = null;
  const server = createServer(s => { peer = s; s.on('data', d => got.push(d)); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as { port: number };
  const modem = await openTcpModem(`tcp://127.0.0.1:${port}`);
  try {
    const heard: number[] = [];
    modem.onData(b => heard.push(...b));
    modem.write(Uint8Array.of(0xc0, 0, 7, 0xc0));
    const until = async (ok: () => boolean) => { for (let i = 0; i < 200 && !ok(); i++) await new Promise(r => setTimeout(r, 10)); assert.ok(ok()); };
    await until(() => Buffer.concat(got).length === 4);
    assert.deepEqual([...Buffer.concat(got)], [0xc0, 0, 7, 0xc0]);
    peer!.write(Uint8Array.of(9, 8));
    await until(() => heard.length === 2);
    assert.deepEqual(heard, [9, 8]);
    assert.equal(modem.label, `tcp://127.0.0.1:${port}`);
  } finally { await modem.close(); peer?.destroy(); await new Promise(r => server.close(r)); }
  await assert.rejects(openTcpModem('tcp://sem-porta'), /tcp:\/\//);
});
