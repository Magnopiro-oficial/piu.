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

test('PiuCore: armazenamento por conversa, limpar uma conversa mede o que saiu e o contato fica', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-core-sto-'));
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
  await until(() => a.networkStatus().lan.links > 0, 'conexão local');
  const bia = a.addContactByCard(b.myCard('public').card);
  for (let i = 0; i < 20; i++) a.sendText(bia.id, `mensagem longa número ${i} `.repeat(20));
  a.saveNow();

  const d = a.storageDetail();
  assert.equal(d.linked, false);
  assert.equal(d.media, 0);
  assert.ok(d.free === null || d.free > 0);
  assert.equal(typeof d.low, 'boolean');
  assert.equal(d.conversations.length, 1);
  assert.equal(d.conversations[0]!.id, bia.id);
  assert.equal(d.conversations[0]!.name, 'Bia');
  assert.equal(d.conversations[0]!.count, 20);
  assert.ok(d.conversations[0]!.bytes > 8000);

  const r = a.clearConversation(bia.id);
  assert.ok(r.freed > 8000, `liberou ${r.freed}`);
  assert.equal(a.getMessages(bia.id).length, 0);
  assert.ok(a.listConversations().some(c => c.contact.id === bia.id), 'o contato continua');
  assert.equal(a.storageDetail().conversations.length, 0);
  assert.deepEqual(a.clearConversation(bia.id), { freed: 0 }, 'repetir não quebra');
  assert.ok(a.clearRelayQueue().freed >= 0);
});
