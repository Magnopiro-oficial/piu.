/**
 * Mensageiro fora da árvore React (plano "app fechado", fatia 5). Dois núcleos sobre o transporte
 * simulado, ligados por um "cabo" em memória, sem nenhuma tela montada: A envia, B grava no
 * `chatStore` e notifica. Remontar a tela (start de novo com as mesmas chaves) não cria outro
 * Messenger; só `shutdown` para e salva.
 */
import assert from 'node:assert/strict';
import { after, mock, test } from 'node:test';
import { deriveIdentity, deriveNodeKey, newSeed, toPublic } from '../../protocol/keys';
import { createSimulatedTransport } from '../../transport/simulated';
import type { Transport, TransportEvent } from '../../transport/types';
import type { Contact } from '../../messaging/messenger';
import type { Msg } from '../../data/types';
import type { PhoneCall } from '../../state/calls';
import { createChatStore, SWEEP_MS } from '../chatStore';
import { chatFor, chatIdFor, createMessengerRuntime, persistedPrefs, type RuntimeHost, type RuntimeKeys } from '../messengerRuntime';

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

function device(id: string, host?: Partial<RuntimeHost>) {
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
    prefs: { ...persistedPrefs(() => undefined), relay: true }, host,
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

/** A escaneou o QR de B (chaves públicas e o convite de uso único) e já tem a conversa. */
function scan(a: ReturnType<typeof device>, b: ReturnType<typeof device>, name: string): Contact {
  const c: Contact = { id: b.keys.identities.public.id, via: 'public', pub: toPublic(b.keys.identities.public), name, invite: b.rt.messenger()!.issueInvite('public').code };
  a.rt.messenger()!.addContact(c);
  a.chats.addChat(chatFor(c, false, 'off'));
  return c;
}

test('sem tela: A envia, B (que já aceitou A) grava a mensagem no chatStore e notifica (kind msg)', async () => {
  const a = device('A'), b = device('B');
  a.rt.start(a.keys); b.rt.start(b.keys);
  cable(a, b);
  const beto = scan(a, b, 'Beto');
  // B também tem A como contato aceito (o pedido de conversa já foi aceito antes).
  const ana: Contact = { id: a.keys.identities.public.id, via: 'public', pub: toPublic(a.keys.identities.public), name: 'Ana' };
  b.rt.messenger()!.addContact(ana);
  b.chats.addChat(chatFor(ana, false, 'off'));
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

test('pedido de conversa (contato novo pelo convite) entra não lido, mas não notifica (como antes)', async () => {
  const a = device('A'), b = device('B');
  a.rt.start(a.keys); b.rt.start(b.keys);
  cable(a, b);
  const beto = scan(a, b, 'Beto');
  a.rt.messenger()!.sendText(beto.id, 'n1', 'oi, Beto');

  const cid = chatIdFor(a.keys.identities.public.id);
  await until(() => !!b.chats.getSnapshot().chats.find(c => c.id === cid)?.msgs?.some(m => m.id === 'in-n1'));
  const got = b.chats.getSnapshot().chats.find(c => c.id === cid)!;
  assert.equal(got.request, true);
  assert.equal(got.unread, 1);
  assert.deepEqual(b.notes, [], 'pedido não vira notificação');
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

/** Chamada falsa: só o estado e os comandos que a tela usaria. */
function fakeCall(phase: string) {
  const did: string[] = [];
  const call = { svc: { state: { phase }, controller: { hangup: () => did.push('hangup'), decline: () => did.push('decline') }, dispose: () => did.push('dispose'), onSignal: () => {}, onFrame: () => false, tryWaiting: () => {} } } as unknown as PhoneCall;
  return { call, did };
}

test('tela desmontou (detach): a chamada segue só onde o núcleo mostra o controle (aviso com o botão)', () => {
  // O núcleo (core/callAlertRunner.ts) diz em que fase há aviso com botão: tocando e em curso.
  const keepCall = (ph: string) => ph === 'ringing' || ph === 'active';
  for (const [phase, did] of [['active', []], ['ringing', []], ['calling', ['hangup']], ['idle', []]] as const) {
    const f = fakeCall(phase);
    const a = device('A', { makeCall: () => f.call });
    a.rt.start(a.keys);
    a.rt.detach({ relay: false, keepCall });
    assert.deepEqual(f.did, did, phase);
    assert.equal(a.rt.getSnapshot().call, f.call, phase);
    assert.ok(a.rt.messenger(), 'o mensageiro continua');
  }
});

test('tela desmontou sem controle no núcleo (iPhone, sem permissão de notificação): desliga em curso, recusa tocando', () => {
  for (const [phase, did] of [['active', ['hangup']], ['calling', ['hangup']], ['ringing', ['decline']], ['idle', []]] as const) {
    const f = fakeCall(phase);
    const a = device('A', { makeCall: () => f.call });
    a.rt.start(a.keys);
    a.rt.detach({ relay: false });
    assert.deepEqual(f.did, did, phase);
    const g = fakeCall(phase);
    const b = device('B', { makeCall: () => g.call });
    b.rt.start(b.keys);
    b.rt.detach({ relay: false, keepCall: () => false });
    assert.deepEqual(g.did, did, phase);
  }
});

test('tela desmontou: sem a pausa por bateria da tela, a retransmissão para terceiros desliga; a tela de volta religa', () => {
  const a = device('A');
  a.rt.start(a.keys);
  const m = a.rt.messenger()!;
  assert.notEqual(m.relayStatus().reason, 'off');
  a.rt.detach({ relay: false });
  assert.equal(m.relayStatus().reason, 'off');
  a.rt.setPrefs({ relay: true });
  assert.notEqual(m.relayStatus().reason, 'off');
  // Ponto Piu ativo: o ponto mantém a retransmissão.
  a.rt.detach({ relay: true });
  assert.notEqual(m.relayStatus().reason, 'off');
});

test('mensagens temporárias vencidas somem no prazo mesmo sem tela (varredura do núcleo)', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const a = device('A');
    a.rt.start(a.keys);
    a.chats.addChat({ id: 'c1', kind: 'direct', ident: 'public', name: 'X', initials: 'X', time: '', unread: 0, msgs: [] } as never);
    a.chats.push('c1', { id: 'in-1', from: 'them', text: 'some', time: '', expiresAt: Date.now() - 1 } as Msg);
    assert.equal(a.chats.getSnapshot().chats[0]!.msgs!.length, 1);
    mock.timers.tick(SWEEP_MS);
    assert.equal(a.chats.getSnapshot().chats[0]!.msgs!.length, 0);
    await a.rt.shutdown();
  } finally { mock.timers.reset(); }
});

test('várias mudanças nas conversas no mesmo instante: a poda de rotas e arquivos roda uma vez', async () => {
  const a = device('A');
  let reads = 0;
  const get = a.chats.getSnapshot;
  const chats = { ...a.chats, getSnapshot: () => { reads++; return get(); } };
  const rt = createMessengerRuntime({ transport: a.net.t, chats, read: () => undefined, persistNow: async () => {}, forget: async () => {}, epoch: () => 0, prefs: persistedPrefs(() => undefined) });
  await new Promise(r => setTimeout(r, 0));
  a.chats.addChat({ id: 'c1', kind: 'direct', ident: 'public', name: 'X', initials: 'X', time: '', unread: 0, msgs: [] } as never);
  reads = 0;
  for (let i = 0; i < 50; i++) a.chats.patchChat('c1', { time: String(i) });
  assert.equal(reads, 0, 'nada síncrono a cada mudança');
  await new Promise(r => setTimeout(r, 0));
  assert.equal(reads, 1);
  await rt.dispose();
});

test('backup restaurado antes da tela: o perfil espera o dono (setHost) em vez de se perder', () => {
  let taken = false;
  const a = device('A', { takeRestoredData: () => (taken ? null : (taken = true, { profile: { name: 'Ana' } as unknown })) });
  a.rt.start(a.keys);
  const got: unknown[] = [];
  a.rt.setHost({ importProfile: p => got.push(p) });
  assert.deepEqual([...got], [{ name: 'Ana' }]);
  a.rt.setHost({ importProfile: undefined });
  a.rt.setHost({ importProfile: p => got.push(p) });
  assert.equal(got.length, 1, 'entregue uma vez');
});
