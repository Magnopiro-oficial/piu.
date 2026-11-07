/**
 * Correções da auditoria de 06/11/2026 (docs/seguranca/auditoria-2026-11-06/node-settlement.md):
 * A-02 (discagens por anúncio UDP), M-01 (recibos próprios), M-02 (state.json), M-03 (código fora do
 * log), M-04 (vagas de handshake), B-02 (scrypt), B-03 (lastSeen), B-05 (touchSession) e a sessão
 * local do app desktop (provider.md M-01). Nenhuma muda o fio: anúncios, quadros e recibos são os mesmos.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { connect, createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import type { Config, LnnpConfig } from '../src/config.js';
import { OperatorVault } from '../src/operator.js';
import { deriveNodeKey, newSeed } from '../src/protocol/keys.js';
import { encodeBeacon, encodeReceipt, FrameType, LNNP_MIN_VERSION, LNNP_VERSION } from '../src/protocol/lnnp.js';
import { makeRelayReceipt, type RelayReceipt } from '../src/protocol/receipts.js';
import { RelayEngine, type RelayHandle, startRelay } from '../src/relay/index.js';
import { pairingCodeOutput } from '../src/security/codeDisplay.js';
import { Pairing } from '../src/security/pairing.js';
import { DEFAULT_SETTINGS, Store } from '../src/store.js';

function cfg(o: Partial<LnnpConfig> = {}): LnnpConfig {
  return { enabled: true, relay: true, listen: '127.0.0.1', port: 0, discoveryPort: null, broadcast: [], peers: [], memoryMB: 16, allow: null, beaconMs: 200, ...o };
}
const nodes: RelayHandle[] = [];
async function node(o: Partial<LnnpConfig> = {}, extra: { maxLinks?: number } = {}) {
  const n = await startRelay(deriveNodeKey(newSeed()), cfg(o), DEFAULT_SETTINGS, { tickMs: 100, handshakeTimeoutMs: 1500, ...extra });
  nodes.push(n);
  return n;
}
const servers: Server[] = [];
const socks: Socket[] = [];
const closeAll = async () => {
  for (const s of socks.splice(0)) s.destroy();
  await Promise.all(servers.splice(0).map(s => new Promise<void>(r => s.close(() => r()))));
  await Promise.all(nodes.splice(0).map(n => n.close()));
};
async function until(cond: () => boolean, what: string, ms = 5000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`Tempo esgotado esperando: ${what}`);
    await new Promise(r => setTimeout(r, 20));
  }
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** Id de envelope (16 bytes em hex) com prefixo, para separar os grupos de recibos no teste. */
const hid = (prefix: string, i: number) => prefix + i.toString(16).padStart(32 - prefix.length, '0');

/** Acesso de teste ao que o adapter LAN faz com um anúncio (sem precisar de outra máquina na rede). */
type LanInternals = { onBeacon(msg: Buffer, address: string): void; outbound: Map<string, unknown> };
/** Anúncio forjado: etiqueta máxima (maior que a de qualquer nó real), então quem recebe disca (o de etiqueta menor conecta). */
const beacon = (port: number) => Buffer.from(encodeBeacon({ minVersion: LNNP_MIN_VERSION, maxVersion: LNNP_VERSION, port, tag: new Uint8Array(8).fill(0xff), relay: true }));

/** Servidor TCP que conta conexões e fecha cada uma na hora (o handshake falha do lado de quem discou). */
async function rudeServer() {
  let count = 0;
  const s = createServer(sock => { count++; sock.destroy(); });
  await new Promise<void>(r => s.listen(0, '127.0.0.1', () => r()));
  servers.push(s);
  const a = s.address();
  return { port: typeof a === 'object' && a ? a.port : 0, count: () => count };
}

test('A-02: anúncios forjados de um mesmo IP disparam no máximo uma discagem por período', async t => {
  t.after(closeAll);
  const R = await node({ discoveryPort: 0, beaconMs: 60_000 });
  const lan = R.lan as unknown as LanInternals;
  for (let p = 40_001; p <= 40_050; p++) lan.onBeacon(beacon(p), '127.0.0.1');
  assert.ok(lan.outbound.size <= 1, `discou ${lan.outbound.size} vezes para o mesmo IP`);
});

test('A-02: anúncios de muitos IPs param no teto global de discagens de descoberta', async t => {
  t.after(closeAll);
  const R = await node({ discoveryPort: 0, beaconMs: 60_000 });
  const lan = R.lan as unknown as LanInternals;
  for (let i = 2; i < 102; i++) lan.onBeacon(beacon(40_000 + i), `127.0.${Math.floor(i / 250)}.${i % 250}`);
  assert.ok(lan.outbound.size <= 8, `${lan.outbound.size} discagens abertas ao mesmo tempo`);
});

test('A-02: discagem de descoberta que falha espera mais antes de tentar o mesmo IP (backoff)', async t => {
  t.after(closeAll);
  const R = await node({ discoveryPort: 0, beaconMs: 200 });
  const lan = R.lan as unknown as LanInternals;
  const rude = await rudeServer();
  lan.onBeacon(beacon(rude.port), '127.0.0.1');
  await until(() => rude.count() === 1 && lan.outbound.size === 0, 'primeira discagem falhar');
  await sleep(300); // passou um período de anúncio, mas ainda dentro do backoff
  lan.onBeacon(beacon(rude.port), '127.0.0.1');
  await sleep(100);
  assert.equal(rude.count(), 1, 'redisca cedo demais depois de uma falha');
  await sleep(1200);
  lan.onBeacon(beacon(rude.port), '127.0.0.1');
  await until(() => rude.count() === 2, 'volta a discar depois do backoff');
});

test('M-04: conexões que entram e não falam LNNP não tiram as vagas das discagens deste nó', async t => {
  t.after(closeAll);
  const R = await node();
  const B = await node();
  // 20 conexões "meio HELLO" (slowloris): recebem o HELLO do nó e nunca respondem.
  for (let i = 0; i < 20; i++) { const s = connect({ host: '127.0.0.1', port: R.port }); s.on('error', () => {}); s.resume(); socks.push(s); }
  await sleep(150);
  R.addPeer(`127.0.0.1:${B.port}`);
  await until(() => R.engine.linkCount === 1, 'enlace com o vizinho fixo apesar das conexões penduradas', 1400);
});

test('M-04: teto de handshakes pendentes por IP de origem', async t => {
  t.after(closeAll);
  const R = await node();
  let closed = 0;
  for (let i = 0; i < 8; i++) {
    const s = connect({ host: '127.0.0.1', port: R.port });
    s.on('error', () => {}); s.resume(); s.once('close', () => closed++); socks.push(s);
  }
  await sleep(500); // bem antes do tempo de handshake (1,5 s)
  assert.ok(closed >= 4, `só ${closed} de 8 conexões do mesmo IP foram recusadas`);
});

test('M-04: no teto de enlaces, um vizinho fixo entra no lugar de um enlace anônimo', async t => {
  t.after(closeAll);
  const R = await node({}, { maxLinks: 1 });
  const X = await node(), B = await node();
  X.addPeer(`127.0.0.1:${R.port}`); // anônimo: X conectou em R
  await until(() => R.engine.linkCount === 1, 'X conectado');
  R.addPeer(`127.0.0.1:${B.port}`);
  await until(() => R.engine.hasPeer(B.engine.stats().node), 'vizinho fixo conectado');
  assert.equal(R.engine.linkCount, 1);
  assert.equal(R.engine.hasPeer(X.engine.stats().node), false);
});

test('M-01: recibos de vizinhos não expulsam os recibos assinados por este nó', () => {
  const me = deriveNodeKey(newSeed()), other = deriveNodeKey(newSeed());
  const e = new RelayEngine({ node: me, relay: true, memoryBytes: 1 << 20 });
  const at = Math.floor(Date.now() / 1000);
  const own = Array.from({ length: 30 }, (_, i) => makeRelayReceipt(me, `own-${i}`, new Uint8Array(16).fill(1), at));
  const foreign = Array.from({ length: 1500 }, (_, i) => makeRelayReceipt(other, `x-${i}`, new Uint8Array(16).fill(2), at));
  e.importState({ envelopes: [], seen: [], receipts: [...own, ...foreign] });
  const kept = e.receiptLog;
  assert.equal(kept.filter(r => r.envelopeId.startsWith('own-')).length, 30, 'todos os próprios ficaram');
  assert.ok(kept.filter(r => r.envelopeId.startsWith('x-')).length <= 1000);
  assert.equal(e.receiptsView().keptOwn, 30);
});

test('M-01: um vizinho que despeja recibos autoassinados é limitado por enlace e não apaga os próprios', async t => {
  t.after(closeAll);
  const R = await node(), A = await node();
  const at = Math.floor(Date.now() / 1000);
  R.engine.importState({ envelopes: [], seen: [], receipts: Array.from({ length: 5 }, (_, i) => makeRelayReceipt(R.engine.node, hid('aa', i), new Uint8Array(16).fill(1), at)) });
  A.addPeer(`127.0.0.1:${R.port}`);
  await until(() => A.engine.linkCount === 1 && R.engine.linkCount === 1, 'A–R conectados');
  const link = [...(A.engine as unknown as { links: Map<string, { send(b: Uint8Array): void; session: { seal(t: number, b: Uint8Array): Uint8Array } }> }).links.values()][0]!;
  const sybil = deriveNodeKey(newSeed());
  for (let i = 0; i < 800; i++) {
    const rc: RelayReceipt = makeRelayReceipt(sybil, hid('bb', i), new Uint8Array(16).fill(3), at);
    link.send(link.session.seal(FrameType.RelayReceipt, encodeReceipt(rc)));
  }
  await until(() => R.engine.counters.receiptsReceived + R.engine.counters.rejected >= 800, 'R processar os quadros', 8000);
  const kept = R.engine.receiptLog;
  assert.equal(kept.filter(r => r.envelopeId.startsWith('aa')).length, 5);
  assert.ok(R.engine.counters.receiptsReceived <= 600, `aceitou ${R.engine.counters.receiptsReceived} recibos de um enlace num minuto`);
});

test('M-02: state.json ilegível não vira estado vazio: o nó recusa subir e guarda o arquivo de lado', () => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-state-'));
  try {
    const s = new Store(dir);
    s.addOperator('Dono', 1);
    assert.ok(existsSync(join(dir, 'state.json')));
    // Uma segunda subida com o arquivo bom guarda uma cópia (restaurável).
    new Store(dir);
    assert.ok(existsSync(join(dir, 'state.json.bak')), 'cópia do último estado bom');
    assert.equal(statSync(join(dir, 'state.json.bak')).mode & 0o777, 0o600);
    for (const bad of ['', '{"operators": [', '\0\0\0\0']) {
      writeFileSync(join(dir, 'state.json'), bad);
      assert.throws(() => new Store(dir), /state\.json/);
      assert.equal(existsSync(join(dir, 'state.json')), false, 'o corrompido sai do lugar');
      const aside = readdirSync(dir).filter(f => f.startsWith('state.json.corrompido-'));
      assert.ok(aside.length >= 1);
      assert.ok(aside.some(f => readFileSync(join(dir, f), 'utf8') === bad), 'o conteúdo original é preservado');
      // Restaurar a cópia: volta com o dono.
      writeFileSync(join(dir, 'state.json'), readFileSync(join(dir, 'state.json.bak')));
      assert.equal(new Store(dir).operatorByName('Dono')?.name, 'Dono');
    }
    // Pasta nova (sem state.json): começa vazio, como antes.
    const fresh = mkdtempSync(join(tmpdir(), 'piu-state-'));
    assert.equal(new Store(fresh).owner(), null);
    rmSync(fresh, { recursive: true, force: true });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('M-02: o estado é gravado de forma atômica (sem .tmp sobrando, 0600)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-state-'));
  try {
    const s = new Store(dir);
    s.addOperator('Dono', 1);
    assert.equal(existsSync(join(dir, 'state.json.tmp')), false);
    assert.equal(statSync(join(dir, 'state.json')).mode & 0o777, 0o600);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('M-03: sem terminal (serviço), o código não vai para o stdout; vai para um arquivo 0600', () => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-code-'));
  try {
    let out = '';
    const show = pairingCodeOutput({ tty: false, dataDir: dir, write: s => { out += s; } });
    show('Para entrar no painel, use este código:', '12345678');
    assert.ok(!out.includes('12345678') && !out.includes('1234 5678'), 'código no log');
    const file = join(dir, 'pairing-code');
    assert.ok(out.includes(file), 'o log diz onde ler o código');
    assert.equal(readFileSync(file, 'utf8').trim(), '12345678');
    assert.equal(statSync(file).mode & 0o777, 0o600);
    // Código novo (o anterior foi usado): o arquivo acompanha.
    show('Código usado. Novo código para o próximo pareamento:', '87654321');
    assert.equal(readFileSync(file, 'utf8').trim(), '87654321');
    assert.ok(!out.includes('87654321'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('M-03: no terminal interativo, o código continua aparecendo na tela', () => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-code-'));
  try {
    let out = '';
    pairingCodeOutput({ tty: true, dataDir: dir, write: s => { out += s; } })('Para entrar no painel, use este código:', '12345678');
    assert.ok(out.includes('1234 5678'));
    assert.equal(existsSync(join(dir, 'pairing-code')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('B-02: backup com scrypt N acima de 2^17 é recusado antes de derivar (sem 1 GiB de RAM)', async () => {
  const v = new OperatorVault(null);
  v.ensure('op', 1);
  const backup = JSON.parse(await v.backup('op', 'Dono', 'senha-boa-123', 1, { N: 1 << 14 })) as { kdf: { N: number } };
  backup.kdf.N = 1 << 18; // 256 MiB: antes era aceito e derivado
  await assert.rejects(v.restore('op', JSON.stringify(backup), 'senha-boa-123'), /Parâmetros do backup/);
});

test('B-03: o mapa de "visto por último" não cresce sem limite com identidades novas', () => {
  const e = new RelayEngine({ node: deriveNodeKey(newSeed()), relay: true, memoryBytes: 1 << 20 });
  const seen = (e as unknown as { lastSeen: Map<string, number> }).lastSeen;
  const pk = deriveNodeKey(newSeed()).pk;
  const fakeLink = (i: number) => ({
    id: `l${i}`, medium: 'eth', inbound: true, address: 'x', since: 0, send() {}, close() {},
    session: { peerId: `peer-${i}`, peerPk: pk, peerCaps: { relay: true, media: 0 }, negotiated: { features: 0, mtu: 1000 }, maxFrame: 1000, version: 1, seal: () => new Uint8Array() },
  });
  for (let i = 0; i < 5000; i++) { const l = fakeLink(i); e.attach(l as never); e.detach(l.id); }
  assert.ok(seen.size <= 4096, `lastSeen com ${seen.size} entradas`);
  assert.ok(seen.has('peer-4999'), 'o mais recente fica');
});

test('B-05: requisições seguidas não regravam o state.json a cada vez', () => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-touch-'));
  try {
    const s = new Store(dir);
    const op = s.addOperator('Dono', 1);
    s.addSession({ tokenHash: 'h', operatorId: op.id, csrf: 'c', createdAt: 1000, lastSeen: 1000, authAt: 1000, id: 'i', label: 'x' });
    const file = join(dir, 'state.json');
    const before = readFileSync(file, 'utf8');
    s.touchSession('h', 1000 + 5_000);
    assert.equal(readFileSync(file, 'utf8'), before, 'gravou de novo 5 s depois');
    assert.equal(s.sessionByHash('h')!.lastSeen, 6_000, 'em memória, o horário é o de agora');
    s.touchSession('h', 1000 + 61_000);
    assert.notEqual(readFileSync(file, 'utf8'), before, 'grava pelo menos uma vez por minuto');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── sessão local do app desktop (provider.md M-01) ─────────────────────────
const HOST = 'piu-node.local:8420';
async function appSetup() {
  const dir = mkdtempSync(join(tmpdir(), 'piu-local-'));
  const panelDir = join(dir, 'panel');
  execFileSync('mkdir', ['-p', panelDir]);
  writeFileSync(join(panelDir, 'index.html'), '<!doctype html><title>painel</title>');
  const config: Config = { port: 8420, host: '127.0.0.1', allowedHosts: [HOST], dataDir: dir, panelDir, releasePubKey: null };
  const pairing = new Pairing();
  const store = new Store(null);
  const app = await buildApp({ config, store, pairing, packages: [], packagesDir: dir, selfDevice: { name: 'Nó de teste', cls: 'Home Node' } });
  return { app, pairing, store, cleanup: async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('sessão local (app desktop): abre sem código, não consome o código vigente e não vale como step-up', async () => {
  const t = await appSetup();
  try {
    const code = t.pairing.issue(Date.now());
    const s = t.app.piuLocalSession('Lucas', 'App Piu Provider · macOS');
    assert.match(s.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(t.pairing.active, true, 'o código mostrado em Nó → Mostrar código continua válido');
    const cookie = `__Host-piu_session=${s.token}`;
    const r = await t.app.inject({ method: 'GET', url: '/api/session', headers: { host: HOST, cookie } });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().operator.name, 'Lucas');
    assert.equal(r.json().stepUpValidMs, 0, 'sessão local não traz step-up: operações sensíveis pedem o código');
    // Mesmo nome: mesma conta (como o pareamento por código).
    const again = t.app.piuLocalSession('lucas', 'App Piu Provider · macOS');
    const r2 = await t.app.inject({ method: 'GET', url: '/api/session', headers: { host: HOST, cookie: `__Host-piu_session=${again.token}` } });
    assert.equal(r2.json().operator.id, r.json().operator.id);
    // O step-up continua pelo código do equipamento.
    const re = await t.app.inject({
      method: 'POST', url: '/api/reauth', payload: { code },
      headers: { host: HOST, cookie, origin: `https://${HOST}`, 'x-csrf-token': s.csrf, 'content-type': 'application/json' },
    });
    assert.equal(re.statusCode, 200);
    assert.ok((await t.app.inject({ method: 'GET', url: '/api/session', headers: { host: HOST, cookie } })).json().stepUpValidMs > 0);
    // Não existe rota HTTP para isto.
    for (const url of ['/api/local-session', '/api/session/local']) {
      assert.notEqual((await t.app.inject({ method: 'POST', url, headers: { host: HOST, origin: `https://${HOST}` } })).statusCode, 200);
    }
  } finally { await t.cleanup(); }
});
