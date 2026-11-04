/// <reference types="node" />
/**
 * Convite por link: leva o mesmo cartão assinado do QR de contato em `piu://invite/accept?c=…`,
 * volta inteiro do link (e de uma mensagem colada), recusa adulteração, mostra as mesmas 4 palavras
 * dos dois lados e só põe link de loja quando app.json tiver um.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { decodeCard, encodeCard } from '../../messaging/card';
import { deriveIdentity, newSeed } from '../../protocol/keys';
import { cardFromText, fingerprintOfId, hasStoreLinks, inviteLink, inviteShareText, inviteWords, storeLinksFrom } from '../inviteLink';

const T0 = 1_800_000_000;
const INV = { code: '0011223344556677', expiresAt: T0 + 24 * 3600 };

test('link piu:// leva o cartão do QR e volta inteiro (também de dentro de uma mensagem)', () => {
  const me = deriveIdentity(newSeed(), 'public');
  const card = encodeCard(me, 'Cardeal', INV);
  const link = inviteLink(card);
  assert.match(link, /^piu:\/\/invite\/accept\?c=piu1%3A[A-Za-z0-9_-]+$/);
  assert.equal(cardFromText(link), card);
  assert.equal(cardFromText(card), card, 'cartão colado direto');
  const msg = inviteShareText({ name: 'Cardeal', link, store: { ios: '', android: '' } });
  assert.equal(cardFromText(msg), card, 'a mensagem inteira colada em Adicionar contato');
  assert.equal(cardFromText(inviteLink(card, 'exp+piu')), card, 'scheme do desenvolvimento');
  const c = decodeCard(cardFromText(link)!, T0 + 10);
  assert.equal(c.name, 'Cardeal');
  assert.equal(c.id, me.id);
  assert.equal(c.invite, INV.code, 'o código de uso único vai junto');
  assert.deepEqual(fingerprintOfId(c.id), fingerprintOfId(me.id));
  assert.equal(cardFromText('https://exemplo.com/?c=outra-coisa'), null);
  assert.equal(cardFromText('piu://invite/accept?c=%E0%A4%A'), null, 'escape inválido');
});

test('link adulterado ou vencido é recusado pela mesma conferência do QR', () => {
  const me = deriveIdentity(newSeed(), 'public');
  const card = encodeCard(me, 'Cardeal', INV);
  const other = encodeCard(deriveIdentity(newSeed(), 'public'), 'Cardeal', INV);
  // Troca as chaves mantendo a assinatura original: não confere.
  const forged = other.slice(0, 80) + card.slice(80);
  assert.throws(() => decodeCard(cardFromText(inviteLink(forged))!, T0), /não confere|corrompido/);
  assert.throws(() => decodeCard(cardFromText(inviteLink(card))!, T0 + 25 * 3600), /venceu/);
});

test('as 4 palavras de quem convida saem iguais do cartão recebido', () => {
  const me = deriveIdentity(newSeed(), 'public');
  const c = decodeCard(encodeCard(me, 'Cardeal', INV), T0);
  assert.deepEqual(inviteWords(c.pub.signPk), inviteWords(me.signPk));
  assert.equal(inviteWords(me.signPk).length, 4);
  assert.notDeepEqual(inviteWords(deriveIdentity(newSeed(), 'public').signPk), inviteWords(me.signPk));
});

test('links das lojas: vazios em app.json (sem ids inventados); só https entra no texto', () => {
  const app = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '..', 'app.json'), 'utf8'));
  const store = storeLinksFrom(app.expo.extra);
  assert.deepEqual(store, { ios: '', android: '' });
  assert.equal(app.expo.scheme, 'piu');
  const link = 'piu://invite/accept?c=piu1%3Axyz';
  const plain = inviteShareText({ name: 'Cardeal', link, store });
  assert.ok(plain.includes(link));
  // piu:// não vira link clicável em muitos apps (cai numa busca): a mensagem diz o caminho de colar.
  assert.match(plain, /não abrir.*copie.*Nova conversa/s);
  assert.match(plain, /Ainda não tem o Piu\?.*peça o instalador a Cardeal/s, 'sem loja: o instalador vem de quem convidou');
  assert.match(inviteShareText({ name: 'Você', link, store }), /peça o instalador a quem convidou/);
  assert.ok(!/Android:|iPhone:|https?:/i.test(plain), 'sem link de loja enquanto não houver');
  assert.equal(hasStoreLinks(storeLinksFrom({ storeLinks: { ios: 'javascript:x', android: 'http://inseguro' } })), false);
  const withStores = inviteShareText({ name: 'Você', link, store: { ios: 'https://loja.example/ios', android: 'https://loja.example/android' } });
  assert.match(withStores, /Você foi convidado/);
  assert.match(withStores, /Android: https:\/\/loja\.example\/android/);
  assert.match(withStores, /iPhone: https:\/\/loja\.example\/ios/);
});
