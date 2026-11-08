import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mediaGrants, transportPermissions, type TransportPermission } from '../grants';

const only = (...ok: string[]) => (p: TransportPermission) => ok.some(x => p.endsWith(x));
const BT = ['BLUETOOTH_SCAN', 'BLUETOOTH_ADVERTISE', 'BLUETOOTH_CONNECT'];

test('negar o Wi-Fi não desliga o Bluetooth (Android 13+)', () => {
  assert.deepEqual(mediaGrants(34, only(...BT)), { ble: true, nearby: false });
  assert.deepEqual(mediaGrants(34, only(...BT, 'NEARBY_WIFI_DEVICES')), { ble: true, nearby: true });
  assert.deepEqual(mediaGrants(34, only('NEARBY_WIFI_DEVICES')), { ble: false, nearby: false }, 'Nearby também usa Bluetooth');
});

test('negar a localização não desliga o Bluetooth (Android 12)', () => {
  assert.deepEqual(mediaGrants(31, only(...BT)), { ble: true, nearby: false });
  assert.deepEqual(mediaGrants(32, only(...BT, 'ACCESS_FINE_LOCATION')), { ble: true, nearby: true });
  assert.deepEqual(mediaGrants(31, only('BLUETOOTH_SCAN', 'ACCESS_FINE_LOCATION')), { ble: false, nearby: false });
});

test('até o Android 11 o Bluetooth LE precisa da localização', () => {
  assert.deepEqual(mediaGrants(29, only('ACCESS_FINE_LOCATION')), { ble: true, nearby: true });
  assert.deepEqual(mediaGrants(29, only()), { ble: false, nearby: false });
});

test('o que pedir em cada versão', () => {
  assert.ok(transportPermissions(33).some(p => p.endsWith('NEARBY_WIFI_DEVICES')));
  assert.ok(!transportPermissions(33).some(p => p.endsWith('ACCESS_FINE_LOCATION')), 'Android 13+ não pede localização');
  assert.ok(transportPermissions(31).some(p => p.endsWith('ACCESS_FINE_LOCATION')));
  assert.deepEqual(transportPermissions(28), ['android.permission.ACCESS_FINE_LOCATION']);
});
