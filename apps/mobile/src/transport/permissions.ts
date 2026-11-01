import { PermissionsAndroid, Platform, type Permission } from 'react-native';

/**
 * Permissões de tempo de execução para descobrir e conectar vizinhos.
 * Android 13+: Bluetooth (procurar, anunciar, conectar) e dispositivos Wi-Fi por perto.
 * Android 12: Bluetooth + localização precisa. Até o 11: localização precisa.
 * iPhone: o sistema pergunta sozinho ao ligar o Bluetooth (texto em app.json → NSBluetoothAlwaysUsageDescription).
 */
export async function requestTransportPermissions(): Promise<'granted' | 'denied'> {
  if (Platform.OS !== 'android') return 'granted';
  const v = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
  const P = PermissionsAndroid.PERMISSIONS;
  const list: Permission[] = v >= 33
    ? [P.BLUETOOTH_SCAN, P.BLUETOOTH_ADVERTISE, P.BLUETOOTH_CONNECT, P.NEARBY_WIFI_DEVICES]
    : v >= 31
      ? [P.BLUETOOTH_SCAN, P.BLUETOOTH_ADVERTISE, P.BLUETOOTH_CONNECT, P.ACCESS_FINE_LOCATION]
      : [P.ACCESS_FINE_LOCATION];
  const res = await PermissionsAndroid.requestMultiple(list);
  return list.every(p => res[p] === PermissionsAndroid.RESULTS.GRANTED) ? 'granted' : 'denied';
}
