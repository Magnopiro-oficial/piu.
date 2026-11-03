import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { test } from 'node:test';
import { type LnnpConfig, loadLnnpConfig } from '../src/config.js';
import { utf8 } from '../src/protocol/bytes.js';
import { MsgType, sealDirect } from '../src/protocol/envelope.js';
import { deriveIdentity, deriveNodeKey, type Identity, newSeed, toPublic } from '../src/protocol/keys.js';
import { DutyCycle, loraAirtimeMs } from '../src/relay/airtime.js';
import { RadioSim, type RelayHandle, startRelay } from '../src/relay/index.js';
import { KissDecoder, kissEncode } from '../src/relay/kiss.js';
import { decodePacket, encodePacket, PacketType, parseSerialSpec } from '../src/relay/serial.js';
import { DEFAULT_SETTINGS } from '../src/store.js';

const LORA = { sf: 7, bwKHz: 500, cr: 5, dutyPercent: 100, maxEnvelope: 1536, beaconMs: 1000 };

function cfg(o: Partial<LnnpConfig> = {}): LnnpConfig {
  return { enabled: true, relay: true, listen: '127.0.0.1', port: 0, discoveryPort: null, broadcast: [], peers: [], memoryMB: 16, allow: null, beaconMs: 60_000, lora: LORA, ...o };
}

const nodes: RelayHandle[] = [];
const closeAll = async () => { await Promise.all(nodes.splice(0).map(n => n.close())); };

/** Nó só com rádio (o LAN sobe sem vizinhos): `name` é o rádio no simulador. */
async function radioNode(sim: RadioSim, name: string, id?: Identity, o: Partial<LnnpConfig> = {}) {
  const n = await startRelay(deriveNodeKey(newSeed()), cfg({ serial: [{ kind: 'lora', path: name, baud: 0 }], ...o }), DEFAULT_SETTINGS,
    { identities: id ? [id] : [], tickMs: 100, openModem: async path => sim.modem(path) });
  nodes.push(n);
  return n;
}

async function until(cond: () => boolean, what: string, ms = 30_000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`Tempo esgotado esperando: ${what}`);
    await new Promise(r => setTimeout(r, 25));
  }
}
const person = () => deriveIdentity(newSeed(), 'public');
const letter = (from: Identity, to: Identity, text: string, extra: { bulk?: boolean } = {}) =>
  sealDirect({ from, to: toPublic(to), type: MsgType.Text, body: utf8(text), now: Math.floor(Date.now() / 1000), ...extra });
const text = (n: RelayHandle, i = 0) => new TextDecoder().decode(n.engine.inbox[i]!.body);

test('KISS: escapes, quadros partidos no meio, ruído e quadro grande demais', () => {
  const payload = Uint8Array.of(1, 0xc0, 2, 0xdb, 3);
  const enc = kissEncode(payload);
  assert.deepEqual([...enc], [0xc0, 0, 1, 0xdb, 0xdc, 2, 0xdb, 0xdd, 3, 0xc0]);
  const d = new KissDecoder(16);
  assert.deepEqual(d.push(enc.slice(0, 4)), []);
  const [got] = d.push(enc.slice(4));
  assert.deepEqual([...got!], [...payload]);
  // Escape inválido, comando de configuração e quadro acima do limite: descartados.
  assert.equal(d.push(Uint8Array.of(0xc0, 0, 0xdb, 0x01, 0xc0)).length, 0);
  assert.equal(d.push(Uint8Array.of(0xc0, 0x06, 1, 0xc0)).length, 0);
  assert.equal(d.push(kissEncode(new Uint8Array(40))).length, 0);
  assert.ok(d.dropped >= 2);
});

test('LoRa: tempo no ar pela fórmula da Semtech e limite de ocupação do canal', () => {
  assert.equal(Math.round(loraAirtimeMs(20, { sf: 7, bwKHz: 125, cr: 5 }) * 1000) / 1000, 56.576);
  assert.equal(Math.round(loraAirtimeMs(10, { sf: 12, bwKHz: 125, cr: 5 })), 991); // com otimização de taxa baixa
  const d = new DutyCycle(1, 1000); // 1% de 1 s = 10 ms
  assert.ok(d.allows(8, 0)); d.spend(8, 0);
  assert.ok(!d.allows(5, 10));
  assert.ok(d.allows(5, 1001)); // a janela andou
});

test('LoRa: pacote do enlace e configuração por PIU_SERIAL / PIU_LORA_*', () => {
  const p = { type: PacketType.Data, dst: 0xdeadbeef, src: 1, seq: 255, payload: Uint8Array.of(9, 8) };
  assert.deepEqual(decodePacket(encodePacket(p)), p);
  assert.equal(decodePacket(Uint8Array.of(9, 0, 0, 0, 0, 0, 0, 0, 0, 0)), null);
  assert.deepEqual(parseSerialSpec('lora:/dev/ttyUSB0@57600'), { kind: 'lora', path: '/dev/ttyUSB0', baud: 57600 });
  const c = loadLnnpConfig({ PIU_SERIAL: 'lora:/dev/ttyUSB0, usb:/dev/ttyACM0@9600', PIU_LORA_SF: '10', PIU_LORA_DUTY: '1' });
  assert.deepEqual(c.serial, [{ kind: 'lora', path: '/dev/ttyUSB0', baud: 115200 }, { kind: 'usb', path: '/dev/ttyACM0', baud: 9600 }]);
  assert.equal(c.lora!.sf, 10); assert.equal(c.lora!.dutyPercent, 1); assert.equal(c.lora!.bwKHz, 125);
  assert.throws(() => loadLnnpConfig({ PIU_SERIAL: 'radio:/dev/x' }), /PIU_SERIAL/);
  assert.throws(() => loadLnnpConfig({ PIU_LORA_SF: '13' }), /PIU_LORA_SF/);
});

test('LoRa simulado: A → R → B em linha (A e B fora do alcance), handshake e envelope em fragmentos', async t => {
  t.after(closeAll);
  const sim = new RadioSim();
  sim.link('A', 'R'); sim.link('R', 'B');
  const alice = person(), bob = person();
  const A = await radioNode(sim, 'A', alice), R = await radioNode(sim, 'R'), B = await radioNode(sim, 'B', bob);
  await until(() => R.engine.stats().neighbors.length === 2 && A.engine.linkCount === 1 && B.engine.linkCount === 1, 'enlaces LoRa A–R–B');
  const m = letter(alice, bob, 'oi, Bob, pelo rádio');
  assert.ok(m.bytes.length > 245, 'o envelope não cabe num pacote: vai em fragmentos');
  A.engine.send(m.bytes);
  await until(() => B.engine.inbox.length === 1, 'B receber pelo rádio');
  assert.equal(text(B), 'oi, Bob, pelo rádio');
  const s = R.engine.stats();
  assert.equal(R.engine.inbox.length, 0);
  assert.equal(s.counters.receipts, 1);
  for (const nb of s.neighbors) { assert.deepEqual(nb.media, ['lora']); assert.equal(nb.link, 'lora'); assert.equal(nb.mtu, 245); }
  assert.ok(A.engine.stats().neighbors.every(x => x.id !== B.engine.stats().node));
  const rs = R.stats().serial[0]!;
  assert.equal(rs.kind, 'lora');
  assert.ok(rs.airtimeMs! > 0 && rs.packetsSent > 0);
  assert.equal(sim.stats.tooLarge, 0, 'nenhum pacote acima de 255 bytes');
});

test('LoRa simulado: com 25% de perda, a confirmação por pacote ainda entrega', async t => {
  t.after(closeAll);
  // Perdas sorteadas com semente fixa: o teste é reproduzível (antes, um sorteio azarado estourava o tempo no CI).
  let seed = 0x9e3779b9;
  const seeded = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const sim = new RadioSim({ loss: 0.25, random: seeded });
  sim.link('A', 'B');
  const alice = person(), bob = person();
  const A = await radioNode(sim, 'A', alice), B = await radioNode(sim, 'B', bob);
  await until(() => A.engine.linkCount === 1 && B.engine.linkCount === 1, 'enlace com perdas', 60_000);
  for (let i = 0; i < 3; i++) A.engine.send(letter(alice, bob, `mensagem ${i}`).bytes);
  await until(() => B.engine.inbox.length === 3, 'as três chegarem', 60_000);
  assert.deepEqual([0, 1, 2].map(i => text(B, i)).sort(), ['mensagem 0', 'mensagem 1', 'mensagem 2']);
  assert.ok(sim.stats.lost > 0, 'o simulador perdeu pacotes');
  assert.ok(A.stats().serial[0]!.retries + B.stats().serial[0]!.retries > 0, 'houve repetição');
});

test('LoRa simulado: mídia e envelope grande demais não vão pelo rádio; mensagem pequena vai', async t => {
  t.after(closeAll);
  const sim = new RadioSim();
  sim.link('A', 'B');
  const alice = person(), bob = person();
  const A = await radioNode(sim, 'A', alice), B = await radioNode(sim, 'B', bob);
  await until(() => A.engine.linkCount === 1 && B.engine.linkCount === 1, 'enlace');
  const media = letter(alice, bob, 'foto', { bulk: true });
  const big = letter(alice, bob, 'x'.repeat(3000));
  const small = letter(alice, bob, 'curta');
  assert.ok(big.bytes.length > LORA.maxEnvelope);
  for (const m of [media, big, small]) A.engine.send(m.bytes);
  await until(() => B.engine.inbox.length === 1, 'a pequena chegar');
  await new Promise(r => setTimeout(r, 800));
  assert.equal(B.engine.inbox.length, 1);
  assert.equal(text(B), 'curta');
  // As outras continuam guardadas em A, para um meio que as leve (LAN, Wi‑Fi, USB).
  assert.ok(A.engine.router.has(media.id) && A.engine.router.has(big.id));
});

test('LoRa simulado: vizinho que reinicia (mesma chave) volta a receber', async t => {
  t.after(closeAll);
  const sim = new RadioSim();
  sim.link('A', 'B');
  const alice = person(), bob = person(), seedB = newSeed();
  const mkB = async () => {
    const n = await startRelay(deriveNodeKey(seedB), cfg({ serial: [{ kind: 'lora', path: 'B', baud: 0 }] }), DEFAULT_SETTINGS,
      { identities: [bob], tickMs: 100, openModem: async path => sim.modem(path) });
    nodes.push(n);
    return n;
  };
  const A = await radioNode(sim, 'A', alice);
  const B1 = await mkB();
  await until(() => A.engine.linkCount === 1 && B1.engine.linkCount === 1, 'primeiro enlace');
  // B cai sem avisar (energia) e volta: a sessão antiga de A não serve mais.
  await B1.close();
  nodes.splice(nodes.indexOf(B1), 1);
  const B2 = await mkB();
  A.engine.send(letter(alice, bob, 'depois do reinício').bytes);
  await until(() => B2.engine.inbox.length === 1, 'B reiniciado receber', 60_000);
  assert.equal(text(B2), 'depois do reinício');
});

test('LoRa simulado: o limite de ocupação do canal segura os envios', async t => {
  t.after(closeAll);
  const sim = new RadioSim();
  // 0,002% de 1 h = 72 ms no ar: poucos anúncios e mais nada.
  const A = await radioNode(sim, 'A', undefined, { lora: { ...LORA, dutyPercent: 0.002, beaconMs: 50 } });
  // O primeiro anúncio sai com atraso aleatório de até 1 s: espera o limite agir, sem tempo fixo.
  await until(() => A.stats().serial[0]!.dutyWaits! > 0, 'o limite segurar um envio', 10_000);
  await new Promise(r => setTimeout(r, 300));
  const s = A.stats().serial[0]!;
  assert.ok(s.airtimeMs! <= 72, `tempo no ar ${s.airtimeMs} ms`);
  assert.ok(s.dutyWaits! > 0);
  assert.ok(s.dutyUsedPercent! <= 0.002);
});

/** Cabo serial virtual: dois pseudo-terminais ligados um ao outro (null-modem), via Python. */
function nullModem(): Promise<{ a: string; b: string; proc: ChildProcess }> {
  const py = `
import os, pty, select, sys
m1, s1 = pty.openpty(); m2, s2 = pty.openpty()
print(os.ttyname(s1)); print(os.ttyname(s2)); sys.stdout.flush()
while True:
    r, _, _ = select.select([m1, m2], [], [])
    for fd in r:
        try: data = os.read(fd, 4096)
        except OSError: continue
        os.write(m2 if fd == m1 else m1, data)
`;
  const proc = spawn('python3', ['-c', py], { stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((res, rej) => {
    let out = '';
    proc.stdout!.on('data', d => { out += d; const l = out.trim().split('\n'); if (l.length >= 2) res({ a: l[0]!, b: l[1]!, proc }); });
    proc.once('error', rej);
  });
}

test('USB: dois nós por cabo serial (pseudo-terminais reais, stty e KISS)', async t => {
  t.after(closeAll);
  const cable = await nullModem();
  t.after(() => { cable.proc.kill(); });
  const alice = person(), bob = person();
  const mk = async (path: string, id: Identity) => {
    const n = await startRelay(deriveNodeKey(newSeed()), cfg({ serial: [{ kind: 'usb', path, baud: 115200 }] }), DEFAULT_SETTINGS, { identities: [id], tickMs: 100 });
    nodes.push(n);
    return n;
  };
  const A = await mk(cable.a, alice), B = await mk(cable.b, bob);
  assert.equal(A.serial.length, 1, 'porta aberta');
  await until(() => A.engine.linkCount === 1 && B.engine.linkCount === 1, 'enlace USB');
  const media = letter(alice, bob, 'foto pelo cabo', { bulk: true });
  A.engine.send(media.bytes);
  await until(() => B.engine.inbox.length === 1, 'B receber pelo cabo');
  assert.equal(text(B), 'foto pelo cabo'); // mídia pode ir por cabo
  const nb = A.engine.stats().neighbors[0]!;
  assert.deepEqual(nb.media, ['usb']);
  assert.ok(nb.address.startsWith(`usb:${cable.a}`));
  assert.ok(nb.mtu > 1000);
});

test('Porta serial ausente não derruba o nó', async t => {
  t.after(closeAll);
  const logs: string[] = [];
  const n = await startRelay(deriveNodeKey(newSeed()), cfg({ serial: [{ kind: 'lora', path: '/dev/nao-existe', baud: 115200 }] }), DEFAULT_SETTINGS, { log: m => logs.push(m) });
  nodes.push(n);
  assert.equal(n.serial.length, 0);
  assert.ok(logs.some(l => l.includes('não abriu /dev/nao-existe')));
});
