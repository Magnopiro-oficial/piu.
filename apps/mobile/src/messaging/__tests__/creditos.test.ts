/// <reference types="node" />
/**
 * Créditos "em lote" (sem pagamento simulado), migração de dados antigos, arquivo de evidências no
 * formato do validador e registros locais de uso (dias com entrega a 3+ contatos, convites aceitos).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveIdentity, deriveNodeKey, newSeed, toPublic } from '../../protocol/keys';
import { ContributionLedger, makeRelayReceipt } from '../../protocol/receipts';
import { hash } from '../../protocol/suite';
import { type Contact, Messenger } from '../messenger';
import { CREDIT_PARAMS, CreditBook } from '../credits';
import { buildEvidence, evidenceFileName } from '../evidence';
import { AcceptedInvites, DeliveryDays } from '../usage';

const T0 = 1_800_000_000;
const fromHex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], x => parseInt(x, 16));

function bookWith(n: number, t0 = T0) {
  const node = deriveNodeKey(newSeed());
  const book = new CreditBook();
  const secrets: [string, Uint8Array][] = [];
  for (let i = 0; i < n; i++) {
    const secret = Uint8Array.of(i & 255, i >> 8, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9);
    const id = i.toString(16).padStart(8, '0').repeat(4);
    book.addReceipt(makeRelayReceipt(node, id, hash(secret).slice(0, 16), t0), { bytes: 300, expiresAt: t0 + 3600 }, 'ble');
    secrets.push([id, secret]);
  }
  return { node, book, secrets };
}

test('7 lote local: validados viram "em lote" (aguardando liquidação), nunca "pago"', () => {
  const n = CREDIT_PARAMS.minLotLunes * CREDIT_PARAMS.creditsPerLunes + 5;
  const { book, secrets } = bookWith(n);
  for (const [id, s] of secrets) assert.ok(book.applyProof(id, s));
  const r = book.tick(T0 + 15 * 86400);
  assert.ok(r.lot);
  assert.equal(r.lot!.settled, false);
  assert.ok(book.list().every(c => c.state === 'em_lote' && c.lot === r.lot!.id));
  assert.equal(book.totals().pago, 0);
  // Em lote e não liquidado em 180 dias: expira, como o validado.
  book.tick(T0 + CREDIT_PARAMS.validitySec + 2 * 86400);
  assert.ok(book.list().every(c => c.state === 'rejeitado' && c.reason?.startsWith('expirou')));
});

test('7 migração: "pago" de lote simulado (versões antigas) volta para "em lote"', () => {
  const { book, secrets } = bookWith(3);
  for (const [id, s] of secrets) book.applyProof(id, s);
  const j = JSON.parse(book.export(T0)) as { c: Record<string, unknown>[]; l: unknown[] };
  // Como as versões antigas gravavam: estado "pago" e lote com `simulated: true`.
  j.c = j.c.map(c => ({ ...c, state: 'pago', lot: 'lote-2027-S02' }));
  j.l = [{ id: 'lote-2027-S02', closedAt: T0, credits: 3, lunes: 0.03, count: 3, simulated: true }];
  const again = new CreditBook(JSON.stringify(j));
  assert.equal(again.totals().pago, 0);
  assert.equal(again.list().filter(c => c.state === 'em_lote').length, 3);
  assert.deepEqual(again.lots[0], { id: 'lote-2027-S02', closedAt: T0, credits: 3, lunes: 0.03, count: 3, settled: false });
  assert.equal('simulated' in again.lots[0], false);
  // Gravado de novo: continua em lote.
  assert.equal(new CreditBook(again.export(T0)).totals().em_lote, again.totals().em_lote);
});

test('7.8 evidências: formato EvidenceFile v1 que o validador aceita (assinatura e prova conferem)', () => {
  const { node, book, secrets } = bookWith(4);
  book.applyProof(secrets[0][0], secrets[0][1]);
  book.applyProof(secrets[1][0], secrets[1][1]);
  // Prova que circula na malha (ainda não aplicada a um crédito guardado) também vai.
  const f = buildEvidence(book.list(), [[secrets[2][0], secrets[2][1]], ['ff'.repeat(16), Uint8Array.of(1, 2)]]);
  assert.equal(f.v, 1);
  assert.equal(f.receipts.length, 4);
  assert.deepEqual(f.proofs.map(p => p.envelopeId).sort(), [secrets[0][0], secrets[1][0], secrets[2][0]].sort(), 'segredo malformado fica de fora');
  for (const r of f.receipts) {
    assert.match(r.ackHash, /^[0-9a-f]{32}$/);
    assert.equal(r.nodePk, Buffer.from(node.pk).toString('hex'));
    assert.match(r.sig, /^[0-9a-f]{128}$/);
  }
  // O mesmo caminho do validador (apps/settlement/src/validator.ts, buildLedger): hex → livro.
  const ledger = new ContributionLedger();
  for (const p of f.proofs) { const s = fromHex(p.ackSecret); ledger.confirmDelivery(p.envelopeId, s, hash(s).slice(0, 16)); }
  const states = f.receipts.map(r => ledger.submit({ envelopeId: r.envelopeId, ackHash: fromHex(r.ackHash), nodePk: fromHex(r.nodePk), at: r.at, sig: fromHex(r.sig) }, T0));
  assert.deepEqual(states.filter(s => s === 'validado').length, 3, 'três com prova');
  assert.ok(states.every(s => s === 'validado' || s === 'pendente'), 'nenhuma assinatura recusada');
  // Ida e volta em JSON (o arquivo compartilhado) e nome do arquivo.
  assert.deepEqual(JSON.parse(JSON.stringify(f)), f);
  assert.equal(evidenceFileName(new Date(2026, 10, 3, 9).getTime()), 'piu-evidencias-celular-2026-11-03.json');
});

test('7.4 dias de uso: só contam dias com entrega para 3+ contatos distintos', () => {
  const d = new DeliveryDays();
  assert.equal(d.record('seg', 'a'), true);
  assert.equal(d.record('seg', 'a'), false, 'mesmo contato não conta duas vezes');
  d.record('seg', 'b');
  assert.equal(d.activeDays(), 0);
  d.record('seg', 'c');
  d.record('ter', 'a'); d.record('ter', 'b');
  assert.equal(d.activeDays(), 1);
  const again = new DeliveryDays(JSON.parse(JSON.stringify(d.export())));
  assert.equal(again.activeDays(), 1);
  assert.equal(again.contactsOn('ter'), 2);
  assert.equal(new DeliveryDays('lixo').activeDays(), 0);
});

test('6.5 convites aceitos: registro único por contato, mais recentes primeiro', () => {
  const a = new AcceptedInvites();
  assert.equal(a.add({ contactId: 'x', name: 'Ana', via: 'public', at: 1 }), true);
  assert.equal(a.add({ contactId: 'x', name: 'Ana', via: 'public', at: 5 }), false);
  a.add({ contactId: 'y', name: '', via: 'anon', at: 3 });
  assert.deepEqual(a.all().map(x => x.contactId), ['y', 'x']);
  assert.equal(new AcceptedInvites(JSON.parse(JSON.stringify(a.export()))).size, 2);
});

// ── no mensageiro ────────────────────────────────────────

class Net {
  clock = T0;
  nodes = new Map<string, Messenger>();
  links = new Set<string>();
  queue: [string, string, Uint8Array][] = [];
  key = (a: string, b: string) => [a, b].sort().join('~');
  transmit = (from: string) => async (to: string, bytes: Uint8Array) => { if (this.links.has(this.key(from, to))) this.queue.push([from, to, bytes]); };
  run() { for (let i = 0; i < 2000 && this.queue.length; i++) { const [f, t, b] = this.queue.shift()!; this.nodes.get(t)!.receive(f, b); } }
  link(a: string, b: string) { this.links.add(this.key(a, b)); this.nodes.get(a)!.peerConnected(b, 'ble'); this.nodes.get(b)!.peerConnected(a, 'ble'); this.run(); }
}
function device(net: Net, name: string, state?: string) {
  const seed = newSeed();
  const ids = { public: deriveIdentity(seed, 'public'), anon: deriveIdentity(seed, 'anon') };
  const used: string[] = [];
  const m = new Messenger({ identities: ids, node: deriveNodeKey(seed), relay: true, now: () => net.clock, transmit: net.transmit(name), state, events: { inviteUsed: i => used.push(i.name) } });
  m.displayName = name;
  net.nodes.set(name, m);
  return { m, ids, used };
}
const contactOf = (d: ReturnType<typeof device>, name: string): Contact => ({ id: d.ids.public.id, via: 'public', pub: toPublic(d.ids.public), name, invite: d.m.issueInvite('public').code });

test('6.5 e 7.4 no mensageiro: convite usado fica registrado; entrega a 3 contatos no dia conta 1 dia', () => {
  const net = new Net();
  const me = device(net, 'Ana');
  const others = ['Beto', 'Caio', 'Dora'].map(n => device(net, n));
  for (const o of others) me.m.addContact(contactOf(o, o.m.displayName));
  others.forEach((o, i) => me.m.sendText(o.ids.public.id, `m${i}`, 'Oi'));
  for (const o of others) net.link('Ana', o.m.displayName);
  for (let i = 0; i < 3; i++) { net.clock += 5; me.m.tick(); for (const o of others) o.m.tick(); net.run(); }
  // Cada um recebeu pelo meu convite? Não: eu escaneei o QR deles. Quem registra é cada um deles.
  for (const o of others) {
    assert.deepEqual(o.used, ['Ana']);
    assert.deepEqual(o.m.acceptedInvites().map(x => [x.contactId, x.name, x.via]), [[me.ids.public.id, 'Ana', 'public']]);
    assert.equal(o.m.acceptedInvites()[0].at, T0 * 1000, 'data em ms');
  }
  assert.equal(me.m.acceptedInvites().length, 0);
  assert.equal(me.m.deliveryDays.activeDays(), 1, 'entregas confirmadas para 3 contatos distintos no dia');
  // Estado salvo e restaurado.
  const again = new Messenger({ identities: me.ids, node: deriveNodeKey(newSeed()), relay: true, now: () => net.clock, transmit: async () => {}, state: me.m.export(), events: {} });
  assert.equal(again.deliveryDays.activeDays(), 1);
  const o0 = new Messenger({ identities: others[0].ids, node: deriveNodeKey(newSeed()), relay: true, now: () => net.clock, transmit: async () => {}, state: others[0].m.export(), events: {} });
  assert.equal(o0.acceptedInvites().length, 1);
  // Evidências do aparelho: sem créditos de relay aqui, o arquivo é válido e vazio de recibos.
  assert.deepEqual(me.m.evidence().receipts, []);
});
