import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appendOutgoing, applyStatus, type ConversationsState, emptyState, filterSummaries, markRead, messagesOf, receiveIncoming, removeConversation, summaries,
} from '../src/shared/conversations';
import type { ContactInfo } from '../src/shared/types';

const ana: ContactInfo = { id: 'piu:ana', name: 'Ana', via: 'public', request: false };
const bia: ContactInfo = { id: 'piu:bia', name: '', via: 'anon', request: true };

test('conversa: mensagem enviada nasce "criada", vira "aguardando", depois "encaminhada" e "entregue" com a rota', () => {
  let s = emptyState();
  s = appendOutgoing(s, { id: 'm1', contactId: ana.id, text: 'oi', at: 100 });
  assert.equal(messagesOf(s, ana.id)[0]!.status, 'aguardando');
  s = applyStatus(s, 'm1', 'encaminhada', { peer: 'abc', via: 'eth', bytes: 512 }, 101);
  const m = messagesOf(s, ana.id)[0]!;
  assert.equal(m.status, 'encaminhada');
  assert.equal(m.forwardedAt, 101);
  assert.deepEqual(m.route, { peer: 'abc', via: 'eth', bytes: 512 });
  s = applyStatus(s, 'm1', 'entregue', undefined, 105);
  assert.equal(messagesOf(s, ana.id)[0]!.status, 'entregue');
  assert.equal(messagesOf(s, ana.id)[0]!.deliveredAt, 105);
  // A rota da encaminhada não se perde quando o recibo chega sem rota.
  assert.equal(messagesOf(s, ana.id)[0]!.route?.peer, 'abc');
});

test('conversa: "entregue" não volta para "encaminhada" (eventos fora de ordem)', () => {
  let s = emptyState();
  s = appendOutgoing(s, { id: 'm1', contactId: ana.id, text: 'oi', at: 100 });
  s = applyStatus(s, 'm1', 'entregue', undefined, 105);
  s = applyStatus(s, 'm1', 'encaminhada', { peer: 'x', bytes: 1 }, 106);
  assert.equal(messagesOf(s, ana.id)[0]!.status, 'entregue');
});

test('conversa: estado de mensagem desconhecida é ignorado', () => {
  const s = emptyState();
  assert.deepEqual(applyStatus(s, 'nao-existe', 'entregue', undefined, 1), s);
});

test('conversa: recebida entra como não lida, com rota e saltos; repetida não duplica', () => {
  let s = emptyState();
  s = receiveIncoming(s, { id: 'r1', contactId: ana.id, text: 'olá', at: 200, route: { peer: 'n1', via: 'eth', bytes: 700, hops: 2 } });
  s = receiveIncoming(s, { id: 'r1', contactId: ana.id, text: 'olá', at: 200 });
  const list = messagesOf(s, ana.id);
  assert.equal(list.length, 1);
  assert.equal(list[0]!.dir, 'in');
  assert.equal(list[0]!.status, 'recebida');
  assert.equal(list[0]!.route?.hops, 2);
  assert.equal(summaries(s, [ana])[0]!.unread, 1);
  s = markRead(s, ana.id);
  assert.equal(summaries(s, [ana])[0]!.unread, 0);
});

test('resumo: ordena pela última atividade, conta pendentes e mostra contato sem mensagens', () => {
  let s = emptyState();
  s = appendOutgoing(s, { id: 'a1', contactId: ana.id, text: 'um', at: 10 });
  s = receiveIncoming(s, { id: 'b1', contactId: bia.id, text: 'dois', at: 20 });
  const carla: ContactInfo = { id: 'piu:carla', name: 'Carla', via: 'public', request: false };
  const list = summaries(s, [ana, bia, carla]);
  assert.deepEqual(list.map(x => x.contact.id), [bia.id, ana.id, carla.id]);
  assert.equal(list[1]!.pending, 1);
  assert.equal(list[2]!.last, null);
  // Entregue deixa de contar como pendente.
  s = applyStatus(s, 'a1', 'entregue', undefined, 30);
  assert.equal(summaries(s, [ana])[0]!.pending, 0);
  assert.equal(summaries(s, [ana])[0]!.last?.at, 10);
});

test('filtro: busca por nome ou id e abas "não lidas" e "pedidos"', () => {
  let s = emptyState();
  s = receiveIncoming(s, { id: 'b1', contactId: bia.id, text: 'dois', at: 20 });
  const all = summaries(s, [ana, bia]);
  assert.equal(filterSummaries(all, 'ana', 'all').length, 1);
  assert.equal(filterSummaries(all, 'BIA', 'all').length, 1); // acha pelo id (piu:bia), sem distinguir maiúsculas
  assert.equal(filterSummaries(all, '', 'unread').length, 1);
  assert.equal(filterSummaries(all, '', 'requests')[0]!.contact.id, bia.id);
  assert.equal(filterSummaries(all, 'zzz', 'all').length, 0);
});

test('remover conversa apaga as mensagens dela e só dela', () => {
  let s = emptyState();
  s = appendOutgoing(s, { id: 'a1', contactId: ana.id, text: 'um', at: 10 });
  s = appendOutgoing(s, { id: 'b1', contactId: bia.id, text: 'dois', at: 10 });
  s = removeConversation(s, ana.id);
  assert.equal(messagesOf(s, ana.id).length, 0);
  assert.equal(messagesOf(s, bia.id).length, 1);
});

test('estado serializa e volta igual (JSON)', () => {
  let s = emptyState();
  s = appendOutgoing(s, { id: 'a1', contactId: ana.id, text: 'um', at: 10 });
  const back = JSON.parse(JSON.stringify(s)) as ConversationsState;
  assert.deepEqual(messagesOf(back, ana.id), messagesOf(s, ana.id));
});


test('filtros distinguem pessoas, grupos e canais e permissões são conservadoras', async () => {
  const { canSendToConversation, conversationKind, filterConversationKind, summaries, emptyState } = await import('../src/shared/conversations');
  const direct = { id: 'd', name: 'Pessoa', via: 'public' as const, request: false };
  const group = { ...direct, id: 'g', kind: 'group' as const, canPost: true };
  const channel = { ...direct, id: 'c', kind: 'channel' as const, canPost: false };
  const community = { ...direct, id: 'v', kind: 'community' as const, canPost: true };
  const unknown = { ...direct, id: 'x', kind: 'unknown' as const, canPost: true };
  const rows = summaries(emptyState(), [direct, group, channel, community, unknown]);
  assert.equal(conversationKind(direct), 'direct');
  assert.deepEqual(filterConversationKind(rows, 'direct').map(c => c.contact.id), ['d']);
  assert.deepEqual(filterConversationKind(rows, 'group').map(c => c.contact.id), ['g']);
  assert.deepEqual(filterConversationKind(rows, 'channel').map(c => c.contact.id), ['c']);
  assert.equal(filterConversationKind(rows, 'all').length, 5);
  assert.equal(canSendToConversation(direct), true); assert.equal(canSendToConversation(group), true);
  assert.equal(canSendToConversation(channel), false); assert.equal(canSendToConversation({ ...group, canPost: undefined }), false);
  assert.equal(canSendToConversation(unknown), false);
});

test('mensagens recebidas em grupos preservam o remetente', () => {
  const state = receiveIncoming(emptyState(), { id: 'g-msg', contactId: 'group:1', text: 'olá', at: 5, sender: 'Ana' });
  assert.equal(messagesOf(state, 'group:1')[0]?.sender, 'Ana');
  assert.equal(messagesOf(JSON.parse(JSON.stringify(state)), 'group:1')[0]?.sender, 'Ana');
});

test('B-04: histórico local tem teto por conversa (ficam as mais novas) e ids do protótipo não quebram a leitura', async () => {
  const { MAX_LOCAL_MESSAGES } = await import('../src/shared/conversations');
  let s = emptyState();
  for (let i = 0; i < MAX_LOCAL_MESSAGES + 3; i++) s = receiveIncoming(s, { id: `m${i}`, contactId: ana.id, text: `t${i}`, at: i });
  assert.equal(messagesOf(s, ana.id).length, MAX_LOCAL_MESSAGES);
  assert.equal(messagesOf(s, ana.id)[0]!.id, 'm3');
  s = appendOutgoing(s, { id: 'eu', contactId: ana.id, text: 'oi', at: 9999 });
  assert.equal(messagesOf(s, ana.id).length, MAX_LOCAL_MESSAGES);
  assert.equal(messagesOf(s, ana.id).at(-1)!.id, 'eu');
  assert.ok(s.readCount[ana.id]! <= MAX_LOCAL_MESSAGES);
  assert.deepEqual(messagesOf(emptyState(), 'constructor'), []);
  assert.deepEqual(messagesOf(emptyState(), '__proto__'), []);
});

test('temporárias: a mensagem guarda o vencimento e some na varredura; a contagem de lidas acompanha', async () => {
  const { dropExpired, expireSecOf, TEMP_MODES } = await import('../src/shared/conversations');
  assert.deepEqual(TEMP_MODES, ['off', '1h', '24h', '7d']);
  assert.equal(expireSecOf('off'), undefined);
  assert.equal(expireSecOf('1h'), 3600);
  assert.equal(expireSecOf('24h'), 86400);
  assert.equal(expireSecOf('7d'), 604800);
  let s = emptyState();
  s = receiveIncoming(s, { id: 'a', contactId: ana.id, text: 'some', at: 100, expiresAt: 200 });
  s = receiveIncoming(s, { id: 'b', contactId: ana.id, text: 'fica', at: 101 });
  s = appendOutgoing(s, { id: 'c', contactId: ana.id, text: 'minha some', at: 102, expiresAt: 150 });
  assert.equal(messagesOf(s, ana.id)[0]!.expiresAt, 200);
  assert.equal(dropExpired(s, 149), s, 'nada venceu: mesmo objeto');
  s = dropExpired(s, 150);
  assert.deepEqual(messagesOf(s, ana.id).map(m => m.id), ['a', 'b']);
  assert.equal(summaries(s, [ana])[0]!.unread, 0, 'escrever marca tudo como lido; a minha que sumiu não muda isso');
  s = receiveIncoming(s, { id: 'd', contactId: ana.id, text: 'nova', at: 103, expiresAt: 500 });
  assert.equal(summaries(s, [ana])[0]!.unread, 1);
  s = dropExpired(s, 200);
  assert.deepEqual(messagesOf(s, ana.id).map(m => m.id), ['b', 'd']);
  assert.equal(summaries(s, [ana])[0]!.unread, 1, 'a lida que sumiu não transforma outra em lida nem em não lida');
  s = markRead(s, ana.id);
  assert.equal(dropExpired(s, 500).readCount[ana.id], 1);
});

test('lista: marca silenciadas e o prazo das temporárias de cada conversa', () => {
  let s = emptyState();
  s = receiveIncoming(s, { id: 'a', contactId: ana.id, text: 'oi', at: 100 });
  const rows = summaries(s, [ana, bia], { muted: new Set([ana.id]), temp: { [bia.id]: '24h' } });
  assert.equal(rows.find(r => r.contact.id === ana.id)!.muted, true);
  assert.equal(rows.find(r => r.contact.id === bia.id)!.muted, undefined);
  assert.equal(rows.find(r => r.contact.id === bia.id)!.temp, '24h');
  assert.equal(rows.find(r => r.contact.id === ana.id)!.temp, undefined);
});
