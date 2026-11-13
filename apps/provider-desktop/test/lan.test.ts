import assert from 'node:assert/strict';
import type { NetworkInterfaceInfo } from 'node:os';
import { test } from 'node:test';
import { STRINGS, LANGS } from '../src/i18n.ts';
import { lanUrls, localName } from '../src/lan.ts';

const iface = (address: string, family: 'IPv4' | 'IPv6', internal = false) => ({ address, family, internal }) as NetworkInterfaceInfo;
const IFACES = {
  lo0: [iface('127.0.0.1', 'IPv4', true), iface('::1', 'IPv6', true)],
  en0: [iface('fe80::1', 'IPv6'), iface('192.168.0.10', 'IPv4')],
};

test('nome na rede: o do computador em minúsculas, com .local (como o mDNS do sistema anuncia)', () => {
  assert.equal(localName('iMac-de-Lucas.local'), 'imac-de-lucas.local');
  assert.equal(localName('pc-da-sala'), 'pc-da-sala.local');
});

test('endereços do painel na rede: o nome do computador e os IPs, nunca piu-node.local (o app não anuncia esse nome)', () => {
  assert.deepEqual(lanUrls(8431, 'iMac-de-Lucas.local', IFACES), ['https://imac-de-lucas.local:8431', 'https://192.168.0.10:8431']);
  assert.ok(lanUrls(8420, 'pc', IFACES).every(u => !u.includes('piu-node.local')));
});

test('textos: nenhum idioma promete piu-node.local e o aviso da rede local mostra o endereço real', () => {
  for (const lang of LANGS) {
    for (const [k, v] of Object.entries(STRINGS[lang])) assert.ok(!v.includes('piu-node.local'), `${lang}.${k}`);
    assert.ok(STRINGS[lang]['lan.detailOn'].includes('{address}'), `${lang}: lan.detailOn sem {address}`);
  }
});
