import assert from 'node:assert/strict';
import type { NetworkInterfaceInfo } from 'node:os';
import { test } from 'node:test';
import { pickLanHosts } from '../src/main/desktopLink';

const v4 = (address: string, internal = false): NetworkInterfaceInfo =>
  ({ address, family: 'IPv4', internal, netmask: '255.255.255.0', mac: '00:00:00:00:00:00', cidr: `${address}/24` }) as NetworkInterfaceInfo;

test('hosts do QR: com endereço privado, nunca anuncia IP público', () => {
  const r = pickLanHosts({ ppp0: [v4('203.0.113.7')], en0: [v4('192.168.0.10')], lo0: [v4('127.0.0.1', true)] });
  assert.deepEqual(r, ['192.168.0.10']);
});

test('hosts do QR: aceita as mesmas faixas do celular (10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10)', () => {
  const r = pickLanHosts({
    a: [v4('10.1.2.3')], b: [v4('172.16.0.5')], c: [v4('172.31.255.1')], d: [v4('172.32.0.1')],
    e: [v4('169.254.9.9')], f: [v4('100.64.0.1')], g: [v4('100.128.0.1')], h: [v4('192.169.0.1')],
  });
  assert.deepEqual([...r].sort(), ['10.1.2.3', '100.64.0.1', '169.254.9.9', '172.16.0.5', '172.31.255.1']);
});

test('hosts do QR: interface comum (en0) vem antes; link-local por último', () => {
  const r = pickLanHosts({ utun1: [v4('169.254.1.1')], br0: [v4('10.0.0.2')], en0: [v4('192.168.1.5')] });
  assert.deepEqual(r, ['192.168.1.5', '10.0.0.2', '169.254.1.1']);
});

test('hosts do QR: sem endereço privado, mantém o comportamento atual (devolve os não internos)', () => {
  const r = pickLanHosts({ ppp0: [v4('203.0.113.7')], lo0: [v4('127.0.0.1', true)] });
  assert.deepEqual(r, ['203.0.113.7']);
});

test('hosts do QR: ignora IPv6 e interno', () => {
  const v6 = { address: 'fe80::1', family: 'IPv6', internal: false } as NetworkInterfaceInfo;
  assert.deepEqual(pickLanHosts({ en0: [v6], lo0: [v4('127.0.0.1', true)] }), []);
});
