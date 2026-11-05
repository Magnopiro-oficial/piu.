/**
 * "Enviar o Piu" (regra 6.1, primeiro passo): o próprio instalador do app vai de celular para celular
 * pelo compartilhamento do Android (Bluetooth, Quick Share), sem loja e sem internet. TypeScript puro,
 * testado no Node; quem compartilha de fato é o módulo nativo `piu-app-share`.
 */

import { t as tGlobal, type Key, type Vars } from '../i18n/core';
/** Tradutor opcional (padrão: idioma em uso no app; pt-BR nos testes). */
type Tr = (key: Key, vars?: Vars) => string;

/** `Piu-0.1.0.apk`: só letras, números, ponto e hífen (o nome não pode virar caminho). */
export function apkShareName(version: string): string {
  const v = version.trim().replace(/[^A-Za-z0-9.-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '');
  return v ? `Piu-${v}.apk` : 'Piu.apk';
}

/** No iPhone só a App Store instala; fora do build nativo (Expo Go) o módulo não existe. */
export const canSendApp = (os: string, hasModule: boolean) => os === 'android' && hasModule;

/** Aviso para cada falha do módulo nativo, sem jargão. */
export function appShareError(code: string, t: Tr = tGlobal): { title: string; body: string } {
  const title = t('appShare.fail');
  const known = ['ERR_SPLIT_APK', 'ERR_NO_SHARE_TARGET', 'ERR_WIFI_OFF', 'ERR_NO_PERMISSION', 'ERR_P2P_BUSY', 'ERR_P2P_UNSUPPORTED'];
  // Wi-Fi Direct (wifiShare.ts) usa os códigos ERR_WIFI_OFF em diante.
  return { title, body: t((known.includes(code) ? `appShare.${code}` : 'appShare.other') as Key) };
}
