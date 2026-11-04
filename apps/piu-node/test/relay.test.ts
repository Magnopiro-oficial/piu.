import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import type { Config, LnnpConfig } from '../src/config.js';
import { utf8 } from '../src/protocol/bytes.js';
import { MsgType, sealDirect } from '../src/protocol/envelope.js';
import { deriveIdentity, deriveNodeKey, type Identity, newSeed, toPublic } from '../src/protocol/keys.js';
import { LNNP_VERSION } from '../src/protocol/lnnp.js';
import { inWindow, RelayEngine, type RelayHandle, startRelay } from '../src/relay/index.js';
import { Pairing } from '../src/security/pairing.js';
import { DEFAULT_SETTINGS, type Settings, Store } from '../src/store.js';

/** Nó em localhost com portas aleatórias, sem descoberta (vizinhos fixos montam a topologia). */
function cfg(o: Partial<LnnpConfig> = {}): LnnpConfig {
  return { enabled: true, relay: true, listen: '127.0.0.1', port: 0, discoveryPort: null, broadcast: [], peers: [], memoryMB: 16, allow: null, beaconMs: 200, ...o };
}

const nodes: RelayHandle[] = [];
async function node(o: Partial<LnnpConfig> = {}, id?: Identity, settings: Settings = DEFAULT_SETTINGS) {
  const n = await startRelay(deriveNodeKey(newSeed()), cfg(o), settings, { identities: id ? [id] : [], tickMs: 100 });
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
const neighbors = (n: RelayHandle) => n.engine.stats().neighbors.length;

const person = () => deriveIdentity(newSeed(), 'public');
const letter = (from: Identity, to: Identity, text: string, extra: Partial<Parameters<typeof sealDirect>[0]> = {}) =>
  sealDirect({ from, to: toPublic(to), type: MsgType.Text, body: utf8(text), now: Math.floor(Date.now() / 1000), ...extra });

test('LAN: envelope multihop A → R1 → R2 → B por TCP, com store-and-forward até B aparecer', async t => {
  t.after(closeAll);
  const alice = person(), bob = person();
  const R2 = await node();
  const R1 = await node({ peers: [addr(R2)] });
  const A = await node({ peers: [addr(R1)] }, alice);
  await until(() => neighbors(R1) === 2 && neighbors(R2) === 1, 'A–R1–R2 conectados');
  const m = letter(alice, bob, 'oi, Bob, pela malha');
  assert.equal(A.engine.send(m.bytes).status, 'stored');
  await until(() => R2.engine.router.has(m.id), 'R2 guardar o envelope');
  // B ainda não existe: R1 e R2 guardam (store-and-forward). Agora B entra, conectado só a R2.
  const B = await node({ peers: [addr(R2)] }, bob);
  await until(() => B.engine.inbox.length === 1, 'B receber');
  assert.equal(new TextDecoder().decode(B.engine.inbox[0]!.body), 'oi, Bob, pela malha');
  assert.equal(B.engine.inbox[0]!.fromId, alice.id);
  // A e B nunca se conectaram; os relays não decifraram nada e assinaram um recibo cada.
  assert.ok(A.engine.stats().neighbors.every(x => x.id !== B.engine.stats().node));
  for (const R of [R1, R2]) {
    const s = R.engine.stats();
    assert.equal(R.engine.inbox.length, 0);
    assert.equal(s.counters.stored, 1);
    assert.ok(s.counters.forwarded >= 1);
    assert.equal(s.counters.receipts, 1);
    assert.equal(s.neighbors[0]!.version, LNNP_VERSION);
    assert.deepEqual(s.neighbors[0]!.media, ['ethernet']);
  }
  assert.ok(R1.engine.receiptLog.every(r => r.envelopeId === m.id));
});

test('LAN: deduplicação — o mesmo envelope por dois caminhos chega uma vez', async t => {
  t.after(closeAll);
  const alice = person(), bob = person();
  const R1 = await node(), R2 = await node();
  const B = await node({ peers: [addr(R1), addr(R2)] }, bob);
  const A = await node({ peers: [addr(R1), addr(R2)] }, alice);
  await until(() => neighbors(A) === 2 && neighbors(B) === 2, 'losango montado');
  const m = letter(alice, bob, 'uma vez só');
  A.engine.send(m.bytes);
  await until(() => B.engine.stats().counters.received >= 2, 'B receber pelos dois caminhos');
  const s = B.engine.stats().counters;
  assert.equal(B.engine.inbox.length, 1);
  assert.equal(s.delivered, 1);
  assert.equal(s.duplicates, 1);
  // Cada relay guardou uma vez; nenhum recebeu o envelope de volta (não devolve a quem mandou).
  for (const R of [R1, R2]) assert.equal(R.engine.stats().counters.stored, 1);
});

test('LAN: nó com a retransmissão desligada não guarda nem repassa envelopes de terceiros', async t => {
  t.after(closeAll);
  const alice = person(), bob = person();
  const R = await node({ relay: false });
  const B = await node({ peers: [addr(R)] }, bob);
  const A = await node({ peers: [addr(R)] }, alice);
  await until(() => neighbors(R) === 2 && neighbors(A) === 1 && neighbors(B) === 1, 'R conectado aos dois');
  // O vizinho fica sabendo pelo handshake que R não retransmite.
  assert.equal(A.engine.stats().neighbors[0]!.relay, false);
  const m = letter(alice, bob, 'não vai passar');
  A.engine.send(m.bytes);
  await until(() => R.engine.stats().counters.received === 1, 'R receber');
  await new Promise(r => setTimeout(r, 300));
  const s = R.engine.stats();
  assert.equal(s.counters.relayOff, 1);
  assert.equal(s.counters.stored, 0);
  assert.equal(s.store.envelopes, 0);
  assert.equal(R.engine.router.has(m.id), false);
  assert.equal(B.engine.inbox.length, 0);
});

test('LAN: descoberta por anúncio UDP conecta dois nós sem vizinhos fixos', async t => {
  t.after(closeAll);
  const A = await node({ discoveryPort: 0 });
  const B = await node({ discoveryPort: 0 });
  // Em localhost não há broadcast: cada um anuncia direto na porta de descoberta do outro.
  A.lan.setBroadcast([`127.0.0.1:${B.discoveryPort}`]);
  B.lan.setBroadcast([`127.0.0.1:${A.discoveryPort}`]);
  await until(() => neighbors(A) === 1 && neighbors(B) === 1, 'descoberta e handshake');
  await new Promise(r => setTimeout(r, 500)); // várias rodadas de anúncio: nada de conexão dupla
  assert.equal(neighbors(A), 1);
  assert.equal(neighbors(B), 1);
  assert.equal(A.engine.stats().neighbors[0]!.id, B.engine.stats().node);
});

test('LAN: vizinhos fixos dos dois lados ficam com um enlace só', async t => {
  t.after(closeAll);
  const A = await node();
  const B = await node({ peers: [addr(A)] });
  A.lan.setPeers([addr(B)]);
  await until(() => neighbors(A) === 1 && neighbors(B) === 1, 'enlace');
  await new Promise(r => setTimeout(r, 600));
  assert.equal(neighbors(A), 1);
  assert.equal(neighbors(B), 1);
});

test('LAN: conexão que não fala LNNP, ou nó fora da lista permitida, é recusada', async t => {
  t.after(closeAll);
  const R = await node();
  const sock = connect({ host: '127.0.0.1', port: R.port });
  sock.resume(); // descarta o HELLO do nó; sem ler, o 'close' nunca chega
  await new Promise<void>(res => sock.once('connect', () => res()));
  sock.write(Buffer.from('GET / HTTP/1.1\r\nHost: x\r\n\r\n'));
  await new Promise<void>(res => sock.once('close', () => res()));
  await until(() => R.engine.stats().counters.handshakesFailed >= 1, 'falha contada');
  assert.equal(neighbors(R), 0);

  const outsider = await node();
  const closed = await node({ allow: ['00'.repeat(32)], peers: [addr(outsider)] });
  await until(() => closed.engine.stats().counters.handshakesFailed >= 1, 'recusa por autorização');
  assert.equal(neighbors(closed), 0);
});

test('limites do operador ligados ao roteador: armazenamento, horário, banda e mídia', () => {
  let clock = new Date(2026, 10, 2, 12, 0, 0).getTime(); // meio-dia, hora local
  const e = new RelayEngine({ node: deriveNodeKey(newSeed()), relay: true, memoryBytes: 64 * 1024 ** 3, now: () => clock });
  const settings = (limits: Partial<Settings['limits']>, media = true): Settings => ({ limits: { ...DEFAULT_SETTINGS.limits, ...limits }, policies: { ...DEFAULT_SETTINGS.policies, media } });
  e.applySettings(settings({ sto: 4 }));
  assert.equal(e.router.limits.maxBytes, 4 * 1024 ** 3);
  // O teto de memória do nó vale mais que o armazenamento do painel.
  const small = new RelayEngine({ node: deriveNodeKey(newSeed()), relay: true, memoryBytes: 16 * 1024 ** 2 });
  small.applySettings(settings({ sto: 16 }));
  assert.equal(small.router.limits.maxBytes, 16 * 1024 ** 2);
  // Horário: só à noite → ao meio-dia não retransmite; às 23h, sim (rodada periódica).
  e.applySettings(settings({ hours: 'night' }));
  assert.equal(e.relaying, false);
  assert.equal(e.caps().relay, false);
  clock = new Date(2026, 10, 2, 23, 0, 0).getTime();
  e.tick();
  assert.equal(e.relaying, true);
  assert.equal(inWindow('day', new Date(2026, 10, 2, 9).getTime()), true);
  assert.equal(inWindow('day', new Date(2026, 10, 2, 19).getTime()), false);
  // Banda: o painel fala em Mbps; o balde do motor em bytes por segundo.
  e.applySettings(settings({ bw: 20 }));
  assert.equal(e.stats().limits.bwMbps, 20);
  assert.equal((e as unknown as { rate(): number }).rate(), 2_500_000);
  // Mídia desligada: envelope marcado como mídia de terceiro é recusado sem guardar.
  e.applySettings(settings({}, false));
  const alice = person(), bob = person();
  const media = letter(alice, bob, 'foto', { bulk: true, now: Math.floor(clock / 1000) });
  const fake = { id: 'x#1', session: { peerId: 'vizinho', peerPk: new Uint8Array(32), maxFrame: 65000, version: 1, peerCaps: { relay: true, media: 0 }, negotiated: { features: 0, mtu: 65000 }, seal: () => new Uint8Array(1) }, medium: 'eth', inbound: true, address: '', since: 0, send() {}, close() {} };
  (e as unknown as { links: Map<string, unknown> }).links.set('x#1', fake);
  e.receive('x#1', { type: 0x10, body: media.bytes });
  assert.equal(e.stats().counters.rejected, 1);
  assert.equal(e.router.has(media.id), false);
  const text = letter(alice, bob, 'texto', { now: Math.floor(clock / 1000) });
  e.receive('x#1', { type: 0x10, body: text.bytes });
  assert.equal(e.router.has(text.id), true);
});

test('API: GET /api/relay exige sessão e mostra as estatísticas reais; PUT /api/settings aplica no roteador', async t => {
  t.after(closeAll);
  const R = await node();
  const HOST = 'piu-node.local:8420';
  const config: Config = { port: 8420, host: '127.0.0.1', allowedHosts: [HOST], dataDir: '/nao-usado', panelDir: '/nao-usado', releasePubKey: null };
  const pairing = new Pairing();
  const store = new Store(null);
  const app = await buildApp({ config, store, pairing, packages: [], packagesDir: '/nao-usado', relay: R });
  t.after(() => app.close());
  const headers = { host: HOST, origin: `https://${HOST}` };
  assert.equal((await app.inject({ method: 'GET', url: '/api/relay', headers })).statusCode, 401);
  const pair = await app.inject({ method: 'POST', url: '/api/pair', headers, payload: { code: pairing.issue(Date.now()), name: 'Dona' } });
  const cookie = String(pair.headers['set-cookie']).split(';')[0]!;
  const csrf = (pair.json() as { csrf: string }).csrf;
  const r = await app.inject({ method: 'GET', url: '/api/relay', headers: { ...headers, cookie } });
  assert.equal(r.statusCode, 200);
  const s = r.json() as { enabled: boolean; relaying: boolean; lnnp: { version: number }; neighbors: unknown[]; counters: Record<string, number>; store: { envelopes: number } };
  assert.equal(s.enabled, true);
  assert.equal(s.lnnp.version, LNNP_VERSION);
  assert.deepEqual(Object.keys(s.counters).sort(), ['delivered', 'duplicates', 'expired', 'forwarded', 'full', 'handshakesFailed', 'handshakesOk', 'received', 'receipts', 'receiptsReceived', 'rejected', 'relayOff', 'revokedRefused', 'stored'].sort());
  // Nada de chave secreta nem conteúdo na resposta.
  assert.equal(r.body.includes('"sk"'), false);
  const put = await app.inject({ method: 'PUT', url: '/api/settings', headers: { ...headers, cookie, 'x-csrf-token': csrf }, payload: { limits: { bw: 20, sto: 4, hours: 'always' }, policies: { media: false, unknown: true, community: false } } });
  assert.equal(put.statusCode, 200, put.body);
  assert.equal(R.engine.router.limits.maxBytes, 16 * 1024 ** 2); // teto de memória do teste (16 MiB) < 4 GB
  assert.deepEqual(R.engine.stats().limits, { bwMbps: 20, stoGB: 4, hours: 'always', media: false, device: null, operator: null, effective: { bwMbps: 20, stoGB: 4, hours: ['always'] } });
});
