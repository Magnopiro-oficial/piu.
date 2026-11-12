import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PiuCore } from '../src/main/core';
import type { CallAudioCmd } from '../src/shared/callBridge';

/**
 * Dois PiuCore de verdade (cofre, estado, LAN em 127.0.0.1) fazendo uma chamada pela ponte que a janela usa
 * (`callAct`/`callFrame` ↔ eventos `call`/`callAudio`). Só a janela não existe: o teste faz o papel dela.
 */
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(s, 'utf8'),
  decryptString: (b: Buffer) => b.toString('utf8'),
};
const until = async (fn: () => boolean, what: string, ms = 10000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error(`Tempo esgotado: ${what}`);
    await new Promise(r => setTimeout(r, 20));
  }
};

test('PiuCore: chamada pela ponte da janela — toca, atende, voz, desliga, cartões na conversa; a janela não forja eventos', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-core-call-'));
  const opts = (name: string) => ({ userData: join(dir, name), safeStorage, platform: 'test', version: 'test', hostname: name,
    lan: { port: 0, discoveryPort: null, listen: '127.0.0.1', broadcast: [] },
    walletBalance: async () => { throw new Error('sem rede nos testes'); } });
  const a = new PiuCore(opts('ana')), b = new PiuCore(opts('bia'));
  t.after(async () => { await Promise.all([a.close(), b.close()]); rmSync(dir, { recursive: true, force: true }); });
  const audio = { a: [] as CallAudioCmd[], b: [] as CallAudioCmd[] };
  a.events.on('callAudio', c => audio.a.push(c));
  b.events.on('callAudio', c => audio.b.push(c));
  await a.open(); await b.open();
  await a.createIdentity({ kind: 'public', name: 'Ana' });
  await b.createIdentity({ kind: 'public', name: 'Bia' });
  a.addPeer(`127.0.0.1:${b.networkStatus().lan.port}`);
  await until(() => a.networkStatus().lan.links > 0 && b.networkStatus().lan.links > 0, 'conexão local');
  const bia = a.addContactByCard(b.myCard('public').card);
  a.sendText(bia.id, 'oi');
  await until(() => b.listConversations().some(c => c.contact.request), 'pedido de conversa');
  const ana = b.listConversations().find(c => c.contact.request)!.contact;
  // Pedido de conversa ainda não aceito: não dá para ligar.
  assert.throws(() => b.callAct({ a: 'open', peer: ana.id }));
  b.sendText(ana.id, 'oi!');
  await until(() => a.getMessages(bia.id).some(m => m.text === 'oi!'), 'resposta');

  a.callAct({ a: 'open', peer: bia.id });
  assert.equal(a.callSnapshot()?.state.phase, 'pre');
  assert.equal(a.callSnapshot()?.state.preRoute, 'direct', 'vizinho direto pela LAN');
  assert.equal(a.callSnapshot()?.routes[bia.id], 'direct');
  // A janela só pede o que um botão pede: eventos da rede não entram.
  assert.throws(() => a.callAct({ a: 'event', event: { type: 'connected' } }));
  assert.throws(() => a.callAct({ a: 'open', peer: 'piu:nao-existe' }));
  a.callAct({ a: 'dial' });
  await until(() => b.callSnapshot()?.state.phase === 'ringing', 'tocar na Bia');
  b.callAct({ a: 'answer' });
  await until(() => a.callSnapshot()?.state.phase === 'active' && b.callSnapshot()?.state.phase === 'active', 'chamada ativa');
  assert.deepEqual(a.callSnapshot()!.words, b.callSnapshot()!.words);
  await until(() => audio.a.some(c => c.op === 'start') && audio.b.some(c => c.op === 'start'), 'microfones abertos');

  // A janela da Ana manda um pedaço do microfone; chega cifrado e toca na janela da Bia.
  // O microfone manda quadros sem parar: os primeiros, antes de o enlace da voz ser achado, não saem.
  b.callFrame('opus', new Uint8Array(1025));   // grande demais: descartado
  await until(() => { a.callFrame('opus', new Uint8Array(48).fill(7)); return audio.b.some(c => c.op === 'play' && c.payload.length === 48); }, 'voz na Bia');
  assert.ok(!audio.a.some(c => c.op === 'play'), 'nada tocou na Ana');
  a.callAct({ a: 'event', event: { type: 'mute' } });
  assert.ok(audio.a.some(c => c.op === 'mute' && c.on));

  a.callAct({ a: 'hangup' });
  await until(() => b.getMessages(ana.id).some(m => m.call), 'registro na Bia');
  const ra = a.getMessages(bia.id).find(m => m.call)!, rb = b.getMessages(ana.id).find(m => m.call)!;
  assert.equal(ra.call!.outcome, 'done'); assert.equal(ra.dir, 'out');
  assert.equal(rb.call!.outcome, 'done'); assert.equal(rb.dir, 'in');
  assert.equal(b.listConversations().find(c => c.contact.id === ana.id)!.unread, 0, 'atendida não fica como não lida');
  assert.ok(audio.a.at(-1)?.op === 'stop' || audio.a.some(c => c.op === 'stop'), 'microfone fechado no fim');

  // Contato bloqueado não toca: a chamada dele fica sem resposta.
  b.blockContact(ana.id);
  await until(() => a.callSnapshot()?.state.phase === 'idle', 'fim da tela de encerramento', 5000);
  a.callAct({ a: 'open', peer: bia.id });
  a.callAct({ a: 'dial' });
  await new Promise(r => setTimeout(r, 600));
  assert.equal(b.callSnapshot()?.state.phase, 'idle', 'bloqueado não toca');
  a.callAct({ a: 'hangup' });
});
