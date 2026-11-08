import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callKeys, newCallKeypair, openVoice, sealVoice, VoiceReplay } from '../callCrypto';
import { WORDLIST } from '../../protocol/phrase';

const callId = 'c-0123456789abcdef';

function pair() {
  const a = newCallKeypair(), b = newCallKeypair();
  const ka = callKeys({ callId, role: 'caller', mySk: a.sk, myPk: a.pk, theirPk: b.pk });
  const kb = callKeys({ callId, role: 'callee', mySk: b.sk, myPk: b.pk, theirPk: a.pk });
  return { a, b, ka, kb };
}

test('os dois lados derivam as mesmas 4 palavras e chaves cruzadas por sentido', () => {
  const { ka, kb } = pair();
  assert.deepEqual(ka.words, kb.words);
  assert.equal(ka.words.length, 4);
  for (const w of ka.words) assert.ok(WORDLIST.includes(w));
  assert.deepEqual(ka.send, kb.recv);
  assert.deepEqual(ka.recv, kb.send);
  assert.notDeepEqual(ka.send, ka.recv);
  assert.deepEqual(ka.tag, kb.tag);
});

test('alguém no meio (outra chave) gera palavras diferentes', () => {
  const { a, ka } = pair();
  const mitm = newCallKeypair();
  const forged = callKeys({ callId, role: 'caller', mySk: a.sk, myPk: a.pk, theirPk: mitm.pk });
  assert.notDeepEqual(forged.words, ka.words);
});

test('quadro de voz: abre do outro lado, recusa adulterado, repetido e de outra chamada', () => {
  const { ka, kb } = pair();
  const opus = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const f0 = sealVoice(ka, 0, opus);
  const f1 = sealVoice(ka, 1, opus);
  const replay = new VoiceReplay();
  const got = openVoice(kb, f0, replay);
  assert.ok(got);
  assert.equal(got!.seq, 0);
  assert.deepEqual(got!.payload, opus);
  assert.equal(openVoice(kb, f0, replay), null, 'repetido');
  assert.ok(openVoice(kb, f1, replay));
  const bad = f1.slice(); bad[bad.length - 1] ^= 1;
  assert.equal(openVoice(kb, bad, new VoiceReplay()), null, 'adulterado');
  assert.equal(openVoice(ka, f0, new VoiceReplay()), null, 'o próprio sentido não abre');
  const other = pair();
  assert.equal(openVoice(other.kb, f0, new VoiceReplay()), null, 'outra chamada');
});

test('janela anti-repetição aceita fora de ordem dentro da janela e recusa muito antigo', () => {
  const r = new VoiceReplay(64);
  assert.ok(r.accept(100));
  assert.ok(r.accept(98));
  assert.ok(!r.accept(98));
  assert.ok(r.accept(200));
  assert.ok(!r.accept(100), 'fora da janela');
  assert.ok(r.accept(199));
});

test('quadro de voz é pequeno (cabe no Bluetooth): cabeçalho fixo de 13 bytes + 16 de autenticação', () => {
  const { ka } = pair();
  const f = sealVoice(ka, 7, new Uint8Array(40));
  assert.equal(f.length, 13 + 40 + 16);
});
