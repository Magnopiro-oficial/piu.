/**
 * Conversas fora do React (plano "app fechado", fatia 4). O núcleo sem tela recebe e decifra a
 * mensagem e precisa de onde pôr: `chatStore` é o dono de `chats` e `verified`, e a tela só assina.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Chat, Msg } from '../../data/types';
import { createChatStore, type ChatStoreDeps } from '../chatStore';

const chat = (id: string, o: Partial<Chat> = {}): Chat => ({ id, peer: 'piu:' + id, kind: 'direct', ident: 'public', name: 'Ana', initials: 'AN', time: '10:00', unread: 0, msgs: [], ...o } as Chat);
const msg = (id: string, o: Partial<Msg> = {}): Msg => ({ id, from: 'them', text: 'oi', time: '10:01', ...o } as Msg);
const tick = () => new Promise(r => setTimeout(r, 0));

function store(saved: Record<string, unknown> = {}, over: Partial<ChatStoreDeps> = {}) {
  const writes: [string, unknown][] = [];
  const notes: { kind: string; title: string; data?: { href?: string } }[] = [];
  const chirps: string[] = [];
  const s = createChatStore({
    read: <T,>(k: string) => saved[k] as T | undefined,
    schedule: (k, v) => { writes.push([k, v]); },
    notify: n => { notes.push(n); },
    chirp: k => { chirps.push(k ?? ''); },
    active: () => false,
    locked: () => false,
    ...over,
  });
  return { s, writes, notes, chirps };
}

test('lê o salvo e o revive: mensagem "criada" volta para "aguardando" e a regravação vai para `chats`', () => {
  const { s, writes } = store({ chats: [chat('a', { msgs: [msg('n1', { from: 'me', status: 'criada' })] })] });
  assert.equal(s.getSnapshot().chats[0]!.msgs![0]!.status, 'aguardando');
  assert.deepEqual(writes.map(w => w[0]), ['chats']);
});

test('subscribe avisa a cada mudança; o snapshot é o mesmo objeto enquanto nada muda', () => {
  const { s } = store({ chats: [chat('a')] });
  let n = 0;
  const off = s.subscribe(() => n++);
  const before = s.getSnapshot();
  assert.equal(s.getSnapshot(), before);
  s.patchChat('a', { name: 'Bia' });
  assert.equal(n, 1);
  assert.notEqual(s.getSnapshot(), before);
  assert.equal(s.getSnapshot().chats[0]!.name, 'Bia');
  off();
  s.patchChat('a', { name: 'Cris' });
  assert.equal(n, 1);
});

test('push: mensagem recebida entra, conta não lida, grava em `chats` e notifica com a rota', () => {
  const { s, writes, notes } = store({ chats: [chat('a')] });
  writes.length = 0;
  s.push('a', msg('in-1'));
  const c = s.getSnapshot().chats[0]!;
  assert.equal(c.unread, 1);
  assert.equal(c.msgs!.at(-1)!.id, 'in-1');
  assert.equal(writes.at(-1)![0], 'chats');
  assert.equal((writes.at(-1)![1] as Chat[])[0]!.msgs!.at(-1)!.id, 'in-1');
  assert.equal(notes.length, 1);
  assert.equal(notes[0]!.kind, 'msg');
  assert.equal(notes[0]!.data?.href, '/chat/a');
});

test('push na conversa aberta com o app na frente: só o piu, sem não lida', () => {
  const { s, notes, chirps } = store({ chats: [chat('a')] }, { active: () => true });
  s.open('a');
  s.push('a', msg('in-1'));
  assert.equal(s.getSnapshot().chats[0]!.unread, 0);
  assert.equal(notes.length, 0);
  assert.deepEqual(chirps, ['msg']);
});

test('patchMsg e setStatus: o estado não volta atrás', () => {
  const { s } = store({ chats: [chat('a', { msgs: [msg('n1', { from: 'me', status: 'aguardando' })] })] });
  s.patchMsg('a', 'n1', () => ({ text: 'editada' }));
  assert.equal(s.getSnapshot().chats[0]!.msgs![0]!.text, 'editada');
  s.setStatus('a', 'n1', 'lida');
  s.setStatus('a', 'n1', 'entregue');
  assert.equal(s.getSnapshot().chats[0]!.msgs![0]!.status, 'lida');
});

test('verified: grava em `verified` e sai junto com a conversa apagada', () => {
  const { s, writes } = store({ chats: [chat('a')] });
  s.setVerified('a', true);
  assert.deepEqual(writes.at(-1), ['verified', { a: true }]);
  s.removeChat('a');
  assert.deepEqual(s.getSnapshot().verified, {});
  assert.equal(s.getSnapshot().chats.length, 0);
});

test('banner só vai a quem assina (a tela); sem assinante, a notificação sai igual', async () => {
  const { s, notes } = store({ chats: [chat('a')] });
  const seen: string[] = [];
  const off = s.onBanner(t => seen.push(t.title));
  s.push('a', msg('in-1'));
  off();
  s.push('a', msg('in-2'));
  await tick();
  assert.deepEqual(seen, ['Ana']);
  assert.equal(notes.length, 2);
});

test('reload depois de "Apagar dados locais": volta ao salvo (vazio) sem regravar', () => {
  const saved: Record<string, unknown> = { chats: [chat('a')] };
  const { s, writes } = store(saved);
  writes.length = 0;
  delete saved.chats;
  s.reload();
  assert.deepEqual(s.getSnapshot().chats, []);
  assert.deepEqual(writes, []);
});

test('sweepExpired: tira as temporárias vencidas e grava; sem nada vencido, não mexe', () => {
  const { s, writes } = store({ chats: [chat('a', { msgs: [msg('in-1', { expiresAt: Date.now() + 60_000 }), msg('in-2')] })] });
  writes.length = 0;
  s.sweepExpired(Date.now());
  assert.equal(writes.length, 0);
  s.sweepExpired(Date.now() + 61_000);
  assert.deepEqual(s.getSnapshot().chats[0]!.msgs!.map(m => m.id), ['in-2']);
  assert.deepEqual(writes.map(w => w[0]), ['chats']);
});

test('settleSent: "criada" passa a "aguardando" (ou "falha") pelo store, sem depender da tela montada', async () => {
  const { s } = store({ chats: [chat('a', { msgs: [msg('n1', { from: 'me', status: 'aguardando' })] })] });
  s.push('a', msg('n2', { from: 'me', status: 'criada' }));
  s.push('a', msg('n3', { from: 'me', status: 'criada' }));
  s.settleSent('a', 'n2', true, 0);
  s.settleSent('a', 'n3', false, 0);
  await tick();
  const st = Object.fromEntries(s.getSnapshot().chats[0]!.msgs!.map(m => [m.id, m.status]));
  assert.equal(st.n2, 'aguardando');
  assert.equal(st.n3, 'falha');
});

test('settleSent não volta um estado que a rede já avançou', async () => {
  const { s } = store({ chats: [chat('a')] });
  s.push('a', msg('n2', { from: 'me', status: 'criada' }));
  s.settleSent('a', 'n2', true, 0);
  s.setStatus('a', 'n2', 'entregue');
  await tick();
  assert.equal(s.getSnapshot().chats[0]!.msgs![0]!.status, 'entregue');
});
