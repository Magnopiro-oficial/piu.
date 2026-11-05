/**
 * Histórico real do endereço do provider (`GET /api/wallet/lunes/history`), lido do indexador público da
 * Lunes pela cópia de lunesHistory.ts, com cache curto e erro honesto. O `fetch` é falso: as respostas são
 * do formato que o indexador devolveu em 2026-11-04 (apps/mobile/src/lib/__tests__/lunesHistoryFixture.ts),
 * encurtadas. Nada aqui vai à rede.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import { LunesHistoryReader } from '../src/lunes/history.js';
import { LUNES_INDEXER } from '../src/lunes/lunesHistory.js';
import { Pairing } from '../src/security/pairing.js';
import { Store } from '../src/store.js';

/** Conta pública consultada no indexador (prefixo 42, como ele guarda). */
const ACCOUNT_42 = '5F4vNdAQrabivM3cq5kAfpthhEyxtcfkq7YXT57ExWUGQ9SU';
const TRANSFERS = {
  data: {
    sent: {
      nodes: [
        { id: '13301965-11', fromId: ACCOUNT_42, toId: '5FdBnjdv1REge2AetPxPsDseaTUY5NtqkLFtmxsNnYeczkTP', amount: '3320', blockNumber: '13301965', eventIndex: 11 },
        { id: '13240750-3', fromId: ACCOUNT_42, toId: '5HFeBxLsGH6cFZAEQjTdvyRKfW53EVuZZA5m92Jo1bRh8XfG', amount: '1320', blockNumber: '13240750', eventIndex: 3 },
      ],
      totalCount: 136,
    },
    received: {
      nodes: [{ id: '9048626-2', fromId: '5DFeJ3WLzpQ1SVesnAhsbYbg6m5bSruoLN9ENSxQogjXXskc', toId: ACCOUNT_42, amount: '490000000000', blockNumber: '9048626', eventIndex: 2 }],
      totalCount: 13,
    },
  },
};
const BLOCKS = { data: { blocks: { nodes: [
  { id: '13240750', timestamp: '1793462562000' }, { id: '13301965', timestamp: '1793830332000' }, { id: '9048626', timestamp: '1768257696000' },
] } } };

interface Call { url: string; body: { query: string; variables: Record<string, unknown> } }
/** `fetch` falso: responde cada consulta pelo nome da operação; sem resposta cadastrada = rede caiu. */
function fakeFetch(answers: Record<string, { status?: number; json: unknown }>) {
  const calls: Call[] = [];
  const f = (async (url: string, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? '{}') as Call['body'];
    calls.push({ url, body });
    const a = answers[/query\s+(\w+)/.exec(body.query)?.[1] ?? ''];
    if (!a) throw new TypeError('fetch failed');
    return { ok: (a.status ?? 200) < 300, status: a.status ?? 200, json: async () => a.json };
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}
const OK = { AccountTransfers: { json: TRANSFERS }, BlockTimes: { json: BLOCKS } };

test('leitor do histórico: duas consultas, cache de 60 s, uma leitura para pedidos simultâneos', async () => {
  let now = 1_000_000;
  const f = fakeFetch(OK);
  const r = new LunesHistoryReader({ fetch: f.fetch, now: () => now, ttlMs: 60_000, retryMs: 15_000 });
  const [a, b] = await Promise.all([r.history(ACCOUNT_42), r.history(ACCOUNT_42)]);
  assert.equal(a, b, 'a mesma leitura');
  assert.equal(a.error, null);
  assert.equal(a.cached, false);
  assert.equal(f.calls.length, 2, 'transfers e blocos, uma vez');
  assert.equal(f.calls[0]!.url, LUNES_INDEXER);
  assert.deepEqual(f.calls[0]!.body.variables, { id: ACCOUNT_42, first: 50 });
  const h = a.history!;
  assert.equal(h.address, ACCOUNT_42);
  assert.equal(h.total, 149);
  assert.equal(h.truncated, true);
  assert.equal(h.at, now);
  assert.deepEqual(h.moves.map(m => [m.id, m.direction, m.amount, m.at]), [
    ['13301965-11', 'out', '3320', 1793830332000], ['13240750-3', 'out', '1320', 1793462562000], ['9048626-2', 'in', '490000000000', 1768257696000],
  ]);
  assert.equal(h.moves[2]!.counterparty, '5DFeJ3WLzpQ1SVesnAhsbYbg6m5bSruoLN9ENSxQogjXXskc', 'contraparte no prefixo do endereço informado (42)');

  now += 30_000;
  assert.equal((await r.history(ACCOUNT_42)).cached, true);
  assert.equal(f.calls.length, 2, 'dentro de 60 s não consulta de novo');
  now += 31_000;
  assert.equal((await r.history(ACCOUNT_42)).cached, false);
  assert.equal(f.calls.length, 4);
});

test('leitor do histórico: indexador fora → erro honesto, última leitura quando houver, espera antes de repetir', async () => {
  let now = 1_000_000;
  const down = fakeFetch({});
  const r = new LunesHistoryReader({ fetch: down.fetch, now: () => now, retryMs: 15_000 });
  const first = await r.history(ACCOUNT_42);
  assert.equal(first.history, null, 'sem leitura anterior, nada de lista vazia fingindo que não há movimentações');
  assert.match(first.error ?? '', /Sem conexão com o indexador da Lunes/);
  now += 5000;
  await r.history(ACCOUNT_42);
  assert.equal(down.calls.length, 1, 'espera 15 s antes de tentar de novo');

  const gql = fakeFetch({ AccountTransfers: { status: 400, json: { errors: [{ message: 'Cannot query field "nope"' }] } } });
  const bad = await new LunesHistoryReader({ fetch: gql.fetch, now: () => now }).history(ACCOUNT_42);
  assert.match(bad.error ?? '', /recusou a consulta: Cannot query field/);

  // Leu uma vez, depois a rede caiu: fica a última leitura, com o horário dela e o motivo.
  let online = true;
  const ok = fakeFetch(OK);
  const mixed = new LunesHistoryReader({ fetch: (u, i) => (online ? ok.fetch(u, i) : down.fetch(u, i)), now: () => now, ttlMs: 60_000 });
  await mixed.history(ACCOUNT_42);
  online = false;
  now += 61_000;
  const stale = await mixed.history(ACCOUNT_42);
  assert.equal(stale.history!.moves.length, 3);
  assert.equal(stale.history!.at, now - 61_000);
  assert.match(stale.error ?? '', /indexador/);

  const typo = await new LunesHistoryReader({ fetch: ok.fetch, now: () => now }).history('xyz');
  assert.match(typo.error ?? '', /caracteres|tamanho/);
});

test('API: GET /api/wallet/lunes/history devolve o histórico do endereço configurado, com erro quando o indexador falha', async t => {
  const HOST = 'piu-node.local:8420';
  const config: Config = { port: 8420, host: '127.0.0.1', allowedHosts: [HOST], dataDir: '/nao-usado', panelDir: '/nao-usado', releasePubKey: null };
  const pairing = new Pairing();
  const store = new Store(null);
  let answers: Record<string, { status?: number; json: unknown }> = OK;
  const f = fakeFetch(OK);
  const history = new LunesHistoryReader({ fetch: (u, i) => fakeFetch(answers).fetch(u, i), ttlMs: 0, retryMs: 0 });
  const app = await buildApp({ config, store, pairing, packages: [], packagesDir: '/nao-usado', lunesHistory: history });
  t.after(() => app.close());
  const headers = { host: HOST, origin: `https://${HOST}` };
  const p = await app.inject({ method: 'POST', url: '/api/pair', headers, payload: { code: pairing.issue(Date.now()), name: 'Dona' } });
  const cookie = String(p.headers['set-cookie']).split(';')[0]!;
  const h = { ...headers, cookie, 'x-csrf-token': (p.json() as { csrf: string }).csrf };
  const get = () => app.inject({ method: 'GET', url: '/api/wallet/lunes/history', headers: { ...headers, cookie } });

  assert.equal((await app.inject({ method: 'GET', url: '/api/wallet/lunes/history', headers })).statusCode, 401);
  const empty = (await get()).json() as Record<string, unknown>;
  assert.deepEqual(empty, { address: null, indexer: LUNES_INDEXER, explorer: 'https://blockexplorer.lunes.io/', history: null, error: null, cached: false });
  assert.equal(f.calls.length, 0, 'sem endereço, não consulta o indexador');

  assert.equal((await app.inject({ method: 'PUT', url: '/api/wallet/lunes', headers: h, payload: { address: ACCOUNT_42 } })).statusCode, 200);
  const view = (await get()).json() as { address: string; history: { moves: { amount: string; counterparty: string }[]; total: number }; error: null };
  assert.equal(view.address, ACCOUNT_42);
  assert.equal(view.error, null);
  assert.equal(view.history.total, 149);
  assert.equal(view.history.moves[0]!.amount, '3320', 'planck em texto (JSON não tem bigint)');

  answers = {};
  const off = await get();
  assert.equal(off.statusCode, 200);
  const stale = off.json() as { history: { total: number }; error: string };
  assert.match(stale.error, /indexador/);
  assert.equal(stale.history.total, 149, 'última leitura, com o motivo da falha');
});
