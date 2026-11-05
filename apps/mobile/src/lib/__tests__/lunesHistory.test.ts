/// <reference types="node" />
/**
 * Histórico de movimentações da Lunes (lib/lunesHistory.ts) sobre respostas reais gravadas do
 * indexador (lunesHistoryFixture.ts). Sem rede: o `fetch` é falso e devolve a gravação.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  explorerAccountUrl, explorerBlockUrl, fetchLunesHistory, fromHistorySnapshot, indexerAccountId, LunesHistoryError,
  moveRow, parseBlockTimes, parseTransfers, shortAddress, toHistorySnapshot, withBlockTimes,
} from '../lunesHistory';
import { decodeSs58, encodeSs58 } from '../ss58';
import { ACCOUNT_42, ACCOUNT_TRANSFERS, BLOCK_TIMES, EMPTY_TRANSFERS, GRAPHQL_ERROR } from './lunesHistoryFixture';
import { ALICE_57 } from './lunesFake';

const pk = (a: string) => { const d = decodeSs58(a); if (!d.ok) throw new Error(d.error); return d.publicKey; };
const ACCOUNT_57 = encodeSs58(pk(ACCOUNT_42), 57);
const NOW = Date.UTC(2026, 10, 4, 15, 0, 0);

test('indexador guarda contas no prefixo 42: o endereço da Lunes (57) é convertido, o 42 fica igual', () => {
  assert.equal(indexerAccountId(ACCOUNT_42), ACCOUNT_42);
  assert.equal(indexerAccountId(` ${ACCOUNT_57} `), ACCOUNT_42);
  assert.throws(() => indexerAccountId('abc'), /SS58|endereço/i);
});

test('parseTransfers: junta enviados e recebidos, decide entrada/saída, ordena do mais recente', () => {
  const moves = parseTransfers(ACCOUNT_TRANSFERS, ACCOUNT_42, 42);
  assert.equal(moves.length, 8);
  assert.deepEqual(moves.map(m => m.id), ['13301965-11', '13301965-7', '13301965-4', '13240750-3', '9850483-2', '9048626-2', '9048614-2', '8987968-20']);
  assert.deepEqual(moves.map(m => m.direction), ['out', 'out', 'out', 'out', 'in', 'in', 'in', 'in']);
  const big = moves.find(m => m.id === '9048614-2')!;
  assert.equal(big.amount, 1000069000000n, 'planck como BigInt, sem perder precisão');
  assert.equal(big.counterparty, '5CNUWeLmycyEoGmsMZdbgbTq5tmFkfDQKTaj2jV9zcaSyFds', 'contraparte do recebimento é quem enviou');
  assert.equal(big.counterpartyId, '5CNUWeLmycyEoGmsMZdbgbTq5tmFkfDQKTaj2jV9zcaSyFds');
  assert.equal(big.block, 9048614);
  assert.equal(big.eventIndex, 2);
  assert.equal(big.at, null, 'o indexador não traz horário no transfer');
  const out = moves[0]!;
  assert.equal(out.counterparty, '5FdBnjdv1REge2AetPxPsDseaTUY5NtqkLFtmxsNnYeczkTP', 'contraparte do envio é quem recebeu');
});

test('parseTransfers: contraparte sai no prefixo do endereço informado (57 na Lunes); o id do explorador fica em 42', () => {
  const moves = parseTransfers(ACCOUNT_TRANSFERS, ACCOUNT_42, 57);
  const m = moves.find(x => x.id === '9048614-2')!;
  assert.equal(m.counterpartyId, '5CNUWeLmycyEoGmsMZdbgbTq5tmFkfDQKTaj2jV9zcaSyFds');
  assert.equal(m.counterparty, encodeSs58(pk(m.counterpartyId), 57));
  assert.ok(m.counterparty.startsWith('6'), 'prefixo 57 começa com 6');
});

test('parseTransfers: transferência para si mesma aparece uma vez, como "self"; resposta vazia dá lista vazia', () => {
  const self = { id: '100-1', fromId: ACCOUNT_42, toId: ACCOUNT_42, amount: '7', blockNumber: '100', eventIndex: 1 };
  const json = { data: { sent: { nodes: [self], totalCount: 1 }, received: { nodes: [self], totalCount: 1 } } };
  const moves = parseTransfers(json, ACCOUNT_42, 42);
  assert.equal(moves.length, 1);
  assert.equal(moves[0]!.direction, 'self');
  assert.deepEqual(parseTransfers(EMPTY_TRANSFERS, ACCOUNT_42, 42), []);
  assert.throws(() => parseTransfers({ data: null }, ACCOUNT_42, 42), LunesHistoryError);
  assert.throws(() => parseTransfers({ errors: [{ message: 'x' }] }, ACCOUNT_42, 42), /x/);
});

test('parseBlockTimes + withBlockTimes: horário vem do bloco (ms), blocos sem resposta ficam sem horário', () => {
  const times = parseBlockTimes(BLOCK_TIMES);
  assert.equal(times.get(13301965), 1793830332000);
  assert.equal(times.get(9048614), 1768257624001);
  const moves = withBlockTimes(parseTransfers(ACCOUNT_TRANSFERS, ACCOUNT_42, 42), times);
  assert.equal(moves[0]!.at, 1793830332000);
  assert.equal(moves.find(m => m.block === 9048614)!.at, 1768257624001);
  const partial = withBlockTimes(parseTransfers(ACCOUNT_TRANSFERS, ACCOUNT_42, 42), new Map([[13301965, 1]]));
  assert.equal(partial[0]!.at, 1);
  assert.equal(partial[4]!.at, null);
});

test('moveRow: entrada/saída com sinal, valor exato em LUNES, contraparte abreviada, data/hora e bloco; mascarado quando o saldo está escondido', () => {
  const moves = withBlockTimes(parseTransfers(ACCOUNT_TRANSFERS, ACCOUNT_42, 42), parseBlockTimes(BLOCK_TIMES));
  const received = moveRow(moves.find(m => m.id === '9048614-2')!, NOW, false);
  assert.equal(received.icon, 'arrow_downward');
  assert.equal(received.title, `Recebido de ${shortAddress('5CNUWeLmycyEoGmsMZdbgbTq5tmFkfDQKTaj2jV9zcaSyFds')}`);
  assert.equal(received.value, '+10.000,69');
  // 1768257624001 ms = 12 jan 2026 22:40 UTC (mesmo ano de NOW: sem o ano); dia/hora locais dependem do fuso da máquina.
  assert.match(received.detail, /^1[23] jan · \d{2}:\d{2} · bloco #9\.048\.614$/);
  assert.equal(received.url, explorerBlockUrl(9048614));

  const sent = moveRow(moves[0]!, NOW, false);
  assert.equal(sent.icon, 'arrow_upward');
  assert.equal(sent.title, `Enviado para ${shortAddress('5FdBnjdv1REge2AetPxPsDseaTUY5NtqkLFtmxsNnYeczkTP')}`);
  assert.equal(sent.value, '−0,0000332', '3320 planck = 0,0000332 LUNES, sem arredondar');

  const hidden = moveRow(moves[0]!, NOW, true);
  assert.equal(hidden.value, '••••');
  assert.equal(hidden.title, sent.title, 'esconder saldo só mascara valores');

  const noTime = moveRow({ ...moves[0]!, at: null }, NOW, false);
  assert.equal(noTime.detail, 'bloco #13.301.965 · horário não indexado');

  const self = moveRow({ ...moves[0]!, direction: 'self', amount: 100000000n }, NOW, false);
  assert.equal(self.title, 'Para a própria conta');
  assert.equal(self.value, '1,00');
});

test('shortAddress e links do explorador', () => {
  assert.equal(shortAddress('5CNUWeLmycyEoGmsMZdbgbTq5tmFkfDQKTaj2jV9zcaSyFds'), '5CNUWeLm…yFds');
  assert.equal(shortAddress('curto'), 'curto');
  assert.equal(explorerBlockUrl(9048614), 'https://blockexplorer.lunes.io/block/9048614');
  assert.equal(explorerAccountUrl(ACCOUNT_42), `https://blockexplorer.lunes.io/account/${ACCOUNT_42}`);
});

interface Call { url: string; body: { query: string; variables: Record<string, unknown> } }
/** `fetch` falso: responde cada consulta pelo nome da operação. */
function fakeFetch(answers: Record<string, { status?: number; json: unknown }>, calls: Call[] = []) {
  const f = (async (url: string, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? '{}') as Call['body'];
    calls.push({ url, body });
    const name = /query\s+(\w+)/.exec(body.query)?.[1] ?? '';
    const a = answers[name];
    if (!a) throw new TypeError('Network request failed');
    return { ok: (a.status ?? 200) < 300, status: a.status ?? 200, json: async () => a.json, text: async () => JSON.stringify(a.json) };
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

test('fetchLunesHistory: duas consultas ao indexador (transfers e blocos), resultado ordenado com horário, total e aviso de corte', async () => {
  const { fetch, calls } = fakeFetch({ AccountTransfers: { json: ACCOUNT_TRANSFERS }, BlockTimes: { json: BLOCK_TIMES } });
  const h = await fetchLunesHistory(ACCOUNT_57, { fetch, first: 4, now: () => NOW });
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.url, 'https://lunes-squid.lunes.io');
  assert.deepEqual(calls[0]!.body.variables, { id: ACCOUNT_42, first: 4 });
  assert.deepEqual((calls[1]!.body.variables.ids as string[]).slice().sort(), ['13240750', '13301965', '8987968', '9048614', '9048626', '9850483']);
  assert.equal(h.address, ACCOUNT_57);
  assert.equal(h.moves.length, 8);
  assert.equal(h.moves[0]!.at, 1793830332000);
  assert.ok(h.moves[0]!.counterparty.startsWith('6'), 'contraparte no prefixo do endereço informado');
  assert.equal(h.total, 149, '136 enviados + 13 recebidos');
  assert.equal(h.truncated, true);
  assert.equal(h.at, NOW);
});

test('fetchLunesHistory: conta sem movimentações não consulta blocos e devolve lista vazia', async () => {
  const { fetch, calls } = fakeFetch({ AccountTransfers: { json: EMPTY_TRANSFERS } });
  const h = await fetchLunesHistory(ALICE_57, { fetch });
  assert.equal(calls.length, 1);
  assert.deepEqual(h.moves, []);
  assert.equal(h.total, 0);
  assert.equal(h.truncated, false);
});

test('fetchLunesHistory: erro do GraphQL, HTTP fora de 2xx e falha de rede viram LunesHistoryError com motivo', async () => {
  await assert.rejects(fetchLunesHistory(ACCOUNT_42, { fetch: fakeFetch({ AccountTransfers: { status: GRAPHQL_ERROR.status, json: GRAPHQL_ERROR.body } }).fetch }),
    (e: unknown) => e instanceof LunesHistoryError && /Cannot query field/.test(e.message));
  await assert.rejects(fetchLunesHistory(ACCOUNT_42, { fetch: fakeFetch({ AccountTransfers: { status: 502, json: {} } }).fetch }),
    (e: unknown) => e instanceof LunesHistoryError && /502/.test(e.message));
  await assert.rejects(fetchLunesHistory(ACCOUNT_42, { fetch: fakeFetch({}).fetch }),
    (e: unknown) => e instanceof LunesHistoryError && /Network request failed/.test(e.message));
  await assert.rejects(fetchLunesHistory('não é endereço', { fetch: fakeFetch({}).fetch }), LunesHistoryError);
});

test('snapshot para o disco: BigInt vira texto e volta igual', () => {
  const moves = withBlockTimes(parseTransfers(ACCOUNT_TRANSFERS, ACCOUNT_42, 42), parseBlockTimes(BLOCK_TIMES));
  const h = { address: ACCOUNT_42, moves, total: 149, truncated: true, at: NOW };
  const snap = toHistorySnapshot(h);
  assert.equal(typeof snap.moves[0]!.amount, 'string');
  assert.doesNotThrow(() => JSON.stringify(snap));
  assert.deepEqual(fromHistorySnapshot(snap), h);
});
