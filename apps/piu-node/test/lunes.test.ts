import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
// @ts-expect-error: script .mjs sem declaração de tipos
import { DST, FILES, generate, SRC, I18N_DST, I18N_FILES, generateI18n } from '../scripts/sync-lunes.mjs';
import { buildApp } from '../src/app.js';
import { type Config, loadConfig } from '../src/config.js';
import { fromHex, LUNES_ENDPOINTS, LunesRpc, accountBalance, systemAccountKey } from '../src/lunes/lunesRpc.js';
import { LunesReader, parseLunesEndpoints } from '../src/lunes/reader.js';
import { Pairing } from '../src/security/pairing.js';
import { Store } from '../src/store.js';
import { ALICE_42, ALICE_57, ALICE_PK, accountInfoHex, fakeConnect, hashOf, substrate, wsServer } from './lunes-fake.js';

const KEY = systemAccountKey(fromHex(ALICE_PK));
const chain = () => substrate({ finalized: 4_200_000, storage: { [KEY]: accountInfoHex(5, 12_345_000_000n) } });

test('src/lunes é cópia fiel de apps/mobile/src/lib (rode `node scripts/sync-lunes.mjs` se falhar)', t => {
  if (!existsSync(SRC)) { t.skip('apps/mobile não está presente (build isolado do piu-node)'); return; }
  for (const f of FILES as string[]) {
    assert.equal(readFileSync(join(DST as string, `${f}.ts`), 'utf8'), (generate as (n: string) => string)(f), `src/lunes/${f}.ts desatualizado`);
  }
  for (const f of I18N_FILES as string[]) {
    assert.equal(readFileSync(join(I18N_DST as string, `${f}.ts`), 'utf8'), (generateI18n as (n: string) => string)(f), `src/i18n/${f}.ts desatualizado`);
  }
});

test('PIU_LUNES_ENDPOINTS: padrão são os endereços de produção, na ordem; endereço inválido é recusado', () => {
  assert.deepEqual(parseLunesEndpoints(undefined), ['wss://ws.lunes.io', 'wss://ws-lunes-main-01.lunes.io', 'wss://ws-lunes-main-02.lunes.io', 'wss://ws-archive.lunes.io']);
  assert.deepEqual(loadConfig({}).lunesEndpoints, [...LUNES_ENDPOINTS]);
  assert.deepEqual(parseLunesEndpoints(' wss://a.example , ws://127.0.0.1:9944 '), ['wss://a.example', 'ws://127.0.0.1:9944']);
  assert.throws(() => parseLunesEndpoints('https://ws.lunes.io'), /PIU_LUNES_ENDPOINTS/);
  assert.throws(() => loadConfig({ PIU_LUNES_ENDPOINTS: 'ws.lunes.io' }), /PIU_LUNES_ENDPOINTS/);
});

test('WebSocket do Node com um servidor de verdade em 127.0.0.1: saldo lido pelo cliente', async t => {
  if (typeof (globalThis as { WebSocket?: unknown }).WebSocket !== 'function') {
    t.skip('este Node não tem WebSocket global (Node 20 sem --experimental-websocket)');
    return;
  }
  const c = chain();
  const srv = await wsServer(c.handle);
  t.after(() => srv.close());
  // O primeiro endereço não existe (porta fechada): o cliente passa ao seguinte.
  const rpc = new LunesRpc({ endpoints: ['ws://127.0.0.1:1', srv.url], timeoutMs: 3000 });
  const b = await accountBalance(rpc, ALICE_42);
  rpc.close();
  assert.equal(b.free, 12_345_000_000n);
  assert.equal(b.nonce, 5);
  assert.equal(b.block, 4_200_000);
  assert.equal(b.endpoint, srv.url);
  assert.deepEqual(c.calls, ['chain_getFinalizedHead', 'chain_getHeader', 'state_getStorage']);
});

test('leitor: cache curto, uma consulta para pedidos simultâneos, última leitura quando a rede cai', async () => {
  let now = 1_000_000;
  const c = chain();
  const f = fakeConnect(c.handle, ['wss://ws.lunes.io']);
  const r = new LunesReader({ connect: f.connect, now: () => now, ttlMs: 30_000, retryMs: 10_000, timeoutMs: 200 });
  const [a, b] = await Promise.all([r.balance(ALICE_57), r.balance(ALICE_57)]);
  assert.equal(a, b, 'a mesma consulta');
  assert.equal(a.error, null);
  assert.equal(a.cached, false);
  assert.equal(a.reading!.free, '12345000000');
  assert.equal(a.reading!.endpoint, 'wss://ws-lunes-main-01.lunes.io', 'o primeiro caiu: respondeu o segundo');
  assert.equal(a.reading!.blockHash, hashOf('bloco 4200000'));
  assert.equal(c.calls.filter(x => x === 'state_getStorage').length, 1);

  now += 10_000;
  assert.equal((await r.balance(ALICE_57)).cached, true);
  assert.equal(c.calls.filter(x => x === 'state_getStorage').length, 1, 'dentro de 30 s não consulta de novo');

  // Rede caiu: todos os endereços falham. Fica a última leitura, com o motivo.
  now += 30_000;
  const off = new LunesReader({ connect: fakeConnect(c.handle, [...LUNES_ENDPOINTS]).connect, now: () => now, timeoutMs: 200 });
  const first = await off.balance(ALICE_57);
  assert.equal(first.reading, null, 'sem leitura anterior, nada de saldo');
  assert.match(first.error ?? '', /ws\.lunes\.io: não conectou; ws-lunes-main-01\.lunes\.io: não conectou/);
  const down = fakeConnect(c.handle, [...LUNES_ENDPOINTS]);
  const r2 = new LunesReader({ connect: (u: string) => (now < 2_000_000 ? f.connect(u) : down.connect(u)), now: () => now, timeoutMs: 200 });
  await r2.balance(ALICE_57);
  now = 2_000_000;
  const stale = await r2.balance(ALICE_57);
  assert.match(stale.error ?? '', /Nenhum endereço da Lunes respondeu/);
  assert.equal(stale.reading!.free, '12345000000', 'último valor, com o horário dele');
  assert.equal(stale.reading!.at, 1_040_000);
  const opened = down.opened.length;
  now += 5000;
  await r2.balance(ALICE_57);
  assert.equal(down.opened.length, opened, 'espera 10 s antes de tentar de novo');
});

test('API: carteira de provider com endereço Lunes conferido no servidor, step-up e saldo on-chain', async t => {
  const HOST = 'piu-node.local:8420';
  const config: Config = { port: 8420, host: '127.0.0.1', allowedHosts: [HOST], dataDir: '/nao-usado', panelDir: '/nao-usado', releasePubKey: null };
  const pairing = new Pairing();
  const store = new Store(null);
  const c = chain();
  const lunes = new LunesReader({ connect: fakeConnect(c.handle).connect });
  const app = await buildApp({ config, store, pairing, packages: [], packagesDir: '/nao-usado', lunes });
  t.after(() => app.close());
  const headers = { host: HOST, origin: `https://${HOST}` };
  const login = async (name: string) => {
    const p = await app.inject({ method: 'POST', url: '/api/pair', headers, payload: { code: pairing.issue(Date.now()), name } });
    const cookie = String(p.headers['set-cookie']).split(';')[0]!;
    const csrf = (p.json() as { csrf: string }).csrf;
    const h = { ...headers, cookie, 'x-csrf-token': csrf };
    return {
      get: () => app.inject({ method: 'GET', url: '/api/wallet/lunes', headers: { ...headers, cookie } }),
      put: (address: string, extra: Record<string, string> = {}) => app.inject({ method: 'PUT', url: '/api/wallet/lunes', headers: { ...h, ...extra }, payload: { address } }),
      del: () => app.inject({ method: 'DELETE', url: '/api/wallet/lunes', headers: h }),
      reauth: () => app.inject({ method: 'POST', url: '/api/reauth', headers: h, payload: { code: pairing.issue(Date.now()) } }),
    };
  };
  const dona = await login('Dona');
  const outra = await login('Outra pessoa');

  assert.equal((await app.inject({ method: 'GET', url: '/api/wallet/lunes', headers })).statusCode, 401);
  const empty = (await dona.get()).json() as Record<string, unknown>;
  assert.deepEqual(empty, { address: null, setAt: null, explorer: 'https://blockexplorer.lunes.io/', endpoints: [...LUNES_ENDPOINTS], onchain: null, error: null, cached: false });
  assert.equal(c.calls.length, 0, 'sem endereço, não consulta a Mainnet');

  // Sem step-up recente: pede código novo. Sem CSRF: recusado antes de tudo.
  store.sessionsOf(store.owner()!.id).forEach(s => { s.authAt = 0; });
  const noStep = await dona.put(ALICE_57);
  assert.equal(noStep.statusCode, 403);
  assert.equal((noStep.json() as { reauth: boolean }).reauth, true);
  assert.equal((await dona.put(ALICE_57, { 'x-csrf-token': 'errado' })).statusCode, 403);
  assert.equal((await dona.reauth()).statusCode, 200);

  const typo = await dona.put(ALICE_57.slice(0, -1) + 's');
  assert.equal(typo.statusCode, 400);
  assert.match((typo.json() as { error: string }).error, /soma de verificação/);
  assert.equal((await dona.put('lunes:' + ALICE_57)).statusCode, 400);
  assert.equal((await dona.put('1' + 'A'.repeat(90))).statusCode, 400, 'maior que o limite do esquema');

  const ok = await dona.put(` ${ALICE_57} `);
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal((ok.json() as { address: string }).address, ALICE_57);

  const view = (await dona.get()).json() as { address: string; onchain: { free: string; block: number; endpoint: string; exists: boolean }; error: null };
  assert.equal(view.address, ALICE_57);
  assert.equal(view.error, null);
  assert.equal(view.onchain.free, '12345000000');
  assert.equal(view.onchain.block, 4_200_000);
  assert.equal(view.onchain.endpoint, 'wss://ws.lunes.io');
  assert.equal(view.onchain.exists, true);
  assert.equal(((await dona.get()).json() as { cached: boolean }).cached, true);

  // Cada operador tem a sua carteira: a outra pessoa não vê a da dona.
  assert.equal(((await outra.get()).json() as { address: null }).address, null);

  assert.equal((await dona.del()).statusCode, 204);
  assert.equal(((await dona.get()).json() as { address: null }).address, null);
});
