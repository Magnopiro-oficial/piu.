/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ANON_ICONS, anonChoices, anonColors, oklchHex, sameAnon } from '../avatarCore';
import { isJpegBase64 } from '../../messaging/photo';

test('imagem anônima: mesmo sorteio do design, 11 ícones distintos, cores por matiz', () => {
  const a = anonChoices(1), b = anonChoices(1), c = anonChoices(2);
  assert.deepEqual(a, b, 'a mesma rodada dá as mesmas opções');
  assert.notDeepEqual(a, c, '"Sortear outras" muda as opções');
  assert.equal(a.length, 11);
  assert.equal(new Set(a.map(x => x.icon)).size, 11);
  for (const x of a) { assert.ok(ANON_ICONS.includes(x.icon)); assert.ok(x.hue % 30 === 0 && x.hue >= 0 && x.hue < 360); }
  // Referência: o algoritmo do design (PiuApp.dc.html) com a semente 1.
  let sx = (1 * 7919) % 233280; const rnd = () => (sx = (sx * 9301 + 49297) % 233280) / 233280;
  const pool = ANON_ICONS.slice(); for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j]!, pool[i]!]; }
  assert.deepEqual(a, pool.slice(0, 11).map(icon => ({ icon, hue: Math.floor(rnd() * 12) * 30 })));
  assert.ok(sameAnon(null, undefined) && sameAnon(a[0], { ...a[0]! }) && !sameAnon(a[0], a[1]));
});

test('oklch → hex: branco, preto, vermelho de referência e as cores do design', () => {
  assert.equal(oklchHex(1, 0, 0), '#ffffff');
  assert.equal(oklchHex(0, 0, 0), '#000000');
  assert.equal(oklchHex(0.62796, 0.25768, 29.234), '#ff0000');
  const { bg, fg } = anonColors({ icon: 'pets', hue: 210 });
  assert.match(bg, /^#[0-9a-f]{6}$/); assert.match(fg, /^#[0-9a-f]{6}$/);
  assert.ok(parseInt(bg.slice(1, 3), 16) > parseInt(fg.slice(1, 3), 16), 'fundo claro, desenho escuro');
});

test('foto de contato: só JPEG em base64, com limite de tamanho', () => {
  assert.ok(isJpegBase64('/9j/4AAQSkZJRgABAQ=='));
  assert.ok(!isJpegBase64('iVBORw0KGgo='), 'PNG não');
  assert.ok(!isJpegBase64('/9j/<script>'), 'caracteres fora do base64');
  assert.ok(!isJpegBase64('/9j/' + 'A'.repeat(30_000)), 'grande demais');
  assert.ok(!isJpegBase64(42));
});
