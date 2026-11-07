/// <reference types="node" />
/**
 * B-03 (auditoria 2026-11-06): quem recebe o Piu de outro celular confere o SHA-256 do arquivo e do
 * certificado de assinatura com o site. O cálculo é nativo (piu-app-share, Kotlin); aqui, formato e textos.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import '../../i18n'; // registra os 11 idiomas (a página sai no idioma de quem envia)
import { certStatus, groupHex, normalizeIntegrity, OFFICIAL_CERT_SHA256, shortHex } from '../apkIntegrity';
import { downloadPageHtml } from '../wifiShare';

const CERT = '595bdc6a2d574fec59f0f781eb9d8d479a84f4907d70405f83b4b1e578b7ff31';
const APK = '6e21b8e977821f15effc4d449ce7e13186b8591c8fff1d0c183a22a302340c25';

test('certificado oficial é o mesmo publicado no site (apps/site/src/lib/androidRelease.ts)', () => {
  const site = readFileSync(new URL('../../../../site/src/lib/androidRelease.ts', import.meta.url), 'utf8');
  const m = site.match(/ANDROID_CERT_SHA256 = '([0-9a-f]{64})'/);
  assert.ok(m, 'constante do site encontrada');
  assert.equal(OFFICIAL_CERT_SHA256, m![1]);
});

test('hash: inteiro em grupos de 4 e curto para a tela', () => {
  assert.equal(groupHex(CERT), '595B DC6A 2D57 4FEC 59F0 F781 EB9D 8D47 9A84 F490 7D70 405F 83B4 B1E5 78B7 FF31');
  assert.equal(shortHex(CERT), '595B DC6A … 78B7 FF31', 'mesmo formato do achado/site');
});

test('valores do módulo nativo: só SHA-256 válido passa; vários assinantes ficam "outro"', () => {
  assert.deepEqual(normalizeIntegrity({ apkSha256: APK.toUpperCase(), certSha256: [CERT] }), { apkSha256: APK, certSha256: [CERT] });
  assert.equal(normalizeIntegrity({ apkSha256: 'xyz', certSha256: [CERT] }), null);
  assert.equal(normalizeIntegrity({ apkSha256: APK, certSha256: [] }), null);
  assert.equal(normalizeIntegrity(null), null);
  assert.equal(normalizeIntegrity({ apkSha256: APK, certSha256: ['<b>'] }), null);
  assert.equal(certStatus([CERT]), 'official');
  assert.equal(certStatus(['a'.repeat(64)]), 'other', 'build de teste (chave de debug) ou alterado');
  assert.equal(certStatus([CERT, 'a'.repeat(64)]), 'other');
});

test('página de download mostra os dois SHA-256 inteiros e manda comparar com o site', () => {
  const html = downloadPageHtml('Piu-0.1.0.apk', 73_790_422, 'pt-BR', { apkSha256: APK, certSha256: [CERT] });
  assert.ok(html.includes(groupHex(APK)), 'SHA-256 do arquivo inteiro');
  assert.ok(html.includes(groupHex(CERT)), 'certificado inteiro');
  assert.match(html, /site/i);
  assert.match(html, /não instale/i);
  assert.ok(!/<script/i.test(html), 'sem script (CSP default-src none)');
  // O resto da página continua igual.
  assert.match(html, /<a [^>]*href="\/Piu-0\.1\.0\.apk"[^>]*download/);
  const en = downloadPageHtml('Piu-0.1.0.apk', 1, 'en', { apkSha256: APK, certSha256: [CERT] });
  assert.match(en, /website/i);
});

test('sem os valores (módulo antigo ou falha no cálculo), a página fica como antes', () => {
  const before = downloadPageHtml('Piu-0.1.0.apk', 73_790_422, 'pt-BR');
  assert.equal(downloadPageHtml('Piu-0.1.0.apk', 73_790_422, 'pt-BR', null), before);
  assert.ok(!before.includes('SHA-256'));
});
