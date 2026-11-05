import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import WebSocket, { type ClientOptions } from 'ws';
import { VECTORS } from '../../mobile/src/lib/__tests__/desktopLink.test';
import { b64url } from '../../mobile/src/messaging/card';
import { toHex } from '../../mobile/src/protocol/bytes';
import { DesktopLinkServer } from '../src/main/desktopLink';
import { FrameOpener, FrameSealer, type LinkMessage, linkWords, newOffer, parseLinkQr, phoneHandshake, wsUrl } from '../src/shared/desktopLink';
import type { LinkState } from '../src/shared/types';

const hex = (h: string) => Uint8Array.from(h.match(/../g)!, x => parseInt(x, 16));
async function until(cond: () => boolean, what: string, ms = 5000) {
  const end = Date.now() + ms;
  while (!cond()) { if (Date.now() > end) throw new Error(`Tempo esgotado esperando: ${what}`); await new Promise(r => setTimeout(r, 15)); }
}
const tmp = () => mkdtempSync(join(tmpdir(), 'piu-link-'));

/**
 * Cliente de teste que simula o celular com a lib compartilhada: conecta por wss:// aceitando SÓ o
 * certificado cujo SHA-256 do DER é o `c` do QR (pino), hello em claro, quadros de TEXTO base64url.
 */
async function fakePhone(uri: string, sk?: Uint8Array) {
  const offer = parseLinkQr(uri); // traz `cert` (SHA-256 do DER): o pino
  const hs = phoneHandshake(offer, sk); // palavras já com o certificado na transcrição (lib)
  // Autoassinado: a confiança vem do pino do QR, não de uma CA. Com `rejectUnauthorized: false` o Node não
  // bloqueia por `checkServerIdentity`, então o pino é conferido no socket TLS antes de usar a conexão.
  const opts: ClientOptions = { rejectUnauthorized: false };
  const ws = new WebSocket(wsUrl(offer), opts);
  await new Promise<void>((res, rej) => {
    ws.once('upgrade', r => {
      const raw = (r.socket as import('node:tls').TLSSocket).getPeerCertificate().raw;
      if (toHex(new Uint8Array(createHash('sha256').update(raw).digest())) !== toHex(offer.cert)) { ws.terminate(); rej(new Error('certificado diferente do QR')); }
    });
    ws.once('open', res); ws.once('error', rej);
  });
  const inbox: LinkMessage[] = [];
  const out = new FrameSealer(hs.keys.send), inn = new FrameOpener(hs.keys.recv);
  let closed: { code: number; reason: string } | null = null;
  ws.on('message', (d, bin) => { if (!bin) inbox.push(inn.open(d.toString())); });
  ws.on('close', (code, reason) => { closed = { code, reason: reason.toString() }; });
  ws.send(JSON.stringify(hs.hello));
  return { words: hs.words, keys: hs.keys, inbox, send: (m: LinkMessage) => ws.send(out.seal(m)), sendRaw: (s: string) => ws.send(s), close: () => ws.close(), get closed() { return closed; } };
}

test('vínculo (wss com pino): QR → hello → 3 palavras → confirmação (ready) → snapshot → cmd send/ack → event → ping/pong → queda', async t => {
  const dir = tmp();
  const srv = new DesktopLinkServer({ host: '127.0.0.1', listen: '127.0.0.1', name: 'iMac de teste', tlsDir: dir });
  t.after(async () => { await srv.stop(); rmSync(dir, { recursive: true, force: true }); });
  const s0 = await srv.start();
  if (s0.state !== 'waiting') throw new Error('estado');
  assert.match(s0.uri, /^piu-link:1\?h=127\.0\.0\.1:\d+&k=[A-Za-z0-9_-]{43}&s=[A-Za-z0-9_-]{22}&c=[A-Za-z0-9_-]{43}$/);
  assert.equal(b64url(parseLinkQr(s0.uri).cert), srv.certPin);

  const phone = await fakePhone(s0.uri);
  await until(() => srv.state.state === 'confirm', 'palavras no desktop');
  const st = srv.state; if (st.state !== 'confirm') throw new Error('estado');
  assert.deepEqual(st.words, phone.words, 'as 3 palavras (com o certificado na transcrição) batem');
  // Celular confirma primeiro e já manda o snapshot: o desktop segura até a pessoa confirmar aqui.
  phone.send({ t: 'snapshot', contacts: [{ id: 'piu:abc', chatId: 'c1', name: 'Marina', verified: true }],
    chats: [{ id: 'c1', ident: 'public', kind: 'direct', name: 'Marina', initials: 'MA', time: '14:32', unread: 0, peer: 'piu:abc' }],
    messages: { c1: [{ id: 'm1', from: 'them', text: 'oi do celular', time: '14:30', at: Date.now() - 1000 }, { id: 'm2', from: 'me', text: 'resposta', time: '14:31', status: 'entregue' }] } });
  await new Promise(r => setTimeout(r, 80));
  assert.equal(srv.state.state, 'confirm');
  assert.equal(srv.listConversations().length, 0, 'nada antes da confirmação');
  assert.equal(srv.confirm().state, 'linked');
  await until(() => srv.state.state === 'linked' && srv.state.synced, 'snapshot aplicado');
  await until(() => phone.inbox.some(m => m.t === 'ready'), 'ready chegar ao celular');
  assert.deepEqual(phone.inbox.find(m => m.t === 'ready'), { t: 'ready', name: 'iMac de teste' });
  assert.equal(srv.listConversations()[0]!.contact.name, 'Marina');
  assert.equal(srv.getMessages('c1').length, 2);

  const sent = srv.sendText('c1', 'do computador');
  await until(() => phone.inbox.some(m => m.t === 'cmd' && m.op === 'send'), 'comando no celular');
  const cmd = phone.inbox.find(m => m.t === 'cmd' && m.op === 'send');
  assert.ok(cmd && cmd.t === 'cmd' && cmd.op === 'send' && cmd.text === 'do computador' && cmd.ref === sent.id);
  phone.send({ t: 'ack', ref: sent.id, ok: true });
  await until(() => srv.getMessages('c1').find(m => m.id === sent.id)?.status === 'encaminhada', 'ack → encaminhada');
  phone.send({ t: 'event', k: 'message', chatId: 'c1', msg: { id: 'm3', from: 'me', text: 'do computador', time: '14:40', status: 'encaminhada' } });
  phone.send({ t: 'event', k: 'status', chatId: 'c1', msgId: 'm3', status: 'entregue' });
  await until(() => srv.getMessages('c1').find(m => m.id === 'm3')?.status === 'entregue', 'mensagem do celular substitui a local');
  assert.ok(!srv.getMessages('c1').some(m => m.id === sent.id));
  phone.send({ t: 'event', k: 'message', chatId: 'c1', msg: { id: 'm4', from: 'them', text: 'mais uma', time: '14:41' } });
  await until(() => srv.listConversations()[0]!.unread === 1, 'não lida');
  srv.markRead('c1');
  await until(() => phone.inbox.some(m => m.t === 'cmd' && m.op === 'read'), 'cmd read');
  phone.send({ t: 'futuro', x: 1 } as unknown as LinkMessage); // tipo desconhecido: ignorado
  phone.send({ t: 'ping' });
  await until(() => phone.inbox.some(m => m.t === 'pong'), 'pong');
  assert.equal(srv.state.state, 'linked');

  phone.close();
  await until(() => srv.state.state === 'dropped', 'queda detectada');
  const cur = (): LinkState => srv.state; const d = cur();
  assert.match(d.state === 'dropped' ? d.reason : '', /QR/);
  assert.equal(srv.listConversations().length, 0);
});

test('vínculo: vetores do celular contra o servidor real (chaves e quadros dos VECTORS; palavras com o pino do certificado)', async t => {
  const dir = tmp();
  const srv = new DesktopLinkServer({ host: '192.168.0.10', listen: '127.0.0.1', tlsDir: dir, offer: () => newOffer(Date.now(), hex(VECTORS.sk_desktop), hex(VECTORS.s)) });
  t.after(async () => { await srv.stop(); rmSync(dir, { recursive: true, force: true }); });
  const s0 = await srv.start(); if (s0.state !== 'waiting') throw new Error('estado');
  assert.ok(s0.uri.includes(`&s=${VECTORS.s_b64url}`));
  const phone = await fakePhone(s0.uri.replace('192.168.0.10', '127.0.0.1'), hex(VECTORS.sk_celular));
  assert.equal(toHex(phone.keys.send), VECTORS.k_c2d);
  assert.equal(toHex(phone.keys.recv), VECTORS.k_d2c);
  await until(() => srv.state.state === 'confirm', 'confirm');
  // Palavras com o certificado REAL deste servidor na transcrição (os VECTORS usam c = 0x33×32; ver test/desktopLink.test.ts).
  assert.deepEqual(srv.state.state === 'confirm' ? srv.state.words : [], linkWords(hex(VECTORS.s), hex(VECTORS.pk_desktop), hex(VECTORS.pk_celular), srv.certHash!));
  assert.deepEqual(srv.state.state === 'confirm' ? srv.state.words : [], phone.words);
  srv.confirm();
  phone.sendRaw(VECTORS.quadro0); phone.sendRaw(VECTORS.quadro1); // pings fixos do celular (contador 0 e 1)
  await until(() => phone.inbox.filter(m => m.t === 'pong').length === 2, 'dois pongs');
});

test('vínculo: certificado diferente do pino é recusado pelo celular; sessão errada fecha com 4001, versão errada com 4002; quadro em claro derruba', async t => {
  const dir = tmp();
  const srv = new DesktopLinkServer({ host: '127.0.0.1', listen: '127.0.0.1', tlsDir: dir });
  t.after(async () => { await srv.stop(); rmSync(dir, { recursive: true, force: true }); });
  const s0 = await srv.start(); if (s0.state !== 'waiting') throw new Error('estado');
  await assert.rejects(fakePhone(s0.uri.replace(/&c=.*/, '&c=' + b64url(new Uint8Array(32)))), /certificado/);
  const bad = await fakePhone(s0.uri.replace(/&s=[^&]+/, '&s=AAAAAAAAAAAAAAAAAAAAAA'));
  await until(() => !!bad.closed, 'fechado');
  assert.equal(bad.closed!.code, 4001);
  const s1 = srv.cancel(); if (s1.state !== 'waiting') throw new Error('estado');
  const ws = new WebSocket(`wss://127.0.0.1:${srv.port}`, { rejectUnauthorized: false });
  const closed = new Promise<number>(res => ws.once('close', code => res(code)));
  ws.once('open', () => ws.send(JSON.stringify({ t: 'hello', v: 2, s: 'x', pk: 'y' })));
  assert.equal(await closed, 4002);
  const s2 = srv.cancel(); if (s2.state !== 'waiting') throw new Error('estado');
  const phone = await fakePhone(s2.uri);
  await until(() => srv.state.state === 'confirm', 'confirm');
  phone.sendRaw('{"t":"ping"}'); // em claro depois do handshake: proibido
  await until(() => !!phone.closed, 'sessão derrubada');
  assert.equal(srv.state.state, 'dropped');
});
