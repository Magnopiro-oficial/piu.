/// <reference types="node" />
/** Ponto Piu: QR em UTF-8, cartaz PDF (P6c) e página local do app (P9). */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pointPageBindOk, pointPageHtml, pointPageUrl, POINT_PAGE_PORT } from '../pointPage';
import { pdfString, posterPdf, posterText, qrMatrix, textWidth, utf8Binary, winAnsiOk, wrap } from '../pointPoster';
import { tIn } from '../../i18n/core';
import '../../i18n';
import type { PointConfig } from '../pointCore';

test('QR em UTF-8: "·" e "é" viram os bytes UTF-8 (o gerador cortaria cada caractere num byte)', () => {
  assert.equal(utf8Binary('Piu · Zé'), 'Piu \xc2\xb7 Z\xc3\xa9');
  const m = qrMatrix('WIFI:T:nopass;S:Piu · Praça;;');
  assert.ok(m.length >= 21 && m.every(r => r.length === m.length));
  assert.notDeepEqual(qrMatrix('WIFI:T:nopass;S:a;;'), m);
});

test('PDF: ASCII puro, xref com deslocamentos exatos, texto WinAnsi com octal', () => {
  assert.equal(pdfString('Zé (1) \\'), '(Z\\351 \\(1\\) \\\\)');
  assert.equal(pdfString('Piu · x'), '(Piu \\267 x)');
  assert.equal(pdfString('日本'), '(??)');
  assert.ok(winAnsiOk('Padaria do Zé — “oi”') && !winAnsiOk('ポイント'));
  const pdf = posterPdf('WIFI:T:WPA;S:Casa;P:segredo12;;', { title: ['Aqui tem', 'ponto Piu'], sub: 'Mensagens sem internet.', name: 'Piu · Padaria do Zé', network: 'Wi-Fi · Casa', id: 'Ponto 0123 4567', footer: '' });
  assert.ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(pdf), 'só ASCII (vai por arquivo de texto)');
  assert.ok(pdf.startsWith('%PDF-1.4') && pdf.endsWith('%%EOF\n'));
  const xref = Number(pdf.match(/startxref\n(\d+)/)![1]);
  assert.ok(pdf.slice(xref).startsWith('xref'));
  const offs = [...pdf.slice(xref).matchAll(/(\d{10}) 00000 n/g)].map(m => Number(m[1]));
  offs.forEach((o, i) => assert.ok(pdf.slice(o).startsWith(`${i + 1} 0 obj`), `objeto ${i + 1}`));
  const len = Number(pdf.match(/\/Length (\d+)/)![1]);
  const start = pdf.indexOf('stream\n') + 7;
  assert.equal(pdf.slice(start + len, start + len + 10), '\nendstream');
  assert.match(pdf, /Padaria do Z\\351/);
});

test('medida e quebra de linha do cartaz', () => {
  assert.equal(textWidth('ii', 10, 'F1'), 4.44);
  assert.ok(textWidth('Zé', 10, 'F2') === textWidth('Ze', 10, 'F2'));
  for (const l of wrap('Mensagens sem internet. Aponte a câmera para entrar.', 16, 'F1', 200)) assert.ok(textWidth(l, 16, 'F1') <= 200);
});

const cfg: PointConfig = { v: 1, id: '0123456789abcdef', name: 'Piu · Padaria', level: 'guardianApp', spaceMb: 1024, days: 7, createdAt: 0, paused: false,
  network: { kind: 'wifi', ssid: 'Casa-Visitantes', security: 'WPA', password: null, separated: true } };

test('texto do cartaz: idioma do app; sem cobertura no PDF (japonês), inglês; rodapé só com a página do app', () => {
  const pt = posterText(cfg, 'http://192.168.0.5:8766/', (k, v) => tIn('pt-BR', k, v));
  assert.deepEqual(pt.title, ['Aqui tem', 'ponto Piu']);
  assert.match(pt.footer, /192\.168\.0\.5:8766/);
  assert.equal(pt.id, 'Ponto 0123 4567 89AB CDEF');
  const ja = posterText(cfg, null, (k, v) => tIn('ja', k, v));
  assert.equal(ja.title[1], tIn('en', 'point.poster.t2'));
  assert.equal(ja.footer, '');
});

test('P9: página do ponto sem script, nome escapado, SHA-256 inteiros; sem hash não inventa valores', () => {
  const integrity = { apkSha256: 'a'.repeat(64), certSha256: ['b'.repeat(64)] };
  const h = pointPageHtml({ pointName: 'Piu · <Zé>', fileName: 'Piu-0.5.0.apk', size: 38 * 1024 * 1024, integrity });
  assert.ok(!/<script/i.test(h));
  assert.match(h, /href="\/Piu-0\.5\.0\.apk" download/);
  assert.match(h, /&lt;Zé&gt;/);
  assert.match(h, /AAAA AAAA/);
  assert.match(h, /BBBB BBBB/);
  assert.match(h, /38,0 MB/);
  const none = pointPageHtml({ pointName: 'x', fileName: 'Piu.apk', size: 1, integrity: null });
  assert.ok(!/SHA-256 do arquivo/.test(none));
  assert.match(none, /Não deu para calcular/);
  assert.equal(pointPageUrl('192.168.43.1'), `http://192.168.43.1:${POINT_PAGE_PORT}/`);
  assert.throws(() => pointPageUrl('piu.local'));
  assert.throws(() => pointPageUrl('10.0.0.1', 80), 'porta privilegiada não');
});

test('página do ponto: só abre em IPv4 privado da rede do ponto (nunca em todas as interfaces, loopback ou IP público)', () => {
  for (const ok of ['192.168.43.1', '192.168.1.20', '10.0.0.5', '172.16.4.2', '172.31.255.254']) assert.ok(pointPageBindOk(ok), ok);
  for (const bad of ['0.0.0.0', '127.0.0.1', '8.8.8.8', '100.64.0.1', '169.254.1.1', '255.255.255.255', '::', 'fe80::1', 'piu.local', '', ' 192.168.1.2', '192.168.1.2:80', '192.168.001.2', 42, null])
    assert.ok(!pointPageBindOk(bad), String(bad));
});
