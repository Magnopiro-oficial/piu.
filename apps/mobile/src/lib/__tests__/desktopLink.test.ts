/// <reference types="node" />
/**
 * Vínculo com o Piu Desktop (lib/desktopLink.ts): QR, handshake, derivação, palavras e quadros cifrados.
 * Os vetores fixos no fim servem para o agente do desktop conferir a compatibilidade da implementação dele.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { x25519 } from '@noble/curves/ed25519.js';
import type { Chat } from '../../data/types';
import { b64url, unb64url } from '../../messaging/card';
import { concat, toHex, utf8 } from '../../protocol/bytes';
import { codeWords } from '../migration';
import {
  buildSnapshot, certPin, DesktopLinkError, desktopHandshake, diffChats, diffTyping, encodeLinkQr, FrameOpener, FrameSealer, LINK_INFO, LINK_PREFIX, LINK_WORDS,
  linkWords, MAX_FRAME_BYTES, MAX_TEXT, parseCommand, parseHello, parseLinkQr, phoneHandshake, SNAPSHOT_MSGS, wsUrl,
} from '../desktopLink';

const isErr = (code: DesktopLinkError['code']) => (e: unknown) => e instanceof DesktopLinkError && e.code === code;
const fixed = (b: number) => new Uint8Array(32).fill(b);
const SESSION = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
/** SHA-256 do certificado DER do desktop (fixado pelo QR): no vetor, 0x33×32. */
const CERT = fixed(0x33);
const OFFER = { host: '192.168.0.10', port: 7332, pk: x25519.getPublicKey(fixed(0x11)), session: SESSION, cert: CERT };
const QR = encodeLinkQr(OFFER);

test('QR: leitura e escrita do piu-link:1?h=…&k=…&s=…&c=…', () => {
  const o = parseLinkQr(QR);
  assert.equal(o.v, 1);
  assert.equal(o.host, '192.168.0.10');
  assert.equal(o.port, 7332);
  assert.equal(toHex(o.pk), toHex(x25519.getPublicKey(fixed(0x11))));
  assert.equal(toHex(o.session), toHex(SESSION));
  assert.equal(toHex(o.cert), toHex(CERT));
  assert.equal(certPin(o), '33:'.repeat(31) + '33');
  assert.equal(wsUrl(o), 'wss://192.168.0.10:7332');
  assert.ok(QR.startsWith(LINK_PREFIX + '1?'));
  // Espaços em volta e ordem diferente dos parâmetros não atrapalham; nome de máquina também vale.
  const [, qs] = QR.split('?');
  const parts = qs!.split('&');
  assert.deepEqual(parseLinkQr(`  ${LINK_PREFIX}1?${[parts[3], parts[2], parts[0], parts[1]].join('&')}\n`), o);
  assert.equal(parseLinkQr(QR.replace('192.168.0.10', 'MacBook-de-Lucas.local')).host, 'MacBook-de-Lucas.local');
  assert.equal(wsUrl(parseLinkQr(QR.replace('192.168.0.10', '[fe80::1]'))), 'wss://[fe80::1]:7332');
});

test('QR: outro QR, versão diferente, parâmetro faltando ou com tamanho errado são recusados', () => {
  assert.throws(() => parseLinkQr('piu1:abc'), isErr('FORMAT'));
  assert.throws(() => parseLinkQr(QR.replace('piu-link:1?', 'piu-link:2?')), isErr('VERSION'));
  assert.throws(() => parseLinkQr(QR.replace(/&s=[^&]+/, '')), isErr('FORMAT'));
  // Sem o pino do certificado não há canal: `c` é obrigatório e tem 32 bytes.
  assert.throws(() => parseLinkQr(QR.replace(/&c=[^&]+/, '')), isErr('FORMAT'));
  assert.throws(() => parseLinkQr(QR.replace(/&c=[^&]+/, '&c=' + b64url(new Uint8Array(20)))), isErr('FORMAT'));
  assert.throws(() => parseLinkQr(QR.replace(/&k=[^&]+/, '&k=' + b64url(new Uint8Array(31)))), isErr('FORMAT'));
  assert.throws(() => parseLinkQr(QR.replace(/&s=[^&]+/, '&s=' + b64url(new Uint8Array(8)))), isErr('FORMAT'));
  assert.throws(() => parseLinkQr(QR.replace('7332', '70000')), isErr('FORMAT'));
  assert.throws(() => parseLinkQr(QR.replace('7332', 'abc')), isErr('FORMAT'));
  assert.throws(() => parseLinkQr(QR.replace('192.168.0.10', 'a b')), isErr('FORMAT'));
  assert.throws(() => parseLinkQr(QR.replace(/&k=[^&]+/, '&k=' + b64url(new Uint8Array(32)))), isErr('AUTH')); // ponto de ordem baixa
});

test('handshake: os dois lados derivam as mesmas chaves (uma por sentido) e as mesmas 3 palavras', () => {
  const offer = parseLinkQr(QR);
  const phone = phoneHandshake(offer);
  const helloText = JSON.stringify(phone.hello);
  assert.deepEqual(Object.keys(phone.hello).sort(), ['pk', 's', 't', 'v']);
  assert.equal(phone.hello.t, 'hello');
  assert.equal(phone.hello.v, 1);
  assert.equal(phone.hello.s, b64url(SESSION));
  const desktop = desktopHandshake(fixed(0x11), SESSION, CERT, helloText);
  assert.equal(toHex(phone.keys.send), toHex(desktop.keys.recv));
  assert.equal(toHex(phone.keys.recv), toHex(desktop.keys.send));
  assert.notEqual(toHex(phone.keys.send), toHex(phone.keys.recv));
  assert.deepEqual(phone.words, desktop.words);
  assert.equal(phone.words.length, LINK_WORDS);
  for (const w of phone.words) assert.match(w, /^[a-z]+$/);
  // As palavras são da transcrição pública (s ‖ pk_desktop ‖ pk_celular ‖ c), como o convite usa 4; `c` amarra o canal TLS ao QR.
  const th = sha256(concat(SESSION, offer.pk, unb64url(phone.hello.pk), CERT));
  assert.deepEqual(phone.words, codeWords(th.slice(0, 8)).slice(0, 3));
  assert.notDeepEqual(desktopHandshake(fixed(0x11), SESSION, fixed(0x34), helloText).words, phone.words);
  phone.wipe();
});

test('handshake: hello inválido, de outra sessão ou com chave de ordem baixa é recusado', () => {
  const offer = parseLinkQr(QR);
  const ok = JSON.stringify(phoneHandshake(offer).hello);
  assert.throws(() => parseHello('nada', SESSION), isErr('FORMAT'));
  assert.throws(() => parseHello('{"t":"hi"}', SESSION), isErr('FORMAT'));
  assert.throws(() => parseHello(ok.replace('"v":1', '"v":2'), SESSION), isErr('VERSION'));
  assert.throws(() => parseHello(ok, new Uint8Array(16)), isErr('AUTH'));
  assert.throws(() => parseHello(ok.replace(/"pk":"[^"]+"/, `"pk":"${b64url(new Uint8Array(32))}"`), SESSION), isErr('AUTH'));
  assert.throws(() => parseHello(ok.replace(/"pk":"[^"]+"/, `"pk":"${b64url(new Uint8Array(31))}"`), SESSION), isErr('FORMAT'));
  // Um intruso que troca a chave do celular muda as palavras do desktop (e as do celular ficam as do QR).
  const phone = phoneHandshake(offer);
  const evil = desktopHandshake(fixed(0x11), SESSION, CERT, JSON.stringify({ ...phone.hello, pk: b64url(x25519.getPublicKey(fixed(0x42))) }));
  assert.notDeepEqual(evil.words, phone.words);
  assert.notEqual(toHex(evil.keys.recv), toHex(phone.keys.send));
});

test('quadros: cifra com contador, abre na ordem; repetido, pulado, adulterado ou grande demais derruba', () => {
  const offer = parseLinkQr(QR);
  const phone = phoneHandshake(offer);
  const desktop = desktopHandshake(fixed(0x11), SESSION, CERT, JSON.stringify(phone.hello));
  const out = new FrameSealer(phone.keys.send), inn = new FrameOpener(desktop.keys.recv);
  const w0 = out.seal({ t: 'ping' }), w1 = out.seal({ t: 'event', k: 'typing', chatId: 'p1', on: true }), w2 = out.seal({ t: 'ping' });
  assert.match(w0, /^[A-Za-z0-9_-]+$/); // texto base64url, sem JSON em claro
  assert.ok(!w1.includes('typing'));
  assert.deepEqual(inn.open(w0), { t: 'ping' });
  assert.deepEqual(inn.open(w1), { t: 'event', k: 'typing', chatId: 'p1', on: true });
  // Repetição: o contador já passou.
  assert.throws(() => inn.open(w1), isErr('ORDER'));
  // Depois de um erro a sessão está morta: nem o quadro certo entra.
  assert.throws(() => inn.open(w2), isErr('STATE'));

  const inn2 = new FrameOpener(desktop.keys.recv);
  assert.deepEqual(inn2.open(w0), { t: 'ping' });
  assert.throws(() => inn2.open(w2), isErr('ORDER')); // pulou o 1

  const inn3 = new FrameOpener(desktop.keys.recv);
  const raw = unb64url(w0); raw[raw.length - 1] ^= 1;
  assert.throws(() => inn3.open(b64url(raw)), isErr('AUTH'));

  // Chave do outro sentido não abre.
  assert.throws(() => new FrameOpener(desktop.keys.send).open(w0), isErr('AUTH'));
  // Lixo e quadro curto.
  assert.throws(() => new FrameOpener(desktop.keys.recv).open('!!!'), isErr('FORMAT'));
  assert.throws(() => new FrameOpener(desktop.keys.recv).open(b64url(new Uint8Array(5))), isErr('FORMAT'));
  // Teto de tamanho (antes de decifrar).
  assert.throws(() => new FrameOpener(desktop.keys.recv).open(b64url(new Uint8Array(MAX_FRAME_BYTES + 1))), isErr('SIZE'));
  assert.throws(() => new FrameSealer(phone.keys.send).seal({ t: 'event', k: 'typing', chatId: 'x'.repeat(MAX_FRAME_BYTES), on: true }), isErr('SIZE'));
  phone.wipe();
});

test('quadros: desktop → celular usa a outra chave e um contador próprio', () => {
  const offer = parseLinkQr(QR);
  const phone = phoneHandshake(offer);
  const desktop = desktopHandshake(fixed(0x11), SESSION, CERT, JSON.stringify(phone.hello));
  const d2p = new FrameSealer(desktop.keys.send), p = new FrameOpener(phone.keys.recv);
  const p2d = new FrameSealer(phone.keys.send), d = new FrameOpener(desktop.keys.recv);
  assert.deepEqual(p.open(d2p.seal({ t: 'cmd', op: 'send', chatId: 'p1', text: 'oi' })), { t: 'cmd', op: 'send', chatId: 'p1', text: 'oi' });
  assert.deepEqual(d.open(p2d.seal({ t: 'ack', ref: 'r1', ok: true })), { t: 'ack', ref: 'r1', ok: true });
  // Quadro do celular (contador 0) não é aceito como se fosse do desktop.
  assert.throws(() => new FrameOpener(phone.keys.recv).open(new FrameSealer(phone.keys.send).seal({ t: 'ping' })), isErr('AUTH'));
});

test('comandos do desktop: só send/read/typing com campos válidos; texto cortado em MAX_TEXT', () => {
  assert.deepEqual(parseCommand({ t: 'cmd', op: 'send', chatId: 'p1', text: '  oi  ', ref: 'a' }), { op: 'send', chatId: 'p1', text: 'oi', ref: 'a' });
  assert.deepEqual(parseCommand({ t: 'cmd', op: 'read', chatId: 'p1' }), { op: 'read', chatId: 'p1' });
  assert.deepEqual(parseCommand({ t: 'cmd', op: 'typing', chatId: 'g2' }), { op: 'typing', chatId: 'g2' });
  assert.equal((parseCommand({ t: 'cmd', op: 'send', chatId: 'p1', text: 'x'.repeat(MAX_TEXT + 10) }) as { text: string }).text.length, MAX_TEXT);
  for (const bad of [null, 'x', { t: 'cmd' }, { t: 'cmd', op: 'delete', chatId: 'p1' }, { t: 'cmd', op: 'send', chatId: 'p1', text: '   ' }, { t: 'cmd', op: 'send', chatId: 7, text: 'oi' },
    { t: 'cmd', op: 'send', chatId: 'p1' }, { t: 'cmd', op: 'read', chatId: 'x'.repeat(65) }, { t: 'cmd', op: 'send', chatId: 'p1', text: 'oi', ref: 7 }]) {
    assert.throws(() => parseCommand(bad), isErr('FORMAT'), JSON.stringify(bad));
  }
});

const chat = (id: string, msgs: Chat['msgs'], extra: Partial<Chat> = {}): Chat => ({ id, ident: 'public', kind: 'direct', name: 'Ana', initials: 'AN', time: '10:00', unread: 1, peer: 'piu:abc', ...extra, msgs });

test('snapshot: contatos, conversas e últimas N mensagens, sem prévias nem campos internos', () => {
  const msgs = Array.from({ length: SNAPSHOT_MSGS + 5 }, (_, i) => ({ id: 'm' + i, from: 'them' as const, text: 'oi ' + i, time: '10:00', fresh: true, at: 1 }));
  const withFile = { id: 'f1', from: 'me' as const, text: '', time: '10:01', status: 'entregue' as const, file: { name: 'foto.jpg', mb: 0.3, blocks: 3, icon: 'image' as const, done: 3, state: 'verified' as const, real: true, preview: 'data:image/jpeg;base64,AAAA' } };
  const chats: Chat[] = [
    chat('p1', [...msgs, withFile], { photo: 'data:image/jpeg;base64,BBBB', muted: true }),
    chat('g1', [{ id: 's1', from: 'sys', text: 'Grupo cifrado', time: '09:00' }], { kind: 'group', group: 'abc123', peer: undefined, name: 'Família', initials: 'FA', owner: true }),
  ];
  const s = buildSnapshot(chats, { p1: true });
  assert.equal(s.t, 'snapshot');
  assert.deepEqual(s.contacts, [{ id: 'piu:abc', chatId: 'p1', name: 'Ana', verified: true }]);
  assert.equal(s.chats.length, 2);
  assert.deepEqual(s.chats[0], { id: 'p1', ident: 'public', kind: 'direct', name: 'Ana', initials: 'AN', time: '10:00', unread: 1, peer: 'piu:abc', photo: 'data:image/jpeg;base64,BBBB', muted: true });
  assert.deepEqual(s.chats[1], { id: 'g1', ident: 'public', kind: 'group', name: 'Família', initials: 'FA', time: '10:00', unread: 1, group: 'abc123', owner: true });
  assert.equal(s.messages.p1!.length, SNAPSHOT_MSGS);
  assert.equal(s.messages.p1![0]!.id, 'm6'); // as mais antigas saem
  const f = s.messages.p1![SNAPSHOT_MSGS - 1]!;
  assert.deepEqual(f, { id: 'f1', from: 'me', text: '', time: '10:01', status: 'entregue', file: { name: 'foto.jpg', mb: 0.3, icon: 'image', state: 'verified', done: 3, blocks: 3 } });
  assert.ok(!JSON.stringify(s).includes('fresh'));
  assert.ok(!JSON.stringify(s).includes('AAAA'));
  assert.deepEqual(s.messages.g1, [{ id: 's1', from: 'sys', text: 'Grupo cifrado', time: '09:00' }]);
});

test('eventos: mensagem nova, estado de envio, conversa alterada/removida, mensagem removida, digitando', () => {
  const a: Chat[] = [chat('p1', [{ id: 'n1', from: 'me', text: 'oi', time: '10:00', status: 'aguardando' }, { id: 'in-1', from: 'them', text: 'olá', time: '10:00' }]), chat('p2', [], { name: 'Bia' })];
  assert.deepEqual(diffChats(a, a), []);
  const b: Chat[] = [
    chat('p1', [{ id: 'n1', from: 'me', text: 'oi', time: '10:00', status: 'lida' }, { id: 'in-2', from: 'them', text: 'tudo bem?', time: '10:02', fresh: true }], { unread: 2, time: '10:02' }),
    chat('p3', [{ id: 'sys-1', from: 'sys', text: 'Chaves trocadas.', time: '10:03' }], { name: 'Caio' }),
  ];
  const ev = diffChats(a, b);
  assert.deepEqual(ev, [
    { t: 'event', k: 'chat', chat: { id: 'p1', ident: 'public', kind: 'direct', name: 'Ana', initials: 'AN', time: '10:02', unread: 2, peer: 'piu:abc' } },
    { t: 'event', k: 'status', chatId: 'p1', msgId: 'n1', status: 'lida' },
    { t: 'event', k: 'messageRemoved', chatId: 'p1', msgId: 'in-1' },
    { t: 'event', k: 'message', chatId: 'p1', msg: { id: 'in-2', from: 'them', text: 'tudo bem?', time: '10:02' } },
    { t: 'event', k: 'chatRemoved', chatId: 'p2' },
    { t: 'event', k: 'chat', chat: { id: 'p3', ident: 'public', kind: 'direct', name: 'Caio', initials: 'AN', time: '10:00', unread: 1, peer: 'piu:abc' } },
    { t: 'event', k: 'message', chatId: 'p3', msg: { id: 'sys-1', from: 'sys', text: 'Chaves trocadas.', time: '10:03' } },
  ]);
  // Só a prévia de um arquivo mudou (campo que não viaja): nada a avisar.
  const c1 = chat('p1', [{ id: 'f', from: 'me', text: '', time: '1', file: { name: 'a', mb: 1, blocks: 1, icon: 'image', done: 0, state: 'sending' } }]);
  const c2 = chat('p1', [{ id: 'f', from: 'me', text: '', time: '1', file: { name: 'a', mb: 1, blocks: 1, icon: 'image', done: 0, state: 'sending', preview: 'data:…' } }]);
  assert.deepEqual(diffChats([c1], [c2]), []);
  // Progresso do arquivo viaja como alteração da mensagem.
  const c3 = chat('p1', [{ id: 'f', from: 'me', text: '', time: '1', file: { name: 'a', mb: 1, blocks: 1, icon: 'image', done: 1, state: 'verified' } }]);
  assert.deepEqual(diffChats([c1], [c3]), [{ t: 'event', k: 'message', chatId: 'p1', msg: { id: 'f', from: 'me', text: '', time: '1', file: { name: 'a', mb: 1, icon: 'image', state: 'verified', done: 1, blocks: 1 } } }]);
  assert.deepEqual(diffTyping({ p1: true }, { p2: true }), [{ t: 'event', k: 'typing', chatId: 'p1', on: false }, { t: 'event', k: 'typing', chatId: 'p2', on: true }]);
  assert.deepEqual(diffTyping({ p1: true }, { p1: true }), []);
});

/**
 * VETORES FIXOS para o Piu Desktop (apps/desktop) conferir a implementação dele.
 * Entradas: sk_desktop = 0x11×32, sk_celular = 0x22×32, s = 01 02 … 10 (16 bytes).
 * - pk = X25519(sk); shared = X25519(sk_a, pk_b).
 * - okm = HKDF-SHA256(ikm = shared, salt = s, info = "piu/v1/desktop-link", 64 bytes); k_c2d = okm[0..32], k_d2c = okm[32..64].
 * - palavras = 3 primeiras de codeWords(SHA-256(s ‖ pk_desktop ‖ pk_celular)[0..8]) (11 bits por palavra, big-endian, lista BIP39 inglesa).
 * - quadro n (texto base64url): header = 0x01 ‖ u64be(n); nonce = 16 zeros ‖ u64be(n); XChaCha20-Poly1305(chave do sentido, nonce, AD = header) sobre o JSON em UTF-8; wire = base64url(header ‖ ciphertext).
 */
export const VECTORS = {
  sk_desktop: '11'.repeat(32), sk_celular: '22'.repeat(32), s: '0102030405060708090a0b0c0d0e0f10', s_b64url: 'AQIDBAUGBwgJCgsMDQ4PEA',
  /** SHA-256 do certificado DER (`c` no QR). */
  cert: '33'.repeat(32),
  qr: 'piu-link:1?h=192.168.0.10:7332&k=e06Qm75__kTEZaIgA31gjuNYl9Me-XLwf3SJLLD3PxM&s=AQIDBAUGBwgJCgsMDQ4PEA&c=MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzM',
  pk_desktop: '7b4e909bbe7ffe44c465a220037d608ee35897d31ef972f07f74892cb0f73f13',
  pk_celular: '0faa684ed28867b97f4a6a2dee5df8ce974e76b7018e3f22a1c4cf2678570f20',
  k_c2d: '7dd6a7c3e8cf7d1e1eda31f0a0ff7ba6051e480126b11e323152e11ee25bac57',
  k_d2c: 'beba4dc173392195d7413c1fd8df416d1b696f9acb5474b6cccb1e2e353829ac',
  palavras: ['cereal', 'scorpion', 'indoor'],
  /** `{"t":"ping"}` cifrado pelo celular (k_c2d) com contador 0 e 1. */
  quadro0: 'AQAAAAAAAAAAYA8htsQTTe6bgBInUYwL9BJKewJjnFQciZQSOg',
  quadro1: 'AQAAAAAAAAAB_rixOchfILGmgai8yKPeb4DmiHh_d1h-lKxJOA',
};

test('vetores fixos (compatibilidade com o Piu Desktop)', () => {
  const skD = fixed(0x11), skP = fixed(0x22);
  const pkD = x25519.getPublicKey(skD), pkP = x25519.getPublicKey(skP);
  assert.equal(toHex(SESSION), VECTORS.s);
  assert.equal(b64url(SESSION), VECTORS.s_b64url);
  assert.equal(toHex(pkD), VECTORS.pk_desktop);
  assert.equal(toHex(pkP), VECTORS.pk_celular);
  // Derivação pela fórmula, direto no @noble (independente da lib).
  const okm = hkdf(sha256, x25519.getSharedSecret(skP, pkD), SESSION, utf8(LINK_INFO), 64);
  assert.equal(toHex(okm.slice(0, 32)), VECTORS.k_c2d);
  assert.equal(toHex(okm.slice(32, 64)), VECTORS.k_d2c);
  assert.equal(toHex(hkdf(sha256, x25519.getSharedSecret(skD, pkP), SESSION, utf8(LINK_INFO), 64)), toHex(okm)); // os dois lados chegam ao mesmo okm
  assert.deepEqual(codeWords(sha256(concat(SESSION, pkD, pkP, CERT)).slice(0, 8)).slice(0, 3), VECTORS.palavras);
  assert.equal(encodeLinkQr(OFFER), VECTORS.qr);
  assert.equal(toHex(parseLinkQr(VECTORS.qr).cert), VECTORS.cert);
  // Quadro 0 pela fórmula: header = 01 ‖ u64be(0); nonce = 16 zeros ‖ u64be(0); AD = header.
  const header0 = Uint8Array.of(1, 0, 0, 0, 0, 0, 0, 0, 0);
  const ct0 = xchacha20poly1305(okm.slice(0, 32), new Uint8Array(24), header0).encrypt(utf8('{"t":"ping"}'));
  assert.equal(b64url(concat(header0, ct0)), VECTORS.quadro0);
  // A lib bate com a fórmula nos dois sentidos.
  const phone = phoneHandshake({ v: 1, ...OFFER }, skP.slice());
  assert.equal(toHex(phone.keys.send), VECTORS.k_c2d);
  assert.equal(toHex(phone.keys.recv), VECTORS.k_d2c);
  assert.deepEqual(phone.words, VECTORS.palavras);
  assert.deepEqual(linkWords(SESSION, pkD, pkP, CERT), VECTORS.palavras);
  assert.deepEqual(phone.hello, { t: 'hello', v: 1, s: VECTORS.s_b64url, pk: b64url(pkP) });
  const sealer = new FrameSealer(phone.keys.send);
  assert.equal(sealer.seal({ t: 'ping' }), VECTORS.quadro0);
  assert.equal(sealer.seal({ t: 'ping' }), VECTORS.quadro1); // mesmo conteúdo, contador 1 → quadro diferente
  const desktop = desktopHandshake(skD, SESSION, CERT, JSON.stringify(phone.hello));
  assert.deepEqual(desktop.words, VECTORS.palavras);
  const opener = new FrameOpener(desktop.keys.recv);
  assert.deepEqual(opener.open(VECTORS.quadro0), { t: 'ping' });
  assert.deepEqual(opener.open(VECTORS.quadro1), { t: 'ping' });
});
