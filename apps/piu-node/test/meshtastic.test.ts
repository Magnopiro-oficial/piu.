import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeNodeBeacon, encodeNodeBeacon } from '../src/meshtastic/nodeBeacon.js';
import { LORA_MAX_ENVELOPE, Reassembler, splitEnvelope } from '../src/meshtastic/fragments.js';
import { utf8 } from '../src/protocol/bytes.js';
import { MsgType, sealDirect } from '../src/protocol/envelope.js';
import { deriveIdentity, deriveNodeKey, newSeed, toPublic } from '../src/protocol/keys.js';
import { RelayEngine } from '../src/relay/engine.js';
import { encodeStreamFrame, MeshtasticAdapter, MESH_PEER, StreamDecoder } from '../src/relay/meshtastic.js';
import { parseSerialSpec } from '../src/relay/serial.js';
import { loadLnnpConfig } from '../src/config.js';

// ---- protobuf mínimo para o rádio de mentira (campos de mesh.proto) ----
function varint(n: number): number[] { const o: number[] = []; let v = n >>> 0; while (v > 0x7f) { o.push((v & 0x7f) | 0x80); v >>>= 7; } o.push(v); return o; }
const fld = (no: number, bytes: number[]) => [...varint((no << 3) | 2), ...varint(bytes.length), ...bytes];
const vfld = (no: number, n: number) => [...varint(no << 3), ...varint(n)];
const fromMyInfo = (node: number) => Uint8Array.from(fld(3, vfld(1, node)));
const fromConfigComplete = (id: number) => Uint8Array.from(vfld(7, id));
function fromPacket(from: number, payload: Uint8Array, port = 256) {
  const data = [...vfld(1, port), ...fld(2, [...payload])];
  const le = (x: number) => [x & 0xff, (x >>> 8) & 0xff, (x >>> 16) & 0xff, (x >>> 24) & 0xff];
  return Uint8Array.from(fld(2, [0x0d, ...le(from), 0x15, 0xff, 0xff, 0xff, 0xff, ...fld(4, data)]));
}
/** Lê campos de um protobuf: número → valores (varint como número, bytes como Uint8Array). */
function fields(b: Uint8Array): Map<number, (number | Uint8Array)[]> {
  const m = new Map<number, (number | Uint8Array)[]>();
  let i = 0;
  const rv = () => { let x = 0, s = 0, c; do { c = b[i++]!; x += (c & 0x7f) * 2 ** s; s += 7; } while (c & 0x80); return x; };
  while (i < b.length) {
    const k = rv(), no = k >>> 3, wt = k & 7;
    let v: number | Uint8Array;
    if (wt === 0) v = rv(); else if (wt === 2) { const n = rv(); v = b.slice(i, i + n); i += n; } else if (wt === 5) { v = (b[i]! | b[i + 1]! << 8 | b[i + 2]! << 16 | b[i + 3]! << 24) >>> 0; i += 4; } else throw new Error(`tipo ${wt}`);
    m.set(no, [...(m.get(no) ?? []), v]);
  }
  return m;
}

/** Rádio Meshtastic pela serial: responde ao want_config e guarda os payloads da porta 256 enviados. */
class FakeMeshRadio {
  label = '/dev/ttyACM0';
  private cb: ((b: Uint8Array) => void) | null = null;
  private dec = new StreamDecoder();
  sent: Uint8Array[] = [];
  heartbeats = 0;
  write(bytes: Uint8Array) {
    for (const f of this.dec.push(bytes)) {
      const m = fields(f);
      const want = m.get(3)?.[0];
      if (typeof want === 'number') { this.push(fromMyInfo(0xabc)); this.push(fromConfigComplete(want)); }
      if (m.has(7)) this.heartbeats++;
      const pkt = m.get(1)?.[0];
      if (pkt instanceof Uint8Array) {
        const p = fields(pkt), data = fields(p.get(4)![0] as Uint8Array);
        assert.equal(p.get(2)?.[0], 0xffffffff, 'sempre para todos');
        if (data.get(1)?.[0] === 256) this.sent.push(data.get(2)![0] as Uint8Array);
      }
    }
  }
  onData(cb: (b: Uint8Array) => void) { this.cb = cb; }
  close() {}
  /** O rádio entrega um FromRadio pela serial (partido em dois, como chega de verdade). */
  push(proto: Uint8Array) { const f = encodeStreamFrame(proto); this.cb?.(f.subarray(0, 3)); this.cb?.(f.subarray(3)); }
}

const T = 1_800_000_000_000;

function setup() {
  const now = { t: T };
  const bob = deriveIdentity(newSeed(), 'public'), ana = deriveIdentity(newSeed(), 'public');
  const node = deriveNodeKey(newSeed());
  const engine = new RelayEngine({ node, relay: true, memoryBytes: 1 << 20, identities: [bob], now: () => now.t });
  const radio = new FakeMeshRadio();
  const a = new MeshtasticAdapter(engine, { modem: radio, node, now: () => now.t, tickMs: 60_000 });
  a.start();
  return { now, bob, ana, node, engine, radio, a };
}

test('serial do Meshtastic: quadro 0x94 0xC3 + tamanho, ruído entre quadros, quadro partido', () => {
  const d = new StreamDecoder();
  const f = encodeStreamFrame(Uint8Array.of(1, 2, 3));
  assert.deepEqual([...f], [0x94, 0xc3, 0, 3, 1, 2, 3]);
  assert.deepEqual(d.push(Uint8Array.from([...utf8('DEBUG boot\n'), ...f.subarray(0, 5)])), []);
  assert.deepEqual(d.push(f.subarray(5)).map(x => [...x]), [[1, 2, 3]]);
  assert.deepEqual(d.push(Uint8Array.of(0x94, 0xc3, 0xff, 0xff, ...f)).map(x => [...x]), [[1, 2, 3]], 'tamanho absurdo é pulado');
  assert.deepEqual(parseSerialSpec('meshtastic:/dev/ttyACM0'), { kind: 'meshtastic', path: '/dev/ttyACM0', baud: 115200 });
  assert.equal(loadLnnpConfig({ PIU_MESHTASTIC_PER_MIN: '4' }).meshtasticPerMin, 4);
  assert.throws(() => loadLnnpConfig({ PIU_MESHTASTIC_PER_MIN: '0' }), /PIU_MESHTASTIC_PER_MIN/);
});

test('Super Node no Meshtastic: configura, entra como malha aberta e se anuncia ("PN" assinado)', () => {
  const { engine, radio, a, node } = setup();
  assert.equal(engine.meshCount, 1);
  assert.equal(a.stats().state, 'up');
  assert.equal(a.stats().myNode, 0xabc);
  const b = decodeNodeBeacon(radio.sent[0]!, Math.floor(T / 1000));
  assert.ok(b, 'o primeiro pacote é o anúncio');
  assert.deepEqual(b.pk, node.pk);
  assert.equal(b.relay, true);
});

test('Super Node no Meshtastic: envelope que chega em pedaços vai para o roteador; o eco do próprio rádio não', () => {
  const { engine, radio, bob, ana } = setup();
  const env = sealDirect({ from: ana, to: toPublic(bob), type: MsgType.Text, body: utf8('Estrada liberada'), now: Math.floor(T / 1000) }).bytes;
  assert.ok(env.length <= LORA_MAX_ENVELOPE);
  const parts = splitEnvelope(env, 0x42);
  for (const p of parts) radio.push(fromPacket(0xabc, p)); // eco do meu rádio: ignorado
  assert.equal(engine.inbox.length, 0);
  for (const p of parts) radio.push(fromPacket(0x999, p));
  assert.equal(engine.inbox.length, 1);
  for (const p of parts) radio.push(fromPacket(0x998, p)); // outro repetidor ecoa: não duplica
  assert.equal(engine.inbox.length, 1);
});

test('Super Node no Meshtastic: guarda e repassa para a malha dentro do tempo de rádio, nunca envelope grande', () => {
  const { engine, radio, now } = setup();
  const p = () => deriveIdentity(newSeed(), 'public');
  const letter = (n: number) => sealDirect({ from: p(), to: toPublic(p()), type: MsgType.Text, body: utf8('x'.repeat(n)), now: Math.floor(now.t / 1000) }).bytes;
  const before = radio.sent.length;
  // Chegam de um vizinho LNNP (aqui direto no roteador, como terceiros guardados).
  for (let i = 0; i < 4; i++) engine.router.ingest(letter(20), 'vizinho-lan', Math.floor(now.t / 1000));
  engine.router.ingest(letter(3000), 'vizinho-lan', Math.floor(now.t / 1000)); // grande demais para o LoRa
  engine.flushAll();
  const re = new Reassembler();
  const got = () => radio.sent.slice(before).map(x => re.push(x, now.t)).filter(Boolean).length;
  const first = got();
  assert.ok(first >= 1 && first < 4, `rajada limitada pelo tempo de rádio (${first})`);
  now.t += 10 * 60_000;
  engine.flushAll();
  assert.equal(first + got(), 4, 'o resto sai quando o tempo de rádio volta; o envelope grande nunca');
});

test('Super Node no Meshtastic: anúncio de outro Super Node é contado, não vira envelope', () => {
  const { engine, radio, a, now } = setup();
  const other = deriveNodeKey(newSeed());
  radio.push(fromPacket(0x555, encodeNodeBeacon(other, { at: Math.floor(now.t / 1000), relay: true, gateway: false })));
  assert.equal(a.stats().superNodes, 1);
  assert.equal(engine.inbox.length, 0);
  assert.equal(engine.router.stats().stored, 0);
});

test('Super Node no Meshtastic: desligar tira a malha aberta do motor', async () => {
  const { engine, a } = setup();
  await a.stop();
  assert.equal(engine.meshCount, 0);
  assert.equal(MESH_PEER, 'lora:mesh');
});
