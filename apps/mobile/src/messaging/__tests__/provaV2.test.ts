/// <reference types="node" />
// Prova de entrega v2 no app (docs/economia/prova-de-entrega-v2.md): o destino assina e sela para o
// validador, a prova circula pelo quadro "P2", e o tráfego v1 continua igual.
import assert from 'node:assert/strict';
import { test } from 'node:test';
const fromHex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], x => parseInt(x, 16));
import { toHex } from '../../protocol/bytes';
import { deriveIdentity, deriveNodeKey, newSeed, toPublic } from '../../protocol/keys';
import { envelopeId } from '../../protocol/envelope';
import { decodeProofV2Frame, encodeProofV2Frame, isProofV2Frame, openSealedProof, proofPseudonym, SEALED_PROOF_BYTES, validatorProofKey, verifyDeliveryProof } from '../../protocol/proof';
import { Router } from '../../protocol/router';
import { random } from '../../protocol/suite';
import { type Contact, Messenger } from '../messenger';

const T0 = 1_800_000_000;
const V = validatorProofKey(newSeed());

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
  run() { for (let i = 0; i < 1000 && this.queue.length; i++) { const [f, t, b] = this.queue.shift()!; this.nodes.get(t)!.receive(f, b); } }
  link(a: string, b: string) { this.links.add(this.key(a, b)); this.nodes.get(a)!.peerConnected(b, 'ble'); this.nodes.get(b)!.peerConnected(a, 'ble'); this.run(); }
  unlink(a: string, b: string) { this.links.delete(this.key(a, b)); this.nodes.get(a)!.peerDisconnected(b); this.nodes.get(b)!.peerDisconnected(a); }
}

function device(net: Net, name: string, o: { pk?: Uint8Array | null; state?: string; seed?: Uint8Array } = {}) {
  const seed = o.seed ?? newSeed();
  const ids = { public: deriveIdentity(seed, 'public'), anon: deriveIdentity(seed, 'anon') };
  const msgs: string[] = [];
  const m = new Messenger({
    identities: ids, node: deriveNodeKey(seed), relay: true, now: () => net.clock, transmit: net.transmit(name), state: o.state,
    validatorProofPk: o.pk === undefined ? V.pk : o.pk,
    events: { message: (_c, x) => msgs.push(x.text), newContact: (_c, x) => msgs.push(x.text) },
  });
  m.displayName = name;
  net.nodes.set(name, m);
  return { m, ids, seed, msgs };
}
const contactOf = (d: ReturnType<typeof device>, name: string, via: 'public' | 'anon' = 'public'): Contact =>
  ({ id: d.ids[via].id, via, pub: toPublic(d.ids[via]), name, invite: d.m.issueInvite(via).code });

/** A → Relay → B, com o relay guardando entre os dois contatos. */
function viaRelay(o: { relayPk?: Uint8Array | null; destPk?: Uint8Array | null; via?: 'public' | 'anon' } = {}) {
  const net = new Net();
  const a = device(net, 'Ana'), r = device(net, 'Relay', { pk: o.relayPk }), b = device(net, 'Beto', { pk: o.destPk });
  a.m.addContact(contactOf(b, 'Beto', o.via ?? 'public'));
  a.m.sendText(b.ids[o.via ?? 'public'].id, 'm1', 'Pela malha');
  net.link('Ana', 'Relay'); net.unlink('Ana', 'Relay');
  net.link('Relay', 'Beto');
  return { net, a, r, b };
}

test('destino assina a prova v2 com a identidade que recebeu e sela para o validador; o relay guarda e exporta', () => {
  const { r, b } = viaRelay();
  assert.deepEqual(b.msgs, ['Pela malha'], 'a mensagem chegou como sempre');
  const ev = r.m.evidence();
  assert.equal(ev.v, 2);
  assert.equal(ev.receipts.length, 1);
  assert.equal(ev.sealedProofs.length, 1, 'a prova v2 voltou pela malha até o relay');
  assert.equal(ev.proofs.length, 1, 'a v1 continua indo (legado)');
  const s = ev.sealedProofs[0]!;
  assert.equal(s.envelopeId, ev.receipts[0]!.envelopeId);
  assert.deepEqual(r.m.credits.get(s.envelopeId)?.sealed, [s.sealed], 'guardada junto com o crédito');
  const p = openSealedProof(fromHex(s.sealed), s.envelopeId, V);
  assert.ok(p, 'só o validador abre');
  const h = verifyDeliveryProof(p, T0 + 60);
  assert.ok(h);
  assert.equal(toHex(h.ackHash), ev.receipts[0]!.ackHash, 'o ackHash do recibo é o do cabeçalho');
  assert.equal(toHex(p.pseudonym), toHex(proofPseudonym(b.ids.public, V.pk).pk), 'assinada pelo pseudônimo do destino');
  assert.notEqual(toHex(p.pseudonym), toHex(b.ids.public.signPk), 'o validador não vê a identidade social');
  // A identidade do destino não aparece em claro no arquivo de evidências do relay.
  assert.ok(!JSON.stringify(ev).includes(toHex(b.ids.public.signPk)));
  // O destino também exporta a própria prova.
  assert.equal(b.m.evidence().sealedProofs.length, 1);
});

test('identidade anônima: a prova é assinada pelo pseudônimo da anônima (não liga com a pública)', () => {
  const { b } = viaRelay({ via: 'anon' });
  const s = b.m.evidence().sealedProofs[0]!;
  const p = openSealedProof(fromHex(s.sealed), s.envelopeId, V)!;
  assert.equal(toHex(p.pseudonym), toHex(proofPseudonym(b.ids.anon, V.pk).pk));
  assert.notEqual(toHex(p.pseudonym), toHex(proofPseudonym(b.ids.public, V.pk).pk));
});

test('destino ambíguo (as duas identidades aceitam): não sai prova v2, em vez de assinar com a errada', () => {
  const net = new Net();
  const a = device(net, 'Ana');
  const seed = newSeed();
  const same = deriveIdentity(seed, 'public');
  const m = new Messenger({ identities: { public: same, anon: same }, node: deriveNodeKey(seed), relay: true, now: () => net.clock, transmit: net.transmit('Beto'), validatorProofPk: V.pk, events: {} });
  net.nodes.set('Beto', m);
  a.m.addContact({ id: same.id, via: 'public', pub: toPublic(same), name: 'Beto', invite: m.issueInvite('public').code });
  a.m.sendText(same.id, 'm1', 'Oi');
  net.link('Ana', 'Beto');
  assert.ok(m.evidence().proofs.length >= 1, 'entregue (prova v1 saiu)');
  // Nenhuma prova assinada por esta identidade (as que aparecem são da Ana, pelas confirmações que ela recebeu).
  const mine = toHex(proofPseudonym(same, V.pk).pk);
  assert.ok(m.evidence().sealedProofs.every(x => toHex(openSealedProof(fromHex(x.sealed), x.envelopeId, V)!.pseudonym) !== mine));
});

test('enxurrada: provas falsas que chegam antes não barram a verdadeira (até 3 por envelope)', () => {
  const net = new Net();
  const a = device(net, 'Ana'), r = device(net, 'Relay'), b = device(net, 'Beto');
  a.m.addContact(contactOf(b, 'Beto'));
  a.m.sendText(b.ids.public.id, 'm1', 'Oi');
  net.link('Ana', 'Relay'); net.unlink('Ana', 'Relay');
  // O relay ainda não repassou: o envelope está guardado nele. Um vizinho manda 2 provas falsas.
  const env = net.wire.find(x => x[0] === 0)!;
  const eid = envelopeId(env);
  const fakes = [random(SEALED_PROOF_BYTES), random(SEALED_PROOF_BYTES)].map(sealed => ({ envelopeId: eid, sealed }));
  r.m.receive('Eva', encodeProofV2Frame(fakes));
  net.link('Relay', 'Beto');
  const ev = r.m.evidence();
  assert.equal(ev.sealedProofs.filter(x => x.envelopeId === eid).length, 3, 'as 2 falsas e a verdadeira');
  assert.ok(ev.sealedProofs.some(x => openSealedProof(fromHex(x.sealed), eid, V)), 'a verdadeira está lá');
  // Mais uma falsa: não entra (teto de 3), e repetir uma já guardada não duplica.
  r.m.receive('Eva', encodeProofV2Frame([{ envelopeId: eid, sealed: random(SEALED_PROOF_BYTES) }, fakes[0]!]));
  assert.equal(r.m.evidence().sealedProofs.filter(x => x.envelopeId === eid).length, 3);
});

test('sem a chave do validador: nenhuma prova v2, e a entrega e a prova v1 continuam iguais', () => {
  const { net, r, b } = viaRelay({ destPk: null });
  assert.deepEqual(b.msgs, ['Pela malha']);
  assert.equal(r.m.evidence().sealedProofs.length, 0);
  assert.ok(r.m.credits.totals().validado > 0, 'o crédito local segue a prova v1');
  assert.ok(!net.wire.some(isProofV2Frame), 'nenhum quadro P2 na malha');
});

test('compatibilidade: um relay antigo (só o roteador v1) descarta o quadro P2 sem efeito e entrega normalmente', () => {
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto');
  a.m.addContact(contactOf(b, 'Beto'));
  a.m.sendText(b.ids.public.id, 'm1', 'Oi');
  net.link('Ana', 'Beto');
  const frame = net.wire.find(isProofV2Frame);
  assert.ok(frame, 'o destino publicou a prova v2');
  // O que um aparelho antigo faz com bytes que não são "PR" nem "PN": entrega ao roteador.
  const seed = newSeed();
  const old = new Router({ node: deriveNodeKey(seed), identities: [deriveIdentity(seed, 'public')], relay: true });
  assert.equal(old.ingest(frame, 'Beto', T0).status, 'rejected');
  // E o fluxo normal de envelopes v0 entre o novo e o antigo continua: o antigo guarda e repassa.
  const env = net.wire.find(x => x[0] === 0)!;
  assert.equal(old.ingest(env, 'Ana', T0).status, 'stored');
  assert.equal(old.outgoing('Beto', 'ble', T0).length, 1);
});

test('quadro P2 de envelope que não passou por aqui é ignorado (contra enxurrada de provas)', () => {
  const net = new Net();
  const r = device(net, 'Relay');
  const fake = encodeProofV2Frame([{ envelopeId: toHex(random(16)), sealed: random(SEALED_PROOF_BYTES) }]);
  assert.equal(r.m.receive('X', fake).status, 'rejected');
  assert.equal(r.m.evidence().sealedProofs.length, 0);
  assert.equal(r.m.receive('X', fake.slice(0, 50)).status, 'rejected', 'malformado: sem erro');
  assert.equal(decodeProofV2Frame(fake.slice(0, 50)), null);
});

test('reabrir o app: as provas v2 guardadas voltam e continuam no arquivo de evidências', () => {
  const { net, r } = viaRelay();
  const before = r.m.evidence().sealedProofs;
  const again = device(net, 'Relay2', { state: r.m.export(), seed: newSeed() });
  assert.deepEqual(again.m.evidence().sealedProofs, before);
  // Depois de 8 dias, saem.
  net.clock += 9 * 86400;
  const later = device(net, 'Relay3', { state: r.m.export(), seed: newSeed() });
  assert.equal(later.m.evidence().sealedProofs.filter(x => !r.m.credits.get(x.envelopeId)?.sealed).length, 0);
});
