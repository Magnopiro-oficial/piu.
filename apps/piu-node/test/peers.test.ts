import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import type { Config, LnnpConfig } from '../src/config.js';
import { toHex } from '../src/protocol/bytes.js';
import { deriveNodeKey, newSeed } from '../src/protocol/keys.js';
import { confirmCode, parsePeerAddress, type RelayHandle, startRelay } from '../src/relay/index.js';
import { Pairing } from '../src/security/pairing.js';
import { DEFAULT_SETTINGS, Store } from '../src/store.js';

function cfg(o: Partial<LnnpConfig> = {}): LnnpConfig {
  return { enabled: true, relay: true, listen: '127.0.0.1', port: 0, discoveryPort: null, broadcast: [], peers: [], memoryMB: 16, allow: null, beaconMs: 200, ...o };
}
const nodes: RelayHandle[] = [];
async function node(o: Partial<LnnpConfig> = {}) {
  const n = await startRelay(deriveNodeKey(newSeed()), cfg(o), DEFAULT_SETTINGS, { tickMs: 100, handshakeTimeoutMs: 1500 });
  nodes.push(n);
  return n;
}
const addr = (n: RelayHandle) => `127.0.0.1:${n.port}`;
const closeAll = async () => { await Promise.all(nodes.splice(0).map(n => n.close())); };
async function until(cond: () => boolean, what: string, ms = 5000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`Tempo esgotado esperando: ${what}`);
    await new Promise(r => setTimeout(r, 20));
  }
}
/** Porta livre em loopback (abre e fecha um servidor). */
async function freePort() {
  const s = createServer();
  await new Promise<void>(r => s.listen(0, '127.0.0.1', r));
  const a = s.address();
  await new Promise<void>(r => s.close(() => r()));
  return typeof a === 'object' && a ? a.port : 0;
}

test('vizinho por endereço: endereço estrito (host:porta, sem esquema nem caminho)', () => {
  assert.equal(parsePeerAddress('192.168.0.12:8422'), '192.168.0.12:8422');
  assert.equal(parsePeerAddress('  Mini-PC.local:8422 '), 'mini-pc.local:8422');
  assert.equal(parsePeerAddress('[fe80::1]:8422'), '[fe80::1]:8422');
  for (const bad of [
    'http://192.168.0.12:8422', '192.168.0.12:8422/x', '192.168.0.12', 'host', 'user@host:8422', '192.168.0.12:0', '192.168.0.12:65536',
    '192.168.0.12:08422', '999.1.1.1:8422', '0.0.0.0:8422', '255.255.255.255:8422', 'fe80::1:8422', '[fe80::1%eth0]:8422', '[::]:8422',
    'a b:8422', '-host:8422', 'host-:8422', 'ho_st:8422', '', ':8422', 'host:8422?x', 'host:8422#x', 'a'.repeat(64) + ':8422',
  ]) assert.equal(parsePeerAddress(bad), null, bad);
  assert.equal(parsePeerAddress(42), null);
});

test('código de confirmação: dois nós em loopback mostram o mesmo código de 6 dígitos', async t => {
  t.after(closeAll);
  const A = await node(), B = await node();
  A.addPeer(addr(B));
  await until(() => A.engine.stats().neighbors.length === 1 && B.engine.stats().neighbors.length === 1, 'A–B conectados');
  const a = A.engine.stats().neighbors[0]!, b = B.engine.stats().neighbors[0]!;
  assert.match(a.confirmCode, /^[0-9]{6}$/);
  assert.equal(a.confirmCode, b.confirmCode);
  // Cada lado vê a chave do outro; o código não depende de quem conectou (ordem canônica).
  assert.equal(a.pk, toHex(B.engine.node.pk));
  assert.equal(b.pk, toHex(A.engine.node.pk));
  assert.notEqual(a.inbound, b.inbound);
  const [p] = A.peers();
  assert.equal(p!.state, 'connected');
  assert.equal(p!.source, 'panel');
  assert.equal(p!.nodeId, B.engine.stats().node);
  assert.equal(p!.pk, toHex(B.engine.node.pk));
  // A função é simétrica nas chaves e muda com o transcript (outra sessão, outro código).
  const th = new Uint8Array(32).fill(7);
  assert.equal(confirmCode(th, A.engine.node.pk, B.engine.node.pk), confirmCode(th, B.engine.node.pk, A.engine.node.pk));
  assert.notEqual(confirmCode(th, A.engine.node.pk, B.engine.node.pk), confirmCode(new Uint8Array(32).fill(8), A.engine.node.pk, B.engine.node.pk));
});

test('vizinho por endereço: reconecta sem reiniciar, mostra a falha com motivo e sai quando removido', async t => {
  t.after(closeAll);
  const A = await node();
  const port = await freePort();
  const target = `127.0.0.1:${port}`;
  const from = Date.now();
  A.addPeer(target);
  const failed = await A.waitPeer(target, 3000, from);
  assert.equal(failed!.state, 'failed');
  assert.match(failed!.error!, /recusada/);
  // O outro nó sobe depois, na mesma porta: A reconecta sozinho (a cada beaconMs).
  const B = await node({ port });
  await until(() => A.peers()[0]!.state === 'connected', 'A reconectar a B');
  assert.equal(A.peers()[0]!.error, null);
  assert.ok(A.peers()[0]!.attempts >= 2);
  // B sai: o estado volta a falha com o motivo; B volta: conecta de novo.
  await B.close();
  nodes.splice(nodes.indexOf(B), 1);
  await until(() => A.peers()[0]!.state !== 'connected', 'A perceber a queda');
  assert.match(A.peers()[0]!.error ?? '', /encerrado|recusada/);
  const B2 = await node({ port });
  await until(() => A.peers()[0]!.state === 'connected', 'A reconectar a B2');
  assert.equal(A.peers()[0]!.nodeId, B2.engine.stats().node);
  // Removido: fecha o enlace e para de reconectar.
  assert.equal(A.removePeer(target), true);
  await until(() => A.engine.stats().neighbors.length === 0, 'enlace fechado');
  await new Promise(r => setTimeout(r, 600));
  assert.equal(A.engine.stats().neighbors.length, 0);
  assert.deepEqual(A.peers(), []);
  assert.equal(A.removePeer(target), false);
});

test('vizinho da configuração (PIU_LNNP_PEERS) aparece com origem "config" e soma com os do painel', async t => {
  t.after(closeAll);
  const B = await node(), C = await node();
  const A = await node({ peers: [addr(B)] });
  A.addPeer(addr(C));
  await until(() => A.peers().every(p => p.state === 'connected'), 'A conectar aos dois');
  assert.deepEqual(A.peers().map(p => p.source), ['config', 'panel']);
  assert.equal(A.removePeer(addr(B)), false);
});

test('API: vizinhos por endereço (dono, CSRF, validação, espera o handshake, persiste) e estado do enlace do equipamento', async t => {
  t.after(closeAll);
  const A = await node(), B = await node();
  const HOST = 'piu-node.local:8420';
  const config: Config = { port: 8420, host: '127.0.0.1', allowedHosts: [HOST], dataDir: '/nao-usado', panelDir: '/nao-usado', releasePubKey: null };
  const pairing = new Pairing();
  const store = new Store(null);
  const app = await buildApp({ config, store, pairing, packages: [], packagesDir: '/nao-usado', relay: A });
  t.after(() => app.close());
  const headers = { host: HOST, origin: `https://${HOST}` };
  assert.equal((await app.inject({ method: 'GET', url: '/api/relay/peers', headers })).statusCode, 401);
  const pair = await app.inject({ method: 'POST', url: '/api/pair', headers, payload: { code: pairing.issue(Date.now()), name: 'Dona' } });
  const cookie = String(pair.headers['set-cookie']).split(';')[0]!;
  const csrf = (pair.json() as { csrf: string }).csrf;
  const h = { ...headers, cookie, 'x-csrf-token': csrf };

  assert.equal((await app.inject({ method: 'POST', url: '/api/relay/peers', headers: { ...headers, cookie }, payload: { address: addr(B) } })).statusCode, 403);
  for (const address of ['http://127.0.0.1:1', '127.0.0.1', '127.0.0.1:1/x']) {
    const r = await app.inject({ method: 'POST', url: '/api/relay/peers', headers: h, payload: { address } });
    assert.equal(r.statusCode, 400, address);
  }
  assert.equal((await app.inject({ method: 'POST', url: '/api/relay/peers', headers: h, payload: { address: addr(B), extra: 1 } })).statusCode, 400);

  const add = await app.inject({ method: 'POST', url: '/api/relay/peers', headers: h, payload: { address: addr(B) } });
  assert.equal(add.statusCode, 201);
  const peer = (add.json() as { peer: { state: string; nodeId: string; pk: string } }).peer;
  assert.equal(peer.state, 'connected');
  assert.equal(peer.pk, toHex(B.engine.node.pk));
  assert.deepEqual(store.relayPeers(), [addr(B)]);
  const list = (await app.inject({ method: 'GET', url: '/api/relay/peers', headers: { ...headers, cookie } })).json() as { peers: { address: string; state: string }[] };
  assert.deepEqual(list.peers.map(p => [p.address, p.state]), [[addr(B), 'connected']]);
  // O código real sai nas estatísticas do relay, igual ao do outro nó.
  await until(() => B.engine.stats().neighbors.length === 1, 'B ver A');
  const relay = (await app.inject({ method: 'GET', url: '/api/relay', headers: { ...headers, cookie } })).json() as { neighbors: { confirmCode: string }[]; lan: { peers: unknown[] } };
  assert.equal(relay.neighbors[0]!.confirmCode, B.engine.stats().neighbors[0]!.confirmCode);
  assert.equal(relay.lan.peers.length, 1);

  // Registrado com a identidade do vizinho: a página de equipamentos vê o enlace real.
  const dev = await app.inject({ method: 'POST', url: '/api/devices', headers: h, payload: { name: 'Raspberry', cls: 'Home Node', family: 'linux', nodePk: peer.pk } });
  assert.equal(dev.statusCode, 201);
  const devId = (dev.json() as { id: string }).id;
  const linkOf = async () => ((await app.inject({ method: 'GET', url: '/api/devices', headers: { ...headers, cookie } })).json() as { id: string; link?: { online: boolean; lastSeen: number | null } }[]).find(d => d.id === devId)!.link;
  assert.equal((await linkOf())!.online, true);

  // Removido pelo painel: sai da lista, do estado salvo e o enlace fecha; o equipamento fica offline com "visto por último".
  const del = await app.inject({ method: 'DELETE', url: `/api/relay/peers/${encodeURIComponent(addr(B))}`, headers: h });
  assert.equal(del.statusCode, 204);
  assert.deepEqual(store.relayPeers(), []);
  await until(() => A.engine.stats().neighbors.length === 0, 'enlace fechado');
  // B ainda pode reconectar? Não: B não tem A como vizinho fixo, e A parou de discar.
  const off = await linkOf();
  assert.equal(off!.online, false);
  assert.ok(off!.lastSeen && off!.lastSeen <= Date.now());
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/relay/peers/${encodeURIComponent(addr(B))}`, headers: h })).statusCode, 404);
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/relay/peers/${encodeURIComponent('http://x')}`, headers: h })).statusCode, 400);
});

test('API: vizinhos salvos voltam a conectar quando o nó sobe de novo', async t => {
  t.after(closeAll);
  const B = await node();
  const A = await node();
  const store = new Store(null);
  store.addRelayPeer(addr(B));
  store.addRelayPeer('nao valido');
  const HOST = 'piu-node.local:8420';
  const config: Config = { port: 8420, host: '127.0.0.1', allowedHosts: [HOST], dataDir: '/nao-usado', panelDir: '/nao-usado', releasePubKey: null };
  const app = await buildApp({ config, store, pairing: new Pairing(), packages: [], packagesDir: '/nao-usado', relay: A });
  t.after(() => app.close());
  await until(() => A.peers().length === 1 && A.peers()[0]!.state === 'connected', 'A reconectar ao vizinho salvo');
});
