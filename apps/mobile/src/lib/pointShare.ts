/**
 * Cartaz do ponto (P6/P6c) como PDF pela folha do sistema (lib/shareFile.ts: imprimir, salvar, mandar).
 * O PDF é ASCII puro (lib/pointPoster.ts). Idioma sem cobertura nas fontes padrão do PDF (japonês, árabe,
 * hindi, chinês): o texto do cartaz vai em inglês; o QR continua exato.
 */
import type { Key, Vars } from '../i18n/core';
import type { PointConfig } from './pointCore';
import { posterPdf, posterText } from './pointPoster';
import { shareTextFile } from './shareFile';

export async function sharePoster(cfg: PointConfig, qr: string | null, pageUrl: string | null, t: (k: Key, v?: Vars) => string) {
  if (!qr) throw new Error('Sem QR.');
  const pdf = posterPdf(qr, posterText(cfg, pageUrl, t));
  const file = `piu-ponto-${cfg.id.slice(0, 8)}.pdf`;
  return shareTextFile(file, pdf, { mimeType: 'application/pdf', dialogTitle: t('point.qr.shareTitle') });
}
