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
  const ws = new WebSocket(wsUrl({ ...offer, host: '127.0.0.1' }), opts);
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
  const srv = new DesktopLinkServer({ host: '192.168.0.10', listen: '127.0.0.1', name: 'iMac de teste', tlsDir: dir });
  t.after(async () => { await srv.stop(); rmSync(dir, { recursive: true, force: true }); });
  const s0 = await srv.start();
  if (s0.state !== 'waiting') throw new Error('estado');
  assert.match(s0.uri, /^piu-link:1\?h=192\.168\.0\.10:\d+&k=[A-Za-z0-9_-]{43}&s=[A-Za-z0-9_-]{22}&c=[A-Za-z0-9_-]{43}$/);
  assert.equal(b64url(parseLinkQr(s0.uri).cert), srv.certPin);

  const phone = await fakePhone(s0.uri);
  await until(() => srv.state.state === 'confirm', 'palavras no desktop');
  const st = srv.state; if (st.state !== 'confirm') throw new Error('estado');
  // M-04: o desktop mostra as 2 primeiras e pede a 3ª entre 4 opções (só quem olha o celular acerta).
  assert.deepEqual(st.words, phone.words.slice(0, 2), 'as palavras (com o certificado na transcrição) batem');
  assert.equal(st.options.length, 4);
  assert.equal(new Set(st.options).size, 4, 'opções distintas');
  assert.ok(st.options.includes(phone.words[2]!), 'a 3ª palavra do celular está entre as opções');
  assert.ok(!st.options.includes(phone.words[0]!) && !st.options.includes(phone.words[1]!));
  // Celular confirma primeiro e já manda o snapshot: o desktop segura até a pessoa confirmar aqui.
  const wallets: (string | null)[] = []; srv.on('wallet', (a: string | null) => wallets.push(a));
  phone.send({ t: 'snapshot', contacts: [{ id: 'piu:abc', chatId: 'c1', name: 'Marina', verified: true }],
    chats: [{ id: 'c1', ident: 'public', kind: 'direct', name: 'Marina', initials: 'MA', time: '14:32', unread: 0, peer: 'piu:abc' }],
    messages: { c1: [{ id: 'm1', from: 'them', text: 'oi do celular', time: '14:30', at: Date.now() - 1000 }, { id: 'm2', from: 'me', text: 'resposta', time: '14:31', status: 'entregue' }] },
    // Carteira do celular (`Snapshot.wallet`; o desktop valida o SS58).
    wallet: '6iUb9rXg2AiDh1Sq6uRzpqjSvgZ6NPayojzGM6zh33vZ4Gse' });
  await new Promise(r => setTimeout(r, 80));
  assert.equal(srv.state.state, 'confirm');
  assert.equal(srv.listConversations().length, 0, 'nada antes da confirmação');
  assert.equal(srv.confirm(phone.words[2]!).state, 'linked');
  await until(() => srv.state.state === 'linked' && srv.state.synced, 'snapshot aplicado');
  await until(() => phone.inbox.some(m => m.t === 'ready'), 'ready chegar ao celular');
  assert.deepEqual(phone.inbox.find(m => m.t === 'ready'), { t: 'ready', name: 'iMac de teste' });
  assert.equal(srv.listConversations()[0]!.contact.name, 'Marina');
  assert.equal(srv.getMessages('c1').length, 2);
  assert.equal(srv.walletAddress, '6iUb9rXg2AiDh1Sq6uRzpqjSvgZ6NPayojzGM6zh33vZ4Gse', 'carteira do celular espelhada');
  assert.deepEqual(wallets, ['6iUb9rXg2AiDh1Sq6uRzpqjSvgZ6NPayojzGM6zh33vZ4Gse']);
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
  assert.equal(srv.walletAddress, null, 'sem vínculo, sem carteira do celular');
  assert.equal(srv.listConversations().length, 0);
});

test('vínculo: vetores do celular contra o servidor real (chaves e quadros dos VECTORS; palavras com o pino do certificado)', async t => {
  const dir = tmp();
  const srv = new DesktopLinkServer({ host: '192.168.0.10', listen: '127.0.0.1', tlsDir: dir, offer: () => newOffer(Date.now(), hex(VECTORS.sk_desktop), hex(VECTORS.s)) });
  t.after(async () => { await srv.stop(); rmSync(dir, { recursive: true, force: true }); });
  const s0 = await srv.start(); if (s0.state !== 'waiting') throw new Error('estado');
  assert.ok(s0.uri.includes(`&s=${VECTORS.s_b64url}`));
  const phone = await fakePhone(s0.uri, hex(VECTORS.sk_celular));
  assert.equal(toHex(phone.keys.send), VECTORS.k_c2d);
  assert.equal(toHex(phone.keys.recv), VECTORS.k_d2c);
  await until(() => srv.state.state === 'confirm', 'confirm');
  // Palavras com o certificado REAL deste servidor na transcrição (os VECTORS usam c = 0x33×32; ver test/desktopLink.test.ts).
  assert.deepEqual(phone.words, linkWords(hex(VECTORS.s), hex(VECTORS.pk_desktop), hex(VECTORS.pk_celular), srv.certHash!));
  assert.deepEqual(srv.state.state === 'confirm' ? srv.state.words : [], phone.words.slice(0, 2));
  srv.confirm(phone.words[2]!);
  phone.sendRaw(VECTORS.quadro0); phone.sendRaw(VECTORS.quadro1); // pings fixos do celular (contador 0 e 1)
  await until(() => phone.inbox.filter(m => m.t === 'pong').length === 2, 'dois pongs');
});

test('vínculo: certificado diferente do pino é recusado pelo celular; sessão errada fecha com 4001, versão errada com 4002; quadro em claro derruba', async t => {
  const dir = tmp();
  const srv = new DesktopLinkServer({ host: '192.168.0.10', listen: '127.0.0.1', tlsDir: dir });
  t.after(async () => { await srv.stop(); rmSync(dir, { recursive: true, force: true }); });
  const s0 = await srv.start(); if (s0.state !== 'waiting') throw new Error('estado');
  await assert.rejects(fakePhone(s0.uri.replace(/&c=.*/, '&c=' + b64url(new Uint8Array(32)))), /certificado/);
  const bad = await fakePhone(s0.uri.replace(/&s=[^&]+/, '&s=AAAAAAAAAAAAAAAAAAAAAA'));
  await until(() => !!bad.closed, 'fechado');
  assert.equal(bad.closed!.code, 4001);
  // M-03: falha ANTES do handshake não derruba o pareamento: o QR segue renovando (sem estado 'dropped').
  assert.equal(srv.state.state, 'waiting');
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


test('vínculo: só envia para conversas existentes e coletivas com permissão do celular', async t => {
  const dir = tmp();
  const srv = new DesktopLinkServer({ host: '192.168.0.10', listen: '127.0.0.1', tlsDir: dir });
  t.after(async () => { await srv.stop(); rmSync(dir, { recursive: true, force: true }); });
  const s = await srv.start(); if (s.state !== 'waiting') throw new Error('estado');
  const phone = await fakePhone(s.uri);
  await until(() => srv.state.state === 'confirm', 'confirmação');
  srv.confirm(phone.words[2]!);
  const base = { ident: 'public' as const, initials: 'EQ', time: '', unread: 0 };
  phone.send({ t: 'snapshot', contacts: [], chats: [
    { ...base, id: 'grupo', kind: 'group', name: 'Grupo', group: 'g', owner: true },
    { ...base, id: 'canal', kind: 'channel', name: 'Canal', group: 'c' },
  ], messages: {} });
  await until(() => srv.state.state === 'linked' && srv.state.synced, 'snapshot');
  assert.throws(() => srv.sendText('desconhecida', 'oi'), /não encontrada/);
  assert.throws(() => srv.sendText('canal', 'oi'), /somente leitura/);
  assert.throws(() => srv.sendText('grupo', '  '), /Escreva/);
  assert.deepEqual(srv.getMessages('canal'), []);
  srv.sendText('grupo', 'olá ao grupo');
  await until(() => phone.inbox.some(m => m.t === 'cmd' && m.op === 'send' && m.chatId === 'grupo'), 'mensagem de grupo');
  phone.send({ t: 'event', k: 'chat', chat: { ...base, id: 'canal', kind: 'channel', name: 'Canal', group: 'c', owner: true } });
  await until(() => srv.listConversations().find(x => x.contact.id === 'canal')?.contact.canPost === true, 'permissão concedida');
  srv.sendText('canal', 'anúncio');
  await until(() => phone.inbox.some(m => m.t === 'cmd' && m.op === 'send' && m.chatId === 'canal'), 'mensagem de canal');
  phone.send({ t: 'event', k: 'chat', chat: { ...base, id: 'grupo', kind: 'group', name: 'Grupo', group: 'g' } });
  await until(() => srv.listConversations().find(x => x.contact.id === 'grupo')?.contact.canPost === false, 'permissão revogada');
  assert.throws(() => srv.sendText('grupo', 'nova'), /somente leitura/);
});

const confirmState = (srv: DesktopLinkServer) => { const st = srv.state; if (st.state !== 'confirm') throw new Error(`estado ${st.state}`); return st; };
const waitingUri = (srv: DesktopLinkServer) => { const st = srv.state; if (st.state !== 'waiting') throw new Error(`estado ${st.state}`); return st.uri; };

test('vínculo (M-04): escolher a palavra errada cancela, avisa o celular (bye) e mostra um QR novo; a certa vincula', async t => {
  const dir = tmp();
  const srv = new DesktopLinkServer({ host: '192.168.0.10', listen: '127.0.0.1', tlsDir: dir });
  t.after(async () => { await srv.stop(); rmSync(dir, { recursive: true, force: true }); });
  const s0 = await srv.start(); if (s0.state !== 'waiting') throw new Error('estado');
  const phone = await fakePhone(s0.uri);
  await until(() => srv.state.state === 'confirm', 'confirm');
  const wrong = confirmState(srv).options.find(w => w !== phone.words[2])!;
  const after = srv.confirm(wrong);
  assert.equal(after.state, 'waiting', 'errou: volta ao QR');
  assert.notEqual(waitingUri(srv), s0.uri, 'QR novo (a oferta anterior não vale mais)');
  await until(() => !!phone.closed, 'celular desconectado');
  assert.ok(phone.inbox.some(m => m.t === 'bye'), 'o celular recebe bye');
  assert.ok(!phone.inbox.some(m => m.t === 'ready'), 'nunca recebeu ready');
  // Palavra que não é nenhuma das opções também não vincula.
  const p2 = await fakePhone(waitingUri(srv));
  await until(() => srv.state.state === 'confirm', 'confirm 2');
  assert.equal(srv.confirm('').state, 'waiting');
  const p3 = await fakePhone(waitingUri(srv));
  await until(() => srv.state.state === 'confirm', 'confirm 3');
  assert.equal(srv.confirm(p3.words[2]!).state, 'linked');
  void p2;
});

test('vínculo (M-03): conexão muda (sem hello) é derrubada no prazo e libera o slot sem trocar o QR; o celular de verdade conecta depois', async t => {
  const dir = tmp();
  const srv = new DesktopLinkServer({ host: '192.168.0.10', listen: '127.0.0.1', tlsDir: dir, helloTimeoutMs: 200 });
  t.after(async () => { await srv.stop(); rmSync(dir, { recursive: true, force: true }); });
  const s0 = await srv.start(); if (s0.state !== 'waiting') throw new Error('estado');
  const mute = new WebSocket(`wss://127.0.0.1:${srv.port}`, { rejectUnauthorized: false });
  const closed = new Promise<number>(res => mute.once('close', code => res(code)));
  await new Promise(res => mute.once('open', res));
  const mute2 = new WebSocket(`wss://127.0.0.1:${srv.port}`, { rejectUnauthorized: false });
  const closed2 = new Promise<number>(res => mute2.once('close', code => res(code)));
  await new Promise(res => mute2.once('open', res));
  // Limite por endereço: o terceiro pendurado do mesmo IP recebe "ocupado".
  const busy = new WebSocket(`wss://127.0.0.1:${srv.port}`, { rejectUnauthorized: false });
  assert.equal(await new Promise<number>(res => busy.once('close', code => res(code))), 1013);
  assert.equal(await closed, 1008, 'tempo esgotado esperando o hello');
  assert.equal(await closed2, 1008);
  assert.equal(waitingUri(srv), s0.uri, 'o QR que a pessoa leu continua valendo');
  const phone = await fakePhone(s0.uri);
  await until(() => srv.state.state === 'confirm', 'confirm');
  assert.equal(srv.confirm(phone.words[2]!).state, 'linked');
});

test('vínculo (M-03): hello inválido não vai para "dropped" nem troca a oferta; QR vencido ou já usado é recusado (1013)', async t => {
  const dir = tmp();
  let now = Date.now();
  const srv = new DesktopLinkServer({ host: '192.168.0.10', listen: '127.0.0.1', tlsDir: dir, now: () => now });
  t.after(async () => { await srv.stop(); rmSync(dir, { recursive: true, force: true }); });
  const s0 = await srv.start(); if (s0.state !== 'waiting') throw new Error('estado');
  const ws = new WebSocket(`wss://127.0.0.1:${srv.port}`, { rejectUnauthorized: false });
  const c1 = new Promise<number>(res => ws.once('close', code => res(code)));
  ws.once('open', () => ws.send('{"t":"hello","v":1,"s":"lixo","pk":"lixo"}'));
  await c1;
  assert.equal(srv.state.state, 'waiting');
  // Quem não provou conhecer o QR não o invalida: sessão errada → 4001 e o QR segue o mesmo.
  const wrong = await fakePhone(s0.uri.replace(/&s=[^&]+/, '&s=AAAAAAAAAAAAAAAAAAAAAA'));
  await until(() => !!wrong.closed, 'sessão errada recusada');
  assert.equal(wrong.closed!.code, 4001);
  assert.equal(waitingUri(srv), s0.uri, 'oferta mantida');
  // QR vencido (relógio passou de 30 s sem renovar): recusado na conexão.
  now += 31_000;
  const late = await fakePhone(waitingUri(srv));
  await until(() => !!late.closed, 'vencido recusado');
  assert.equal(late.closed!.code, 1013);
  // Depois de um handshake que falhou no meio (dropped), a oferta usada não é reaproveitada.
  const fresh = srv.cancel(); if (fresh.state !== 'waiting') throw new Error('estado');
  const phone = await fakePhone(fresh.uri);
  await until(() => srv.state.state === 'confirm', 'confirm');
  phone.sendRaw('{"t":"ping"}');
  await until(() => srv.state.state === 'dropped', 'dropped');
  const reuse = await fakePhone(fresh.uri);
  await until(() => !!reuse.closed, 'reuso recusado');
  assert.equal(reuse.closed!.code, 1013);
});

test('vínculo (M-03): sem `listen`, escuta só no endereço anunciado no QR (não em 0.0.0.0)', async t => {
  const dir = tmp();
  const srv = new DesktopLinkServer({ host: '127.0.0.1', tlsDir: dir });
  t.after(async () => { await srv.stop(); rmSync(dir, { recursive: true, force: true }); });
  const s0 = await srv.start(); if (s0.state !== 'waiting') throw new Error('estado');
  assert.equal(srv.boundHost, '127.0.0.1');
  assert.equal(s0.host, '127.0.0.1');
});

test('vínculo (privacidade): desconectar pelo computador apaga o espelho; o próximo celular não vê nada do anterior antes do snapshot dele', async t => {
  const dir = tmp();
  const srv = new DesktopLinkServer({ host: '192.168.0.10', listen: '127.0.0.1', tlsDir: dir });
  t.after(async () => { await srv.stop(); rmSync(dir, { recursive: true, force: true }); });
  const s0 = await srv.start(); if (s0.state !== 'waiting') throw new Error('estado');
  const a = await fakePhone(s0.uri);
  await until(() => srv.state.state === 'confirm', 'confirm A');
  srv.confirm(a.words[2]!);
  a.send({ t: 'snapshot', contacts: [{ id: 'piu:abc', chatId: 'c1', name: 'Marina', verified: true }],
    chats: [{ id: 'c1', ident: 'public', kind: 'direct', name: 'Marina', initials: 'MA', time: '14:32', unread: 0, peer: 'piu:abc' }],
    messages: { c1: [{ id: 'm1', from: 'them', text: 'segredo de A', time: '14:30' }] },
    wallet: '6iUb9rXg2AiDh1Sq6uRzpqjSvgZ6NPayojzGM6zh33vZ4Gse' });
  await until(() => srv.state.state === 'linked' && srv.state.synced, 'snapshot A');
  assert.equal(srv.listConversations().length, 1);
  await srv.stop();
  assert.equal(srv.listConversations().length, 0, 'desconectou: sem conversas de A na memória');
  assert.deepEqual(srv.getMessages('c1'), []);
  assert.equal(srv.walletAddress, null, 'sem carteira de A');
  assert.equal(srv.meInfo(), null);
  const s1 = await srv.start(); if (s1.state !== 'waiting') throw new Error('estado');
  const b = await fakePhone(s1.uri);
  await until(() => srv.state.state === 'confirm', 'confirm B');
  assert.equal(srv.confirm(b.words[2]!).state, 'linked');
  assert.equal(srv.listConversations().length, 0, 'B vinculado sem snapshot: nada de A');
});

test('certificado do vínculo: sem nome do computador nem IPs; novo a cada abertura do servidor; nada identificador no HTTP simples', async t => {
  const dir = tmp();
  const srv = new DesktopLinkServer({ host: '192.168.0.10', listen: '127.0.0.1', tlsDir: dir });
  t.after(async () => { await srv.stop(); rmSync(dir, { recursive: true, force: true }); });
  await srv.start();
  const pin1 = srv.certPin;
  const { X509Certificate } = await import('node:crypto');
  const { request } = await import('node:https');
  const cert = await new Promise<import('node:crypto').X509Certificate>((res, rej) => {
    const r = request({ host: '127.0.0.1', port: srv.port, rejectUnauthorized: false }, resp => {
      const raw = (resp.socket as import('node:tls').TLSSocket).getPeerCertificate().raw;
      let body = ''; resp.on('data', d => { body += d; }); resp.on('end', () => { assert.ok(!/piu/i.test(body), 'resposta sem texto identificador'); res(new X509Certificate(raw)); });
    });
    r.on('error', rej); r.end();
  });
  const san = cert.subjectAltName ?? '';
  const { hostname } = await import('node:os');
  assert.ok(!san.toLowerCase().includes(hostname().toLowerCase()), 'sem hostname no SAN');
  assert.ok(!/IP Address/i.test(san), 'sem IPs no SAN');
  await srv.stop();
  await srv.start();
  assert.notEqual(srv.certPin, pin1, 'certificado novo a cada abertura (não identifica o computador entre redes)');
});

test('vínculo (DoS na LAN): conexões mudas não trocam o QR nem impedem o celular de verdade; limite por endereço', async t => {
  const dir = tmp();
  const srv = new DesktopLinkServer({ host: '192.168.0.10', listen: '127.0.0.1', tlsDir: dir, helloTimeoutMs: 300 });
  t.after(async () => { await srv.stop(); rmSync(dir, { recursive: true, force: true }); });
  const s0 = await srv.start(); if (s0.state !== 'waiting') throw new Error('estado');
  // Hello inválido de quem não conhece o QR: libera, mas o QR que a pessoa leu continua valendo.
  const junk = new WebSocket(`wss://127.0.0.1:${srv.port}`, { rejectUnauthorized: false });
  const cj = new Promise<number>(res => junk.once('close', code => res(code)));
  junk.once('open', () => junk.send('{"t":"hello","v":1,"s":"lixo","pk":"lixo"}'));
  await cj;
  assert.equal(waitingUri(srv), s0.uri, 'hello inválido não troca o QR');
  // Um mudo segurando conexão não bloqueia o celular de verdade, que conecta em paralelo.
  const mute = new WebSocket(`wss://127.0.0.1:${srv.port}`, { rejectUnauthorized: false });
  const cm = new Promise<number>(res => mute.once('close', code => res(code)));
  await new Promise(res => mute.once('open', res));
  const phone = await fakePhone(s0.uri);
  await until(() => srv.state.state === 'confirm', 'confirm com o mudo pendurado');
  await cm; // o mudo é dispensado quando o celular de verdade vence
  assert.equal(srv.confirm(phone.words[2]!).state, 'linked');
});
