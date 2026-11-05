/// <reference types="node" />
/**
 * Pedido de pagamento pela malha (regra 7.3, adaptada: o Piu não guarda chave Lunes nem envia LUNES).
 * Aqui só a lógica pura: valor em planck (8 casas), limites de texto, validade, codificação do
 * payload e o julgamento da conferência na Mainnet.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  judgementText, judgePayment, MAX_PAY_DESC, MAX_PAY_PLANCK, newPayRequest, PAY_REQUEST_TTL_SEC, parseLunesAmount, payRequestSummary,
  readPaidNotice, readPayRequest, wirePayRequest,
} from '../paymentRequest';
import { ALICE_42, ALICE_57 } from './lunesFake';

const T0 = 1_800_000_000;
const ID = '0123456789abcdef';
const HASH = '0x' + 'ab'.repeat(32);
const HASH2 = '0x' + 'cd'.repeat(32);

test('valor em LUNES: vírgula ou ponto, até 8 casas, maior que zero, sem notação científica', () => {
  assert.equal(parseLunesAmount('1'), 100_000_000n);
  assert.equal(parseLunesAmount('1,5'), 150_000_000n);
  assert.equal(parseLunesAmount('1.5'), 150_000_000n);
  assert.equal(parseLunesAmount(' 0,00000001 '), 1n);
  assert.equal(parseLunesAmount('1.234,5'), 123_450_000_000n, 'separador de milhar brasileiro');
  assert.equal(parseLunesAmount('12345678,12345678'), 1_234_567_812_345_678n);
  assert.equal(parseLunesAmount(''), null, 'vazio = sem valor');
  assert.equal(parseLunesAmount('0'), null);
  assert.equal(parseLunesAmount('0,000000001'), null, 'nona casa não existe na Lunes');
  assert.equal(parseLunesAmount('-1'), null);
  assert.equal(parseLunesAmount('1e3'), null);
  assert.equal(parseLunesAmount('abc'), null);
  assert.equal(parseLunesAmount('1,2,3'), null);
  assert.equal(parseLunesAmount('1000000000'), MAX_PAY_PLANCK, 'teto: 1 bilhão de LUNES');
  assert.equal(parseLunesAmount('1000000000,00000001'), null, 'acima do teto');
});

test('novo pedido: id de 16 hex, descrição até 80 caracteres (por caractere, não por byte), validade de 7 dias, endereço conferido', () => {
  const r = newPayRequest({ address: ALICE_57, amount: '2,5', desc: '  Almoço de   sábado  ', now: T0, id: ID });
  assert.equal(r.id, ID);
  assert.equal(r.address, ALICE_57);
  assert.equal(r.planck, 250_000_000n);
  assert.equal(r.desc, 'Almoço de sábado', 'espaços duplicados somem');
  assert.equal(r.createdAt, T0);
  assert.equal(r.expiresAt, T0 + PAY_REQUEST_TTL_SEC);
  assert.equal(PAY_REQUEST_TTL_SEC, 7 * 86400);
  // Sem valor: pedido aberto ("quanto quiser").
  assert.equal(newPayRequest({ address: ALICE_42, amount: '', desc: 'Vaquinha', now: T0 }).planck, null);
  // Id gerado quando não vem: 16 hex, dois pedidos diferentes.
  const a = newPayRequest({ address: ALICE_42, amount: '', desc: 'x', now: T0 }), b = newPayRequest({ address: ALICE_42, amount: '', desc: 'x', now: T0 });
  assert.match(a.id, /^[0-9a-f]{16}$/);
  assert.notEqual(a.id, b.id);
  // Descrição: 80 caracteres com acento contam como 80 (não como bytes).
  assert.equal(newPayRequest({ address: ALICE_42, amount: '1', desc: 'é'.repeat(MAX_PAY_DESC), now: T0 }).desc.length, MAX_PAY_DESC);
  assert.throws(() => newPayRequest({ address: ALICE_42, amount: '1', desc: 'é'.repeat(MAX_PAY_DESC + 1), now: T0 }), /80 caracteres/);
  assert.throws(() => newPayRequest({ address: ALICE_42, amount: 'dez', desc: 'x', now: T0 }), /Valor inválido/);
  assert.throws(() => newPayRequest({ address: '5Nao', amount: '1', desc: 'x', now: T0 }), /endereço|Endereço/);
  assert.throws(() => newPayRequest({ address: '', amount: '1', desc: 'x', now: T0 }), /Salve o endereço/);
  // Sem valor E sem descrição: pedido vazio não faz sentido.
  assert.throws(() => newPayRequest({ address: ALICE_42, amount: '', desc: '   ', now: T0 }), /valor ou uma descrição/);
});

test('payload `pq`: ida e volta, planck como texto (sem perder precisão no JSON) e campos curtos', () => {
  const r = newPayRequest({ address: ALICE_57, amount: '12345678,12345678', desc: 'Conserto', now: T0, id: ID });
  const w = wirePayRequest(r);
  assert.deepEqual(w, { t: 'pq', i: ID, a: ALICE_57, v: '1234567812345678', d: 'Conserto', u: T0 + PAY_REQUEST_TTL_SEC });
  const back = readPayRequest(JSON.parse(JSON.stringify(w)), T0 + 10);
  assert.ok(back);
  assert.equal(back.planck, 1_234_567_812_345_678n);
  assert.equal(back.address, ALICE_57);
  assert.equal(back.desc, 'Conserto');
  assert.equal(back.expiresAt, T0 + PAY_REQUEST_TTL_SEC);
  assert.equal(back.createdAt, T0 + 10, 'quem recebe conta a partir de quando recebeu');
  // Sem valor: `v` não vai.
  const open = wirePayRequest(newPayRequest({ address: ALICE_42, amount: '', desc: 'Vaquinha', now: T0, id: ID }));
  assert.equal('v' in open, false);
  assert.equal(readPayRequest(open, T0)?.planck, null);
});

test('payload `pq` recebido: recusa o que não confere (id, endereço, valor, descrição, validade, lixo)', () => {
  const ok = { t: 'pq', i: ID, a: ALICE_42, v: '100', d: 'x', u: T0 + 3600 };
  assert.ok(readPayRequest(ok, T0));
  assert.equal(readPayRequest(null, T0), null);
  assert.equal(readPayRequest('pq', T0), null);
  assert.equal(readPayRequest({ ...ok, t: 'm' }, T0), null);
  assert.equal(readPayRequest({ ...ok, i: 'curto' }, T0), null);
  assert.equal(readPayRequest({ ...ok, i: ID.toUpperCase() }, T0), null, 'id só em minúsculas');
  assert.equal(readPayRequest({ ...ok, a: '5EnderecoFalso' }, T0), null);
  assert.equal(readPayRequest({ ...ok, a: 42 }, T0), null);
  assert.equal(readPayRequest({ ...ok, v: 100 }, T0), null, 'valor como número não entra (precisão)');
  assert.equal(readPayRequest({ ...ok, v: '0' }, T0), null);
  assert.equal(readPayRequest({ ...ok, v: '007' }, T0), null, 'sem zeros à esquerda');
  assert.equal(readPayRequest({ ...ok, v: '-5' }, T0), null);
  assert.equal(readPayRequest({ ...ok, v: (MAX_PAY_PLANCK + 1n).toString() }, T0), null, 'acima do teto');
  assert.equal(readPayRequest({ ...ok, v: MAX_PAY_PLANCK.toString() }, T0)?.planck, MAX_PAY_PLANCK);
  assert.equal(readPayRequest({ ...ok, d: 7 }, T0), null);
  assert.equal(readPayRequest({ ...ok, d: 'é'.repeat(MAX_PAY_DESC + 1) }, T0), null, 'descrição longa não é cortada: é recusada');
  assert.equal(readPayRequest({ ...ok, d: 'linha\ncom\tcontrole' }, T0)?.desc, 'linha com controle', 'controles viram espaço');
  assert.equal(readPayRequest({ ...ok, u: T0 }, T0), null, 'já vencido');
  assert.equal(readPayRequest({ ...ok, u: T0 + PAY_REQUEST_TTL_SEC + 2 * 3600 }, T0), null, 'validade maior que 7 dias (mais a folga do relógio)');
  assert.equal(readPayRequest({ ...ok, u: T0 + PAY_REQUEST_TTL_SEC + 1800 }, T0)?.expiresAt, T0 + PAY_REQUEST_TTL_SEC + 1800, 'folga de 1 h para relógios diferentes');
  assert.equal(readPayRequest({ ...ok, u: '123' }, T0), null);
  assert.equal(readPayRequest({ ...ok, u: 1.5 }, T0), null);
  // Sem valor e sem descrição: nada para mostrar.
  assert.equal(readPayRequest({ ...ok, d: '', v: undefined }, T0), null);
  // Campos extras não derrubam (versões futuras podem acrescentar).
  assert.ok(readPayRequest({ ...ok, z: 'novo' }, T0));
});

test('aviso "já paguei" (`pd`): id do pedido, hash da transação e hash do bloco opcionais e conferidos', () => {
  assert.deepEqual(readPaidNotice({ t: 'pd', i: ID }), { id: ID });
  assert.deepEqual(readPaidNotice({ t: 'pd', i: ID, h: HASH, b: HASH2 }), { id: ID, txHash: HASH, blockHash: HASH2 });
  assert.deepEqual(readPaidNotice({ t: 'pd', i: ID, h: HASH.toUpperCase().replace('0X', '0x') }), { id: ID, txHash: HASH }, 'hash normalizado para minúsculas');
  assert.equal(readPaidNotice({ t: 'pd', i: ID, h: '0x123' }), null, 'hash torto derruba o aviso inteiro');
  assert.equal(readPaidNotice({ t: 'pd', i: ID, b: 'bloco' }), null);
  assert.equal(readPaidNotice({ t: 'pd', i: 'x' }), null);
  assert.equal(readPaidNotice({ t: 'pq', i: ID }), null);
  assert.equal(readPaidNotice(undefined), null);
});

test('resumo do pedido para a lista de conversas e para versões sem o balão', () => {
  const r = newPayRequest({ address: ALICE_42, amount: '1,5', desc: 'Almoço', now: T0, id: ID });
  assert.equal(payRequestSummary(r), 'Pedido de pagamento · 1,50 LUNES · Almoço');
  assert.equal(payRequestSummary({ ...r, desc: '' }), 'Pedido de pagamento · 1,50 LUNES');
  assert.equal(payRequestSummary({ ...r, planck: null }), 'Pedido de pagamento · Almoço');
});

test('conferência na Mainnet: só marca "recebido" com prova real (saldo subiu o valor, ou transação no bloco finalizado)', () => {
  const amount = 150_000_000n;
  // Sem leitura anterior do saldo e sem hash: não dá para dizer nada.
  assert.deepEqual(judgePayment({ planck: amount, baseline: null, free: 10n ** 9n }), { state: 'indeterminado', reason: 'sem-base' });
  // Saldo subiu o valor pedido (ou mais): recebido.
  assert.deepEqual(judgePayment({ planck: amount, baseline: 10n ** 9n, free: 10n ** 9n + amount }), { state: 'recebido', via: 'saldo', delta: amount });
  assert.deepEqual(judgePayment({ planck: amount, baseline: 10n ** 9n, free: 10n ** 9n + amount + 5n }), { state: 'recebido', via: 'saldo', delta: amount + 5n });
  // Subiu menos que o pedido: parcial, não é pago.
  assert.deepEqual(judgePayment({ planck: amount, baseline: 10n ** 9n, free: 10n ** 9n + 1n }), { state: 'parcial', delta: 1n });
  // Não mudou (ou caiu): nada ainda.
  assert.deepEqual(judgePayment({ planck: amount, baseline: 10n ** 9n, free: 10n ** 9n }), { state: 'nada' });
  assert.deepEqual(judgePayment({ planck: amount, baseline: 10n ** 9n, free: 10n ** 9n - 7n }), { state: 'nada' });
  // Pedido sem valor: qualquer entrada conta.
  assert.deepEqual(judgePayment({ planck: null, baseline: 10n ** 9n, free: 10n ** 9n + 1n }), { state: 'recebido', via: 'saldo', delta: 1n });
  assert.deepEqual(judgePayment({ planck: null, baseline: 10n ** 9n, free: 10n ** 9n }), { state: 'nada' });
  // Com a transação conferida no bloco finalizado, é prova mesmo sem base de saldo.
  const tx = { blockFound: true, blockNumber: 1234, finalized: true, txIndex: 2, endpoint: 'wss://x' };
  assert.deepEqual(judgePayment({ planck: amount, baseline: null, free: 0n, tx }), { state: 'recebido', via: 'transacao', block: 1234 });
  // Transação no bloco, mas ainda não finalizado: não é prova; bloco sem a transação: nada.
  assert.deepEqual(judgePayment({ planck: amount, baseline: null, free: 0n, tx: { ...tx, finalized: false } }), { state: 'indeterminado', reason: 'nao-finalizado' });
  assert.deepEqual(judgePayment({ planck: amount, baseline: null, free: 0n, tx: { ...tx, txIndex: -1 } }), { state: 'indeterminado', reason: 'transacao-ausente' });
  assert.deepEqual(judgePayment({ planck: amount, baseline: null, free: 0n, tx: { ...tx, blockFound: false, blockNumber: null } }), { state: 'indeterminado', reason: 'bloco-ausente' });
  // Saldo decide antes da transação quando os dois existem e o saldo já prova.
  assert.equal(judgePayment({ planck: amount, baseline: 0n, free: amount, tx: { ...tx, txIndex: -1 } }).state, 'recebido');
  // Saldo não provou, mas a transação está no bloco finalizado: prova.
  assert.equal(judgePayment({ planck: amount, baseline: 0n, free: 1n, tx }).state, 'recebido');
});

test('texto da conferência: diz "chegou" só com prova e explica o que faltou nos outros casos', () => {
  assert.equal(judgementText({ state: 'recebido', via: 'saldo', delta: 150_000_000n }), 'Chegou: o saldo subiu 1,50 LUNES desde o pedido.');
  assert.match(judgementText({ state: 'recebido', via: 'transacao', block: 1234 }), /bloco #1234/);
  assert.match(judgementText({ state: 'parcial', delta: 1n }), /menos que o pedido/);
  assert.match(judgementText({ state: 'nada' }), /não mudou/);
  for (const reason of ['sem-base', 'bloco-ausente', 'transacao-ausente', 'nao-finalizado'] as const) {
    const t = judgementText({ state: 'indeterminado', reason });
    assert.ok(t.length > 10 && !/chegou/i.test(t), reason);
  }
});
