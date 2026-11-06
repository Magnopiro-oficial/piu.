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

test('PiuCore: criação e mensagens de grupos e canais, validação e restauração', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-core-groups-'));
  const opts = (name: string) => ({ userData: join(dir, name), safeStorage, platform: 'test', version: 'test', hostname: name,
    lan: { port: 0, discoveryPort: null, listen: '127.0.0.1', broadcast: [] } });
  let a = new PiuCore(opts('ana'));
  let b = new PiuCore(opts('bia'));
  t.after(async () => { await Promise.all([a.close(), b.close()]); rmSync(dir, { recursive: true, force: true }); });
  await a.open(); await b.open();
  await a.createIdentity({ kind: 'public', name: 'Ana' });
  await b.createIdentity({ kind: 'public', name: 'Bia' });
  const port = b.networkStatus().lan.port;
  assert.ok(port);
  a.addPeer(`127.0.0.1:${port}`);
  await until(() => (a.networkStatus().lan.links > 0 && b.networkStatus().lan.links > 0), 'conexão local');
  const bia = a.addContactByCard(b.myCard('public').card);
  a.sendText(bia.id, 'Olá, Bia');
  await until(() => b.listConversations().some(c => c.contact.request), 'pedido de conversa');
  assert.equal(b.listGroupCandidates().length, 0, 'pedido ainda não foi aceito');
  const ana = b.listConversations().find(c => c.contact.request)!.contact;
  b.sendText(ana.id, 'Olá, Ana');
  await until(() => a.getMessages(bia.id).some(m => m.text === 'Olá, Ana'), 'resposta');
  assert.equal(b.listGroupCandidates().some(c => c.id === ana.id), true);
  assert.throws(() => a.createGroup({ kind: 'group', name: ' ', via: 'public', memberIds: [bia.id] }), /inválidos/);
  assert.throws(() => a.createGroup({ kind: 'group', name: 'Teste', via: 'public', memberIds: [] }), /inválidos/);
  assert.throws(() => a.createGroup({ kind: 'group', name: 'Teste', via: 'public', memberIds: [bia.id, bia.id] }), /contatos aceitos/);
  assert.throws(() => a.createGroup({ kind: 'group', name: 'Teste', via: 'anon', memberIds: [bia.id] }), /mesma identidade/);
  assert.throws(() => a.createGroup({ kind: 'group', name: 'Teste', via: 'public', memberIds: ['inexistente'] }), /contatos aceitos/);
  assert.throws(() => a.createGroup({ kind: 'outro', name: 'Teste', via: 'public', memberIds: [bia.id] } as never), /inválidos/);
  const group = a.createGroup({ kind: 'group', name: 'Equipe', via: 'public', memberIds: [bia.id] });
  const channel = a.createGroup({ kind: 'channel', name: 'Avisos', via: 'public', memberIds: [bia.id] });
  assert.equal(a.listConversations().find(c => c.contact.id === group.id)?.contact.kind, 'group');
  await until(() => b.listConversations().some(c => c.contact.id === group.id) && b.listConversations().some(c => c.contact.id === channel.id), 'distribuição dos grupos');
  assert.equal(b.listConversations().find(c => c.contact.id === channel.id)?.contact.canPost, false);
  assert.throws(() => b.sendText(channel.id, 'Sem permissão'), /Só admins/);
  a.sendText(group.id, 'Mensagem protegida');
  await until(() => b.getMessages(group.id).some(m => m.text === 'Mensagem protegida'), 'mensagem de grupo');
  assert.equal(b.getMessages(group.id).find(m => m.text === 'Mensagem protegida')?.sender, 'Ana');
  await a.close(); await b.close();
  a = new PiuCore(opts('ana')); b = new PiuCore(opts('bia'));
  await a.open(); await b.open();
  assert.equal(a.listConversations().find(c => c.contact.id === group.id)?.contact.name, 'Equipe');
  assert.equal(b.listConversations().find(c => c.contact.id === channel.id)?.contact.canPost, false);
  assert.equal(b.getMessages(group.id).find(m => m.text === 'Mensagem protegida')?.sender, 'Ana');
});
