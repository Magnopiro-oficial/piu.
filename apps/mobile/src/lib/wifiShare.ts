/**
 * "Enviar o Piu" por Wi-Fi Direct (regra 6.1): este celular abre uma rede Wi-Fi Direct com senha e
 * serve o instalador numa página local por 10 minutos. O outro celular entra na rede pelo QR e baixa
 * pela página. TypeScript puro, testado no Node; a rede e o servidor são do módulo `piu-app-share`.
 */
import { fmtNumber, tIn, type Key, type Lang, type Vars } from '../i18n/core';

/** A rede fica aberta por 10 min (design: "Rede Piu-7F3A aberta por 10 min"). */
export const SHARE_WINDOW_MS = 10 * 60 * 1000;
export const SHARE_PORT = 8765;

const esc = (s: string) => s.replace(/([\\;,:"])/g, '\\$1');

/** QR que a câmera do Android e do iPhone usam para entrar na rede (formato `WIFI:`). */
export const wifiQr = (ssid: string, passphrase: string) => `WIFI:T:WPA;S:${esc(ssid)};P:${esc(passphrase)};;`;

/** Página local do instalador. Só IPv4 da rede Wi-Fi Direct; nada de nome que leve para fora. */
export function wifiPageUrl(ip: string, port: number): string {
  if (!/^(\d{1,3})(\.\d{1,3}){3}$/.test(ip) || ip.split('.').some(n => Number(n) > 255)) throw new Error('IP inválido');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('porta inválida');
  return `http://${ip}:${port}/`;
}

/** "9:58": quanto falta para a rede fechar. */
export function shareTimeLeft(startedAt: number, now: number): string {
  const s = Math.max(0, Math.ceil((SHARE_WINDOW_MS - (now - startedAt)) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const html = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Página servida pelo celular de quem convida: um botão para o arquivo, sem script nem recurso de fora. */
export function downloadPageHtml(fileName: string, size: number, lang: Lang = 'pt-BR'): string {
  const t = (k: Key, vars?: Vars) => html(tIn(lang, k, vars));
  const f = html(fileName);
  const mb = fmtNumber(Math.round((size / 1024 / 1024) * 10) / 10, { minimumFractionDigits: 1, maximumFractionDigits: 1 }, lang, 'auto');
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t('wifiPage.title')}</title>
<style>body{font-family:system-ui,sans-serif;margin:0;padding:32px 20px;background:#111;color:#f4f4f4;line-height:1.45}h1{font-size:30px;margin:0 0 8px}p{color:#bbb}a{display:block;margin:24px 0;padding:16px;border-radius:28px;background:#f4f4f4;color:#111;text-align:center;font-weight:600;font-size:17px;text-decoration:none}</style></head>
<body><h1>piu.</h1><p>${t('wifiPage.intro')}</p>
<a href="/${f}" download="${f}">${t('wifiPage.download', { mb })}</a>
<p>${t('wifiPage.install')}</p>
<p>${t('wifiPage.then')}</p></body></html>`;
}
