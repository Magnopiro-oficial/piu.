/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveIdentity, deriveNodeKey, newSeed, toPublic } from '../../protocol/keys';
import { decodeCard, encodeCard, unb64url, b64url } from '../card';
import { type Contact, Messenger } from '../messenger';

const T0 = 1_800_000_000;

/** Malha em memória: links entre aparelhos, entregues de forma síncrona numa fila. */
class Net {
  clock = T0;
  nodes = new Map<string, Messenger>();
  links = new Set<string>();
  queue: [string, string, Uint8Array][] = [];
  wire: Uint8Array[] = [];
  key = (a: string, b: string) => [a, b].sort().join('~');
  transmit = (from: string) => async (to: string, bytes: Uint8Array) => {
    if (this.links.has(this.key(from, to))) { this.queue.push([from, to, bytes]); this.wire.push(bytes); }
  };
  run() {
    for (let i = 0; i < 1000 && this.queue.length; i++) { const [f, t, b] = this.queue.shift()!; this.nodes.get(t)!.receive(f, b); }
  }
  link(a: string, b: string) { this.links.add(this.key(a, b)); this.nodes.get(a)!.peerConnected(b, 'ble'); this.nodes.get(b)!.peerConnected(a, 'ble'); this.run(); }
  unlink(a: string, b: string) { this.links.delete(this.key(a, b)); this.nodes.get(a)!.peerDisconnected(b); this.nodes.get(b)!.peerDisconnected(a); }
}

function device(net: Net, name: string, opts: { relay?: boolean; seed?: Uint8Array; state?: string } = {}) {
  const seed = opts.seed ?? newSeed();
  const ids = { public: deriveIdentity(seed, 'public'), anon: deriveIdentity(seed, 'anon') };
  const log = { msgs: [] as [string, string][], status: [] as [string, string][], requests: [] as Contact[] };
  const m = new Messenger({
    identities: ids, node: deriveNodeKey(seed), relay: opts.relay ?? true, now: () => net.clock, transmit: net.transmit(name), state: opts.state,
    events: {
      message: (c, x) => log.msgs.push([c, x.text]),
      newContact: (c, x) => { log.requests.push(c); log.msgs.push([c.id, x.text]); },
      status: (id, s) => log.status.push([id, s]),
    },
  });
  m.displayName = name;
  net.nodes.set(name, m);
  return { m, ids, seed, log };
}

/** Como escanear o QR de `d`: chaves públicas + convite de uso único emitido por `d`. */
const contactOf = (d: ReturnType<typeof device>, name: string, via: 'public' | 'anon' = 'public'): Contact =>
  ({ id: d.ids[via].id, via, pub: toPublic(d.ids[via]), name, invite: d.m.issueInvite(via).code });
const INV = { code: '0011223344556677', expiresAt: T0 + 24 * 3600 };

test('cartão de contato: ida e volta, assinatura, validade e adulteração', () => {
  const me = deriveIdentity(newSeed(), 'public');
  const code = encodeCard(me, 'Cardeal', INV);
  const c = decodeCard(code, T0 + 10);
  assert.equal(c.id, me.id);
  assert.equal(c.name, 'Cardeal');
  assert.equal(c.invite, INV.code);
  assert.throws(() => decodeCard(code, T0 + 25 * 3600), /venceu/);
  const raw = unb64url(code.slice(5)); raw[40] ^= 1;
  assert.throws(() => decodeCard('piu1:' + b64url(raw), T0), /não confere|corrompido/);
  assert.throws(() => decodeCard(code.slice(0, -10), T0), /incompleto|corrompido|não confere/);
  assert.throws(() => decodeCard('https://exemplo.com', T0), /não é um código/);
  // Anônima: o cartão não leva nome.
  const anon = deriveIdentity(newSeed(), 'anon');
  assert.equal(decodeCard(encodeCard(anon, 'Não vaza', INV), T0).name, '');
  // Nome longo é cortado sem quebrar caracteres.
  assert.ok(decodeCard(encodeCard(me, 'á'.repeat(60), INV), T0).name.length <= 24);
});

test('direto: entrega, recibo de entrega cifrado e pedido de conversa', () => {
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto');
  a.m.addContact(contactOf(b, 'Beto'));
  a.m.sendText(b.ids.public.id, 'm1', 'Oi Beto');
  assert.deepEqual(a.m.pendingFor(b.ids.public.id), ['m1']);
  net.link('Ana', 'Beto');
  assert.deepEqual(b.log.msgs, [[a.ids.public.id, 'Oi Beto']]);
  assert.equal(b.log.requests.length, 1, 'quem não tinha o código recebe como pedido');
  assert.equal(b.log.requests[0].name, 'Ana');
  assert.deepEqual(a.log.status, [['m1', 'encaminhada'], ['m1', 'entregue']]);
  assert.deepEqual(a.m.pendingFor(b.ids.public.id), []);
  // Resposta usa a mesma sessão; nada de texto em claro no fio.
  b.m.addContact(b.log.requests[0]);
  b.m.sendText(a.ids.public.id, 'r1', 'Oi Ana');
  net.run();
  assert.deepEqual(a.log.msgs, [[b.ids.public.id, 'Oi Ana']]);
  for (const w of net.wire) assert.ok(!Buffer.from(w).includes(Buffer.from('Oi ')), 'texto não aparece no fio');
});

test('store-and-forward por um relay que não lê nada', () => {
  const net = new Net();
  const a = device(net, 'Ana'), r = device(net, 'Relay'), b = device(net, 'Beto');
  a.m.addContact(contactOf(b, 'Beto'));
  b.m.addContact(contactOf(a, 'Ana'));
  a.m.sendText(b.ids.public.id, 'm1', 'Pela malha');
  net.link('Ana', 'Relay');
  net.unlink('Ana', 'Relay');
  assert.equal(r.log.msgs.length, 0);
  net.clock += 600;
  net.link('Relay', 'Beto');
  assert.deepEqual(b.log.msgs, [[a.ids.public.id, 'Pela malha']]);
  assert.deepEqual(a.log.status, [['m1', 'encaminhada']], 'recibo ainda não voltou');
  net.unlink('Relay', 'Beto');
  net.link('Relay', 'Ana');
  assert.deepEqual(a.log.status.at(-1), ['m1', 'entregue']);
});

test('Modo nó desligado: não guarda mensagens de terceiros', () => {
  const net = new Net();
  const a = device(net, 'Ana'), r = device(net, 'Relay', { relay: false }), b = device(net, 'Beto');
  a.m.addContact(contactOf(b, 'Beto'));
  a.m.sendText(b.ids.public.id, 'm1', 'x');
  net.link('Ana', 'Relay'); net.unlink('Ana', 'Relay');
  net.link('Relay', 'Beto');
  assert.equal(b.log.msgs.length, 0);
});

test('reabrir o app: fila, sessões e ids vistos sobrevivem; replay depois de reabrir é ignorado', () => {
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto');
  a.m.addContact(contactOf(b, 'Beto'));
  b.m.addContact(contactOf(a, 'Ana'));
  a.m.sendText(b.ids.public.id, 'm1', 'Antes de fechar');
  // Ana fecha o app sem ninguém por perto.
  const a2 = device(net, 'Ana', { seed: a.seed, state: a.m.export() });
  assert.deepEqual(a2.m.pendingFor(b.ids.public.id), ['m1']);
  net.link('Ana', 'Beto');
  assert.deepEqual(b.log.msgs, [[a.ids.public.id, 'Antes de fechar']]);
  assert.deepEqual(a2.log.status.at(-1), ['m1', 'entregue']);
  const captured = net.wire.slice();
  // Beto reabre; um atacante repete tudo o que passou no fio.
  const b2 = device(net, 'Beto', { seed: b.seed, state: b.m.export() });
  for (const w of captured) b2.m.receive('Atacante', w);
  net.run();
  assert.equal(b2.log.msgs.length, 0, 'nada repetido aparece de novo');
  net.unlink('Ana', 'Beto'); net.link('Ana', 'Beto'); // reconectam depois de reabrir
  // A sessão continua funcionando nos dois sentidos depois de reabrir.
  b2.m.sendText(a.ids.public.id, 'r1', 'Depois de reabrir');
  net.run();
  assert.deepEqual(a2.log.msgs, [[b.ids.public.id, 'Depois de reabrir']]);
  a2.m.sendText(b.ids.public.id, 'm2', 'De novo');
  net.run();
  assert.deepEqual(b2.log.msgs.at(-1), [a.ids.public.id, 'De novo']);
});

test('identidade anônima: conversa separada, sem nome no pedido', () => {
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto');
  a.m.addContact({ ...contactOf(b, '', 'anon'), via: 'anon' });
  a.m.sendText(b.ids.anon.id, 'm1', 'Anônimo para anônimo');
  net.link('Ana', 'Beto');
  assert.equal(b.log.requests.length, 1);
  assert.equal(b.log.requests[0].via, 'anon');
  assert.equal(b.log.requests[0].id, a.ids.anon.id);
  assert.equal(b.log.requests[0].name, '');
  assert.notEqual(b.log.requests[0].id, a.ids.public.id);
});

test('contatos: recusa o próprio código e chaves trocadas', () => {
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto'), e = device(net, 'Eva');
  assert.throws(() => a.m.addContact(contactOf(a, 'eu')), /próprio/);
  const forged = { ...contactOf(b, 'Beto'), pub: { ...toPublic(b.ids.public), agreePk: e.ids.public.agreePk } };
  assert.throws(() => a.m.addContact(forged), /inválidas/);
});

test('expiração: sem rota até o fim do TTL, a mensagem sai da fila como "expirada"', () => {
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto');
  a.m.addContact(contactOf(b, 'Beto'));
  a.m.sendText(b.ids.public.id, 'm1', 'Ninguém por perto');
  net.clock += 2 * 24 * 3600;
  a.m.tick();
  assert.deepEqual(a.m.pendingFor(b.ids.public.id), ['m1'], 'ainda dentro do TTL de 3 dias');
  net.clock += 2 * 24 * 3600;
  a.m.tick();
  assert.deepEqual(a.m.pendingFor(b.ids.public.id), []);
  assert.deepEqual(a.log.status.at(-1), ['m1', 'expirada']);
});

test('QR de uso único: o segundo uso e quem não tem convite são recusados; novo código revoga o anterior', () => {
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto'), e = device(net, 'Eva');
  const inv = b.m.issueInvite('public');
  assert.equal(b.m.issueInvite('public').code, inv.code, 'o mesmo QR enquanto não for usado');
  const card = { id: b.ids.public.id, via: 'public' as const, pub: toPublic(b.ids.public), name: 'Beto', invite: inv.code };
  a.m.addContact(card);
  e.m.addContact(card); // Eva fotografou o mesmo QR
  a.m.sendText(b.ids.public.id, 'a1', 'Sou a Ana');
  net.link('Ana', 'Beto');
  assert.equal(b.log.requests.length, 1);
  assert.notEqual(b.m.issueInvite('public').code, inv.code, 'usado: o QR troca de código');
  e.m.sendText(b.ids.public.id, 'e1', 'Sou a Eva');
  net.link('Eva', 'Beto');
  assert.equal(b.log.requests.length, 1, 'convite já usado: Eva não entra');
  assert.ok(!b.log.msgs.some(([, t]) => t === 'Sou a Eva'));
  // Sem convite nenhum (só a chave pública): também não.
  const f = device(net, 'Fred');
  f.m.addContact({ id: b.ids.public.id, via: 'public', pub: toPublic(b.ids.public), name: 'Beto' });
  f.m.sendText(b.ids.public.id, 'f1', 'Sem convite');
  net.link('Fred', 'Beto');
  assert.equal(b.log.requests.length, 1);
  // "Gerar novo código" revoga o anterior ainda não usado.
  const old = b.m.issueInvite('public');
  const fresh = b.m.issueInvite('public', true);
  assert.notEqual(fresh.code, old.code);
  const g = device(net, 'Gil');
  g.m.addContact({ ...card, invite: old.code });
  g.m.sendText(b.ids.public.id, 'g1', 'Com o código revogado');
  net.link('Gil', 'Beto');
  assert.equal(b.log.requests.length, 1);
  // Convite da identidade pública não abre conversa na anônima.
  const h = device(net, 'Hugo');
  h.m.addContact({ id: b.ids.anon.id, via: 'anon', pub: toPublic(b.ids.anon), name: '', invite: fresh.code });
  h.m.sendText(b.ids.anon.id, 'h1', 'Convite trocado de identidade');
  net.link('Hugo', 'Beto');
  assert.equal(b.log.requests.length, 1);
});
