/// <reference types="node" />
/**
 * Pedido de pagamento pela malha (regra 7.3): o payload `pq` vai cifrado na sessão do contato, só
 * contato aceito recebe, o recibo de entrega volta como nas mensagens, repetição não duplica, e
 * versões sem o tipo (simuladas por um payload desconhecido) ignoram sem quebrar.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveIdentity, deriveNodeKey, newSeed, toPublic } from '../../protocol/keys';
import { newPayRequest, type PaidNotice, type PaymentRequest, PAY_REQUEST_TTL_SEC } from '../../lib/paymentRequest';
import { ALICE_57 } from '../../lib/__tests__/lunesFake';
import { type Contact, Messenger } from '../messenger';

const T0 = 1_800_000_000;
const HASH = '0x' + 'ab'.repeat(32);

class Net {
  clock = T0;
  nodes = new Map<string, Messenger>();
  links = new Set<string>();
  queue: [string, string, Uint8Array][] = [];
  key = (a: string, b: string) => [a, b].sort().join('~');
  transmit = (from: string) => async (to: string, bytes: Uint8Array) => { if (this.links.has(this.key(from, to))) this.queue.push([from, to, bytes]); };
  run() { for (let i = 0; i < 1000 && this.queue.length; i++) { const [f, t, b] = this.queue.shift()!; this.nodes.get(t)!.receive(f, b); } }
  link(a: string, b: string) { this.links.add(this.key(a, b)); this.nodes.get(a)!.peerConnected(b, 'ble'); this.nodes.get(b)!.peerConnected(a, 'ble'); this.run(); }
}

function device(net: Net, name: string) {
  const seed = newSeed();
  const ids = { public: deriveIdentity(seed, 'public'), anon: deriveIdentity(seed, 'anon') };
  const log = { msgs: [] as string[], status: [] as [string, string][], pay: [] as [string, PaymentRequest][], paid: [] as [string, PaidNotice][] };
  const m = new Messenger({
    identities: ids, node: deriveNodeKey(seed), relay: true, now: () => net.clock, transmit: net.transmit(name),
    events: {
      message: (_c, x) => log.msgs.push(x.text),
      newContact: (_c, x) => log.msgs.push(x.text),
      status: (id, s) => log.status.push([id, s]),
      paymentRequest: (c, r) => log.pay.push([c, r]),
      paymentPaid: (c, n) => log.paid.push([c, n]),
    },
  });
  m.displayName = name;
  net.nodes.set(name, m);
  return { m, ids, log };
}
const contactOf = (d: ReturnType<typeof device>, name: string): Contact => ({ id: d.ids.public.id, via: 'public', pub: toPublic(d.ids.public), name, invite: d.m.issueInvite('public').code });

/** Ana e Beto já se conhecem (os dois escanearam o QR um do outro). */
function pair() {
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto');
  a.m.addContact(contactOf(b, 'Beto'));
  b.m.addContact(contactOf(a, 'Ana'));
  return { net, a, b };
}

test('pedido de pagamento: chega cifrado ao contato, com recibo de entrega, e o aviso "já paguei" volta', () => {
  const { net, a, b } = pair();
  const r = newPayRequest({ address: ALICE_57, amount: '1,5', desc: 'Almoço', now: T0 });
  a.m.sendPayRequest(b.ids.public.id, r);
  assert.deepEqual(a.m.pendingFor(b.ids.public.id), [r.id], 'o id do pedido é o id da mensagem na fila');
  net.link('Ana', 'Beto');
  assert.equal(b.log.pay.length, 1);
  const [from, got] = b.log.pay[0]!;
  assert.equal(from, a.ids.public.id);
  assert.equal(got.id, r.id);
  assert.equal(got.address, ALICE_57);
  assert.equal(got.planck, 150_000_000n);
  assert.equal(got.desc, 'Almoço');
  assert.equal(got.expiresAt, T0 + PAY_REQUEST_TTL_SEC);
  assert.deepEqual(a.log.status, [[r.id, 'encaminhada'], [r.id, 'entregue']]);
  assert.deepEqual(b.log.msgs, [], 'não vira texto');
  // Beto avisa que pagou, com o hash da transação.
  b.m.sendPaid(a.ids.public.id, { id: r.id, txHash: HASH });
  net.run();
  assert.deepEqual(a.log.paid, [[b.ids.public.id, { id: r.id, txHash: HASH }]]);
});

test('pedido repetido na malha não aparece duas vezes; pedido vencido ou torto é descartado', () => {
  const { net, a, b } = pair();
  const r = newPayRequest({ address: ALICE_57, amount: '', desc: 'Vaquinha', now: T0 });
  a.m.sendPayRequest(b.ids.public.id, r);
  net.link('Ana', 'Beto');
  // Reenvio do mesmo pedido (ex.: quem pediu tocou em Reenviar): mesma mensagem, não duplica.
  a.m.sendPayRequest(b.ids.public.id, r);
  net.run();
  assert.equal(b.log.pay.length, 1);
  // Vencido antes de sair: não entra na fila.
  assert.throws(() => a.m.sendPayRequest(b.ids.public.id, { ...r, id: 'ffffffffffffffff', expiresAt: T0 - 1 }), /venceu|vencido/i);
  // Id que não é o formato: recusado antes de cifrar.
  assert.throws(() => a.m.sendPayRequest(b.ids.public.id, { ...r, id: 'nope' }), /inválido/);
});

test('só contato aceito recebe pedido e aviso; desconhecido e pedido de conversa são ignorados', () => {
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto');
  // Ana escaneou o QR de Beto; Beto ainda não respondeu (Ana é "pedido de conversa" para ele).
  a.m.addContact(contactOf(b, 'Beto'));
  a.m.sendText(b.ids.public.id, 'm1', 'Oi');
  net.link('Ana', 'Beto');
  assert.deepEqual(b.log.msgs, ['Oi']);
  const r = newPayRequest({ address: ALICE_57, amount: '1', desc: 'x', now: T0 });
  a.m.sendPayRequest(b.ids.public.id, r);
  net.run();
  assert.equal(b.log.pay.length, 0, 'pedido de conversa não recebe pedido de pagamento');
  assert.deepEqual(a.log.status.filter(([id]) => id === r.id), [[r.id, 'encaminhada']], 'sem recibo: fica aguardando');
  a.m.sendPaid(b.ids.public.id, { id: r.id });
  net.run();
  assert.equal(b.log.paid.length, 0);
  // Beto responde (aceita): agora recebe.
  b.m.addContact(b.m.getContact(a.ids.public.id)!);
  a.m.sendPayRequest(b.ids.public.id, { ...r, id: '0000000000000001' });
  net.run();
  assert.equal(b.log.pay.length, 1);
  // Para quem nem é contato, nem envia.
  const c = device(net, 'Caio');
  assert.throws(() => a.m.sendPayRequest(c.ids.public.id, r), /desconhecido/);
});

test('versão antiga: um tipo de payload desconhecido é ignorado sem derrubar a sessão nem as mensagens seguintes', () => {
  const { net, a, b } = pair();
  net.link('Ana', 'Beto');
  // Simula o app novo falando com um antigo: injeta um payload de tipo inexistente pelo caminho interno.
  const enqueue = (a.m as unknown as { enqueue: (c: Contact, p: unknown, id: string | null, pr: number) => void }).enqueue.bind(a.m);
  enqueue(a.m.getContact(b.ids.public.id)!, { t: 'zz', i: '0000000000000002', x: 'futuro' }, '0000000000000002', 1);
  net.run();
  assert.deepEqual(b.log.msgs, []);
  assert.deepEqual(b.log.pay, []);
  a.m.sendText(b.ids.public.id, 'm2', 'depois');
  net.run();
  assert.deepEqual(b.log.msgs, ['depois'], 'a sessão continua em ordem');
});

test('o estado salvo e restaurado continua recebendo pedidos (payload passa pelo mesmo caminho das mensagens)', () => {
  const { net, a, b } = pair();
  net.link('Ana', 'Beto');
  a.m.sendText(b.ids.public.id, 'm1', 'Oi');
  net.run();
  const saved = b.m.export();
  const b2 = new Messenger({ identities: b.ids, node: deriveNodeKey(newSeed()), relay: true, now: () => net.clock, transmit: net.transmit('Beto'), state: saved, events: { paymentRequest: (c, r) => b.log.pay.push([c, r]) } });
  net.nodes.set('Beto', b2);
  b2.peerConnected('Ana', 'ble');
  const r = newPayRequest({ address: ALICE_57, amount: '3', desc: 'Depois de reabrir', now: T0 });
  a.m.sendPayRequest(b.ids.public.id, r);
  net.run();
  assert.equal(b.log.pay.length, 1);
  assert.equal(b.log.pay[0]![1].desc, 'Depois de reabrir');
});
