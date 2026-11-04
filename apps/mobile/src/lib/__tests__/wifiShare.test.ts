import assert from 'node:assert/strict';
import { test } from 'node:test';
import { downloadPageHtml, SHARE_WINDOW_MS, shareTimeLeft, wifiPageUrl, wifiQr } from '../wifiShare';

test('QR do Wi-Fi no formato que a câmera do Android entende, com escape', () => {
  assert.equal(wifiQr('DIRECT-Pi-7F3A', 'abcd1234'), 'WIFI:T:WPA;S:DIRECT-Pi-7F3A;P:abcd1234;;');
  assert.equal(wifiQr('a;b', 'p:"x\\,'), 'WIFI:T:WPA;S:a\\;b;P:p\\:\\"x\\\\\\,;;');
});

test('endereço da página local: só IPv4 e porta válidos', () => {
  assert.equal(wifiPageUrl('192.168.49.1', 8765), 'http://192.168.49.1:8765/');
  assert.throws(() => wifiPageUrl('evil.com', 80));
  assert.throws(() => wifiPageUrl('192.168.49.1', 70000));
});

test('a rede fica aberta 10 minutos e a contagem não fica negativa', () => {
  assert.equal(SHARE_WINDOW_MS, 10 * 60 * 1000);
  assert.equal(shareTimeLeft(0, 0), '10:00');
  assert.equal(shareTimeLeft(0, 61_500), '8:59', 'arredonda para cima: 538,5 s');
  assert.equal(shareTimeLeft(0, SHARE_WINDOW_MS + 5000), '0:00');
});

test('página de download: botão para o arquivo, tamanho, aviso de instalação e nada injetável', () => {
  const html = downloadPageHtml('Piu-0.1.0.apk', 73_790_422);
  assert.match(html, /<a [^>]*href="\/Piu-0\.1\.0\.apk"[^>]*download/);
  assert.match(html, /70,4 MB/);
  assert.match(html, /permitir/i, 'avisa que o Android pede para permitir a instalação');
  assert.match(html, /<meta charset="utf-8">/);
  const evil = downloadPageHtml('<script>x</script>.apk', 1);
  assert.ok(!evil.includes('<script>'), 'nome escapado');
});
