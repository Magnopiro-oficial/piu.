/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { b64url, unb64url } from '../../messaging/card';
import { newPhrase } from '../../protocol/phrase';
import { newDeviceKey } from '../devicesCore';
import {
  codeWords, createOffer, dropSessions, memoryChannelPair, MigrationError, OFFER_PREFIX, parseOffer, readReply, receiveOverChannel, REPLY_PREFIX,
  respondToOffer, sendOverChannel,
} from '../migration';

const NOW = 1_800_000_000;
const phrase = newPhrase();
const newDev = { pk: newDeviceKey().pk, name: 'Pixel novo', platform: 'android' as const };
const payload = { phrase, from: { pk: b64url(newDeviceKey().pk), name: 'Galaxy antigo', platform: 'android' as const }, profileName: 'Cardeal' };
const isErr = (code: MigrationError['code']) => (e: unknown) => e instanceof MigrationError && e.code === code;

test('migração: acordo de chaves efêmero, mesmo código nos dois aparelhos e a frase chega', () => {
  const secret = createOffer(newDev, NOW);
  const old = respondToOffer(secret.text, payload, NOW + 5);
  assert.equal(old.device.name, 'Pixel novo');
  assert.equal(b64url(old.device.pk), b64url(newDev.pk));
  const got = readReply(secret, old.reply, NOW + 10);
  assert.deepEqual(got.code, old.code);
  assert.equal(got.code.length, 4);
  assert.deepEqual(got.payload.phrase, phrase);
  assert.equal(got.payload.from.name, 'Galaxy antigo');
  assert.equal(got.payload.profileName, 'Cardeal');
  // A frase não viaja em claro.
  assert.ok(!old.reply.includes(phrase.join(' ')));
});

test('migração: resposta adulterada é recusada', () => {
  const secret = createOffer(newDev, NOW);
  const { reply } = respondToOffer(secret.text, payload, NOW);
  const b = unb64url(reply.slice(REPLY_PREFIX.length));
  const bad = (i: number) => { const x = b.slice(); x[i] ^= 0x01; return REPLY_PREFIX + b64url(x); };
  assert.throws(() => readReply(secret, bad(b.length - 1), NOW), isErr('AUTH')); // conteúdo
  assert.throws(() => readReply(secret, bad(40), NOW), isErr('AUTH')); // nonce
  assert.throws(() => readReply(secret, bad(5), NOW), isErr('AUTH')); // chave efêmera do antigo
  assert.throws(() => readReply(secret, 'piu-mig2:AAAA', NOW), isErr('FORMAT'));
});

test('migração: resposta de um intruso (outra chave efêmera) muda o código; resposta para outra oferta não abre', () => {
  const secret = createOffer(newDev, NOW);
  const honest = respondToOffer(secret.text, payload, NOW);
  // O intruso viu a oferta e responde com a frase dele: as palavras não batem com as do aparelho antigo.
  const evil = respondToOffer(secret.text, { ...payload, phrase: newPhrase() }, NOW);
  assert.notDeepEqual(readReply(secret, evil.reply, NOW).code, honest.code);
  const other = respondToOffer(createOffer(newDev, NOW).text, payload, NOW);
  assert.throws(() => readReply(secret, other.reply, NOW), isErr('AUTH'));
});

test('migração: oferta expirada, adulterada ou de outro tipo é recusada', () => {
  const secret = createOffer(newDev, NOW);
  assert.throws(() => parseOffer(secret.text, NOW + 601), isErr('EXPIRED'));
  assert.throws(() => readReply(secret, respondToOffer(secret.text, payload, NOW).reply, NOW + 601), isErr('EXPIRED'));
  assert.throws(() => respondToOffer('piu1:abc', payload, NOW), isErr('FORMAT'));
  assert.throws(() => parseOffer(secret.text + 'AA', NOW), isErr('FORMAT'));
  // Trocar a chave efêmera da oferta muda a transcrição: o aparelho novo não abre a resposta.
  const raw = unb64url(secret.text.slice(OFFER_PREFIX.length)); raw[5] ^= 1;
  const r = respondToOffer(OFFER_PREFIX + b64url(raw), payload, NOW);
  assert.throws(() => readReply(secret, r.reply, NOW), isErr('AUTH'));
});

test('migração: canal plugável (em memória) faz a ida e volta', async () => {
  const [a, b] = memoryChannelPair();
  const now = () => NOW;
  const [got, sent] = await Promise.all([receiveOverChannel(a, newDev, now), sendOverChannel(b, payload, now)]);
  assert.deepEqual(got.code, sent.code);
  assert.deepEqual(got.payload.phrase, phrase);
  assert.equal(sent.device.name, 'Pixel novo');
});

test('migração: código de 4 palavras é determinístico e depende do segredo', () => {
  const s = new Uint8Array(8).fill(0xab);
  assert.deepEqual(codeWords(s), codeWords(s.slice()));
  assert.notDeepEqual(codeWords(s), codeWords(new Uint8Array(8)));
});

test('rotação: tira as sessões do estado do mensageiro e mantém o resto', () => {
  const st = JSON.stringify({ s: { public: 'x', anon: 'y' }, c: [{ id: 'piu:1' }], q: [], seen: ['a'] });
  const out = JSON.parse(dropSessions(st));
  assert.equal(out.s, undefined);
  assert.deepEqual(out.c, [{ id: 'piu:1' }]);
  assert.deepEqual(out.seen, ['a']);
});
