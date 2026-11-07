import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PiuCore } from '../src/main/core';

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
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
type Spy = { messenger: { sendRead: (id: string, ids: string[]) => void; sendTyping: (id: string) => boolean } };

test('PiuCore: silenciar, bloquear, temporárias, recibo de leitura, "digitando…" e espaço usado', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-core-priv-'));
  const opts = (name: string) => ({ userData: join(dir, name), safeStorage, platform: 'test', version: 'test', hostname: name,
    lan: { port: 0, discoveryPort: null, listen: '127.0.0.1', broadcast: [] },
    walletBalance: async () => { throw new Error('sem rede nos testes'); } });
  const a = new PiuCore(opts('ana'));
  const b = new PiuCore(opts('bia'));
  t.after(async () => { await Promise.all([a.close(), b.close()]); rmSync(dir, { recursive: true, force: true }); });
  await a.open(); await b.open();
  await a.createIdentity({ kind: 'public', name: 'Ana' });
  await b.createIdentity({ kind: 'public', name: 'Bia' });
  a.addPeer(`127.0.0.1:${b.networkStatus().lan.port}`);
  await until(() => a.networkStatus().lan.links > 0 && b.networkStatus().lan.links > 0, 'conexão local');

  // Temporárias por padrão valem para a conversa nova (a do convite que eu adiciono).
  a.setPrefs({ tempDefault: '24h' });
  const bia = a.addContactByCard(b.myCard('public').card);
  assert.equal(a.listConversations().find(c => c.contact.id === bia.id)?.temp, '24h');
  const sent = a.sendText(bia.id, 'Olá, Bia');
  assert.ok(sent.expiresAt && sent.expiresAt - sent.at === 86400, 'minha mensagem leva o prazo');
  await until(() => b.listConversations().some(c => c.contact.request), 'pedido de conversa');
  const ana = b.listConversations().find(c => c.contact.request)!.contact;
  const got = b.getMessages(ana.id).find(m => m.text === 'Olá, Bia')!;
  assert.ok(got.expiresAt && got.expiresAt - got.at <= 86400 && got.expiresAt - got.at > 86000, 'quem recebe guarda o mesmo prazo (campo `e`)');
  a.setTemp(bia.id, 'off');
  assert.equal(a.listConversations().find(c => c.contact.id === bia.id)?.temp, undefined);
  assert.throws(() => a.setTemp(bia.id, '2h' as never), /inválido/);

  // Recibo de leitura: sai ao ler (com o ajuste ligado), não sai com ele desligado.
  b.sendText(ana.id, 'Oi, Ana');
  await until(() => a.getMessages(bia.id).some(m => m.text === 'Oi, Ana'), 'resposta');
  const am = (a as unknown as { mesh: Spy }).mesh.messenger;
  const reads: string[][] = [];
  const realRead = am.sendRead.bind(am);
  am.sendRead = (id, ids) => { reads.push(ids); realRead(id, ids); };
  a.setPrefs({ readReceipts: false });
  a.markRead(bia.id);
  assert.equal(reads.length, 0);
  b.sendText(ana.id, 'Leu?');
  await until(() => a.getMessages(bia.id).some(m => m.text === 'Leu?'), 'segunda');
  a.setPrefs({ readReceipts: true });
  a.markRead(bia.id);
  assert.equal(reads.length, 1);
  assert.equal(reads[0]!.length, 1, 'só a que ainda não estava lida');

  // "digitando…": chega do outro lado como evento; desligado, nada sai.
  const typing: string[] = [];
  a.events.on('typing', (p: { contactId: string }) => typing.push(p.contactId));
  b.typing(ana.id);
  await until(() => typing.length > 0, 'digitando');
  assert.equal(typing[0], bia.id);
  const bm = (b as unknown as { mesh: Spy }).mesh.messenger;
  let typed = 0; const realTyping = bm.sendTyping.bind(bm);
  bm.sendTyping = id => { typed++; return realTyping(id); };
  b.setPrefs({ typing: false });
  b.typing(ana.id);
  assert.equal(typed, 0);

  // Silenciar: marca na lista e persiste; desfazer volta.
  a.setMuted(bia.id, true);
  assert.equal(a.listConversations().find(c => c.contact.id === bia.id)?.muted, true);
  assert.equal(a.isMuted(bia.id), true);
  a.setMuted(bia.id, false);
  assert.equal(a.listConversations().find(c => c.contact.id === bia.id)?.muted, undefined);

  // Bloquear: o que a Bia manda é descartado; enviar para ela é recusado; desbloquear volta ao normal.
  assert.throws(() => a.blockContact('piu:nao-existe'), /conversa direta/);
  const list = a.blockContact(bia.id);
  assert.deepEqual(list.map(x => [x.id, x.name]), [[bia.id, bia.name]]);
  assert.equal(a.blockContact(bia.id).length, 1, 'bloquear de novo não duplica');
  b.sendText(ana.id, 'Bloqueada fala');
  await sleep(600);
  assert.equal(a.getMessages(bia.id).some(m => m.text === 'Bloqueada fala'), false);
  assert.throws(() => a.sendText(bia.id, 'x'), /bloqueado/i);
  assert.equal(a.unblockContact(bia.id).length, 0);
  b.sendText(ana.id, 'De volta');
  await until(() => a.getMessages(bia.id).some(m => m.text === 'De volta'), 'depois de desbloquear');

  // Espaço: mede a pasta de dados de verdade.
  a.saveNow();
  const u = a.storageUsage();
  assert.ok(u.total > 0 && u.messages > 0 && u.total >= u.messages);
  assert.equal(u.media, 0);
  assert.equal(typeof u.relay, 'number');
});
