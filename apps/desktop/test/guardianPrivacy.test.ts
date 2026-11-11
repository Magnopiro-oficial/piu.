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
  assert.equal(node2.importStored(back.map(r => ({ ...r, own: false, releaseAt: 0 }))), 1);
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
  const from = 'a1b2c3d4e5f60718', gone = '0f1e2d3c4b5a6978', here = '1111222233334444';
  await node.start();
  node.receive(from, letter(now));
  ft.emit({ type: 'connected', id: gone, pk: '', address: '' });
  ft.emit({ type: 'connected', id: here, pk: '', address: '' });
  await until(() => ft.sent.length === 2, 'repasse aos dois vizinhos');
  assert.deepEqual(node.exportStored()[0]!.sentTo.sort(), [pid(gone), pid(here)].sort());
  ft.emit({ type: 'disconnected', id: gone });
  assert.deepEqual(node.exportStored()[0]!.sentTo, [pid(here)], 'quem saiu não fica registrado no disco');
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
  assert.equal(onDisk[0]!.from, (node as unknown as { pid: (x: string) => string }).pid(from));
  assert.deepEqual(onDisk[0]!.sentTo, [], 'o disco não guarda para quem já foi; só a memória lembra');
  // Na memória a conversão preserva o repasse: não devolve a quem trouxe nem repete a quem já recebeu.
  const out = (id: string) => node.router.outgoing((node as unknown as { pid: (x: string) => string }).pid(id), 'eth', now).length;
  assert.equal(out(from), 0);
  assert.equal(out(to), 0);
  assert.equal(out('ffffffffffffffff'), 1);
});
