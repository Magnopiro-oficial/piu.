/// <reference types="node" />
/**
 * Por perto (docs/regras/mapa-regras-negocio.md, seção 5): presença só enquanto visível, descoberta
 * por saltos, convite pago pela malha com o texto, pedidos (aceitar, recusar em silêncio, bloquear),
 * taxa de quem recebe e 30 dias sem insistência.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveIdentity, deriveNodeKey, newSeed } from '../../protocol/keys';
import { Messenger, type MessengerEvents, type NearRequest } from '../messenger';
import { decodePresence, encodePresence, makePresence, NEAR_COOLDOWN_SEC, PRESENCE_TTL_SEC } from '../nearby';

const T0 = 1_800_000_000;
const HOUR = 3600;

class Net {
  clock = T0;
  nodes = new Map<string, Messenger>();
  links = new Set<string>();
  queue: [string, string, Uint8Array][] = [];
  key = (a: string, b: string) => [a, b].sort().join('~');
  transmit = (from: string) => async (to: string, bytes: Uint8Array) => { if (this.links.has(this.key(from, to))) this.queue.push([from, to, bytes]); };
  run() { for (let i = 0; i < 5000 && this.queue.length; i++) { const [f, t, b] = this.queue.shift()!; this.nodes.get(t)!.receive(f, b); } }
  link(a: string, b: string) { this.links.add(this.key(a, b)); this.nodes.get(a)!.peerConnected(b, 'ble'); this.nodes.get(b)!.peerConnected(a, 'ble'); this.run(); }
  unlink(a: string, b: string) { this.links.delete(this.key(a, b)); this.nodes.get(a)!.peerDisconnected(b); this.nodes.get(b)!.peerDisconnected(a); }
  tick() { for (const m of this.nodes.values()) m.tick(); this.run(); }
}

function device(net: Net, name: string, events: Partial<MessengerEvents> = {}) {
  const seed = newSeed();
  const ids = { public: deriveIdentity(seed, 'public'), anon: deriveIdentity(seed, 'anon') };
  const log = { requests: [] as NearRequest[], accepted: [] as [string, number][], msgs: [] as [string, string][] };
  const m = new Messenger({
    identities: ids, node: deriveNodeKey(seed), relay: true, now: () => net.clock, transmit: net.transmit(name),
    events: {
      nearRequest: r => log.requests.push(r),
      nearAccepted: (c, fee) => log.accepted.push([c.id, fee]),
      message: (c, x) => log.msgs.push([c, x.text]),
      ...events,
    },
  });
  m.displayName = name;
  net.nodes.set(name, m);
  return { m, ids, name, log, show: (fee = 3, until = net.clock + HOUR) => m.setNearby({ until, fee, name, photo: null }), hide: () => m.setNearby({ until: null, fee: 3, name }) };
}

test('5.1 presença só enquanto visível; a anônima nunca aparece; some ao ficar invisível', () => {
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto');
  net.link('Ana', 'Beto');
  a.show();
  assert.deepEqual(b.m.nearbyProfiles(), [], 'Beto invisível não vê ninguém (recíproco)');
  b.show(); net.run();
  assert.equal(a.m.nearbyProfiles().length, 1, 'Ana vê Beto');
  net.tick(); net.clock += 61; net.tick();
  const seen = b.m.nearbyProfiles();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].id, a.ids.public.id, 'id da identidade pública');
  assert.notEqual(seen[0].id, a.ids.anon.id);
  assert.equal(seen[0].name, 'Ana');
  assert.equal(seen[0].prox, 'muito perto');
  assert.equal(seen[0].via, 'Bluetooth · direto');
  // Ana fica invisível: a retirada apaga o perfil na hora.
  a.hide(); net.run();
  assert.deepEqual(b.m.nearbyProfiles(), []);
  assert.deepEqual(a.m.nearbyProfiles(), [], 'invisível também não vê ninguém');
});

test('5.1 o prazo de 1 h acaba: o anúncio nunca passa do fim da visibilidade', () => {
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto');
  net.link('Ana', 'Beto');
  b.show(net.clock + 10 * HOUR);
  a.show(3, net.clock + 100); net.run(); // visível só por mais 100 s
  assert.equal(b.m.nearbyProfiles().length, 1);
  net.clock += 101; net.tick();
  assert.deepEqual(b.m.nearbyProfiles(), [], 'some quando a visibilidade de Ana acaba, sem retirada');
  // Fora de alcance: sem anúncio novo, some no fim do prazo curto.
  a.show(); net.run();
  assert.equal(b.m.nearbyProfiles().length, 1);
  net.unlink('Ana', 'Beto');
  net.clock += PRESENCE_TTL_SEC + 1; net.tick();
  assert.deepEqual(b.m.nearbyProfiles(), []);
});

test('5.1 proximidade por saltos (direto, 1 salto, 2 saltos) e no máximo 2 saltos', () => {
  const net = new Net();
  const [a, r1, r2, r3, z] = ['Ana', 'R1', 'R2', 'R3', 'Zé'].map(n => device(net, n));
  for (const [x, y] of [['Ana', 'R1'], ['R1', 'R2'], ['R2', 'R3'], ['R3', 'Zé']]) net.link(x, y);
  for (const d of [r1, r2, r3, z]) d.show();
  a.show(); net.run();
  assert.equal(r1.m.nearbyProfiles().find(p => p.id === a.ids.public.id)?.prox, 'muito perto');
  assert.equal(r2.m.nearbyProfiles().find(p => p.id === a.ids.public.id)?.prox, 'perto');
  assert.equal(r2.m.nearbyProfiles().find(p => p.id === a.ids.public.id)?.via, '1 salto');
  assert.equal(r3.m.nearbyProfiles().find(p => p.id === a.ids.public.id)?.prox, 'mais longe');
  assert.equal(z.m.nearbyProfiles().find(p => p.id === a.ids.public.id), undefined, 'não passa de 2 saltos');
});

test('5.1 anúncio adulterado ou da identidade anônima é recusado', () => {
  const me = deriveIdentity(newSeed(), 'public');
  const body = makePresence(me, { name: 'Ana', fee: 3, now: T0, until: T0 + HOUR, withPhoto: false });
  assert.ok(decodePresence(encodePresence(body, 2, false), T0));
  assert.equal(decodePresence(encodePresence({ ...body, n: 'Outra' }, 2, false), T0), null, 'nome trocado');
  assert.equal(decodePresence(encodePresence({ ...body, f: 1 }, 2, false), T0), null, 'taxa trocada');
  assert.equal(decodePresence(encodePresence(body, 2, false), T0 + PRESENCE_TTL_SEC + 1), null, 'vencido');
  assert.throws(() => makePresence(deriveIdentity(newSeed(), 'anon'), { name: '', fee: 3, now: T0, until: T0 + HOUR, withPhoto: false }));
});

/** Ana convida Beto: os dois visíveis, ligados. */
function pair() {
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto');
  net.link('Ana', 'Beto');
  b.show(5); a.show(); net.run();
  return { net, a, b };
}

test('5.4 / 5.6 convite pago chega com o texto; aceitar abre a conversa nos dois lados', () => {
  const { net, a, b } = pair();
  const p = a.m.nearbyProfiles()[0];
  assert.equal(p.fee, 5, 'a taxa é a que Beto anunciou');
  const inv = a.m.sendNearInvite(p.id, 'Oi! Vi que você também curte rádio.');
  net.run();
  assert.equal(inv.fee, 5);
  assert.equal(b.log.requests.length, 1);
  const r = b.m.nearRequests()[0];
  assert.equal(r.msg, 'Oi! Vi que você também curte rádio.');
  assert.equal(r.from, a.ids.public.id, 'id real (piu:) da identidade pública de Ana');
  assert.equal(r.fee, 5);
  assert.equal(r.name, 'Ana');
  assert.equal(r.prox, 'muito perto');
  const ok = b.m.answerNear(r.id, 'accept');
  net.run();
  assert.ok(ok);
  assert.ok(b.m.getContact(a.ids.public.id) && !b.m.getContact(a.ids.public.id)!.request, 'Ana vira contato de Beto');
  assert.deepEqual(a.log.accepted, [[b.ids.public.id, 5]], 'Ana sabe que foi aceito');
  assert.ok(a.m.getContact(b.ids.public.id));
  a.m.sendText(b.ids.public.id, 'm1', 'Que bom!'); net.run();
  assert.deepEqual(b.log.msgs, [[a.ids.public.id, 'Que bom!']]);
});

test('5.6 recusar em silêncio não manda nada; o pedido expira em 24 h', () => {
  const { net, a, b } = pair();
  a.m.sendNearInvite(a.m.nearbyProfiles()[0].id, 'Oi'); net.run();
  const r = b.m.nearRequests()[0];
  const before = net.queue.length;
  assert.equal(b.m.answerNear(r.id, 'decline'), null);
  assert.equal(net.queue.length, before, 'nada sai do aparelho de Beto');
  net.run();
  assert.deepEqual(a.log.accepted, []);
  assert.equal(b.m.nearRequests()[0].status, 'declined');
  net.clock += 24 * HOUR + 1; net.tick();
  assert.deepEqual(b.m.nearRequests(), [], 'some depois de 24 h');
});

test('5.6 aceitar depois de 24 h não vale', () => {
  const { net, a, b } = pair();
  a.m.sendNearInvite(a.m.nearbyProfiles()[0].id, 'Oi'); net.run();
  const r = b.m.nearRequests()[0];
  net.clock += 24 * HOUR + 1;
  assert.throws(() => b.m.answerNear(r.id, 'accept'), /expirou/);
});

test('5.7 bloquear e denunciar: novos pedidos e mensagens dessa identidade são descartados', () => {
  const { net, a, b } = pair();
  a.m.sendNearInvite(a.m.nearbyProfiles()[0].id, 'Oi'); net.run();
  b.m.answerNear(b.m.nearRequests()[0].id, 'block');
  assert.equal(b.m.nearRequests()[0].status, 'blocked');
  assert.deepEqual(b.m.nearbyProfiles().filter(p => p.id === a.ids.public.id), [], 'não aparece mais em Por perto');
  // Mesmo depois dos 30 dias, Ana bloqueada não consegue pedir de novo.
  net.clock += NEAR_COOLDOWN_SEC + 1; net.tick();
  a.show(); b.show(5); net.run();
  a.m.sendNearInvite(b.ids.public.id, 'De novo'); net.run();
  assert.equal(b.log.requests.length, 1);
});

test('5.5 convite com taxa abaixo da vigente de quem recebe não entra', () => {
  const { net, a, b } = pair();
  // Beto sobe a taxa depois que Ana viu o perfil antigo (5 → 10).
  const p = a.m.nearbyProfiles()[0];
  b.m.setNearby({ until: net.clock + HOUR, fee: 10, name: 'Beto' });
  // Ana ainda não recebeu o anúncio novo: manda com 5.
  net.queue = [];
  a.m.sendNearInvite(p.id, 'Oi'); net.run();
  assert.equal(b.log.requests.length, 0);
});

test('5.x 30 dias sem insistência (quem convida e quem recebe)', () => {
  const { net, a, b } = pair();
  const id = a.m.nearbyProfiles()[0].id;
  a.m.sendNearInvite(id, 'Oi'); net.run();
  assert.throws(() => a.m.sendNearInvite(id, 'Oi de novo'), /30 dias/);
  assert.ok(a.m.nearInviteBlockedUntil(id));
  net.clock += NEAR_COOLDOWN_SEC; net.tick();
  b.show(5); a.show(); net.run();
  assert.equal(a.m.nearInviteBlockedUntil(id), null);
  a.m.sendNearInvite(id, 'Passou um mês'); net.run();
  assert.equal(b.log.requests.length, 2);
});

test('5.x quem estava invisível não recebe pedido, e invisível não convida', () => {
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto');
  net.link('Ana', 'Beto');
  b.show(); a.show(); net.run();
  const id = a.m.nearbyProfiles()[0].id;
  b.hide(); net.run();
  assert.throws(() => a.m.sendNearInvite(id, 'Oi'), /não está mais por perto/);
  a.hide();
  assert.throws(() => a.m.sendNearInvite(id, 'Oi'), /visível/);
});

test('5.x pedidos e regra dos 30 dias sobrevivem a reabrir o app', () => {
  const { net, a, b } = pair();
  a.m.sendNearInvite(a.m.nearbyProfiles()[0].id, 'Oi'); net.run();
  const saved = b.m.export();
  const seed = newSeed(); void seed;
  const b2 = new Messenger({ identities: { public: b.ids.public, anon: b.ids.anon }, node: deriveNodeKey(newSeed()), relay: true, now: () => net.clock, transmit: net.transmit('Beto'), events: {}, state: saved });
  assert.equal(b2.nearRequests().length, 1);
  assert.ok(b2.answerNear(b2.nearRequests()[0].id, 'accept'));
  const a2 = new Messenger({ identities: { public: a.ids.public, anon: a.ids.anon }, node: deriveNodeKey(newSeed()), relay: true, now: () => net.clock, transmit: net.transmit('Ana'), events: {}, state: a.m.export() });
  assert.ok(a2.nearInviteBlockedUntil(b.ids.public.id));
});
