import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEV_ADDR_57, DEV_MNEMONIC } from '../../mobile/src/lib/__tests__/walletFixture';
import { PiuCore } from '../src/main/core';
import { toContactInfo } from '../src/main/mesh';
import { pickWalletAddress } from '../src/main/wallet';

const safeStorage = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s, 'utf8'), decryptString: (b: Buffer) => b.toString('utf8') };
const MANUAL = '6hiMqKZbNejk5Wat7uBBN2krtAd8Bde1Ja4ofzR6goLSd4Kt';

test('PiuCore: sem endereço informado a carteira usa o derivado da frase (o mesmo do celular); o informado tem prioridade', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-core-wallet-'));
  const reads: string[] = [];
  const core = new PiuCore({ userData: dir, safeStorage, platform: 'test', version: 'test', hostname: 'teste',
    lan: { port: 0, discoveryPort: null, listen: '127.0.0.1', broadcast: [] },
    walletBalance: async (_rpc, address) => { reads.push(address); return { address, free: 5_840_000_000n, exists: true, reserved: 0n, frozen: 0n, nonce: 0, block: 1, blockHash: '', endpoint: 'teste' }; } });
  t.after(async () => { await core.close(); rmSync(dir, { recursive: true, force: true }); });
  await core.open();
  assert.equal(core.wallet().address, null, 'sem identidade, sem endereço');
  await core.restoreIdentity({ phrase: DEV_MNEMONIC.split(' '), name: 'Teste' });
  assert.equal(core.wallet().address, DEV_ADDR_57);
  assert.equal(core.wallet().source, 'phrase');
  assert.equal(core.prefs().walletAddress, null, 'o derivado não é gravado como se tivesse sido digitado');
  // Informado por você vale mais; vazio volta ao derivado.
  const manual = await core.setWalletAddress(MANUAL);
  assert.equal(manual.address, MANUAL); assert.equal(manual.source, 'manual'); assert.equal(manual.status, 'ok'); assert.equal(manual.free, '5840000000');
  const back = await core.setWalletAddress(null);
  assert.equal(back.address, DEV_ADDR_57); assert.equal(back.source, 'phrase');
  assert.ok(reads.includes(DEV_ADDR_57) && reads.includes(MANUAL), 'leu o saldo das duas contas');
  await assert.rejects(core.setWalletAddress('endereço-inválido'));
});

test('prioridade do endereço: informado > carteira do celular vinculado > derivado da frase', () => {
  const phrase = DEV_ADDR_57, phone = MANUAL, manual = '6iZ4e5PpYi6XKLPW6RaxbfuhE2ENFXD9gwAaM3yiJjUSXd6W';
  assert.deepEqual(pickWalletAddress({ manual, phone, phrase }), { address: manual, source: 'manual' });
  assert.deepEqual(pickWalletAddress({ manual: null, phone, phrase }), { address: phone, source: 'phone' });
  assert.deepEqual(pickWalletAddress({ manual: null, phone: null, phrase }), { address: phrase, source: 'phrase' });
  assert.deepEqual(pickWalletAddress({ manual: null, phone: null, phrase: null }), { address: null, source: null });
});

test('contato do Messenger com `lunes` vira `ContactInfo.lunesAddress`', () => {
  const pub = { signPk: new Uint8Array(32), agreePk: new Uint8Array(32), binding: new Uint8Array(64) };
  assert.equal(toContactInfo({ id: 'piu:a', via: 'public', pub, name: 'Ana', lunes: MANUAL }).lunesAddress, MANUAL);
  assert.deepEqual(toContactInfo({ id: 'piu:b', via: 'public', pub, name: 'Bia' }), { id: 'piu:b', name: 'Bia', via: 'public', request: false });
});

const until = async (fn: () => boolean, what: string, ms = 10000) => {
  const end = Date.now() + ms;
  while (!fn()) { if (Date.now() > end) throw new Error(`Tempo esgotado: ${what}`); await new Promise(r => setTimeout(r, 20)); }
};

test('PiuCore compartilha o endereço derivado com contato público aceito; desligar o ajuste manda "parei"', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-core-share-'));
  const opts = (name: string) => ({ userData: join(dir, name), safeStorage, platform: 'test', version: 'test', hostname: name,
    lan: { port: 0, discoveryPort: null, listen: '127.0.0.1', broadcast: [] }, walletBalance: async () => { throw new Error('sem rede nos testes'); } });
  const a = new PiuCore(opts('ana')), b = new PiuCore(opts('bia'));
  t.after(async () => { await Promise.all([a.close(), b.close()]); rmSync(dir, { recursive: true, force: true }); });
  await a.open(); await b.open();
  await a.createIdentity({ kind: 'public', name: 'Ana' });
  await b.createIdentity({ kind: 'public', name: 'Bia' });
  const aAddr = a.wallet().address!, bAddr = b.wallet().address!;
  assert.ok(aAddr && bAddr && aAddr !== bAddr);
  a.addPeer(`127.0.0.1:${b.networkStatus().lan.port}`);
  await until(() => a.networkStatus().lan.links > 0 && b.networkStatus().lan.links > 0, 'conexão local');
  // Ana adiciona Bia pelo cartão (contato aceito do lado dela) e escreve; para Bia é um pedido até ela responder.
  const bia = a.addContactByCard(b.myCard('public').card);
  a.sendText(bia.id, 'Olá, Bia');
  await until(() => b.listConversations().some(c => c.contact.request), 'pedido de conversa');
  const ana = b.listConversations().find(c => c.contact.request)!.contact;
  assert.equal(ana.lunesAddress, undefined, 'pedido ainda não aceito não recebe endereço');
  b.sendText(ana.id, 'Olá, Ana');
  await until(() => !!a.listConversations().find(c => c.contact.id === ana.id || c.contact.id === bia.id)?.contact.lunesAddress, 'Bia aceitou e compartilhou a carteira dela');
  assert.equal(a.listConversations().find(c => c.contact.id === bia.id)!.contact.lunesAddress, bAddr);
  // Ana mandou o dela ao adicionar Bia, mas Bia ainda a tratava como pedido e descartou; ao receber o de Bia, Ana reenvia o dela uma vez.
  await until(() => b.listConversations().find(c => c.contact.id === ana.id)?.contact.lunesAddress === aAddr, 'Bia vê a carteira da Ana');
  b.setPrefs({ shareWalletAddress: false });
  await until(() => a.listConversations().find(c => c.contact.id === bia.id)?.contact.lunesAddress === undefined, 'Bia parou de compartilhar');
});
