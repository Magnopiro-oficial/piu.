/// <reference types="node" />
/**
 * B-07 (auditoria 2026-11-06): nomes e descrições que chegam de outros aparelhos perdem os controles
 * bidi (U+202A–U+202E, U+2066–U+2069), que invertem o texto e deixam um nome parecer outro.
 * Só na leitura: a assinatura continua sobre os bytes originais (nada muda no fio).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { concat, utf8, Writer } from '../../protocol/bytes';
import { deriveIdentity, newSeed } from '../../protocol/keys';
import { sign } from '../../protocol/suite';
import { readPayRequest } from '../../lib/paymentRequest';
import { encodeSs58 } from '../../lib/ss58';
import { stripBidi } from '../bidi';
import { b64url, CARD_PREFIX, decodeCard, encodeCard } from '../card';
import { decodeState } from '../groups';
import { decodePresence, encodePresence, makePresence } from '../nearby';

const T0 = 1_800_000_000;
const RLO = '‮', ISO = '⁦', PDI = '⁩';
const BIDI = /[‪-‮⁦-⁩]/;

test('stripBidi: tira só os controles bidi; acentos, árabe, emoji com ZWJ e espaços ficam', () => {
  assert.equal(stripBidi(`Ana${RLO}lapyap‬`), 'Analapyap');
  assert.equal(stripBidi(`${ISO}x${PDI}‪‫‭⁧⁨`), 'x');
  for (const ok of ['José Conceição', 'محمد', 'नमस्ते', '👨‍👩‍👧', 'a b']) assert.equal(stripBidi(ok), ok);
});

test('cartão de contato: nome com RLO chega sem ele (cartão montado fora deste app)', () => {
  const me = deriveIdentity(newSeed(), 'public');
  const nm = utf8(`Ana${RLO}lapyap`);
  const body = new Writer().u8(2).u8(0).bytes(me.signPk).bytes(me.agreePk).bytes(me.binding)
    .u32(T0 + 3600).bytes(new Uint8Array(8).fill(1)).u8(nm.length).bytes(nm).done();
  const raw = CARD_PREFIX + b64url(concat(body, sign.sign(concat(utf8('piu/v0/card'), body), me.sign.sk)));
  const card = decodeCard(raw, T0);
  assert.equal(card.name, 'Analapyap', 'assinatura conferida sobre os bytes originais; o nome exibido vem limpo');
  // e o próprio app também não manda controles bidi no nome
  assert.equal(decodeCard(encodeCard(me, `Beto${RLO}x`, { code: '0101010101010101', expiresAt: T0 + 3600 }), T0).name, 'Betox');
});

test('por perto: nome do anúncio sai limpo, e o anúncio repassado segue com a assinatura original', () => {
  const me = deriveIdentity(newSeed(), 'public');
  const body = makePresence(me, { name: `Ana${RLO}x`, fee: 3, now: T0, until: T0 + 60, withPhoto: false });
  const p = decodePresence(encodePresence(body, 2, false), T0);
  assert.ok(p);
  assert.equal(p.name, 'Anax');
  assert.ok(decodePresence(encodePresence(p.body, 1, false), T0), 'o corpo assinado não foi mexido');
});

test('grupo: nome, descrição, membros e subgrupos chegam sem controles bidi', () => {
  const id = deriveIdentity(newSeed(), 'public');
  const st = {
    id: 'a'.repeat(32), kind: 'group', rev: 1, keyV: 1, key: b64url(new Uint8Array(32).fill(3)),
    name: `Família${RLO}x`, desc: `${ISO}Avisos${PDI}`,
    members: [{ id: id.id, name: `Ana${RLO}`, role: 'admin', s: b64url(id.signPk), a: b64url(id.agreePk), b: b64url(id.binding) }],
    children: [{ id: 'b'.repeat(32), name: `Sub${RLO}grupo`, kind: 'group' }],
  };
  const g = decodeState(JSON.stringify(st), 'public');
  assert.ok(g);
  assert.ok(!BIDI.test(g.name) && !BIDI.test(g.desc ?? '') && !BIDI.test(g.members[0]!.name) && !BIDI.test(g.children![0]!.name));
  assert.equal(g.name, 'Famíliax');
});

test('pedido de pagamento: descrição chega sem controles bidi', () => {
  const r = readPayRequest({ t: 'pq', i: '0123456789abcdef', a: encodeSs58(new Uint8Array(32).fill(5)), d: `Almoço ${RLO}01 SEUNUL`, v: '100', u: T0 + 60 }, T0);
  assert.ok(r);
  assert.equal(r.desc, 'Almoço 01 SEUNUL');
});
