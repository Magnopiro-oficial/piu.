import { Linking, PermissionsAndroid, Platform, type Permission } from 'react-native';
import { type MediaGrants, mediaGrants, transportPermissions } from './grants';

/**
 * Permissões de tempo de execução para descobrir e conectar vizinhos, por meio (transport/grants.ts):
 * Android 13+: Bluetooth (procurar, anunciar, conectar) e dispositivos Wi-Fi por perto.
 * Android 12: Bluetooth + localização precisa (só para o Wi-Fi Direct). Até o 11: localização precisa.
 * Negar a parte do Wi-Fi deixa o Bluetooth ligado.
 * iPhone: o sistema pergunta sozinho ao ligar o Bluetooth (texto em app.json → NSBluetoothAlwaysUsageDescription).
 */
export async function requestTransportPermissions(): Promise<MediaGrants> {
  if (Platform.OS !== 'android') return { ble: true, nearby: true };
  const v = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
  const list = transportPermissions(v) as Permission[];
  const res = await PermissionsAndroid.requestMultiple(list);
  return mediaGrants(v, p => res[p as Permission] === PermissionsAndroid.RESULTS.GRANTED);
}

/**
 * Sem pedir nada: só o que já foi concedido. Para o núcleo ligar sem tela (core/index.ts), quando não
 * há Activity para mostrar o pedido.
 */
export async function checkTransportPermissions(): Promise<MediaGrants> {
  if (Platform.OS !== 'android') return { ble: true, nearby: true };
  const v = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
  const list = transportPermissions(v) as Permission[];
  const ok = await Promise.all(list.map(p => PermissionsAndroid.check(p).catch(() => false)));
  return mediaGrants(v, p => ok[list.indexOf(p as Permission)] === true);
}

/**
 * Pedido de novo (aba Rede, linha sem permissão). Se o Android não mostra mais o pedido ("não perguntar
 * de novo"), abre os ajustes do app para a pessoa liberar lá.
 */
export async function askTransportPermissionsAgain(): Promise<MediaGrants> {
  if (Platform.OS !== 'android') return { ble: true, nearby: true };
  const v = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
  const list = transportPermissions(v) as Permission[];
  const res = await PermissionsAndroid.requestMultiple(list);
  const g = mediaGrants(v, p => res[p as Permission] === PermissionsAndroid.RESULTS.GRANTED);
  if ((!g.ble || !g.nearby) && list.some(p => res[p] === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN)) await Linking.openSettings().catch(() => {});
  return g;
}

/**
 * Abrir a rede Wi-Fi Direct do "Enviar o Piu": dispositivos Wi-Fi por perto no Android 13+,
 * localização precisa até o 12 (o Android exige para criar o grupo).
 */
export async function requestWifiDirectPermission(): Promise<'granted' | 'denied'> {
  if (Platform.OS !== 'android') return 'denied';
  const v = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
  const p = v >= 33 ? PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES : PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
  if (await PermissionsAndroid.check(p)) return 'granted';
  return (await PermissionsAndroid.request(p)) === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied';
}

/**
 * Android 13+: permissão para mostrar o aviso fixo do Modo nó em segundo plano (NFR-009).
 * Negar não impede o serviço; o aviso só deixa de aparecer na gaveta de notificações.
 */
export async function requestRelayNotificationPermission(): Promise<'granted' | 'denied'> {
  if (Platform.OS !== 'android') return 'granted';
  const v = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
  if (v < 33) return 'granted';
  const p = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  if (await PermissionsAndroid.check(p)) return 'granted';
  return (await PermissionsAndroid.request(p)) === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied';
}
