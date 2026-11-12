/// <reference types="node" />
/**
 * Achados baixos da auditoria de 2026-11-09 na área de mensagens: contato que veio só de grupo,
 * arquivo de pedido de conversa, oferta de arquivo com tamanho que não é número inteiro e avisos de
 * revogação em sequência.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveIdentity, deriveNodeKey, newSeed, toPublic } from '../../protocol/keys';
import { type Contact, type IncomingFile, Messenger } from '../messenger';
import { DEV_ADDR_57 } from '../../lib/__tests__/walletFixture';

const T0 = 1_800_000_000;

class Net {
  clock = T0;
  nodes = new Map<string, Messenger>();
  links = new Set<string>();
  queue: [string, string, Uint8Array][] = [];
  key = (a: string, b: string) => [a, b].sort().join('~');
  transmit = (from: string) => async (to: string, bytes: Uint8Array) => {
    if (this.links.has(this.key(from, to))) this.queue.push([from, to, bytes]);
  };
  run() {
    for (let i = 0; i < 5000 && this.queue.length; i++) { const [f, t, b] = this.queue.shift()!; this.nodes.get(t)!.receive(f, b); }
  }
  link(a: string, b: string) { this.links.add(this.key(a, b)); this.nodes.get(a)!.peerConnected(b, 'ble'); this.nodes.get(b)!.peerConnected(a, 'ble'); this.run(); }
}

function device(net: Net, name: string, opts: { seed?: Uint8Array; state?: string } = {}) {
  const seed = opts.seed ?? newSeed();
  const ids = { public: deriveIdentity(seed, 'public'), anon: deriveIdentity(seed, 'anon') };
  const log = { wallet: [] as (string | null)[], photo: [] as (string | null)[], calls: [] as unknown[], pay: [] as unknown[], files: [] as Omit<IncomingFile, 'data'>[] };
  const m = new Messenger({
    identities: ids, node: deriveNodeKey(seed), relay: true, now: () => net.clock, transmit: net.transmit(name), state: opts.state,
    events: {
      peerWallet: (_id, w) => log.wallet.push(w),
      peerPhoto: (_id, p) => log.photo.push(p),
      callSignal: (_id, p) => log.calls.push(p),
      paymentRequest: (_id, r) => log.pay.push(r),
      fileOffered: (_id, f) => log.files.push(f),
    },
  });
  m.displayName = name;
  net.nodes.set(name, m);
  return { m, ids, seed, log };
}
type Dev = ReturnType<typeof device>;
const asContact = (d: Dev, name: string): Contact => ({ id: d.ids.public.id, via: 'public', pub: toPublic(d.ids.public), name });
/** Manda um conteúdo cru pela sessão 1:1 (como um cliente modificado faria). */
const raw = (from: Dev, to: string, p: unknown) => (from.m as unknown as { enqueue: (...x: unknown[]) => void }).enqueue(from.m.getContact(to), p, null, 1, false);
const JPEG = '/9j/' + 'A'.repeat(200);

test('quem entrou no grupo pelo link não recebe meu endereço Lunes nem minha foto, nem me liga ou cobra, até eu escrever direto', () => {
  const net = new Net();
  const a = device(net, 'Ana'), d = device(net, 'Davi');
  const g = a.m.createGroup({ kind: 'group', name: 'Rádio', via: 'public', memberIds: [], approve: false });
  const inv = a.m.groupInvite(g.id);
  d.m.requestJoin(asContact(a, 'Ana'), g.id, inv.code);
  net.link('Davi', 'Ana');
  assert.equal(d.m.getGroup(g.id)?.name, 'Rádio', 'entrou no grupo');
  const davi = d.ids.public.id;
  assert.equal(a.m.getContact(davi)?.groupOnly, true, 'contato só de grupo');
  a.m.sendWalletAddress(DEV_ADDR_57);
  a.m.sendProfilePhoto(JPEG);
  net.run();
  assert.deepEqual(d.log.wallet, [], 'endereço Lunes não vai');
  assert.deepEqual(d.log.photo, [], 'foto não vai');
  // Ele tenta tocar chamada e mandar pedido de pagamento: cai no portão como pedido de conversa.
  raw(d, a.ids.public.id, { t: 'cl', s: { t: 'request', requestId: 'pedido-0001-abcd' } });
  net.run();
  assert.deepEqual(a.log.calls, []);
  // Sobrevive a reabrir o app.
  const a2 = device(net, 'Ana2', { seed: a.seed, state: a.m.export() });
  assert.equal(a2.m.getContact(davi)?.groupOnly, true);
  // Escrever direto para ele aceita a pessoa: a partir daí, como contato comum.
  a.m.sendText(davi, 'm1', 'Oi, Davi');
  assert.equal(a.m.getContact(davi)?.groupOnly, undefined);
  a.m.sendWalletAddress(DEV_ADDR_57);
  net.run();
  assert.deepEqual(d.log.wallet, [DEV_ADDR_57]);
});

test('arquivo oferecido por quem ainda é só pedido de conversa é ignorado', () => {
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto');
  a.m.addContact(asContact(b, 'Beto'));
  b.m.addContact(asContact(a, 'Ana'));
  net.link('Ana', 'Beto');
  (b.m.getContact(a.ids.public.id) as Contact).request = true;
  a.m.sendFile(b.ids.public.id, 'f1', { name: 'x.bin', mime: 'application/octet-stream', data: new Uint8Array(1000).fill(1) });
  net.run();
  assert.deepEqual(b.log.files, [], 'pedido de conversa não manda arquivo');
  (b.m.getContact(a.ids.public.id) as Contact).request = false;
  a.m.sendFile(b.ids.public.id, 'f2', { name: 'y.bin', mime: 'application/octet-stream', data: new Uint8Array(1000).fill(2) });
  net.run();
  assert.equal(b.log.files.length, 1, 'contato aceito manda');
});

test('oferta de arquivo com tamanho em texto ou fracionário é descartada', () => {
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto');
  a.m.addContact(asContact(b, 'Beto'));
  b.m.addContact(asContact(a, 'Ana'));
  net.link('Ana', 'Beto');
  const h = 'ab'.repeat(32);
  raw(a, b.ids.public.id, { t: 'f', i: 'oferta-texto', n: 'a.bin', s: '0x10', m: 'x/y', c: 1, h });
  raw(a, b.ids.public.id, { t: 'f', i: 'oferta-fracao', n: 'b.bin', s: 1.5, m: 'x/y', c: 1, h });
  raw(a, b.ids.public.id, { t: 'f', i: 'oferta-hash', n: 'c.bin', s: 10, m: 'x/y', c: 1, h: ['ab'.repeat(32)] });
  net.run();
  assert.deepEqual(b.log.files, []);
});

test('avisos de revogação do mesmo contato em sequência trocam a chave do grupo uma vez a cada 10 min', () => {
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto');
  a.m.addContact(asContact(b, 'Beto'));
  const g = a.m.createGroup({ kind: 'group', name: 'Mutirão', via: 'public', memberIds: [b.ids.public.id] });
  assert.equal(a.m.rotateForRevocation(b.ids.public.id, 'aviso-1').length, 1);
  assert.equal(a.m.rotateForRevocation(b.ids.public.id, 'aviso-2').length, 0, 'segundo aviso logo depois não troca de novo');
  net.clock += 10 * 60;
  assert.equal(a.m.rotateForRevocation(b.ids.public.id, 'aviso-3').length, 1, 'passados 10 min, troca');
  // A minha própria revogação sempre troca.
  assert.equal(a.m.rotateForRevocation(a.ids.public.id, 'meu-1', 'public').length, 1);
  assert.equal(a.m.rotateForRevocation(a.ids.public.id, 'meu-2', 'public').length, 1);
  assert.ok(a.m.getGroup(g.id));
});

test('mandar um arquivo direto para quem veio só de grupo aceita a pessoa, e o arquivo que ela manda de volta chega', () => {
  const net = new Net();
  const a = device(net, 'Ana'), d = device(net, 'Davi');
  const g = a.m.createGroup({ kind: 'group', name: 'Rádio', via: 'public', memberIds: [], approve: false });
  const inv = a.m.groupInvite(g.id);
  d.m.requestJoin(asContact(a, 'Ana'), g.id, inv.code);
  net.link('Davi', 'Ana');
  const davi = d.ids.public.id;
  assert.equal(a.m.getContact(davi)?.groupOnly, true, 'contato só de grupo');
  // Arquivo recusado pelo tamanho não aceita ninguém.
  assert.throws(() => a.m.sendFile(davi, 'f0', { name: 'vazio', mime: 'application/octet-stream', data: new Uint8Array(0) }));
  assert.equal(a.m.getContact(davi)?.groupOnly, true);
  a.m.sendFile(davi, 'f1', { name: 'mapa.bin', mime: 'application/octet-stream', data: new Uint8Array(100).fill(7) });
  assert.equal(a.m.getContact(davi)?.groupOnly, undefined, 'mandar arquivo é conversa direta');
  net.run();
  d.m.sendFile(a.ids.public.id, 'f2', { name: 'volta.bin', mime: 'application/octet-stream', data: new Uint8Array(100).fill(9) });
  net.run();
  assert.deepEqual(a.log.files.map(f => f.name), ['volta.bin']);
});
