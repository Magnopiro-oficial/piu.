/**
 * Permissões de vizinhança no Android → quais meios podem ligar (puro, testado em __tests__/grants.test.ts).
 * Cada meio vale com as PRÓPRIAS permissões: negar o Wi-Fi (ou a localização) não pode desligar o Bluetooth.
 * - Bluetooth LE: Android 12+ só as de Bluetooth (BLUETOOTH_SCAN com `neverForLocation`); até o 11, localização.
 * - Wi-Fi Direct (Nearby Connections): as de Bluetooth mais "dispositivos Wi-Fi por perto" (13+) ou localização (≤12).
 */
export type MediaGrants = { ble: boolean; nearby: boolean };

const P = {
  scan: 'android.permission.BLUETOOTH_SCAN',
  advertise: 'android.permission.BLUETOOTH_ADVERTISE',
  connect: 'android.permission.BLUETOOTH_CONNECT',
  wifi: 'android.permission.NEARBY_WIFI_DEVICES',
  location: 'android.permission.ACCESS_FINE_LOCATION',
} as const;
export type TransportPermission = (typeof P)[keyof typeof P];

/** O que pedir nesta versão do Android (tudo de uma vez; cada uma pode ser negada à parte). */
export function transportPermissions(api: number): TransportPermission[] {
  if (api >= 33) return [P.scan, P.advertise, P.connect, P.wifi];
  if (api >= 31) return [P.scan, P.advertise, P.connect, P.location];
  return [P.location];
}

export function mediaGrants(api: number, granted: (p: TransportPermission) => boolean): MediaGrants {
  if (api < 31) { const loc = granted(P.location); return { ble: loc, nearby: loc }; }
  const bt = granted(P.scan) && granted(P.advertise) && granted(P.connect);
  return { ble: bt, nearby: bt && granted(api >= 33 ? P.wifi : P.location) };
}
