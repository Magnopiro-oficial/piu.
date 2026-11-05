import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VECTORS } from '../../mobile/src/lib/__tests__/desktopLink.test';
import { b64url } from '../../mobile/src/messaging/card';
import { toHex } from '../../mobile/src/protocol/bytes';
import { emptyState } from '../src/shared/conversations';
import {
  applyLinkEvent, certPin, desktopHandshake, FrameOpener, FrameSealer, LINK_RENEW_SEC, newOffer, offerExpired, offerQr, parseLinkQr, phoneHandshake, stateFromSnapshot, wsUrl,
} from '../src/shared/desktopLink';

const hex = (h: string) => Uint8Array.from(h.match(/../g)!, x => parseInt(x, 16));

test('vetores do celular: oferta com sk/sessão/certificado fixos reproduz o QR, as chaves, as 3 palavras e abre os quadros', () => {
  const o = newOffer(1000, hex(VECTORS.sk_desktop), hex(VECTORS.s));
  const cert = hex(VECTORS.cert);
  assert.equal(toHex(o.pk), VECTORS.pk_desktop);
  const qr = offerQr(o, '192.168.0.10', 7332, cert);
  assert.equal(qr, 'piu-link:1?h=192.168.0.10:7332&k=e06Qm75__kTEZaIgA31gjuNYl9Me-XLwf3SJLLD3PxM&s=AQIDBAUGBwgJCgsMDQ4PEA&c=MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzM');
  const offer = parseLinkQr(qr);
  assert.equal(wsUrl(offer), 'wss://192.168.0.10:7332');
  assert.equal(certPin(offer), Array(32).fill('33').join(':').toUpperCase());
  // Celular (lib compartilhada) lê o QR e faz o hello; o desktop responde com as mesmas chaves e palavras.
  const phone = phoneHandshake(offer, hex(VECTORS.sk_celular));
  assert.equal(b64url(hex(VECTORS.pk_celular)), phone.hello.pk);
  const desk = desktopHandshake(o.sk, o.session, cert, JSON.stringify(phone.hello));
  assert.equal(toHex(desk.keys.recv), VECTORS.k_c2d);
  assert.equal(toHex(desk.keys.send), VECTORS.k_d2c);
  assert.deepEqual(desk.words, VECTORS.palavras);
  assert.deepEqual(desk.words, ['cereal', 'scorpion', 'indoor']);
  assert.deepEqual(phone.words, desk.words);
  // Outro certificado → outras palavras (o `c` entra só nas palavras, não na HKDF).
  const other = desktopHandshake(o.sk, o.session, new Uint8Array(32).fill(0x44), JSON.stringify(phone.hello));
  assert.notDeepEqual(other.words, desk.words);
  assert.equal(toHex(other.keys.recv), VECTORS.k_c2d);
  // Quadros do celular (texto base64url, header 0x01‖u64be, nonce 16×0‖u64be, AD = header) abrem na ordem.
  const opener = new FrameOpener(desk.keys.recv);
  assert.deepEqual(opener.open(VECTORS.quadro0), { t: 'ping' });
  assert.deepEqual(opener.open(VECTORS.quadro1), { t: 'ping' });
  assert.throws(() => opener.open(VECTORS.quadro1)); // repetido mata a sessão
  const d2c = new FrameSealer(desk.keys.send), phoneIn = new FrameOpener(phone.keys.recv);
  assert.deepEqual(phoneIn.open(d2c.seal({ t: 'ready', name: 'iMac' })), { t: 'ready', name: 'iMac' });
});

test('oferta: renovação a cada 30 s com chave e sessão novas', () => {
  const a = newOffer(1000), b = newOffer(1000);
  assert.notDeepEqual(a.pk, b.pk); assert.notDeepEqual(a.session, b.session);
  assert.equal(offerExpired(a, 1000 + LINK_RENEW_SEC * 1000 - 1), false);
  assert.equal(offerExpired(a, 1000 + LINK_RENEW_SEC * 1000), true);
});

test('snapshot e eventos do celular viram o modelo do desktop (sem dados de exemplo; `sys` fora; lido o que o celular já mostrou)', () => {
  const now = 1_700_000_000;
  const { contacts, conv } = stateFromSnapshot({
    t: 'snapshot', contacts: [{ id: 'piu:abc', chatId: 'c1', name: 'Ana', verified: false }],
    chats: [{ id: 'c1', ident: 'public', kind: 'direct', name: 'Ana', initials: 'AN', time: '10:00', unread: 2, peer: 'piu:abc', request: true }, { id: 'c2', ident: 'anon', kind: 'direct', name: '', initials: '2D', time: '09:00', unread: 0 }],
    messages: { c1: [{ id: 's1', from: 'sys', text: 'sistema', time: '09:59' }, { id: 'm1', from: 'them', text: 'oi', time: '10:00', at: 1_700_000_000_000 }, { id: 'm2', from: 'me', text: 'olá', time: '10:01', status: 'entregue' }], c2: [] },
  }, now);
  assert.deepEqual(contacts.map(c => [c.id, c.via, c.request]), [['c1', 'public', true], ['c2', 'anon', false]]);
  assert.deepEqual(conv.byContact.c1!.map(m => [m.id, m.dir, m.status, m.at]), [['m1', 'in', 'recebida', 1_700_000_000], ['m2', 'out', 'entregue', now]]);
  assert.equal(conv.readCount.c1, 2);
  let s = { contacts, conv };
  s = applyLinkEvent(s.contacts, s.conv, { t: 'event', k: 'message', chatId: 'c1', msg: { id: 'm3', from: 'them', text: 'chegou', time: '10:05' } }, now);
  assert.equal(s.conv.byContact.c1!.length, 3);
  const local = { ...s.conv, byContact: { ...s.conv.byContact, c1: [...s.conv.byContact.c1!, { id: 'dlocal-1', contactId: 'c1', dir: 'out' as const, text: 'do pc', at: now, status: 'aguardando' as const }] } };
  s = applyLinkEvent(s.contacts, local, { t: 'event', k: 'message', chatId: 'c1', msg: { id: 'm4', from: 'me', text: 'do pc', time: '10:06', status: 'encaminhada' } }, now);
  assert.deepEqual(s.conv.byContact.c1!.slice(-1).map(m => [m.id, m.status]), [['m4', 'encaminhada']]);
  assert.ok(!s.conv.byContact.c1!.some(m => m.id === 'dlocal-1'), 'a cópia provisória sai');
  s = applyLinkEvent(s.contacts, s.conv, { t: 'event', k: 'status', chatId: 'c1', msgId: 'm4', status: 'entregue' }, now);
  assert.equal(s.conv.byContact.c1!.find(m => m.id === 'm4')!.status, 'entregue');
  s = applyLinkEvent(s.contacts, s.conv, { t: 'event', k: 'chat', chat: { id: 'c3', ident: 'public', kind: 'group', name: 'Mutirão', initials: 'MU', time: 'agora', unread: 1 } }, now);
  assert.equal(s.contacts.length, 3);
  s = applyLinkEvent(s.contacts, s.conv, { t: 'event', k: 'chatRemoved', chatId: 'c1' }, now);
  assert.ok(!s.contacts.some(c => c.id === 'c1') && !s.conv.byContact.c1);
  s = applyLinkEvent(s.contacts, s.conv, { t: 'event', k: 'typing', chatId: 'c2', on: true }, now);
  assert.equal(s.contacts.length, 2);
});
