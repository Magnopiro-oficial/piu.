/**
 * Mensageiro fora da árvore React (plano "app fechado", fatia 5). Dois núcleos sobre o transporte
 * simulado, ligados por um "cabo" em memória, sem nenhuma tela montada: A envia, B grava no
 * `chatStore` e notifica. Remontar a tela (start de novo com as mesmas chaves) não cria outro
 * Messenger; só `shutdown` para e salva.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { deriveIdentity, deriveNodeKey, newSeed, toPublic } from '../../protocol/keys';
import { createSimulatedTransport } from '../../transport/simulated';
import type { Transport, TransportEvent } from '../../transport/types';
import type { Contact } from '../../messaging/messenger';
import { createChatStore } from '../chatStore';
import { chatFor, chatIdFor, createMessengerRuntime, persistedPrefs, type RuntimeKeys } from '../messengerRuntime';

/** Transporte simulado com uma ponta extra: o que um manda para o outro chega como envelope. */
function simNode(id: string) {
  const base = createSimulatedTransport();
  const listeners = new Set<(e: TransportEvent) => void>();
  let other: { id: string; inject: (e: TransportEvent) => void } | null = null;
  const t: Transport = {
    ...base,
    subscribe: fn => { listeners.add(fn); const off = base.subscribe(fn); return () => { listeners.delete(fn); off(); }; },
    send: async (peer, data) => { if (other && peer === other.id) { const o = other; setTimeout(() => o.inject({ type: 'envelope', from: id, data }), 0); return; } return base.send(peer, data); },
  };
  return { id, t, inject: (e: TransportEvent) => listeners.forEach(fn => fn(e)), plug: (o: { id: string; inject: (e: TransportEvent) => void }) => { other = o; } };
}

function device(id: string) {
  const seed = newSeed();
  const keys: RuntimeKeys = { identities: { public: deriveIdentity(seed, 'public'), anon: deriveIdentity(seed, 'anon') }, node: deriveNodeKey(seed), nodeKeyFor: null, phonePk: null, rotation: 0 };
  const disk: Record<string, unknown> = {};
  const notes: { kind: string; title: string }[] = [];
  const chats = createChatStore({
    read: <T,>(k: string) => disk[k] as T | undefined, schedule: (k, v) => { disk[k] = v; },
    notify: n => { notes.push(n); }, chirp: () => {}, active: () => false, locked: () => false,
  });
  const net = simNode(id);
  const rt = createMessengerRuntime({
    transport: net.t, chats, read: <T,>(k: string) => disk[k] as T | undefined,
    persistNow: async (k, v) => { disk[k] = v; }, forget: async k => { delete disk[k]; }, epoch: () => 0,
    prefs: { ...persistedPrefs(() => undefined), relay: true },
  });
  live.push(rt);
  return { id, seed, keys, disk, notes, chats, net, rt };
}
const live: Array<{ shutdown(): Promise<void> }> = [];
after(() => Promise.all(live.map(r => r.shutdown())));

function cable(a: ReturnType<typeof device>, b: ReturnType<typeof device>) {
  a.net.plug(b.net); b.net.plug(a.net);
  a.net.inject({ type: 'connected', id: b.id, name: b.id });
  b.net.inject({ type: 'connected', id: a.id, name: a.id });
}

async function until(ok: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!ok()) { if (Date.now() > end) throw new Error('não chegou'); await new Promise(r => setTimeout(r, 10)); }
}

test('sem tela: A envia, B grava a mensagem no chatStore e notifica (kind msg)', async () => {
  const a = device('A'), b = device('B');
  a.rt.start(a.keys); b.rt.start(b.keys);
  cable(a, b);
  const mb = b.rt.messenger()!;
  // A escaneou o QR de B: chaves públicas e o convite de uso único.
  const beto: Contact = { id: b.keys.identities.public.id, via: 'public', pub: toPublic(b.keys.identities.public), name: 'Beto', invite: mb.issueInvite('public').code };
  a.rt.messenger()!.addContact(beto);
  a.chats.addChat(chatFor(beto, false, 'off'));
  a.rt.messenger()!.sendText(beto.id, 'n1', 'oi, Beto');

  const cid = chatIdFor(a.keys.identities.public.id);
  await until(() => !!b.chats.getSnapshot().chats.find(c => c.id === cid)?.msgs?.some(m => m.id === 'in-n1'));
  const got = b.chats.getSnapshot().chats.find(c => c.id === cid)!;
  assert.equal(got.msgs!.find(m => m.id === 'in-n1')!.text, 'oi, Beto');
  assert.equal(got.unread, 1);
  assert.ok(b.notes.some(n => n.kind === 'msg'), 'notify com kind msg');
  // As sessões foram salvas antes de os bytes saírem (e a conversa, pela chave de sempre).
  assert.equal(typeof a.disk['msg.state'], 'string');
  assert.ok(Array.isArray(b.disk.chats));
});

test('remontar a tela (start de novo com as mesmas chaves) mantém a mesma instância', () => {
  const a = device('A');
  a.rt.start(a.keys);
  const m = a.rt.messenger();
  assert.ok(m);
  // Outro objeto com as mesmas chaves, como o KeysProvider remontado deriva.
  a.rt.start({ ...a.keys, identities: { public: deriveIdentity(a.seed, 'public'), anon: deriveIdentity(a.seed, 'anon') }, node: deriveNodeKey(a.seed) });
  assert.equal(a.rt.messenger(), m);
  let n = 0;
  const off = a.rt.subscribe(() => n++);
  off();
  assert.equal(a.rt.messenger(), m, 'deixar de assinar não descarta nada');
  assert.equal(n, 0);
});

test('rotação de sessão (outra época) troca o mensageiro e salva o anterior', () => {
  const a = device('A');
  a.rt.start(a.keys);
  const m = a.rt.messenger();
  a.rt.start({ ...a.keys, rotation: 1 });
  assert.notEqual(a.rt.messenger(), m);
  assert.equal(typeof a.disk['msg.state'], 'string');
});

test('só shutdown para: salva as sessões e descarta o mensageiro', async () => {
  const a = device('A');
  a.rt.start(a.keys);
  delete a.disk['msg.state'];
  await a.rt.shutdown();
  assert.equal(a.rt.messenger(), null);
  assert.equal(typeof a.disk['msg.state'], 'string');
});

test('ajustes salvos sem tela: mesmos padrões de Ajustes e Rede', () => {
  const p = persistedPrefs(k => ({ 'net.relay': false, 'set.priv': { find: 'contacts' }, blocked: [{ id: 'piu:x', name: 'X', initials: 'X', at: 1, how: 'pela conversa', reported: false }, { id: 'demo', name: 'D', initials: 'D', at: 1, how: 'pela conversa', reported: false }] } as Record<string, unknown>)[k] as never);
  assert.equal(p.relay, false);
  assert.equal(p.priv.find, 'contacts');
  assert.equal(p.priv.pad, true);
  assert.deepEqual(p.blocked, ['piu:x']);
  assert.equal(p.policy.maxBytes, 512 * 1024 * 1024);
  assert.equal(p.policy.retentionSec, 48 * 3600);
});
