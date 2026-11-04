/**
 * "Enviar o Piu" (regra 6.1, primeiro passo): o próprio instalador do app vai de celular para celular
 * pelo compartilhamento do Android (Bluetooth, Quick Share), sem loja e sem internet. TypeScript puro,
 * testado no Node; quem compartilha de fato é o módulo nativo `piu-app-share`.
 */

/** `Piu-0.1.0.apk`: só letras, números, ponto e hífen (o nome não pode virar caminho). */
export function apkShareName(version: string): string {
  const v = version.trim().replace(/[^A-Za-z0-9.-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '');
  return v ? `Piu-${v}.apk` : 'Piu.apk';
}

/** No iPhone só a App Store instala; fora do build nativo (Expo Go) o módulo não existe. */
export const canSendApp = (os: string, hasModule: boolean) => os === 'android' && hasModule;

/** Aviso para cada falha do módulo nativo, sem jargão. */
export function appShareError(code: string): { title: string; body: string } {
  const title = 'Não foi possível enviar o Piu';
  if (code === 'ERR_SPLIT_APK') return { title, body: 'Este Piu veio de uma loja em partes e não dá para repassar o instalador. Peça para alguém que instalou pelo arquivo enviar para você.' };
  if (code === 'ERR_NO_SHARE_TARGET') return { title, body: 'Nenhum app para enviar arquivos foi encontrado. Ligue o Bluetooth ou o Quick Share e tente de novo.' };
  // Wi-Fi Direct (wifiShare.ts)
  if (code === 'ERR_WIFI_OFF') return { title, body: 'Ligue o Wi-Fi deste celular (não precisa estar conectado a nenhuma rede) e tente de novo.' };
  if (code === 'ERR_NO_PERMISSION') return { title, body: 'O Piu precisa da permissão de dispositivos por perto (ou localização, no Android 12 e antes) para abrir a rede. Permita nas configurações do app.' };
  if (code === 'ERR_P2P_BUSY') return { title, body: 'O Wi-Fi deste celular está ocupado com outra conexão direta. Tente de novo em alguns segundos ou envie por Bluetooth.' };
  if (code === 'ERR_P2P_UNSUPPORTED') return { title, body: 'Este celular não abre rede Wi-Fi Direct. Envie por Bluetooth.' };
  return { title, body: 'Tente de novo. Se continuar, reinicie o Piu.' };
}
