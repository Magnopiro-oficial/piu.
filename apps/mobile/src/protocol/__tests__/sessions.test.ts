/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromUtf8, utf8 } from '../bytes';
import { directDest, MsgType, openDirect, parseHeader, sealDirect } from '../envelope';
import { deriveIdentity, deriveNodeKey, newSeed, toPublic } from '../keys';
import { isValidPhrase, newPhrase, seedFromPhrase, suggestWords, WORDLIST } from '../phrase';
import { Session } from '../ratchet';
import { ContributionLedger, makeRelayReceipt } from '../receipts';
import { randomDelaySec, Router } from '../router';
import { SessionManager } from '../sessions';

const NOW = 1_800_000_000;
const A = deriveIdentity(newSeed(), 'public');
const B = deriveIdentity(newSeed(), 'public');

test('frase: 12 palavras em português, checksum detecta erro, a mesma frase recupera as mesmas chaves', () => {
  const words = newPhrase();
  assert.equal(words.length, 12);
  assert.ok(words.every(w => WORDLIST.includes(w)));
  assert.ok(isValidPhrase(words));
  const seed = seedFromPhrase(words);
  assert.equal(deriveIdentity(seedFromPhrase([...words]), 'public').id, deriveIdentity(seed, 'public').id);
  const wrong = [...words]; wrong[5] = WORDLIST[(WORDLIST.indexOf(words[5]) + 1) % WORDLIST.length];
  assert.equal(isValidPhrase(wrong), false);
  assert.throws(() => seedFromPhrase(wrong));
  assert.ok(isValidPhrase(words.map(w => ` ${w.toUpperCase()} `)), 'tolera maiúsculas e espaços');
  assert.ok(suggestWords('aba').includes('abacate'));
});

test('ratchet: conversa nos dois sentidos, cada mensagem com chave própria', () => {
  const a = Session.initiate(A, toPublic(B)), b = Session.respond(B, toPublic(A));
  const m1 = a.encrypt(utf8('oi')), m2 = a.encrypt(utf8('tudo bem?'));
  assert.equal(fromUtf8(b.decrypt(m1)!), 'oi');
  assert.equal(fromUtf8(b.decrypt(m2)!), 'tudo bem?');
  assert.throws(() => Session.respond(B, toPublic(A)).encrypt(utf8('x')), /sem cadeia/, 'quem responde só envia depois de receber');
  const r1 = b.encrypt(utf8('tudo!'));
  assert.equal(fromUtf8(a.decrypt(r1)!), 'tudo!');
  for (let i = 0; i < 5; i++) {
    assert.equal(fromUtf8(b.decrypt(a.encrypt(utf8('a' + i)))!), 'a' + i);
    assert.equal(fromUtf8(a.decrypt(b.encrypt(utf8('b' + i)))!), 'b' + i);
  }
  assert.ok(a.established && b.established);
});

test('ratchet: fora de ordem funciona; replay e adulteração não', () => {
  const a = Session.initiate(A, toPublic(B)), b = Session.respond(B, toPublic(A));
  const ms = [0, 1, 2, 3, 4].map(i => a.encrypt(utf8('m' + i)));
  assert.equal(fromUtf8(b.decrypt(ms[3])!), 'm3');
  assert.equal(fromUtf8(b.decrypt(ms[0])!), 'm0');
  assert.equal(fromUtf8(b.decrypt(ms[4])!), 'm4');
  assert.equal(b.decrypt(ms[3]), null, 'replay recusado');
  const t = ms[1].slice(); t[t.length - 1] ^= 1;
  assert.equal(b.decrypt(t), null, 'adulterada recusada');
  assert.equal(fromUtf8(b.decrypt(ms[1])!), 'm1', 'a tentativa adulterada não estragou o estado');
  assert.equal(fromUtf8(b.decrypt(ms[2])!), 'm2');
});

test('sigilo futuro: quem rouba a chave de identidade depois não lê a conversa antiga', () => {
  const a = Session.initiate(A, toPublic(B)), b = Session.respond(B, toPublic(A));
  b.decrypt(a.encrypt(utf8('início')));
  a.decrypt(b.encrypt(utf8('resposta')));            // catraca de DH girou
  const secret = a.encrypt(utf8('segredo depois da catraca'));
  assert.ok(b.decrypt(secret));
  // O atacante tem a chave de identidade de B (e a de A) e tenta montar a sessão do zero.
  const attacker = Session.respond(B, toPublic(A));
  assert.equal(attacker.decrypt(secret), null);
});

test('ratchet: estado salvo e restaurado continua a conversa', () => {
  const a = Session.initiate(A, toPublic(B)), b = Session.respond(B, toPublic(A));
  b.decrypt(a.encrypt(utf8('1')));
  const later = a.encrypt(utf8('pulada'));           // vai chegar depois da restauração
  const b2 = Session.import(b.export());
  assert.equal(fromUtf8(a.decrypt(b2.encrypt(utf8('2')))!), '2');
  assert.equal(fromUtf8(b2.decrypt(later)!), 'pulada');
});

test('sessão pela malha: depois da resposta, o destino não é mais ligável à chave pública', () => {
  const sa = new SessionManager(A), sb = new SessionManager(B);
  const ra = new Router({ node: deriveNodeKey(newSeed()), identities: [A], relay: true, acceptDest: sa.acceptsDest });
  const rb = new Router({ node: deriveNodeKey(newSeed()), identities: [B], relay: true, acceptDest: sb.acceptsDest });
  const first = sa.seal(toPublic(B), utf8('primeira'), { now: NOW });
  assert.ok(first.bytes.length > 0);
  assert.deepEqual(parseHeader(first.bytes).dest, directDest(B.agreePk, parseHeader(first.bytes).expiresAt), 'primeira: B ainda não tem a sessão');
  const d1 = rb.ingest(first.bytes, 'A', NOW);
  assert.equal(d1.status, 'delivered');
  assert.equal(fromUtf8(sb.open((d1 as { message: Parameters<SessionManager['open']>[0] }).message)!), 'primeira');
  const reply = sb.seal(toPublic(A), utf8('resposta'), { now: NOW + 1 });
  const h = parseHeader(reply.bytes);
  assert.notDeepEqual(h.dest, directDest(A.agreePk, h.expiresAt), 'resposta já usa o destino da sessão');
  const d2 = ra.ingest(reply.bytes, 'B', NOW + 1);
  assert.equal(d2.status, 'delivered');
  assert.equal(fromUtf8(sa.open((d2 as { message: Parameters<SessionManager['open']>[0] }).message)!), 'resposta');
  // Quem não tem a sessão (nem o próprio A sem o acceptDest) não reconhece o destino.
  assert.equal(openDirect(reply.bytes, A, NOW + 1), null);
  const next = sa.seal(toPublic(B), utf8('terceira'), { now: NOW + 2 });
  const h3 = parseHeader(next.bytes);
  assert.notDeepEqual(h3.dest, directDest(B.agreePk, h3.expiresAt));
  const d3 = rb.ingest(next.bytes, 'A', NOW + 2);
  assert.equal(fromUtf8(sb.open((d3 as { message: Parameters<SessionManager['open']>[0] }).message)!), 'terceira');
  // Persistência do gerenciador.
  const sb2 = SessionManager.import(B, sb.export());
  const again = sa.seal(toPublic(B), utf8('depois de reabrir'), { now: NOW + 3 });
  const m = openDirect(again.bytes, B, NOW + 3, sb2.acceptsDest)!;
  assert.equal(fromUtf8(sb2.open(m)!), 'depois de reabrir');
});

test('início simultâneo: as duas pontas leem tudo e convergem', () => {
  const sa = new SessionManager(A), sb = new SessionManager(B);
  const x = sa.seal(toPublic(B), utf8('de A'), { now: NOW });
  const y = sb.seal(toPublic(A), utf8('de B'), { now: NOW });
  assert.equal(fromUtf8(sb.open(openDirect(x.bytes, B, NOW)!)!), 'de A');
  assert.equal(fromUtf8(sa.open(openDirect(y.bytes, A, NOW)!)!), 'de B');
  for (let i = 0; i < 3; i++) {
    const p = sa.seal(toPublic(B), utf8('a' + i), { now: NOW + i });
    assert.equal(fromUtf8(sb.open(openDirect(p.bytes, B, NOW + i, sb.acceptsDest)!)!), 'a' + i);
    const q = sb.seal(toPublic(A), utf8('b' + i), { now: NOW + i });
    assert.equal(fromUtf8(sa.open(openDirect(q.bytes, A, NOW + i, sa.acceptsDest)!)!), 'b' + i);
  }
});

test('atraso aleatório: a mensagem só sai depois do tempo sorteado', () => {
  const r = new Router({ node: deriveNodeKey(newSeed()), identities: [A], relay: true });
  const m = sealDirect({ from: A, to: toPublic(B), type: MsgType.Text, body: utf8('x'), now: NOW });
  r.send(m.bytes, NOW, { delaySec: 20 });
  assert.equal(r.outgoing('B', 'ble', NOW + 19).length, 0);
  assert.equal(r.outgoing('B', 'ble', NOW + 20).length, 1);
  const ds = Array.from({ length: 200 }, () => randomDelaySec(30));
  assert.ok(ds.every(d => d >= 0 && d <= 30) && new Set(ds).size > 10);
});

test('antifraude: tetos, horário e auditoria por amostragem', () => {
  const ledger = new ContributionLedger({ maxRelaysPerEnvelope: 3, maxPerNodePerDay: 2 });
  const nodes = Array.from({ length: 5 }, () => deriveNodeKey(newSeed()));
  const ack = new Uint8Array(16);
  // Sybil/colusão: 5 "relays" para um mesmo envelope; só 3 contam.
  const states = nodes.map(n => ledger.submit(makeRelayReceipt(n, 'env1', ack, NOW), NOW));
  assert.deepEqual(states, ['pendente', 'pendente', 'pendente', 'rejeitado', 'rejeitado']);
  // Tráfego artificial: teto diário por nó.
  const n = nodes[0];
  assert.equal(ledger.submit(makeRelayReceipt(n, 'env2', ack, NOW), NOW), 'pendente');
  assert.equal(ledger.submit(makeRelayReceipt(n, 'env3', ack, NOW), NOW), 'rejeitado');
  assert.equal(ledger.submit(makeRelayReceipt(nodes[1], 'env4', ack, NOW + 3600), NOW), 'rejeitado', 'recibo do futuro');
  // Auditoria: tudo é sorteado com taxa 1; o nó 1 é reprovado e perde o pendente.
  assert.ok(ledger.sampleForAudit(1).length >= 3);
  assert.equal(ledger.sampleForAudit(0).length, 0);
  ledger.auditResult(nodes[1].pk, false);
  assert.equal(ledger.summary(nodes[1].pk).pendente, 0);
  assert.equal(ledger.submit(makeRelayReceipt(nodes[1], 'env5', ack, NOW), NOW), 'rejeitado', 'bloqueado');
  ledger.auditResult(nodes[0].pk, true);
  assert.equal(ledger.summary(nodes[0].pk).pendente, 2);
});
