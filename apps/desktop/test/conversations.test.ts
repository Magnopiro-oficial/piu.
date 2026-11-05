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
