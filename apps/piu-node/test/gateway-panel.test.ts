/**
 * Gateway pelo painel (Piu 12 · E3): ligar/desligar e a caixa do validador vivem no estado do nó (não só
 * no env), mudam sem reiniciar, exigem dono + step-up + CSRF, e o painel lê contadores e cargas reais.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildApp, inboxUrlProblem } from '../src/app.js';
import type { Config, LnnpConfig } from '../src/config.js';
import { buildTransferKeepAlive, IMMORTAL_PERIOD } from '../src/lunes/extrinsic.js';
import { extrinsicHash, LunesRpc } from '../src/lunes/lunesRpc.js';
import { withWalletKey } from '../src/lunes/walletKey.js';
import { CarryChain, CarryKind, sealCarry } from '../src/protocol/carry.js';
import { deriveNodeKey, newSeed } from '../src/protocol/keys.js';
import { type RelayHandle, startRelay } from '../src/relay/index.js';
import { Pairing } from '../src/security/pairing.js';
import { STEP_UP_MS } from '../src/security/session.js';
import { DEFAULT_SETTINGS, Store } from '../src/store.js';
import { ALICE_57, fakeConnect, substrate } from './lunes-fake.js';
import { DEV_MNEMONIC } from './wallet-fixture.js';

const HOST = 'piu-node.local:8420';
const ORIGIN = `https://${HOST}`;
const GENESIS = '0xb9926ab2c88b882cad89f1393fcf74ee90d40ef98ae99080b08289036c61efac';

async function until(cond: () => boolean, what: string, ms = 6000) {
  const end = Date.now() + ms;
  while (!cond()) { if (Date.now() > end) throw new Error(`Tempo esgotado esperando: ${what}`); await new Promise(r => setTimeout(r, 20)); }
}
const signed = (nonce = 3) => withWalletKey(DEV_MNEMONIC.split(' '), key => buildTransferKeepAlive(key, {
  dest: ALICE_57, value: 100_000_000n,
  ctx: { specVersion: 107, transactionVersion: 2, genesisHash: GENESIS, blockHash: GENESIS, blockNumber: 1000, nonce, tip: 0n, period: IMMORTAL_PERIOD },
}));
function lunes() {
  const chain = { finalized: 1000, storage: {}, extrinsics: {} as Record<number, string[]> };
  const s = substrate(chain);
  const { connect } = fakeConnect(s.handle, []);
  return { chain, s, rpc: () => new LunesRpc({ endpoints: ['ws://lunes-falsa'], connect, timeoutMs: 200 }) };
}
const cfg = (o: Partial<LnnpConfig> = {}): LnnpConfig => ({ enabled: true, relay: true, listen: '127.0.0.1', port: 0, discoveryPort: null, broadcast: [], peers: [], memoryMB: 16, allow: null, beaconMs: 200, gateway: true, ...o });

test('caixa do validador: só https com servidor, sem usuário/senha, sem espaços', () => {
  assert.equal(inboxUrlProblem('https://validador.example/caixa'), null);
  assert.match(inboxUrlProblem('http://validador.example/caixa')!, /https/);
  assert.match(inboxUrlProblem('https://user:senha@validador.example/')!, /usuário/);
  assert.match(inboxUrlProblem('https://valida dor.example/')!, /espaços/);
  assert.match(inboxUrlProblem('javascript:alert(1)')!, /https/);
  assert.ok(inboxUrlProblem(''));
  assert.ok(inboxUrlProblem(`https://x.example/${'a'.repeat(600)}`));
  assert.ok(inboxUrlProblem(42));
});

test('gateway ligado/desligado e caixa mudam sem reiniciar; cargas aparecem com o estado real', async t => {
  const L = lunes();
  let enabled = false;
  let inbox: string | null = null;
  const G: RelayHandle = await startRelay(deriveNodeKey(newSeed()), cfg(), DEFAULT_SETTINGS, {
    tickMs: 100, gateway: { rpc: L.rpc, probeMs: 100, tickMs: 100, enabled: () => enabled, inboxUrl: () => inbox },
  });
  const P: RelayHandle = await startRelay(deriveNodeKey(newSeed()), cfg({ peers: [`127.0.0.1:${G.port}`], gateway: false }), DEFAULT_SETTINGS, { tickMs: 100 });
  t.after(async () => { await P.close(); await G.close(); });
  const g = G.gateway!;
  // Desligado: nem consulta a Lunes, não pega carga.
  assert.equal(await g.probe(), false);
  assert.deepEqual(g.roles(), { tx: false, inbox: false });
  assert.equal(g.stats().online, false);
  // Caixa nova vale na hora (mas só com o gateway ligado).
  inbox = 'https://validador.example/caixa';
  assert.equal(g.roles().inbox, false);
  enabled = true;
  assert.equal(await g.probe(), true);
  assert.deepEqual(g.roles(), { tx: true, inbox: true });
  inbox = null;
  assert.equal(g.roles().inbox, false);

  await until(() => G.engine.stats().neighbors.length === 1, 'P–G conectados');
  const tx = signed();
  const c = sealCarry({ item: { kind: CarryKind.Tx, chain: CarryChain.LunesMainnet, extrinsic: tx.extrinsic }, now: Math.floor(Date.now() / 1000) });
  P.engine.send(c.bytes);
  await until(() => L.s.submitted.length === 1, 'gateway enviar à Lunes');
  await until(() => g.recent().some(x => x.status === 'pool'), 'carga aparecer como enviada');
  const r = g.recent()[0]!;
  assert.equal(r.kind, 'tx');
  assert.equal(r.ref, extrinsicHash(tx.extrinsic), 'referência = hash da transação (o mesmo que a Lunes mostra)');
  assert.equal(r.reason, null);
  assert.equal(g.stats().submitted + g.stats().pool, 1);
  // Desligado de novo: a próxima carga não é pega (segue como envelope de terceiros).
  enabled = false;
  assert.deepEqual(g.roles(), { tx: false, inbox: false });
  const c2 = sealCarry({ item: { kind: CarryKind.Tx, chain: CarryChain.LunesMainnet, extrinsic: signed(4).extrinsic }, now: Math.floor(Date.now() / 1000) });
  P.engine.send(c2.bytes);
  await until(() => G.engine.router.has(c2.id), 'G guardar como envelope de terceiros');
  assert.equal(L.s.submitted.length, 1);
  assert.equal(g.recent().length, 1);
});

/** Nó de teste com um gateway falso (contadores e lista controlados) e relógio controlável. */
async function setup(o: { gateway?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'piu-node-gw-'));
  mkdirSync(join(dir, 'panel'));
  writeFileSync(join(dir, 'panel', 'index.html'), '<!doctype html><title>painel</title>');
  const config: Config = { port: 8420, host: '127.0.0.1', allowedHosts: [HOST], dataDir: dir, panelDir: join(dir, 'panel'), releasePubKey: null, lnnp: { ...cfg(), inboxUrl: null } };
  let clock = 1_800_000_000_000;
  const pairing = new Pairing();
  const store = new Store(dir);
  let probes = 0;
  const fake = {
    stats: () => ({ online: true, inbox: !!store.gatewaySettings({ enabled: true, inboxUrl: null }).inboxUrl, queued: 2, submitted: 120, pool: 8, invalid: 2, rejected: 1, forwarded: 4, finalized: 100, errors: 0, tracked: 3 }),
    recent: () => [{ ref: `0x${'8e41'.padEnd(64, '0')}`, kind: 'tx', status: 'queued', reason: null, at: 1_800_000_000 }, { ref: `0x${'c3d4'.padEnd(64, '1')}`, kind: 'tx', status: 'invalid', reason: 'saldo', at: 1_799_999_000 }],
    probe: async () => { probes++; return true; },
  };
  const relay = { stats: () => ({ startedAt: 1_799_000_000_000 }), applySettings() {}, gateway: o.gateway === false ? null : fake };
  const app = await buildApp({ config, store, pairing, packages: [], packagesDir: dir, now: () => clock, relay, selfDevice: { name: 'Nó', cls: 'Home Node' } });
  const req = (method: string, url: string, h: { cookie?: string; csrf?: string; origin?: string | null; body?: unknown } = {}) => app.inject({
    method: method as 'GET', url, payload: h.body as object | undefined,
    headers: { host: HOST, ...(h.origin === null ? {} : { origin: h.origin ?? ORIGIN }), ...(h.cookie ? { cookie: h.cookie } : {}), ...(h.csrf ? { 'x-csrf-token': h.csrf } : {}) },
  });
  const pair = async (name: string) => {
    const r = await req('POST', '/api/pair', { body: { code: pairing.issue(clock), name } });
    assert.equal(r.statusCode, 200, r.body);
    return { cookie: String(r.headers['set-cookie']).split(';')[0]!, csrf: (r.json() as { csrf: string }).csrf };
  };
  return { app, req, pair, store, pairing, dir, probes: () => probes, advance: (ms: number) => { clock += ms; }, clock: () => clock, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('GET /api/gateway: só com sessão; contadores e cargas reais do gateway; padrão vem da configuração', async t => {
  const s = await setup();
  t.after(s.cleanup);
  assert.equal((await s.req('GET', '/api/gateway')).statusCode, 401);
  const a = await s.pair('Lucas');
  const r = await s.req('GET', '/api/gateway', { cookie: a.cookie });
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers['cache-control'], 'no-store');
  const j = r.json() as { available: boolean; enabled: boolean; online: boolean; inboxUrl: string | null; counters: Record<string, number>; recent: { status: string; reason: string | null }[]; changedAt: number | null };
  assert.equal(j.available, true);
  assert.equal(j.enabled, true, 'sem ajuste salvo: PIU_GATEWAY (ligado de fábrica)');
  assert.equal(j.inboxUrl, null);
  assert.equal(j.changedAt, null);
  assert.deepEqual(j.counters, { sent: 128, finalized: 100, refused: 3, queued: 2, forwarded: 4, errors: 0 });
  assert.deepEqual(j.recent.map(x => [x.status, x.reason]), [['queued', null], ['invalid', 'saldo']]);
});

test('PUT /api/gateway: CSRF, mesma origem, dono e step-up; https só; grava no estado do nó e sonda na hora', async t => {
  const s = await setup();
  t.after(s.cleanup);
  const owner = await s.pair('Lucas');
  const body = { enabled: false, inboxUrl: 'https://validador.example/caixa' };
  // Sem CSRF / outra origem: recusado antes de ler o corpo.
  assert.equal((await s.req('PUT', '/api/gateway', { cookie: owner.cookie, body })).statusCode, 403);
  assert.equal((await s.req('PUT', '/api/gateway', { cookie: owner.cookie, csrf: owner.csrf, origin: 'https://evil.example', body })).statusCode, 403);
  // Campo a mais, tipo errado: 400.
  assert.equal((await s.req('PUT', '/api/gateway', { cookie: owner.cookie, csrf: owner.csrf, body: { ...body, extra: 1 } })).statusCode, 400);
  assert.equal((await s.req('PUT', '/api/gateway', { cookie: owner.cookie, csrf: owner.csrf, body: { enabled: 'sim', inboxUrl: null } })).statusCode, 400);
  // http e credenciais no endereço: 400 com o motivo.
  const http = await s.req('PUT', '/api/gateway', { cookie: owner.cookie, csrf: owner.csrf, body: { enabled: true, inboxUrl: 'http://validador.example/caixa' } });
  assert.equal(http.statusCode, 400);
  assert.match((http.json() as { error: string }).error, /https/);
  // Outro operador (não é o dono): 403.
  const other = await s.pair('Outra pessoa');
  assert.equal((await s.req('PUT', '/api/gateway', { cookie: other.cookie, csrf: other.csrf, body })).statusCode, 403);
  // Passou a janela do step-up: pede um código novo do equipamento.
  s.advance(STEP_UP_MS + 1000);
  const late = await s.req('PUT', '/api/gateway', { cookie: owner.cookie, csrf: owner.csrf, body });
  assert.equal(late.statusCode, 403);
  assert.equal((late.json() as { reauth?: boolean }).reauth, true);
  assert.equal(s.store.gatewaySettings({ enabled: true, inboxUrl: null }).at, 0, 'nada gravado');
  const re = await s.req('POST', '/api/reauth', { cookie: owner.cookie, csrf: owner.csrf, body: { code: s.pairing.issue(s.clock()) } });
  assert.equal(re.statusCode, 200, re.body);
  const ok = await s.req('PUT', '/api/gateway', { cookie: owner.cookie, csrf: owner.csrf, body });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.deepEqual(ok.json(), { enabled: false, inboxUrl: 'https://validador.example/caixa', changedAt: s.clock() });
  assert.equal(s.probes(), 1);
  // Persistido no estado do nó: outra instância do Store lê o mesmo.
  const again = new Store(s.dir).gatewaySettings({ enabled: true, inboxUrl: null });
  assert.deepEqual({ enabled: again.enabled, inboxUrl: again.inboxUrl }, { enabled: false, inboxUrl: 'https://validador.example/caixa' });
  const view = (await s.req('GET', '/api/gateway', { cookie: owner.cookie })).json() as { enabled: boolean; inboxUrl: string };
  assert.equal(view.enabled, false);
  assert.equal(view.inboxUrl, 'https://validador.example/caixa');
  // Tirar a caixa: null.
  const clear = await s.req('PUT', '/api/gateway', { cookie: owner.cookie, csrf: owner.csrf, body: { enabled: true, inboxUrl: null } });
  assert.equal((clear.json() as { inboxUrl: string | null }).inboxUrl, null);
});

test('PIU_GATEWAY=0: o painel mostra indisponível e não liga', async t => {
  const s = await setup({ gateway: false });
  t.after(s.cleanup);
  const a = await s.pair('Lucas');
  const j = (await s.req('GET', '/api/gateway', { cookie: a.cookie })).json() as { available: boolean; reason: string };
  assert.deepEqual([j.available, j.reason], [false, 'config']);
  const r = await s.req('PUT', '/api/gateway', { cookie: a.cookie, csrf: a.csrf, body: { enabled: true, inboxUrl: null } });
  assert.equal(r.statusCode, 409);
});
