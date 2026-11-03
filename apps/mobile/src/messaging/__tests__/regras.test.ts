/// <reference types="node" />
/**
 * Regras de negócio do mensageiro (docs/regras/mapa-regras-negocio.md): canal privado, convite por
 * membros, troca de chave na revogação, prazo, leitura, "digitando…", temporárias e créditos.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveIdentity, deriveNodeKey, newSeed, toPublic } from '../../protocol/keys';
import { b64url } from '../card';
import { type Contact, Messenger, type MessengerEvents } from '../messenger';

const T0 = 1_800_000_000;

/** Malha em memória (a mesma de messenger.test.ts). */
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
    for (let i = 0; i < 5000 && this.queue.length; i++) { const [f, t, b] = this.queue.shift()!; this.nodes.get(t)!.receive(f, b); }
  }
  link(a: string, b: string) { this.links.add(this.key(a, b)); this.nodes.get(a)!.peerConnected(b, 'ble'); this.nodes.get(b)!.peerConnected(a, 'ble'); this.run(); }
  unlink(a: string, b: string) { this.links.delete(this.key(a, b)); this.nodes.get(a)!.peerDisconnected(b); this.nodes.get(b)!.peerDisconnected(a); }
}

type Dev = ReturnType<typeof device>;
function device(net: Net, name: string, opts: { relay?: boolean; seed?: Uint8Array; state?: string; events?: Partial<MessengerEvents> } = {}) {
  const seed = opts.seed ?? newSeed();
  const ids = { public: deriveIdentity(seed, 'public'), anon: deriveIdentity(seed, 'anon') };
  const log = { msgs: [] as [string, string][], status: [] as [string, string][], group: [] as [string, string][] };
  const m = new Messenger({
    identities: ids, node: deriveNodeKey(seed), relay: opts.relay ?? true, now: () => net.clock, transmit: net.transmit(name), state: opts.state,
    events: {
      message: (c, x) => log.msgs.push([c, x.text]),
      newContact: (c, x) => log.msgs.push([c.id, x.text]),
      status: (id, s) => log.status.push([id, s]),
      groupMessage: (_g, _f, who, x) => log.group.push([who, x.text]),
      ...opts.events,
    },
  });
  m.displayName = name;
  net.nodes.set(name, m);
  return { m, ids, seed, log, name };
}
const know = (x: Dev, y: Dev) => x.m.addContact({ id: y.ids.public.id, via: 'public', pub: toPublic(y.ids.public), name: y.name } satisfies Contact);

/** Ana, Beto, Caio e Davi: Ana conhece todos; os outros só conhecem Ana. Todos ligados a Ana. */
function star() {
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto'), c = device(net, 'Caio'), d = device(net, 'Davi');
  for (const x of [b, c, d]) { know(a, x); know(x, a); }
  const all = () => { for (const x of ['Beto', 'Caio', 'Davi']) net.link('Ana', x); };
  return { net, a, b, c, d, all };
}

// ── 3.1 canal privado/secreto ────────────────────────────────────────

test('3.1 canal privado: inscrito não recebe ids nem chaves dos outros inscritos', () => {
  const { net, a, b, c, d, all } = star();
  const ch = a.m.createGroup({ kind: 'channel', name: 'Brigada', via: 'public', memberIds: [b.ids.public.id, c.ids.public.id, d.ids.public.id], visibility: 'private' });
  all();
  const seen = b.m.getGroup(ch.id)!;
  assert.deepEqual(seen.members.map(m => m.id).sort(), [a.ids.public.id, b.ids.public.id].sort(), 'só o admin e ele mesmo');
  assert.equal(seen.count, 4, 'o total continua visível');
  // Nada dos outros inscritos fica guardado no aparelho de Beto (nem id nem chave pública).
  const saved = b.m.export();
  for (const other of [c, d]) {
    assert.ok(!saved.includes(other.ids.public.id), 'id de outro inscrito não chega');
    assert.ok(!saved.includes(b64url(other.ids.public.signPk)), 'chave de outro inscrito não chega');
  }
  // O admin continua com a lista completa.
  assert.equal(a.m.getGroup(ch.id)!.members.length, 4);
  // Publicação continua chegando; remover Caio troca a chave e Beto segue lendo, com o total novo.
  a.m.sendGroupText(ch.id, 'p1', 'Ponto de encontro: escola');
  net.run();
  assert.deepEqual(b.log.group, [['Ana', 'Ponto de encontro: escola']]);
  a.m.removeMember(ch.id, c.ids.public.id);
  net.run();
  assert.equal(b.m.getGroup(ch.id)!.keyV, 2);
  assert.equal(b.m.getGroup(ch.id)!.count, 3);
  assert.equal(c.m.getGroup(ch.id), undefined, 'Caio saiu e apagou o canal');
  a.m.sendGroupText(ch.id, 'p2', 'Depois da troca');
  net.run();
  assert.ok(b.log.group.some(([, t]) => t === 'Depois da troca'));
  assert.ok(!c.log.group.some(([, t]) => t === 'Depois da troca'));
  // Estado salvo e restaurado continua valendo (o total vem junto).
  const b2 = device(net, 'Beto', { seed: b.seed, state: b.m.export() });
  assert.equal(b2.m.getGroup(ch.id)!.count, 3);
});

test('3.1 canal secreto esconde inscritos; promovido a admin recebe a lista; canal público e grupo mostram todos', () => {
  const { net, a, b, c, d, all } = star();
  const sec = a.m.createGroup({ kind: 'channel', name: 'S', via: 'public', memberIds: [b.ids.public.id, c.ids.public.id], visibility: 'secret' });
  const pub = a.m.createGroup({ kind: 'channel', name: 'P', via: 'public', memberIds: [b.ids.public.id, c.ids.public.id], visibility: 'public' });
  const grp = a.m.createGroup({ kind: 'group', name: 'G', via: 'public', memberIds: [b.ids.public.id, d.ids.public.id] });
  all();
  assert.ok(!b.m.getGroup(sec.id)!.members.some(m => m.id === c.ids.public.id));
  assert.ok(b.m.getGroup(pub.id)!.members.some(m => m.id === c.ids.public.id));
  assert.ok(b.m.getGroup(grp.id)!.members.some(m => m.id === d.ids.public.id));
  // Moderador também não vê os inscritos; admin vê.
  a.m.updateGroup(sec.id, { postMods: true });
  a.m.setRole(sec.id, b.ids.public.id, 'mod');
  net.run();
  assert.ok(!b.m.getGroup(sec.id)!.members.some(m => m.id === c.ids.public.id), 'moderador: só admins e moderadores');
  assert.ok(c.m.getGroup(sec.id)!.members.some(m => m.id === b.ids.public.id && m.role === 'mod'), 'inscritos veem quem modera');
  a.m.setRole(sec.id, b.ids.public.id, 'admin');
  net.run();
  assert.ok(b.m.getGroup(sec.id)!.members.some(m => m.id === c.ids.public.id), 'admin novo recebe a lista completa');
});

test('3.1 inscrito não aceita estado forjado por outro inscrito', () => {
  const { net, a, b, c, all } = star();
  know(b, c); know(c, b);
  net.link('Beto', 'Caio');
  const ch = a.m.createGroup({ kind: 'channel', name: 'Brigada', via: 'public', memberIds: [b.ids.public.id, c.ids.public.id], visibility: 'private' });
  all();
  const forged = { ...b.m.getGroup(ch.id)!, rev: 50, name: 'Golpe', members: b.m.getGroup(ch.id)!.members.map(m => ({ ...m, role: 'admin' as const })) };
  (b.m as unknown as { distribute: (x: unknown) => void }).distribute(forged);
  net.run();
  assert.equal(c.m.getGroup(ch.id)!.name, 'Brigada');
});

// ── 3.3 "Quem pode convidar: Todos os membros" ───────────────────────

/** Ana (admin) e Beto se conhecem; Caio só conhece Beto. Malha Ana – Beto – Caio. */
function chain() {
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto'), c = device(net, 'Caio');
  know(a, b); know(b, a); know(b, c); know(c, b);
  const all = () => { net.link('Ana', 'Beto'); net.link('Beto', 'Caio'); };
  return { net, a, b, c, all };
}
type Internals = { o: { events: Record<string, unknown> }; distribute: (x: unknown) => void; enqueue: (ct: unknown, p: unknown, i: null, pr: number) => void; inviteAsMember: (g: unknown, ids: string[]) => void };
const inner = (m: Messenger) => m as unknown as Internals;

test('3.3 membro convida com "Todos os membros": o admin confere e o convidado entra, mesmo sem conhecer o admin', () => {
  const { net, a, b, c, all } = chain();
  const g = a.m.createGroup({ kind: 'group', name: 'Mutirão', via: 'public', memberIds: [b.ids.public.id], inv: 'all', approve: false });
  all();
  assert.ok(b.m.canInvite(g.id));
  b.m.addMembers(g.id, [c.ids.public.id]);
  net.run();
  assert.ok(a.m.getGroup(g.id)!.members.some(m => m.id === c.ids.public.id), 'o admin adicionou');
  assert.equal(c.m.getGroup(g.id)?.name, 'Mutirão', 'Caio aceitou o estado do admin indicado por Beto');
  a.m.sendGroupText(g.id, 'g1', 'Bem-vindo, Caio');
  net.run();
  assert.ok(c.log.group.some(([, t]) => t === 'Bem-vindo, Caio'));
});

test('3.3 com "Admins", o membro não convida; com "Aprovar quem entra", o pedido aguarda o admin', () => {
  const { net, a, b, c, all } = chain();
  const g = a.m.createGroup({ kind: 'group', name: 'Feira', via: 'public', memberIds: [b.ids.public.id], inv: 'admins' });
  all();
  assert.equal(b.m.canInvite(g.id), false);
  assert.throws(() => b.m.addMembers(g.id, [c.ids.public.id]), /permissão/);
  // Beto forja a indicação mesmo assim: o admin confere a regra e ignora.
  inner(b.m).inviteAsMember(b.m.getGroup(g.id)!, [c.ids.public.id]);
  net.run();
  assert.ok(!a.m.getGroup(g.id)!.members.some(m => m.id === c.ids.public.id));
  assert.equal(c.m.getGroup(g.id), undefined);
  // Agora "Todos os membros" + aprovação.
  const asked: string[] = [];
  inner(a.m).o.events.joinRequest = (_g: string, w: { name: string }) => asked.push(w.name);
  a.m.updateGroup(g.id, { inv: 'all', approve: true });
  net.run();
  b.m.addMembers(g.id, [c.ids.public.id]);
  net.run();
  assert.deepEqual(asked, ['Caio']);
  assert.equal(c.m.getGroup(g.id), undefined, 'aguardando o admin');
  a.m.answerJoin(g.id, c.ids.public.id, true);
  net.run();
  assert.equal(c.m.getGroup(g.id)?.name, 'Feira');
});

test('3.3 canal não aceita convite de inscrito; indicação de quem não é contato não vale', () => {
  const { net, a, b, c, all } = chain();
  const ch = a.m.createGroup({ kind: 'channel', name: 'Avisos', via: 'public', memberIds: [b.ids.public.id], inv: 'all', visibility: 'public' });
  all();
  assert.equal(b.m.canInvite(ch.id), false);
  // Davi (Caio não o conhece) se indica como admin de um grupo e manda o estado: Caio recusa.
  const d = device(net, 'Davi');
  know(d, c);
  const g2 = d.m.createGroup({ kind: 'group', name: 'Golpe', via: 'public', memberIds: [c.ids.public.id] });
  inner(d.m).enqueue(d.m.getContact(c.ids.public.id), { t: 'gv', g: g2.id, a: [{ id: d.ids.public.id, n: 'Davi', s: b64url(d.ids.public.signPk), a: b64url(d.ids.public.agreePk), b: b64url(d.ids.public.binding) }] }, null, 2);
  inner(d.m).distribute({ ...d.m.getGroup(g2.id)!, rev: 2 });
  net.link('Davi', 'Caio');
  assert.equal(c.m.getGroup(g2.id), undefined);
});

// ── 1.2 revogar aparelho troca a chave dos grupos ───────────────────

test('1.2 aparelho revogado: o admin confere o aviso e troca a chave; o próprio admin troca nos grupos dele', async () => {
  const { createRevocation, decodeRevocation, encodeRevocation, newDeviceKey, verifyRevocation } = await import('../../lib/devicesCore');
  const net = new Net();
  // O admin confere a assinatura com a chave conhecida e troca a chave (como em state/messaging.tsx).
  const onNotice = (self: () => Messenger) => (from: string, text: string, pub: { signPk: Uint8Array }) => {
    const n = decodeRevocation(text);
    if (verifyRevocation(n, pub.signPk)) self().rotateForRevocation(from, n.sig);
  };
  let am: Messenger | null = null, dm: Messenger | null = null;
  const a = device(net, 'Ana', { events: { notice: onNotice(() => am!) } });
  const b = device(net, 'Beto'), c = device(net, 'Caio');
  const d = device(net, 'Davi', { events: { notice: onNotice(() => dm!) } });
  am = a.m; dm = d.m;
  for (const x of [b, c, d]) { know(a, x); know(x, a); }
  const g = a.m.createGroup({ kind: 'group', name: 'Mutirão', via: 'public', memberIds: [b.ids.public.id, c.ids.public.id, d.ids.public.id] });
  for (const x of ['Beto', 'Caio', 'Davi']) net.link('Ana', x);
  // Davi vira admin também (e não é contato de Beto).
  a.m.setRole(g.id, d.ids.public.id, 'admin');
  net.run();
  const lost = newDeviceKey();
  const notice = createRevocation(b.ids.public, { pk: b64url(lost.pk) }, 'lost', T0);
  b.m.broadcastNotice('public', encodeRevocation(notice));
  net.run();
  assert.equal(a.m.getGroup(g.id)!.keyV, 2, 'a chave trocou uma vez (um admin só troca)');
  assert.equal(d.m.getGroup(g.id)!.keyV, 2);
  assert.equal(c.m.getGroup(g.id)!.keyV, a.m.getGroup(g.id)!.keyV, 'os membros receberam a chave nova');
  // O mesmo aviso de novo (repetido pela malha ou reenviado) não troca outra vez.
  const before = a.m.getGroup(g.id)!.keyV;
  a.m.rotateForRevocation(b.ids.public.id, notice.sig);
  assert.equal(a.m.getGroup(g.id)!.keyV, before);
  // Aviso forjado (assinado por outra chave) não troca nada.
  const forged = createRevocation(c.ids.public, { pk: b64url(lost.pk) }, 'lost', T0 + 1);
  inner(c.m).enqueue(c.m.getContact(a.ids.public.id), { t: 'rv', n: encodeRevocation({ ...forged, by: b64url(b.ids.public.signPk) }) }, null, 2);
  net.run();
  assert.equal(a.m.getGroup(g.id)!.keyV, before);
  // Revogação da própria Ana: troca nos grupos em que ela é admin.
  const own = createRevocation(a.ids.public, { pk: b64url(newDeviceKey().pk) }, 'lost', T0 + 2);
  assert.equal(a.m.rotateForRevocation(a.ids.public.id, own.sig, 'public').length, 1);
  net.run();
  assert.equal(b.m.getGroup(g.id)!.keyV, before + 1);
});
