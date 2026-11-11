/** Foto em qualidade Original sem metadados (EXIF/GPS) e com nome neutro (auditoria 2026-11-09). */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isJpeg, photoName, stripJpegMetadata } from '../photoMeta';

const seg = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];
const ascii = (s: string) => Array.from(s, c => c.charCodeAt(0));
/** APP1 Exif little-endian com Orientation e um campo de GPS (texto "GPS-SEGREDO" no meio). */
function exif(orientation: number) {
  const tiff = [
    ...ascii('II'), 0x2a, 0, 8, 0, 0, 0,
    2, 0,
    0x12, 0x01, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0,
    0x25, 0x88, 4, 0, 1, 0, 0, 0, 38, 0, 0, 0,
    0, 0, 0, 0,
    ...ascii('GPS-SEGREDO'),
  ];
  return seg(0xe1, [...ascii('Exif'), 0, 0, ...tiff]);
}
const jfif = seg(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const icc = seg(0xe2, [...ascii('ICC_PROFILE'), 0, 1, 1, 9, 9]);
const mpf = seg(0xe2, [...ascii('MPF'), 0, 1, 2]);
const xmp = seg(0xe1, [...ascii('http://ns.adobe.com/xap/1.0/'), 0, ...ascii('<gps>SEGREDO</gps>')]);
const iptc = seg(0xed, ascii('Photoshop 3.0 SEGREDO'));
const com = seg(0xfe, ascii('SEGREDO'));
const dqt = seg(0xdb, [0, 1, 2, 3]);
const sos = [...seg(0xda, [1, 1, 0, 0, 63, 0]), 0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56];
const eoi = [0xff, 0xd9];
const trailer = [0xff, 0xd8, ...exif(1), 0xff, 0xd9]; // segunda imagem (MPF) com EXIF próprio

const has = (b: Uint8Array, s: string) => Buffer.from(b).includes(Buffer.from(s));

test('reconhece JPEG pelos primeiros bytes', () => {
  assert.ok(isJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])));
  assert.ok(!isJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47])));
  assert.ok(!isJpeg(new Uint8Array([])));
});

test('tira EXIF, XMP, IPTC, comentário, MPF e o que vem depois do fim da imagem', () => {
  const src = new Uint8Array([0xff, 0xd8, ...jfif, ...exif(1), ...xmp, ...icc, ...mpf, ...iptc, ...com, ...dqt, ...sos, ...eoi, ...trailer]);
  const out = stripJpegMetadata(src);
  assert.ok(out);
  assert.ok(!has(out, 'SEGREDO') && !has(out, 'Exif') && !has(out, 'MPF'));
  assert.deepEqual([...out], [0xff, 0xd8, ...jfif, ...icc, ...dqt, ...sos, ...eoi], 'mantém a imagem, a cor e as tabelas como estavam');
});

test('guarda só a orientação, para a foto não aparecer deitada', () => {
  const src = new Uint8Array([0xff, 0xd8, ...exif(6), ...dqt, ...sos, ...eoi]);
  const out = stripJpegMetadata(src)!;
  assert.ok(!has(out, 'SEGREDO'));
  const min = [0xff, 0xe1, 0, 34, ...ascii('Exif'), 0, 0, ...ascii('MM'), 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0];
  assert.deepEqual([...out], [0xff, 0xd8, ...min, ...dqt, ...sos, ...eoi]);
});

test('arquivo que não dá para ler devolve null (quem chama regrava a foto)', () => {
  assert.equal(stripJpegMetadata(new Uint8Array([0x89, 0x50])), null);
  assert.equal(stripJpegMetadata(new Uint8Array([0xff, 0xd8, 0x00, 0x00])), null);
  assert.equal(stripJpegMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x50, 1])), null, 'segmento cortado');
  assert.equal(stripJpegMetadata(new Uint8Array([0xff, 0xd8, ...dqt, ...seg(0xda, [1]), 1, 2])), null, 'sem fim da imagem');
});

test('nome neutro: nada do nome original do arquivo', () => {
  assert.equal(photoName('2026-11-10', 'image/jpeg'), 'foto-2026-11-10.jpg');
  assert.equal(photoName('2026-11-10', 'image/png'), 'foto-2026-11-10.png');
  assert.equal(photoName('2026-11-10', 'image/heic'), 'foto-2026-11-10.heic');
  assert.equal(photoName('2026-11-10', 'x/y'), 'foto-2026-11-10.jpg');
});
