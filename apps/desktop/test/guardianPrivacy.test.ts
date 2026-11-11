import assert from 'node:assert/strict';
import { test } from 'node:test';
import { utf8 } from '../../mobile/src/protocol/bytes';
import { MsgType, sealDirect } from '../../mobile/src/protocol/envelope';
import { deriveIdentity, newSeed, toPublic } from '../../mobile/src/protocol/keys';
import { GuardianNode } from '../src/main/guardian/guardianNode';
import { pointKey } from '../src/main/guardian/guardian';
import { packRecords, unpackRecords } from '../src/main/guardian/sealed';
import type { Transport, TransportEvent } from '../src/transport/types';

/** Transporte em memória: o teste dispara os eventos e vê o que o ponto envia. */
function fakeTransport() {
  let fn: ((e: TransportEvent) => void) | null = null;
  const sent: { peer: string; data: Uint8Array }[] = [];
  const t: Transport = {
    kind: 'lan', state: 'running' as never, linkCount: 0,
    start: async () => {}, stop: async () => {},
    send: async (peer, data) => { sent.push({ peer, data }); },
    subscribe: f => { fn = f; return () => { fn = null; }; },
    peerStatus: () => [],
  };
  return { t, sent, emit: (e: TransportEvent) => fn?.(e) };
}

async function until(cond: () => boolean, what: string, ms = 3000) {
  const end = Date.now() + ms;
  while (!cond()) { if (Date.now() > end) throw new Error(`Tempo esgotado esperando: ${what}`); await new Promise(r => setTimeout(r, 10)); }
}

const letter = (now: number) => {
  const alice = deriveIdentity(newSeed(), 'public'), bob = deriveIdentity(newSeed(), 'public');
  return sealDirect({ from: alice, to: toPublic(bob), type: MsgType.Text, body: utf8('oi'), now }).bytes;
};

test('ponto ocioso: o expurgo por validade marca o estado para gravar (o disco não guarda vencidos)', async t => {
  let now = Math.floor(Date.now() / 1000);
  let changes = 0;
  const ft = fakeTransport();
  const node = new GuardianNode({ key: pointKey(newSeed()), transport: ft.t, limits: { maxBytes: 2 ** 20, retentionSec: 3600 }, tickMs: 20, now: () => now, onChange: () => { changes++; } });
  t.after(() => node.stop());
  node.receive('a1b2c3d4e5f60718', letter(now));
  assert.equal(node.stats().stored, 1);
  await node.start();
  await new Promise(r => setTimeout(r, 60));
  changes = 0;
  now += 3601; // passou da retenção, sem tráfego nenhum
  await until(() => node.stats().stored === 0, 'expurgo');
  await until(() => changes > 0, 'onChange depois do expurgo');
});

test('ponto: o que vai ao disco não leva o id do vizinho em claro nem o horário exato; repasse continua sem repetir', async () => {
  const now = Math.floor(Date.now() / 1000);
  const key = pointKey(newSeed());
  const ft = fakeTransport();
  const node = new GuardianNode({ key, transport: ft.t, limits: { maxBytes: 2 ** 20, retentionSec: 3 * 86400 }, now: () => now });
  const from = 'a1b2c3d4e5f60718', to = '0f1e2d3c4b5a6978';
  await node.start();
  node.receive(from, letter(now));
  ft.emit({ type: 'connected', id: to, pk: '', address: '' });
  await until(() => ft.sent.length === 1, 'repasse a outro vizinho');
  const recs = node.exportStored();
  const disk = packRecords(recs).toString('latin1');
  assert.ok(!disk.includes(from) && !disk.includes(to), 'ids de vizinhos não vão em claro para o store.bin');
  const back = unpackRecords(packRecords(recs));
  assert.equal(back[0]!.storedAt % 3600, 0, 'horário guardado arredondado à hora');
  assert.ok(back[0]!.dropAt >= recs[0]!.dropAt - 3600 && back[0]!.dropAt % 3600 === 0);
  await node.stop();
  // Reinício: o mesmo ponto reconhece os vizinhos (não devolve a quem trouxe nem repete a quem já foi).
  const ft2 = fakeTransport();
  const node2 = new GuardianNode({ key, transport: ft2.t, limits: { maxBytes: 2 ** 20, retentionSec: 3 * 86400 }, now: () => now });
  assert.equal(node2.importStored(back), 1);
  await node2.start();
  ft2.emit({ type: 'connected', id: from, pk: '', address: '' });
  ft2.emit({ type: 'connected', id: to, pk: '', address: '' });
  ft2.emit({ type: 'connected', id: 'ffffffffffffffff', pk: '', address: '' });
  await until(() => ft2.sent.length >= 1, 'repasse ao vizinho novo');
  await new Promise(r => setTimeout(r, 30));
  assert.deepEqual(ft2.sent.map(s => s.peer), ['ffffffffffffffff']);
  await node2.stop();
});

test('ponto: o disco não leva para quem foi repassado quando esse vizinho já saiu (só os ligados agora)', async () => {
  const now = Math.floor(Date.now() / 1000);
  const ft = fakeTransport();
  const node = new GuardianNode({ key: pointKey(newSeed()), transport: ft.t, limits: { maxBytes: 2 ** 20, retentionSec: 3 * 86400 }, now: () => now });
  const pid = (id: string) => (node as unknown as { pid: (x: string) => string }).pid(id);
  const disk = (salt: string, id: string) => (node as unknown as { diskName: (s: string, p: string) => string }).diskName(salt, pid(id));
  const from = 'a1b2c3d4e5f60718', gone = '0f1e2d3c4b5a6978', here = '1111222233334444';
  await node.start();
  node.receive(from, letter(now));
  ft.emit({ type: 'connected', id: gone, pk: '', address: '' });
  ft.emit({ type: 'connected', id: here, pk: '', address: '' });
  await until(() => ft.sent.length === 2, 'repasse aos dois vizinhos');
  const r0 = node.exportStored()[0]!;
  assert.deepEqual(r0.sentTo.sort(), [disk(r0.salt!, gone), disk(r0.salt!, here)].sort());
  ft.emit({ type: 'disconnected', id: gone });
  assert.deepEqual(node.exportStored()[0]!.sentTo, [disk(r0.salt!, here)], 'quem saiu não fica registrado no disco');
  // Na memória o ponto ainda lembra: se o vizinho voltar com o ponto ligado, não repete.
  ft.emit({ type: 'connected', id: gone, pk: '', address: '' });
  await new Promise(r => setTimeout(r, 30));
  assert.equal(ft.sent.length, 2);
  await node.stop();
});

test('ponto: store.bin antigo (ids em claro) é regravado logo na carga, mesmo ocioso: quem trouxe convertido, "para quem já foi" zerado no disco', async t => {
  const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { GuardianService, storeKey } = await import('../src/main/guardian/guardian');
  const { readSealed, writeSealed } = await import('../src/main/guardian/sealed');
  const dir = mkdtempSync(join(tmpdir(), 'piu-guardian-legacy-'));
  const net = { up: true, wired: false, ssid: 'Casa', iface: 'en0', address: '127.0.0.1', cidr: '192.168.0.0/24', gateway: '192.168.0.1', label: 'Casa' };
  const mk = () => {
    const s = new GuardianService({
      dir, hostname: 'mac', onState: () => {}, dataKey: async () => Buffer.alloc(32, 7),
      lan: { port: 0, discoveryPort: null, listen: '127.0.0.1' }, tickMs: 3_600_000, watchMs: 3_600_000,
      net: { ifaces: () => ({}) as never }, check: { beacons: async () => 2, probe: async () => 'none', freeBytes: async () => 50 * 2 ** 30 },
    });
    (s as unknown as { network: () => Promise<unknown> }).network = async () => net;
    return s;
  };
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const a = mk();
  await a.init();
  await a.activate({ name: 'Piu · Casa', level: 'guardian', storageMB: 256, days: 3, gateway: false, autoStart: true });
  await a.close();
  const seed = Buffer.from(JSON.parse(readSealed(join(dir, 'point.bin'), Buffer.alloc(32, 7), 'PIUP1')!.toString('utf8')).seed, 'hex');
  // Formato antigo: meta sem versão, com os ids dos vizinhos em claro.
  const from = 'a1b2c3d4e5f60718', to = '0f1e2d3c4b5a6978';
  const now = Math.floor(Date.now() / 1000);
  const bytes = Buffer.from(letter(now));
  const meta = Buffer.from(JSON.stringify({ f: from, s: now, d: now + 86400, t: [to], c: 1 }));
  const h = Buffer.alloc(4); h.writeUInt32BE(meta.length);
  const b = Buffer.alloc(4); b.writeUInt32BE(bytes.length);
  writeSealed(join(dir, 'store.bin'), storeKey(seed), Buffer.concat([h, meta, b, bytes]), 'PIUS1');
  const svc = mk();
  t.after(() => svc.close());
  await svc.init();
  assert.equal(svc.state().status, 'active');
  assert.equal(svc.state().stats!.stored, 1, 'o envelope antigo continua guardado');
  const disk = readSealed(join(dir, 'store.bin'), storeKey(seed), 'PIUS1')!.toString('latin1');
  assert.ok(!disk.includes(from) && !disk.includes(to), 'store.bin regravado na hora, sem ids em claro');
  const node = (svc as unknown as { node: GuardianNode }).node;
  // No disco: quem trouxe vira o nome do ponto; "para quem já foi" fica VAZIO (na carga não há vizinho ligado).
  const { unpackRecords } = await import('../src/main/guardian/sealed');
  const onDisk = unpackRecords(readSealed(join(dir, 'store.bin'), storeKey(seed), 'PIUS1')!);
  assert.equal(onDisk.length, 1);
  assert.equal(onDisk[0]!.legacy, undefined, 'regravado no formato novo');
  const pidOf = (id: string) => (node as unknown as { pid: (x: string) => string }).pid(id);
  assert.match(onDisk[0]!.salt ?? '', /^[0-9a-f]{32}$/, 'sal próprio do envelope');
  assert.equal(onDisk[0]!.from, (node as unknown as { diskName: (s: string, p: string) => string }).diskName(onDisk[0]!.salt!, pidOf(from)));
  assert.deepEqual(onDisk[0]!.sentTo, [], 'o disco não guarda para quem já foi; só a memória lembra');
  // Na memória a conversão preserva o repasse: não devolve a quem trouxe nem repete a quem já recebeu.
  const out = (id: string) => node.router.outgoing((node as unknown as { pid: (x: string) => string }).pid(id), 'eth', now).length;
  assert.equal(out(from), 0);
  assert.equal(out(to), 0);
  assert.equal(out('ffffffffffffffff'), 1);
});

test('ponto: envelopes do mesmo vizinho vão ao disco com nomes diferentes (sal por envelope), sem o nome estável do vizinho', async () => {
  const now = Math.floor(Date.now() / 1000);
  const ft = fakeTransport();
  const node = new GuardianNode({ key: pointKey(newSeed()), transport: ft.t, limits: { maxBytes: 2 ** 20, retentionSec: 3 * 86400 }, now: () => now });
  const pid = (id: string) => (node as unknown as { pid: (x: string) => string }).pid(id);
  const from = 'a1b2c3d4e5f60718', to = '0f1e2d3c4b5a6978';
  await node.start();
  node.receive(from, letter(now));
  node.receive(from, letter(now));
  ft.emit({ type: 'connected', id: to, pk: '', address: '' });
  await until(() => ft.sent.length === 2, 'repasse dos dois');
  const back = unpackRecords(packRecords(node.exportStored()));
  assert.equal(back.length, 2);
  const [a, b] = back as [typeof back[0], typeof back[0]];
  assert.notEqual(a.salt, b.salt, 'cada envelope com seu sal');
  assert.notEqual(a.from, b.from, 'quem trouxe: nomes diferentes no disco');
  assert.notEqual(a.sentTo[0], b.sentTo[0], 'para quem foi: nomes diferentes no disco');
  for (const r of back) {
    assert.notEqual(r.from, pid(from), 'o nome estável do vizinho não vai ao disco');
    assert.ok(!r.sentTo.includes(pid(to)));
  }
  // Regravar o mesmo envelope mantém o mesmo sal (o registro não muda de nome a cada minuto).
  const again = unpackRecords(packRecords(node.exportStored()));
  assert.deepEqual(again.map(r => r.salt).sort(), back.map(r => r.salt).sort());
  await node.stop();
});

test('ponto: store.bin do formato com nome estável (v2, sem sal) é regravado na carga com sal, sem perder quem trouxe nem para quem foi', async t => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createHmac } = await import('node:crypto');
  const { GuardianService, storeKey } = await import('../src/main/guardian/guardian');
  const { readSealed, writeSealed } = await import('../src/main/guardian/sealed');
  const dir = mkdtempSync(join(tmpdir(), 'piu-guardian-v2-'));
  const net = { up: true, wired: false, ssid: 'Casa', iface: 'en0', address: '127.0.0.1', cidr: '192.168.0.0/24', gateway: '192.168.0.1', label: 'Casa' };
  const mk = () => {
    const s = new GuardianService({
      dir, hostname: 'mac', onState: () => {}, dataKey: async () => Buffer.alloc(32, 7),
      lan: { port: 0, discoveryPort: null, listen: '127.0.0.1' }, tickMs: 3_600_000, watchMs: 3_600_000,
      net: { ifaces: () => ({}) as never }, check: { beacons: async () => 2, probe: async () => 'none', freeBytes: async () => 50 * 2 ** 30 },
    });
    (s as unknown as { network: () => Promise<unknown> }).network = async () => net;
    return s;
  };
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const a = mk();
  await a.init();
  await a.activate({ name: 'Piu · Casa', level: 'guardian', storageMB: 256, days: 3, gateway: false, autoStart: true });
  await a.close();
  const seed = Buffer.from(JSON.parse(readSealed(join(dir, 'point.bin'), Buffer.alloc(32, 7), 'PIUP1')!.toString('utf8')).seed, 'hex');
  const sk = pointKey(seed).sk;
  // Formato v2: f/t = HMAC estável do id com a chave do ponto (igual para todos os envelopes do vizinho).
  const stable = (id: string) => createHmac('sha256', sk).update(`piu/ponto/vizinho/${id}`).digest('hex').slice(0, 16);
  const from = 'a1b2c3d4e5f60718', to = '0f1e2d3c4b5a6978';
  const now = Math.floor(Date.now() / 1000);
  const parts: Buffer[] = [];
  for (let i = 0; i < 2; i++) {
    const bytes = Buffer.from(letter(now));
    const meta = Buffer.from(JSON.stringify({ v: 2, f: stable(from), s: now, d: now + 86400, t: [stable(to)], c: 1 }));
    const h = Buffer.alloc(4); h.writeUInt32BE(meta.length);
    const b = Buffer.alloc(4); b.writeUInt32BE(bytes.length);
    parts.push(h, meta, b, bytes);
  }
  writeSealed(join(dir, 'store.bin'), storeKey(seed), Buffer.concat(parts), 'PIUS1');
  const svc = mk();
  t.after(() => svc.close());
  await svc.init();
  assert.equal(svc.state().stats!.stored, 2);
  const onDisk = unpackRecords(readSealed(join(dir, 'store.bin'), storeKey(seed), 'PIUS1')!);
  assert.equal(onDisk.length, 2);
  for (const r of onDisk) {
    assert.equal(r.legacy, undefined, 'regravado no formato novo logo na carga');
    assert.match(r.salt ?? '', /^[0-9a-f]{32}$/);
    assert.notEqual(r.from, stable(from), 'o nome estável sumiu do disco');
    assert.deepEqual(r.sentTo, [], 'para quem já foi: só vizinhos ligados (nenhum na carga)');
  }
  assert.notEqual(onDisk[0]!.from, onDisk[1]!.from, 'os dois envelopes do mesmo vizinho não formam grupo no disco');
  const node = (svc as unknown as { node: GuardianNode }).node;
  const out = (id: string) => node.router.outgoing((node as unknown as { pid: (x: string) => string }).pid(id), 'eth', now).length;
  assert.equal(out(from), 0, 'não devolve a quem trouxe');
  assert.equal(out(to), 0, 'não repete a quem já recebeu');
  assert.equal(out('ffffffffffffffff'), 2);
});

test('ponto: depois de reiniciar só com o store.bin novo, não devolve a quem trouxe nem reenvia a quem já recebeu (vizinhos chegando aos poucos)', async () => {
  const now = Math.floor(Date.now() / 1000);
  const key = pointKey(newSeed());
  const ft = fakeTransport();
  const node = new GuardianNode({ key, transport: ft.t, limits: { maxBytes: 2 ** 20, retentionSec: 3 * 86400 }, now: () => now });
  const A = 'a1b2c3d4e5f60718', B = '0f1e2d3c4b5a6978', C = '1111222233334444';
  await node.start();
  node.receive(A, letter(now));
  node.receive(B, letter(now));
  ft.emit({ type: 'connected', id: C, pk: '', address: '' });
  await until(() => ft.sent.length === 2, 'C recebe os dois');
  const disk = packRecords(node.exportStored());
  await node.stop();
  const ft2 = fakeTransport();
  const node2 = new GuardianNode({ key, transport: ft2.t, limits: { maxBytes: 2 ** 20, retentionSec: 3 * 86400 }, now: () => now });
  assert.equal(node2.importStored(unpackRecords(disk)), 2);
  await node2.start();
  ft2.emit({ type: 'connected', id: C, pk: '', address: '' });
  await new Promise(r => setTimeout(r, 30));
  assert.equal(ft2.sent.length, 0, 'C já tinha recebido os dois');
  ft2.emit({ type: 'connected', id: A, pk: '', address: '' });
  await until(() => ft2.sent.length === 1, 'A recebe só o de B');
  ft2.emit({ type: 'connected', id: B, pk: '', address: '' });
  await until(() => ft2.sent.length === 2, 'B recebe só o de A');
  await new Promise(r => setTimeout(r, 30));
  assert.deepEqual(ft2.sent.map(s => s.peer), [A, B]);
  // Depois de reconhecidos, o disco volta a ter quem trouxe com o mesmo sal (nome igual ao gravado antes).
  const before = unpackRecords(disk), after = unpackRecords(packRecords(node2.exportStored()));
  for (const r of before) {
    const x = after.find(y => y.salt === r.salt)!;
    assert.equal(x.from, r.from);
  }
  await node2.stop();
});

test('ponto: a ordem dos registros no store.bin não junta os envelopes de um vizinho (nem depois de reconhecê-lo)', async () => {
  const now = Math.floor(Date.now() / 1000);
  const key = pointKey(newSeed());
  const ft = fakeTransport();
  const lim = { maxBytes: 2 ** 22, retentionSec: 3 * 86400 };
  const node = new GuardianNode({ key, transport: ft.t, limits: lim, now: () => now });
  const A = 'a1b2c3d4e5f60718';
  // 40 envelopes: 1 em cada 4 trazido por A, os outros por vizinhos diferentes.
  for (let i = 0; i < 40; i++) node.receive(i % 4 === 0 ? A : `0000${i.toString(16).padStart(12, '0')}`, letter(now));
  const disk = packRecords(node.exportStored());
  const ft2 = fakeTransport();
  const node2 = new GuardianNode({ key, transport: ft2.t, limits: lim, now: () => now });
  assert.equal(node2.importStored(unpackRecords(disk)), 40);
  await node2.start();
  // A liga: o ponto reconhece quem trouxe (tira e devolve ao roteador os 10 de A).
  ft2.emit({ type: 'connected', id: A, pk: '', address: '' });
  await until(() => ft2.sent.length === 30, 'A recebe só os dos outros');
  const pidA = (node2 as unknown as { pid: (x: string) => string }).pid(A);
  const name = (s: string) => (node2 as unknown as { diskName: (s: string, p: string) => string }).diskName(s, pidA);
  const recs = unpackRecords(packRecords(node2.exportStored()));
  const pos = recs.map((r, i) => (r.from === name(r.salt!) ? i : -1)).filter(i => i >= 0);
  assert.equal(pos.length, 10);
  // Sem embaralhar, os 10 de A iriam juntos para o fim (30..39). Chance de cair assim por acaso: 1 em ~847 milhões.
  assert.notDeepEqual(pos, [30, 31, 32, 33, 34, 35, 36, 37, 38, 39], 'os de A não ficam num bloco no fim');
  await node2.stop();
});

test('store.bin: packRecords grava os registros em ordem aleatória (a ordem de chegada não vai ao disco)', () => {
  const now = Math.floor(Date.now() / 1000);
  const recs = Array.from({ length: 32 }, (_, i) => ({ bytes: letter(now), from: null, storedAt: now, dropAt: now + 3600, sentTo: [], copies: 0, salt: i.toString(16).padStart(32, '0') }));
  const order = unpackRecords(packRecords(recs)).map(r => r.salt);
  assert.equal(order.length, 32);
  assert.notDeepEqual(order, recs.map(r => r.salt), 'ordem igual à de entrada: 1 em 32! por acaso');
  assert.deepEqual([...order].sort(), recs.map(r => r.salt).sort(), 'nenhum registro perdido');
});
