/**
 * "Enviar o Piu" por Wi-Fi Direct (regra 6.1): este celular abre uma rede Wi-Fi Direct com senha e
 * serve o instalador numa página local por 10 minutos. O outro celular entra na rede pelo QR e baixa
 * pela página. TypeScript puro, testado no Node; a rede e o servidor são do módulo `piu-app-share`.
 */

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
export function downloadPageHtml(fileName: string, size: number): string {
  const f = html(fileName);
  const mb = (size / 1024 / 1024).toFixed(1).replace('.', ',');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Baixar o Piu</title>
<style>body{font-family:system-ui,sans-serif;margin:0;padding:32px 20px;background:#111;color:#f4f4f4;line-height:1.45}h1{font-size:30px;margin:0 0 8px}p{color:#bbb}a{display:block;margin:24px 0;padding:16px;border-radius:28px;background:#f4f4f4;color:#111;text-align:center;font-weight:600;font-size:17px;text-decoration:none}</style></head>
<body><h1>piu.</h1><p>Instalador enviado de um celular por perto, sem internet.</p>
<a href="/${f}" download="${f}">Baixar o Piu (${mb} MB)</a>
<p>Depois de baixar, abra o arquivo. O Android vai pedir para permitir a instalação deste app: toque em Configurações e permita. Em seguida, volte e instale.</p>
<p>Ao abrir o Piu, escaneie o código de convite no celular de quem enviou.</p></body></html>`;
}
