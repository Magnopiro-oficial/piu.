/// <reference types="node" />
/**
 * Folha Enviar da Carteira (design: `APP-CARTEIRA-ENVIAR-RECEBER.md` §2), só a lógica pura:
 * destinatários reais (contatos com endereço Lunes conhecido + "Outro"), valor inicial e chips,
 * validade do valor contra o saldo, opacidade do botão de segurar e leitura do QR de outra carteira.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Chat } from '../../data/types';
import type { PayRecord } from '../../state/messaging';
import {
  DEFAULT_AMOUNT, OTHER_ID, QUICK_AMOUNTS, QUOTE_DEBOUNCE_MS, amountState, amountText, contactAddresses, holdOpacity, lunesUri, parseWalletQr, receiveAddressLabel, recipientsFrom, sanitizeAmount,
  transferRow,
} from '../walletSend';
import type { WalletTransferRecord } from '../walletTransfer';
import { ALICE_42, ALICE_57 } from './lunesFake';
import { DEV_ADDR_57 } from './walletFixture';

const T0 = 1_800_000_000;
const chat = (id: string, name: string, extra: Partial<Chat> = {}): Chat => ({ id, ident: 'public', kind: 'direct', name, initials: name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(), time: '', unread: 0, peer: `piu:${id}`, ...extra });
const pay = (chatId: string, address: string, dir: 'in' | 'out' = 'in', createdAt = T0): PayRecord => ({ id: `${chatId}-${createdAt}`, chatId, dir, address, planck: null, desc: 'x', createdAt, expiresAt: createdAt + 7 * 86400 });

test('design: valor inicial "5", chips 1 · 5 · 10 LUNES, cotação com debounce curto', () => {
  assert.equal(DEFAULT_AMOUNT, '5');
  assert.deepEqual([...QUICK_AMOUNTS], [1, 5, 10]);
  assert.ok(QUOTE_DEBOUNCE_MS >= 250 && QUOTE_DEBOUNCE_MS <= 600);
});

test('valor: só dígitos, vírgula e ponto entram no campo', () => {
  assert.equal(sanitizeAmount('1a,5b'), '1,5');
  assert.equal(sanitizeAmount('12.50 LUNES'), '12.50');
  assert.equal(sanitizeAmount('-3'), '3');
});

test('endereços dos contatos: o último pedido de pagamento recebido de cada conversa, só com endereço Lunes válido', () => {
  const chats = [chat('a', 'Marina Alves'), chat('b', 'Ana Costa'), chat('c', 'Pedro'), chat('d', 'Sem pedido')];
  const pays: PayRecord[] = [
    pay('a', ALICE_42, 'in', T0 - 10), pay('a', ALICE_57, 'in', T0), // o mais novo vence
    pay('b', 'nao-e-endereco', 'in'), // inválido: fora
    pay('c', DEV_ADDR_57, 'out'), // pedido meu: o endereço é o meu, não o do contato
  ];
  const map = contactAddresses(chats, pays);
  assert.deepEqual([...map.entries()], [['a', ALICE_57]]);
});

test('destinatários: 4 círculos como no design (até 3 contatos aceitos com endereço + "Outro" no fim), nunca nomes inventados', () => {
  const chats = [chat('a', 'Marina Alves', { photo: 'data:x', inv: true }), chat('b', 'Ana Costa'), chat('c', 'Pedro Lima'), chat('d', 'João Souza'), chat('e', 'Quinto Nome'), chat('r', 'Pedido', { request: true }), chat('g', 'Grupo', { kind: 'group', peer: undefined })];
  const addr = new Map([['a', ALICE_57], ['b', ALICE_57], ['c', ALICE_57], ['d', ALICE_57], ['e', ALICE_57], ['r', ALICE_57], ['g', ALICE_57]]);
  const list = recipientsFrom(chats, addr);
  assert.deepEqual(list.map(r => r.id), ['a', 'b', 'c', OTHER_ID]);
  assert.deepEqual(list[0], { id: 'a', name: 'Marina Alves', first: 'Marina', initials: 'MA', address: ALICE_57, photo: 'data:x', inv: true });
  assert.equal(list[3]!.address, null);
  // Vindo de uma conversa (botão de pagar), aquele contato entra primeiro mesmo fora dos 3 da lista.
  assert.deepEqual(recipientsFrom(chats, addr, 'e').map(r => r.id), ['e', 'a', 'b', OTHER_ID]);
  // Conversa sem endereço conhecido, pedido ou grupo: ignorada como preferência.
  assert.deepEqual(recipientsFrom(chats, addr, 'r').map(r => r.id), ['a', 'b', 'c', OTHER_ID]);
  assert.deepEqual(recipientsFrom(chats, new Map([['a', ALICE_57]]), 'b').map(r => r.id), ['a', OTHER_ID]);
  // Sem contato com endereço: só "Outro" (a folha começa nele).
  assert.deepEqual(recipientsFrom(chats, new Map()).map(r => r.id), [OTHER_ID]);
});

test('valor contra o saldo: 0 < valor ≤ disponível habilita o botão; senão opacidade .35', () => {
  assert.deepEqual(amountState('5', 58.4), { planck: 500_000_000n, over: false, ok: true });
  assert.deepEqual(amountState('58,40', 58.4), { planck: 5_840_000_000n, over: false, ok: true });
  assert.deepEqual(amountState('60', 58.4), { planck: 6_000_000_000n, over: true, ok: false });
  assert.deepEqual(amountState('0', 58.4), { planck: null, over: false, ok: false });
  assert.deepEqual(amountState('', 58.4), { planck: null, over: false, ok: false });
  assert.deepEqual(amountState('abc', 58.4), { planck: null, over: false, ok: false });
  // Sem leitura do saldo (null): não dá para afirmar que cabe.
  assert.deepEqual(amountState('5', null), { planck: 500_000_000n, over: true, ok: false });
  assert.equal(holdOpacity(true), 1);
  assert.equal(holdOpacity(false), 0.35);
});

test('QR de carteira: endereço SS58 puro ou `lunes:<endereço>`; prefixo 42 é normalizado para 57', () => {
  assert.deepEqual(parseWalletQr(ALICE_57, T0), { ok: true, address: ALICE_57, amount: null });
  assert.deepEqual(parseWalletQr(` lunes:${ALICE_57}\n`, T0), { ok: true, address: ALICE_57, amount: null });
  assert.deepEqual(parseWalletQr(`LUNES:${ALICE_42}`, T0), { ok: true, address: ALICE_57, amount: null });
  assert.equal(lunesUri(ALICE_57), `lunes:${ALICE_57}`);
});

test('QR de pedido de pagamento (payload `pq` do app): endereço e valor preenchidos', () => {
  const pq = JSON.stringify({ t: 'pq', i: '0123456789abcdef', a: ALICE_57, v: '150000000', d: 'Almoço', u: T0 + 3600 });
  assert.deepEqual(parseWalletQr(pq, T0), { ok: true, address: ALICE_57, amount: '1,5' });
  assert.equal(amountText(500_000_000n), '5');
  assert.equal(amountText(123_450_000_000n), '1234,5');
  assert.equal(amountText(1n), '0,00000001');
  const semValor = JSON.stringify({ t: 'pq', i: '0123456789abcdef', a: ALICE_57, d: 'Almoço', u: T0 + 3600 });
  assert.deepEqual(parseWalletQr(semValor, T0), { ok: true, address: ALICE_57, amount: null });
  // Vencido ou torto: erro claro, nada preenchido.
  const vencido = JSON.stringify({ t: 'pq', i: '0123456789abcdef', a: ALICE_57, v: '1', d: 'x', u: T0 - 1 });
  const r = parseWalletQr(vencido, T0);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /inválido ou vencido/);
});

test('QR que não é de carteira: erro claro, com o motivo do validador SS58', () => {
  for (const text of ['', 'piu1:abc', 'https://piu.net', '{"t":"pd","i":"0123456789abcdef"}', '0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d']) {
    const r = parseWalletQr(text, T0);
    assert.equal(r.ok, false, text);
    assert.match((r as { error: string }).error, /não é de uma carteira Lunes/, text);
  }
  // Endereço de outra rede (prefixo ≠ 57/42): o motivo vem do validador.
  const polkadot = '1FRMM8PEiWXYax7rpS6X4XZX1aAAxSWx1CrKTyrVYhV24fg';
  const r = parseWalletQr(polkadot, T0);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /outra rede/);
});

test('Receber: endereço numa linha só como no design (`lunes:` + 10 primeiros … 8 últimos)', () => {
  assert.equal(receiveAddressLabel(ALICE_57), `lunes:${ALICE_57.slice(0, 10)}…${ALICE_57.slice(-8)}`);
  assert.equal(receiveAddressLabel('curto'), 'lunes:curto');
});

const rec = (o: Partial<WalletTransferRecord> = {}): WalletTransferRecord => ({
  id: 'r1', from: DEV_ADDR_57, dest: ALICE_57, value: '500000000', fee: '144000', hash: '0xab', hex: '0x', validUntil: 70, status: 'submitted', createdAt: T0, updatedAt: T0,
  ctx: { specVersion: 107, transactionVersion: 2, genesisHash: '0x', blockHash: '0x', blockNumber: 1, nonce: 0, period: 64, tip: 0n } as never, ...o,
});

test('linha da transferência recém-enviada (design: nova linha no topo da atividade): status real e valor com sinal', () => {
  const tr = (k: string, v?: Record<string, string | number>) => (v ? `${k}:${JSON.stringify(v)}` : k);
  const row = transferRow(rec(), [], tr as never)!;
  assert.equal(row.icon, 'arrow_upward');
  assert.equal(row.title, `wallet.sentTo:${JSON.stringify({ to: `${ALICE_57.slice(0, 6)}…${ALICE_57.slice(-4)}` })}`);
  assert.equal(row.detail, 'ownWallet.status.submitted');
  assert.equal(row.value, '−5,00');
  // Falhou: ícone de erro e valor sem sinal (nada saiu da conta).
  const failed = transferRow(rec({ status: 'failed' }), [], tr as never)!;
  assert.equal(failed.icon, 'error');
  assert.equal(failed.value, '5,00');
  // Confirmada e já no histórico do indexador (mesmo bloco, saída, mesmo valor): a linha do histórico basta.
  const fin = rec({ status: 'finalized', block: { number: 2411001, hash: '0x', index: 1 } });
  const move = { id: '2411001-3', direction: 'out' as const, amount: 500_000_000n, counterparty: ALICE_57, counterpartyId: ALICE_42, block: 2411001, eventIndex: 3, at: null };
  assert.equal(transferRow(fin, [move], tr as never), null);
  assert.ok(transferRow(fin, [{ ...move, block: 2410000 }], tr as never)); // indexador ainda não chegou nela
  assert.ok(transferRow(fin, [], tr as never));
  // Confirmada e mais antiga que todas as linhas lidas do indexador (está nas páginas antigas): não fica presa no topo.
  assert.equal(transferRow(fin, [{ ...move, block: 2500000, direction: 'in' }], tr as never), null);
  // Ainda não confirmada: aparece mesmo com histórico mais novo (o indexador pode não ter chegado nela).
  assert.ok(transferRow(rec({ status: 'included', block: { number: 2411001, hash: '0x', index: 1 } }), [{ ...move, block: 2500000 }], tr as never));
});
