// Auditoria final de 06/11/2026 (docs/auditoria-final-2026-11-06/core-node-provider.md): correções no
// piu-node, cada uma com o abuso que ela fecha.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { inboxUrlProblem } from '../src/app.js';
import { loadLnnpConfig } from '../src/config.js';
import { CarryAdmission, sourceHost } from '../src/relay/carryAdmission.js';
import { bundlePoster } from '../src/relay/gatewayPost.js';

test('M-N1: reconectar (link novo, mesmo vizinho) não renova o balde de cargas; trocar de identidade no mesmo IP também não', () => {
  const a = new CarryAdmission({ perHour: 30, burst: 3, hostPerHour: 60, hostBurst: 5 });
  const link = (peerId: string, seq: number, ip = '192.168.1.9') => ({ id: `${peerId}#${seq}`, session: { peerId }, address: `${ip}:${40000 + seq}` });
  const t = 1000;
  for (let i = 0; i < 3; i++) assert.ok(a.take(link('aa', i), t));
  assert.equal(a.take(link('aa', 99), t), false, 'reconexão: mesmo balde');
  // Outras identidades no mesmo IP: o teto do endereço (5) segura.
  assert.ok(a.take(link('bb', 1), t));
  assert.ok(a.take(link('cc', 1), t));
  assert.equal(a.take(link('dd', 1), t), false, 'teto por endereço');
  // Outro endereço, outra identidade: passa.
  assert.ok(a.take(link('ee', 1, '192.168.1.10'), t));
  // O balde volta a encher com o tempo.
  assert.ok(a.take(link('aa', 100), t + 3600));
});

test('M-N1: host da origem sem a porta (IPv4, IPv6, serial)', () => {
  assert.equal(sourceHost('192.168.0.12:8422'), '192.168.0.12');
  assert.equal(sourceHost('[fe80::1]:8422'), 'fe80::1');
  assert.equal(sourceHost('/dev/ttyUSB0'), '/dev/ttyUSB0');
});

test('B-N1: a caixa do validador não segue redirecionamento (POST com o corpo da malha não vai para outro lugar)', async t => {
  let second = 0;
  const target = createServer((_q, r) => { second++; r.end('ok'); });
  await new Promise<void>(r => target.listen(0, '127.0.0.1', () => r()));
  const port2 = (target.address() as { port: number }).port;
  const redir = createServer((_q, r) => { r.writeHead(307, { Location: `http://127.0.0.1:${port2}/cgi-bin/x` }); r.end(); });
  await new Promise<void>(r => redir.listen(0, '127.0.0.1', () => r()));
  t.after(() => { target.close(); redir.close(); });
  const port1 = (redir.address() as { port: number }).port;
  // O entregador só aceita https://; aqui o fetch é trocado para falar http com o servidor de teste.
  const viaHttp: typeof fetch = (url, init) => fetch(String(url).replace('https://caixa.test', `http://127.0.0.1:${port1}`), init);
  const post = bundlePoster('https://caixa.test/v1', viaHttp)!;
  const r = await post(new Uint8Array([1, 2, 3]));
  assert.equal(r.ok, false);
  assert.equal(second, 0, 'o segundo alvo não recebeu nada');
});

test('B-N1: caixa do validador recusa loopback, rede privada e link-local (painel e PIU_VALIDATOR_INBOX)', () => {
  for (const u of ['https://localhost/caixa', 'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://192.168.1.1/cgi-bin', 'https://172.16.3.4/x',
    'https://169.254.169.254/latest', 'https://[::1]/x', 'https://[fe80::1]/x', 'https://[fd00::1]/x', 'https://0.0.0.0/x', 'https://piu-node.local/x']) {
    assert.ok(inboxUrlProblem(u), u);
    assert.throws(() => loadLnnpConfig({ PIU_VALIDATOR_INBOX: u }), /PIU_VALIDATOR_INBOX/, u);
  }
  assert.equal(inboxUrlProblem('https://validador.lunes.io/caixa'), null);
  assert.equal(inboxUrlProblem('https://8.8.8.8/caixa'), null);
  // Espaço no meio: antes passava pela expressão do PIU_VALIDATOR_INBOX.
  assert.throws(() => loadLnnpConfig({ PIU_VALIDATOR_INBOX: 'https://a.example/x y' }), /PIU_VALIDATOR_INBOX/);
});

test('B-N2: vizinho que para de ler tem o enlace fechado antes de o buffer de escrita passar do teto', async t => {
  const { createServer: tcp, connect } = await import('node:net');
  const { MAX_WRITE_BUFFER, writeFrame } = await import('../src/relay/lan.js');
  const server = tcp(s => { s.pause(); }); // nunca lê
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  t.after(() => server.close());
  const sock = connect((server.address() as { port: number }).port, '127.0.0.1');
  await new Promise<void>(r => sock.once('connect', () => r()));
  const frame = new Uint8Array(64 * 1024);
  let max = 0;
  for (let i = 0; i < 400 && !sock.destroyed; i++) { writeFrame(sock, frame); max = Math.max(max, sock.writableLength); }
  assert.ok(sock.destroyed, 'enlace fechado');
  assert.ok(max <= MAX_WRITE_BUFFER, `buffer ${max}`);
});
