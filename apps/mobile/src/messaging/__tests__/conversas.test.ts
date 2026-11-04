/// <reference types="node" />
/**
 * Conversas com dados reais: rota (meio, envelope e prioridade) nos eventos, prioridade do canal no
 * cabeçalho, localização em texto curto, editar grupo e apagar contato com limpeza da fila.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHeader, Priority } from '../../protocol/envelope';
import { deriveIdentity, deriveNodeKey, newSeed, toPublic } from '../../protocol/keys';
import { decodeState, encodeState } from '../groups';
import { type Contact, type IncomingText, Messenger, type RouteInfo } from '../messenger';

const T0 = 1_800_000_000;

class Net {
  clock = T0;
  nodes = new Map<string, Messenger>();
  links = new Set<string>();
  queue: [string, string, Uint8Array][] = [];
  wire: [string, string, Uint8Array][] = [];
  key = (a: string, b: string) => [a, b].sort().join('~');
  transmit = (from: string) => async (to: string, bytes: Uint8Array) => {
    if (this.links.has(this.key(from, to))) { this.queue.push([from, to, bytes]); this.wire.push([from, to, bytes]); }
  };
  run() { for (let i = 0; i < 5000 && this.queue.length; i++) { const [f, t, b] = this.queue.shift()!; this.nodes.get(t)!.receive(f, b); } }
  link(a: string, b: string, via: 'ble' | 'direct' = 'ble') { this.links.add(this.key(a, b)); this.nodes.get(a)!.peerConnected(b, via); this.nodes.get(b)!.peerConnected(a, via); this.run(); }
}

type Dev = ReturnType<typeof device>;
function device(net: Net, name: string) {
  const seed = newSeed();
  const ids = { public: deriveIdentity(seed, 'public'), anon: deriveIdentity(seed, 'anon') };
  const log = { msgs: [] as IncomingText[], status: [] as [string, string, RouteInfo | undefined][], group: [] as IncomingText[] };
  const m = new Messenger({
    identities: ids, node: deriveNodeKey(seed), relay: true, now: () => net.clock, transmit: net.transmit(name),
    events: {
      message: (_c, x) => log.msgs.push(x),
      newContact: (_c, x) => log.msgs.push(x),
      status: (id, s, r) => log.status.push([id, s, r]),
      groupMessage: (_g, _f, _w, x) => log.group.push(x),
    },
  });
  m.displayName = name;
  net.nodes.set(name, m);
  return { m, ids, log, name };
}
const know = (x: Dev, y: Dev) => x.m.addContact({ id: y.ids.public.id, via: 'public', pub: toPublic(y.ids.public), name: y.name } satisfies Contact);

test('rota real: "encaminhada" traz meio, tamanho e prioridade do envelope; quem recebe vê meio e saltos', () => {
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto');
  know(a, b); know(b, a);
  a.m.sendText(b.ids.public.id, 'n1', 'Oi Beto');
  net.link('Ana', 'Beto', 'direct');
  const fwd = a.log.status.find(([id, s]) => id === 'n1' && s === 'encaminhada');
  assert.ok(fwd?.[2], 'a rota vem junto');
  const out = net.wire.find(([f, t, bytes]) => f === 'Ana' && t === 'Beto' && bytes.length === fwd![2]!.bytes);
  assert.ok(out, 'o tamanho é o do envelope que saiu');
  assert.equal(fwd![2]!.via, 'direct');
  assert.equal(fwd![2]!.peer, 'Beto');
  assert.equal(fwd![2]!.priority, Priority.Normal);
  assert.equal(parseHeader(out![2]).priority, Priority.Normal);
  const got = b.log.msgs[0];
  assert.equal(got.text, 'Oi Beto');
  assert.equal(got.route?.peer, 'Ana');
  assert.equal(got.route?.via, 'direct');
  assert.equal(got.route?.hops, 1, 'vizinho direto: 1 salto');
  assert.ok((got.route?.bytes ?? 0) > 100);
});

test('rota real: por um relay, quem recebe conta 2 saltos e o meio do último enlace', () => {
  const net = new Net();
  const a = device(net, 'Ana'), r = device(net, 'Rui'), b = device(net, 'Beto');
  know(a, b); know(b, a);
  net.link('Ana', 'Rui', 'direct');
  a.m.sendText(b.ids.public.id, 'n1', 'Pelo Rui');
  net.link('Rui', 'Beto', 'ble');
  void r;
  assert.equal(b.log.msgs[0]?.text, 'Pelo Rui');
  assert.equal(b.log.msgs[0]?.route?.hops, 2);
  assert.equal(b.log.msgs[0]?.route?.via, 'ble');
});

test('2.7 prioridade: canal "Alta" sai com prioridade alta no cabeçalho; grupo comum, Normal', () => {
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto');
  know(a, b); know(b, a);
  const ch = a.m.createGroup({ kind: 'channel', name: 'Defesa Civil', via: 'public', memberIds: [b.ids.public.id], visibility: 'public', prio: 'high' });
  const g = a.m.createGroup({ kind: 'group', name: 'Mutirão', via: 'public', memberIds: [b.ids.public.id], prio: 'high' });
  net.link('Ana', 'Beto');
  assert.equal(b.m.getGroup(ch.id)?.prio, 'high', 'a prioridade vai no estado do canal');
  assert.equal(b.m.getGroup(g.id)?.prio, undefined, 'só canal tem prioridade');
  assert.equal(a.m.groupPriority(ch.id), Priority.High);
  assert.equal(a.m.groupPriority(g.id), Priority.Normal);
  net.wire.length = 0;
  a.m.sendGroupText(ch.id, 'p1', 'Alerta: estrada interditada');
  net.run();
  const fwd = a.log.status.find(([id, s]) => id === 'p1' && s === 'encaminhada');
  assert.equal(fwd?.[2]?.priority, Priority.High);
  assert.equal(b.log.group.at(-1)?.route?.priority, Priority.High, 'quem recebe lê do cabeçalho');
  const env = net.wire.find(([f, , bytes]) => f === 'Ana' && bytes.length === fwd![2]!.bytes);
  assert.equal(parseHeader(env![2]).priority, Priority.High);
  a.m.sendGroupText(g.id, 'p2', 'Oi');
  net.run();
  assert.equal(a.log.status.find(([id, s]) => id === 'p2' && s === 'encaminhada')?.[2]?.priority, Priority.Normal);
  // Estado recebido com prioridade num grupo comum é ignorado.
  const st = JSON.parse(encodeState(a.m.getGroup(g.id)!, 'store'));
  assert.equal(decodeState(JSON.stringify({ ...st, prio: 'high' }), 'public')?.prio, undefined);
});

test('2.6 localização: coordenadas e nome do lugar chegam na conversa e no grupo; inválidas não saem', () => {
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto');
  know(a, b); know(b, a);
  net.link('Ana', 'Beto');
  a.m.sendText(b.ids.public.id, 'n1', 'Portão do galpão', undefined, { lat: -23.550521, lon: -46.633308 });
  net.run();
  assert.deepEqual(b.log.msgs[0].loc, { lat: -23.55052, lon: -46.63331 });
  assert.equal(b.log.msgs[0].text, 'Portão do galpão');
  assert.throws(() => a.m.sendText(b.ids.public.id, 'n2', 'x', undefined, { lat: 91, lon: 0 }), /inválidas/);
  const g = a.m.createGroup({ kind: 'group', name: 'Mutirão', via: 'public', memberIds: [b.ids.public.id] });
  net.run();
  a.m.sendGroupText(g.id, 'p1', '-22.90000, -43.20000', { lat: -22.9, lon: -43.2 });
  net.run();
  assert.deepEqual(b.log.group.at(-1)?.loc, { lat: -22.9, lon: -43.2 });
  // Texto comum não vira localização.
  a.m.sendText(b.ids.public.id, 'n3', 'sem mapa');
  net.run();
  assert.equal(b.log.msgs.at(-1)?.loc, undefined);
});

test('7 editar grupo: admin muda nome e descrição (com limites); membro recebe; nome vazio não vale', () => {
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto');
  know(a, b); know(b, a);
  const com = a.m.createGroup({ kind: 'community', name: 'Vila', via: 'public', memberIds: [b.ids.public.id] });
  const g = a.m.createGroup({ kind: 'channel', name: 'Avisos', via: 'public', memberIds: [b.ids.public.id], parent: com.id });
  net.link('Ana', 'Beto');
  a.m.updateGroup(g.id, { name: '  Avisos da Vila  ', desc: 'd'.repeat(300) });
  net.run();
  assert.equal(b.m.getGroup(g.id)?.name, 'Avisos da Vila');
  assert.equal(b.m.getGroup(g.id)?.desc.length, 200);
  assert.equal(a.m.getGroup(com.id)?.children?.find(x => x.id === g.id)?.name, 'Avisos da Vila', 'a comunidade mostra o nome novo');
  assert.throws(() => a.m.updateGroup(g.id, { name: '   ' }), /vazio/);
  assert.throws(() => b.m.updateGroup(g.id, { name: 'Meu' }), /Só admins/);
});

test('7 apagar contato: a fila para ele é descartada e mensagem nova dele sem convite não entra', () => {
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto');
  know(a, b); know(b, a);
  a.m.sendText(b.ids.public.id, 'n1', 'fica na fila');
  a.m.sendFile(b.ids.public.id, 'f1', { name: 'x.bin', mime: 'application/octet-stream', data: new Uint8Array(30_000) });
  assert.deepEqual(a.m.pendingFor(b.ids.public.id), ['n1']);
  assert.equal(a.m.hasFileJob('f1'), true);
  a.m.removeContact(b.ids.public.id);
  assert.deepEqual(a.m.pendingFor(b.ids.public.id), []);
  assert.equal(a.m.hasFileJob('f1'), false);
  assert.equal(a.m.getContact(b.ids.public.id), undefined);
  net.wire.length = 0;
  net.link('Ana', 'Beto');
  assert.equal(net.wire.filter(([f]) => f === 'Ana').length, 0, 'nada da fila apagada sai (texto, oferta e blocos)');
  assert.equal(b.log.msgs.length, 0);
  b.m.sendText(a.ids.public.id, 'm1', 'oi?');
  net.run();
  assert.equal(a.log.msgs.length, 0, 'sem convite novo, não volta como conversa');
});
