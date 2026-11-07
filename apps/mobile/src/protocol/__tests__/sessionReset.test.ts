/// <reference types="node" />
/**
 * M-02 (auditoria 2026-11-06): o replay da primeira mensagem de um contato não pode trocar uma sessão
 * Double Ratchet já estabelecida. Sem mudança no fio: a decisão usa só o `sentAt` (assinado pelo
 * remetente) do início da sessão atual e a sessão anterior fica como alternativa.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromUtf8, utf8 } from '../bytes';
import { openDirect } from '../envelope';
import { deriveIdentity, newSeed, toPublic } from '../keys';
import { Session } from '../ratchet';
import { SessionManager } from '../sessions';

const NOW = 1_800_000_000;
const A = deriveIdentity(newSeed(), 'public');
const B = deriveIdentity(newSeed(), 'public');

/** Abre em `mgr` (de `me`) um envelope selado; texto ou null. */
function read(mgr: SessionManager, me: typeof A, bytes: Uint8Array, now: number): string | null {
  const m = openDirect(bytes, me, now, mgr.acceptsDest);
  if (!m) return null;
  const pt = mgr.open(m);
  return pt ? fromUtf8(pt) : null;
}

/** A começa, B responde, A manda mais uma: sessão estabelecida nos dois lados. */
function talk() {
  const sa = new SessionManager(A), sb = new SessionManager(B);
  const first = sa.seal(toPublic(B), utf8('primeira'), { now: NOW });
  assert.equal(read(sb, B, first.bytes, NOW), 'primeira');
  assert.equal(read(sa, A, sb.seal(toPublic(A), utf8('resposta'), { now: NOW + 10 }).bytes, NOW + 10), 'resposta');
  assert.equal(read(sb, B, sa.seal(toPublic(B), utf8('segunda'), { now: NOW + 20 }).bytes, NOW + 20), 'segunda');
  return { sa, sb, first };
}

test('replay da primeira mensagem (relay guardou e reenviou) não troca a sessão estabelecida', () => {
  const { sa, sb, first } = talk();
  assert.equal(read(sb, B, first.bytes, NOW + 3600), null, 'replay recusado');
  // A conversa segue nos dois sentidos, como se nada tivesse acontecido.
  assert.equal(read(sb, B, sa.seal(toPublic(B), utf8('depois'), { now: NOW + 3601 }).bytes, NOW + 3601), 'depois');
  assert.equal(read(sa, A, sb.seal(toPublic(A), utf8('ok'), { now: NOW + 3602 }).bytes, NOW + 3602), 'ok');
});

test('replay da primeira mensagem logo depois dela (conversa parada) também é recusado', () => {
  const sa = new SessionManager(A), sb = new SessionManager(B);
  const first = sa.seal(toPublic(B), utf8('oi'), { now: NOW });
  assert.equal(read(sb, B, first.bytes, NOW), 'oi');
  assert.equal(read(sa, A, sb.seal(toPublic(A), utf8('oi!'), { now: NOW + 1 }).bytes, NOW + 1), 'oi!');
  assert.equal(read(sb, B, first.bytes, NOW + 5), null);
  assert.equal(read(sb, B, sa.seal(toPublic(B), utf8('tudo?'), { now: NOW + 6 }).bytes, NOW + 6), 'tudo?');
});

test('contato que reinstalou o app (sessão nova, mensagem mais recente) continua sendo aceito', () => {
  const { sb } = talk();
  const sa2 = new SessionManager(A); // reinstalou: sem sessão nenhuma
  assert.equal(read(sb, B, sa2.seal(toPublic(B), utf8('voltei'), { now: NOW + 100 }).bytes, NOW + 100), 'voltei');
  assert.equal(read(sa2, A, sb.seal(toPublic(A), utf8('bem-vinda'), { now: NOW + 101 }).bytes, NOW + 101), 'bem-vinda', 'a resposta já vai pela sessão nova');
  assert.equal(read(sb, B, sa2.seal(toPublic(B), utf8('valeu'), { now: NOW + 102 }).bytes, NOW + 102), 'valeu');
});

test('aparelho novo com relógio atrás da última mensagem, mas depois do início da sessão, ainda reinicia', () => {
  const { sa, sb } = talk(); // início da sessão de A: NOW; última mensagem de A: NOW + 20
  void sa;
  const sa2 = new SessionManager(A);
  assert.equal(read(sb, B, sa2.seal(toPublic(B), utf8('relógio atrasado'), { now: NOW + 5 }).bytes, NOW + 100), 'relógio atrasado');
  assert.equal(read(sa2, A, sb.seal(toPublic(A), utf8('ok'), { now: NOW + 101 }).bytes, NOW + 101), 'ok');
});

test('sem o início guardado (estado da versão antiga), a primeira mensagem autêntica depois passa a valer como início', () => {
  const { sa, sb, first } = talk();
  const old = JSON.stringify((JSON.parse(sb.export()) as string[]).map(e => { const j = JSON.parse(e); delete j.piuSince; return JSON.stringify(j); }));
  const sb2 = SessionManager.import(B, old);
  assert.equal(read(sb2, B, sa.seal(toPublic(B), utf8('mais uma'), { now: NOW + 30 }).bytes, NOW + 30), 'mais uma');
  assert.equal(read(sb2, B, first.bytes, NOW + 3600), null, 'replay recusado a partir daí');
});

test('mensagem da sessão antiga que chega depois da troca ainda abre (sessão anterior como alternativa)', () => {
  const { sa, sb } = talk();
  const late = sa.seal(toPublic(B), utf8('atrasada'), { now: NOW + 90 }); // saiu antes da reinstalação, chega depois
  const sa2 = new SessionManager(A);
  assert.equal(read(sb, B, sa2.seal(toPublic(B), utf8('voltei'), { now: NOW + 100 }).bytes, NOW + 100), 'voltei');
  assert.equal(read(sb, B, late.bytes, NOW + 110), 'atrasada');
  // e a sessão atual continua a nova
  assert.equal(read(sa2, A, sb.seal(toPublic(A), utf8('ok'), { now: NOW + 111 }).bytes, NOW + 111), 'ok');
});

test('início simultâneo segue convergindo (regra antiga intacta)', () => {
  const sa = new SessionManager(A), sb = new SessionManager(B);
  const x = sa.seal(toPublic(B), utf8('de A'), { now: NOW });
  const y = sb.seal(toPublic(A), utf8('de B'), { now: NOW });
  assert.equal(read(sb, B, x.bytes, NOW), 'de A');
  assert.equal(read(sa, A, y.bytes, NOW), 'de B');
  for (let i = 1; i < 4; i++) {
    assert.equal(read(sb, B, sa.seal(toPublic(B), utf8('a' + i), { now: NOW + i }).bytes, NOW + i), 'a' + i);
    assert.equal(read(sa, A, sb.seal(toPublic(A), utf8('b' + i), { now: NOW + i }).bytes, NOW + i), 'b' + i);
  }
});

test('salvar e reabrir guarda o início da sessão e a sessão anterior', () => {
  const { sa, sb, first } = talk();
  const late = sa.seal(toPublic(B), utf8('atrasada'), { now: NOW + 90 });
  const sa2 = new SessionManager(A);
  assert.equal(read(sb, B, sa2.seal(toPublic(B), utf8('voltei'), { now: NOW + 100 }).bytes, NOW + 100), 'voltei');
  const sb2 = SessionManager.import(B, sb.export());
  assert.equal(read(sb2, B, first.bytes, NOW + 3600), null, 'replay recusado depois de reabrir');
  assert.equal(read(sb2, B, late.bytes, NOW + 3600), 'atrasada', 'sessão anterior volta junto');
  assert.equal(read(sa2, A, sb2.seal(toPublic(A), utf8('ok'), { now: NOW + 3601 }).bytes, NOW + 3601), 'ok');
});

test('compatível: estado salvo pela versão antiga (lista de sessões) abre igual', () => {
  const { sa, sb } = talk();
  const old = JSON.stringify((JSON.parse(sb.export()) as string[]).filter(e => !JSON.parse(e).piuPrev).map(e => {
    const j = JSON.parse(e); delete j.piuSince; return JSON.stringify(j);
  }));
  const sb2 = SessionManager.import(B, old);
  assert.equal(read(sb2, B, sa.seal(toPublic(B), utf8('de novo'), { now: NOW + 30 }).bytes, NOW + 30), 'de novo');
});

test('compatível: a versão antiga lendo o estado novo fica com a sessão atual (não a anterior)', () => {
  const { sa, sb } = talk();
  const sa2 = new SessionManager(A);
  assert.equal(read(sb, B, sa2.seal(toPublic(B), utf8('voltei'), { now: NOW + 100 }).bytes, NOW + 100), 'voltei');
  void sa;
  // Mesmo laço do `SessionManager.import` antigo: cada item vira sessão, o último de cada contato vale.
  const oldMap = new Map<string, Session>();
  for (const e of JSON.parse(sb.export()) as string[]) { const s = Session.import(e); oldMap.set(s.peerId, s); }
  const cur = oldMap.get(A.id)!;
  const m = openDirect(sa2.seal(toPublic(B), utf8('x'), { now: NOW + 101 }).bytes, B, NOW + 101, sb.acceptsDest)!;
  assert.equal(fromUtf8(cur.decrypt(m.body)!), 'x');
});
