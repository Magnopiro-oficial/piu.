/**
 * QR e cartaz do ponto Piu (P6, P6c). Puro e testado (src/lib/__tests__/pointPoster.test.ts).
 *
 * - `qrMatrix`: módulos do QR com o texto em UTF-8 (o gerador sozinho corta cada caractere num byte, o que
 *   estraga nomes como "Piu · Praça" acima de U+00FF). Leitores (ZXing/câmera) reconhecem UTF-8 válido.
 * - `posterPdf`: cartaz A4 em PDF 1.4 só com texto ASCII (sem dependência nativa nova): QR em retângulos
 *   vetoriais, fontes padrão Helvetica (WinAnsi). Texto que a WinAnsi não cobre (japonês, árabe, hindi…)
 *   cai para a versão em inglês; caractere solto sem equivalente vira "?" — o QR continua exato.
 *   Compartilhado/impresso pela folha do sistema (lib/shareFile.ts).
 */
import qrcode from 'qrcode-generator';
import { tIn, type Key, type Vars } from '../i18n/core';
import { groupId, type PointConfig } from './pointCore';

/** Texto → "string binária" UTF-8 (um caractere por byte), o que o gerador espera no modo Byte. */
export const utf8Binary = (s: string) => Array.from(new TextEncoder().encode(s), b => String.fromCharCode(b)).join('');

export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(utf8Binary(text), 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/** Caminho SVG (um único `path`) dos módulos escuros, viewBox `0 0 n n`. */
export function qrPath(m: boolean[][]): string {
  let d = '';
  for (let r = 0; r < m.length; r++) for (let c = 0; c < m.length; c++) if (m[r]![c]) d += `M${c} ${r}h1v1h-1z`;
  return d;
}

// ── PDF ──────────────────────────────────────────────────

/** WinAnsi: Latin-1 (fora 0x80–0x9F) e as aspas/travessões da faixa 0x80–0x9F. */
const WIN_EXTRA: Record<number, number> = { 0x2019: 0x92, 0x2018: 0x91, 0x201c: 0x93, 0x201d: 0x94, 0x2014: 0x97, 0x2013: 0x96, 0x2026: 0x85, 0x20ac: 0x80, 0x2022: 0x95 };
const winCode = (cp: number): number | null => (cp >= 0x20 && cp < 0x7f) || (cp >= 0xa0 && cp <= 0xff) ? cp : WIN_EXTRA[cp] ?? null;
export const winAnsiOk = (s: string) => Array.from(s).every(ch => winCode(ch.codePointAt(0)!) !== null);

/** String PDF entre parênteses, só ASCII (octal para o resto). */
export function pdfString(s: string): string {
  let out = '(';
  for (const ch of Array.from(s)) {
    const code = winCode(ch.codePointAt(0)!) ?? 0x3f;
    if (code === 0x28 || code === 0x29 || code === 0x5c) out += '\\' + String.fromCharCode(code);
    else if (code >= 0x20 && code < 0x7f) out += String.fromCharCode(code);
    else out += '\\' + code.toString(8).padStart(3, '0');
  }
  return out + ')';
}

// Larguras AFM (1/1000 em) de 32 a 126.
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const HELV_B = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

/** Largura do texto em pontos (acentuados medidos pela letra base; Courier é 600). */
export function textWidth(s: string, size: number, font: 'F1' | 'F2' | 'F3'): number {
  if (font === 'F3') return Array.from(s).length * 0.6 * size;
  const tab = font === 'F2' ? HELV_B : HELV;
  let w = 0;
  for (const ch of Array.from(s.normalize('NFD').replace(/[̀-ͯ]/g, ''))) {
    const c = ch.codePointAt(0)!;
    w += c >= 32 && c <= 126 ? tab[c - 32]! : c === 0xb7 ? 278 : 556;
  }
  return (w * size) / 1000;
}

/** Quebra em linhas que cabem em `max` pontos. */
export function wrap(s: string, size: number, font: 'F1' | 'F2', max: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const word of s.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && textWidth(next, size, font) > max) { lines.push(cur); cur = word; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

export interface PosterText {
  /** "Aqui tem" / "ponto Piu" (duas linhas grandes). */
  title: [string, string];
  sub: string;
  name: string;
  /** "Wi-Fi · <rede>" (ou vazio). */
  network: string;
  /** "Ponto 0123 4567 89AB CDEF". */
  id: string;
  /** Rodapé ("Sem o Piu? Entre na rede e abra http://…/"); vazio = sem rodapé. */
  footer: string;
}

const A4 = { w: 595, h: 842 };

/** Cartaz A4 (PDF 1.4, ASCII puro). `qr` = texto do QR de Wi-Fi. */
export function posterPdf(qr: string, t: PosterText): string {
  const ops: string[] = [];
  const text = (s: string, size: number, font: 'F1' | 'F2' | 'F3', y: number, gray = 0) => {
    const x = (A4.w - textWidth(s, size, font)) / 2;
    ops.push(`${gray} g BT /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td ${pdfString(s)} Tj ET`);
  };
  // Marca: quadrado preto arredondado (aproximado por retângulo) com "P".
  ops.push('0 g 267.5 712 60 60 re f');
  ops.push(`1 g BT /F2 40 Tf ${(A4.w / 2 - textWidth('P', 40, 'F2') / 2).toFixed(2)} 727 Td (P) Tj ET`);
  text(t.title[0], 46, 'F2', 640);
  text(t.title[1], 46, 'F2', 590);
  let y = 552;
  for (const line of wrap(t.sub, 16, 'F1', 420)) { text(line, 16, 'F1', y, 0.37); y -= 21; }
  // QR: 300 pt, centralizado, com margem branca de 2 módulos.
  const m = qrMatrix(qr);
  const n = m.length, size = 300, cell = size / n, x0 = (A4.w - size) / 2, top = y - 18;
  ops.push('0 g');
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r]![c]) ops.push(`${(x0 + c * cell).toFixed(3)} ${(top - (r + 1) * cell).toFixed(3)} ${cell.toFixed(3)} ${cell.toFixed(3)} re`);
  ops.push('f');
  y = top - size - 40;
  text(t.name, 24, 'F2', y);
  if (t.network) { y -= 24; text(t.network, 13, 'F3', y, 0.37); }
  y -= 20; text(t.id, 11, 'F3', y, 0.37);
  if (t.footer) for (const line of wrap(t.footer, 12, 'F1', 460)) { y -= 26; text(line, 12, 'F1', y, 0.37); }
  const content = ops.join('\n');

  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >> >> /Contents 7 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}

/** Texto do cartaz no idioma do app; sem cobertura nas fontes padrão do PDF, em inglês (o QR continua exato). */
type Tr = (k: Key, v?: Vars) => string;

export function posterText(cfg: PointConfig, pageUrl: string | null, t: Tr): PosterText {
  const build = (tr: Tr): PosterText => ({
    title: [tr('point.poster.t1'), tr('point.poster.t2')],
    sub: tr('point.poster.sub'),
    name: cfg.name,
    network: cfg.network.ssid ? tr('point.qr.wifi', { ssid: cfg.network.ssid }) : '',
    id: tr('point.poster.id', { id: groupId(cfg.id) }),
    footer: pageUrl ? tr('point.poster.noApp', { url: pageUrl }) : '',
  });
  const local = build(t);
  const fits = [local.title[0], local.title[1], local.sub, local.footer, local.id].every(winAnsiOk);
  return fits ? local : build((k, v) => tIn('en', k, v));
}

