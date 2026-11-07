/**
 * Página local do ponto (P9): variação da página do "Enviar o Piu" por Wi-Fi Direct (lib/wifiShare.ts),
 * servida pelo guardião com distribuição do app na rede do ponto, sem internet. Sem script, sem recurso de
 * fora (o servidor manda `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'`).
 * Pura e testada (src/lib/__tests__/pointPoster.test.ts).
 */
import { fmtNumber, tIn, type Key, type Lang, type Vars } from '../i18n/core';
import { groupHex, type ApkIntegrity } from './apkIntegrity';

/** Porta da página do ponto (a do Wi-Fi Direct é 8765; as duas podem rodar juntas, cada uma no seu IP). */
export const POINT_PAGE_PORT = 8766;

const html = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Onde a página pode abrir: só um IPv4 privado (RFC 1918) escrito na forma canônica — o IP do hotspot ou
 * da rede do ponto. Nunca `0.0.0.0` (todas as interfaces, inclusive dados móveis), loopback, link-local ou
 * IP público. O módulo nativo confere de novo antes do `bind`.
 */
export function pointPageBindOk(ip: unknown): ip is string {
  if (typeof ip !== 'string' || !/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(ip)) return false;
  const [a, b, c, d] = ip.split('.').map(Number) as [number, number, number, number];
  if ([a, b, c, d].some(n => n > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** Endereço da página: só IPv4 da rede do ponto. */
export function pointPageUrl(ip: string, port = POINT_PAGE_PORT): string {
  if (!/^(\d{1,3})(\.\d{1,3}){3}$/.test(ip) || ip.split('.').some(n => Number(n) > 255)) throw new Error('IP inválido');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('porta inválida');
  return `http://${ip}:${port}/`;
}

const CSS = 'body{font-family:system-ui,sans-serif;margin:0;padding:28px 24px 36px;background:#fff;color:#0c0c0c;line-height:1.45}'
  + '.hd{text-align:center;padding-top:10px}.logo{width:72px;height:72px;border-radius:20px;background:#0c0c0c;color:#fff;font-weight:700;font-size:26px;line-height:72px;margin:0 auto 14px}'
  + 'h1{font-size:28px;font-weight:700;letter-spacing:-.045em;line-height:1.05;margin:0 0 14px}p{color:#5f5f5c;font-size:14px;margin:0}'
  + 'a.b{display:block;margin:18px 0 8px;height:54px;line-height:54px;border-radius:27px;background:#0c0c0c;color:#fff;text-align:center;font-weight:600;font-size:16px;text-decoration:none}'
  + '.f{display:block;text-align:center;font-family:ui-monospace,monospace;font-size:12px;color:#5f5f5c}'
  + '.c{margin-top:18px;padding:16px;border-radius:20px;background:#f3f3f1}.k{font-family:ui-monospace,monospace;font-size:12px;color:#5f5f5c;letter-spacing:.04em;text-transform:uppercase;margin:0 0 10px}'
  + '.l{font-size:12.5px;color:#5f5f5c;margin:0 0 4px}.h{font-family:ui-monospace,monospace;font-size:12px;line-height:1.5;overflow-wrap:anywhere;margin:0 0 10px;color:#0c0c0c}'
  + '.s{border-top:1px solid rgba(0,0,0,.07);padding-top:10px}.n{margin-top:18px;font-size:13px}';

/**
 * Página do ponto. `integrity` (SHA-256 do arquivo e do certificado) vem do módulo nativo; sem ela, a
 * página não inventa valores: diz que não deu para calcular e pede para conferir com quem tem o Piu.
 */
export function pointPageHtml(o: { pointName: string; fileName: string; size: number; lang?: Lang; integrity: ApkIntegrity | null }): string {
  const lang = o.lang ?? 'pt-BR';
  const t = (k: Key, vars?: Vars) => html(tIn(lang, k, vars));
  const f = html(o.fileName);
  const mb = fmtNumber(Math.round((o.size / 1024 / 1024) * 10) / 10, { minimumFractionDigits: 1, maximumFractionDigits: 1 }, lang, 'auto');
  const i = o.integrity;
  const check = i
    ? `<div class="c"><p class="k">${t('pointPage.check')}</p><p class="l">${t('pointPage.apk')}</p><p class="h">${html(groupHex(i.apkSha256))}</p>`
      + `<div class="s"><p class="l">${t('pointPage.cert')}</p>${i.certSha256.map(c => `<p class="h">${html(groupHex(c))}</p>`).join('')}</div></div>`
      + `<p class="n">${t('pointPage.compare')}</p>`
    : `<p class="n">${t('pointPage.noHash')}</p>`;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t('pointPage.title')}</title><style>${CSS}</style></head>`
    + `<body><div class="hd"><div class="logo">piu.</div><h1>${t('pointPage.h1')}</h1><p>${t('pointPage.intro', { name: o.pointName })}</p></div>`
    + `<a class="b" href="/${f}" download="${f}">${t('pointPage.download')}</a><span class="f">${f} · ${html(mb)} MB</span>`
    + `<p class="n">${t('pointPage.install')}</p>${check}</body></html>`;
}
