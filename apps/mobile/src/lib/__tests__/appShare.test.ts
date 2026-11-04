import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apkShareName, appShareError, canSendApp } from '../appShare';

test('o instalador vai com um nome que diz o que é e a versão', () => {
  assert.equal(apkShareName('0.1.0'), 'Piu-0.1.0.apk');
  assert.equal(apkShareName(' 1.2.3-beta+5 '), 'Piu-1.2.3-beta-5.apk', 'só letras, números, ponto e hífen');
  assert.equal(apkShareName(''), 'Piu.apk');
  assert.equal(apkShareName('../../x'), 'Piu-x.apk', 'nada de caminho no nome');
});

test('enviar o app só existe no Android com o módulo nativo', () => {
  assert.equal(canSendApp('android', true), true);
  assert.equal(canSendApp('android', false), false, 'Expo Go ou build sem o módulo');
  assert.equal(canSendApp('ios', true), false, 'no iPhone só a App Store instala');
  assert.equal(canSendApp('web', true), false);
});

test('cada falha do envio vira um aviso que a pessoa entende', () => {
  const split = appShareError('ERR_SPLIT_APK');
  assert.match(split.body, /loja/);
  const none = appShareError('ERR_NO_SHARE_TARGET');
  assert.match(none.body, /Bluetooth/);
  const other = appShareError('qualquer outra coisa');
  assert.equal(other.title, 'Não foi possível enviar o Piu');
  const wifi = appShareError('ERR_WIFI_OFF');
  assert.match(wifi.body, /Wi-Fi/);
  const perm = appShareError('ERR_NO_PERMISSION');
  assert.match(perm.body, /permiss/i);
  const busy = appShareError('ERR_P2P_BUSY');
  assert.match(busy.body, /Bluetooth/, 'sugere o outro caminho');
  const unsupported = appShareError('ERR_P2P_UNSUPPORTED');
  assert.match(unsupported.body, /Bluetooth/);
  for (const e of [split, none, other, wifi, perm, busy, unsupported]) assert.ok(!/ERR_|apk|intent|p2p/i.test(e.body), 'sem jargão no aviso');
});
