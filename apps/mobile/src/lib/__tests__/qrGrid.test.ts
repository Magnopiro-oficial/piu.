/// <reference types="node" />
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
// Decodificador ZXing (o mesmo que o expo-camera usa na web, via barcode-detector): lê o QR de volta como uma câmera leria.
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import { LANGS, tIn } from '../../i18n';
import { b64url, encodeCard } from '../../messaging/card';
import { deriveIdentity, newSeed } from '../../protocol/keys';
import { GROUP_INVITE_QR_LEVEL, qrGrid, qrZoomSize, QR_ZOOM_QUIET, type QrLevel } from '../qrGrid';

const wasm = readFileSync(createRequire(import.meta.url).resolve('zxing-wasm/reader/zxing_reader.wasm'));
prepareZXingModule({ overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer }, fireImmediately: true });

const INV = { code: '0011223344556677', expiresAt: 1_800_000_000 };

/** Convite de grupo montado como em `inviteLink` (state/messaging.tsx): `piug:` + base64url do JSON com o cartão assinado. */
function groupLink(profile: string, group: string): string {
  const card = encodeCard(deriveIdentity(newSeed(), 'public'), profile, INV);
  return 'piug:' + b64url(new TextEncoder().encode(JSON.stringify({ c: card, g: '0'.repeat(32), n: group, k: 'group' })));
}

const typical = groupLink('Cardeal', 'Grupo da Família');
// Pior caso: nome de perfil e de grupo longos, em CJK (3 bytes por caractere em UTF-8).
const worst = groupLink('张'.repeat(30), '家'.repeat(60));

/** Desenha a matriz do QR como a tela desenha (preto no branco, margem `quiet`) com `px` pixels por módulo e decodifica. */
async function decode(value: string, level: QrLevel, quiet: number, px: number): Promise<string | undefined> {
  const { d, n } = qrGrid(value, level);
  const w = (n + quiet * 2) * px;
  const data = new Uint8ClampedArray(w * w * 4).fill(255);
  // Lê os quadrados do próprio caminho SVG (`M{c} {r}h1v1h-1z`), não da biblioteca: testa o que é desenhado.
  for (const m of d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    const c = Number(m[1]) + quiet, r = Number(m[2]) + quiet;
    for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
      const i = ((r * px + y) * w + c * px + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 0;
    }
  }
  const res = await readBarcodes({ data, width: w, height: w, colorSpace: 'srgb' } as ImageData, { formats: ['QRCode'], tryHarder: false });
  return res[0]?.text;
}

test('qrGrid: correção L deixa o convite de grupo menos denso que M', () => {
  assert.ok(typical.length > 500);
  assert.equal(qrGrid(typical, 'M').n, 85); // versão 17
  assert.equal(qrGrid(typical, 'L').n, 77); // versão 15
  assert.equal(GROUP_INVITE_QR_LEVEL, 'L');
});

test('qrGrid: padrão continua M (os outros QRs do app não mudam)', () => {
  // Payload em que L e M dão tamanhos diferentes: se o padrão virasse L, daria 77.
  assert.equal(qrGrid(typical).n, 85);
});

test('qrGrid: o QR do convite, desenhado como no zoom, decodifica de volta para o link exato', async () => {
  for (const link of [typical, worst]) {
    assert.equal(await decode(link, GROUP_INVITE_QR_LEVEL, QR_ZOOM_QUIET, 3), link);
  }
});

test('qrZoomSize: QR ampliado ocupa a largura do celular, com teto no tablet', () => {
  assert.equal(qrZoomSize(360, 780), 328);
  assert.equal(qrZoomSize(1024, 1366), 480);
  // Celular deitado: cabe na altura.
  assert.ok(qrZoomSize(780, 360) <= 360 * 0.7);
});

test('qrZoomSize: no celular pequeno, cada módulo do convite tem mais de 2,5 pt (no cartão de 72 pt tinha menos de 1)', () => {
  const side = qrZoomSize(320, 640);
  for (const [link, min] of [[typical, 3.2], [worst, 2.5]] as const) {
    const { n } = qrGrid(link, GROUP_INVITE_QR_LEVEL);
    const mod = side / (n + QR_ZOOM_QUIET * 2);
    assert.ok(mod >= min, `módulo de ${mod} pt`);
  }
});

test('Grupo · tela de convite e zoom usam o nível L e a margem de 4 módulos', () => {
  const info = readFileSync(new URL('../../ui/RealGroupInfo.tsx', import.meta.url), 'utf8');
  const zoom = readFileSync(new URL('../../ui/QrZoom.tsx', import.meta.url), 'utf8');
  assert.equal(info.match(/level=\{GROUP_INVITE_QR_LEVEL\}/g)?.length, 2, 'miniatura e zoom');
  assert.doesNotMatch(info, /level="[LMQH]"/);
  assert.match(zoom, /<QrCode [^>]*radius=\{0\}[^>]*quiet=\{QR_ZOOM_QUIET\}/);
});

test('Grupo · leitor de tela: zoom tem fundo não acessível e botão de fechar próprio; a linha do convite é um só alvo com rótulo', () => {
  const zoom = readFileSync(new URL('../../ui/QrZoom.tsx', import.meta.url), 'utf8');
  // O fundo que fecha não agrupa os filhos (senão o QR e o aviso somem para o leitor de tela).
  assert.match(zoom, /<Pressable onPress=\{onClose\} accessible=\{false\} importantForAccessibility="no"/);
  assert.match(zoom, /<Pressable onPress=\{onClose\} accessibilityRole="button" accessibilityLabel=\{t\('common\.close'\)\}/);
  const info = readFileSync(new URL('../../ui/RealGroupInfo.tsx', import.meta.url), 'utf8');
  const rows = info.match(/<Pressable[^>]*onPress=\{\(\) => setZoom\(true\)\}[^>]*>/g) ?? [];
  assert.equal(rows.length, 1, 'um só alvo de toque para ampliar');
  assert.match(rows[0], /accessibilityRole="button" accessibilityLabel=\{t\('groupInfo\.inviteQr\.zoom'\)\}/);
});

test('Grupo · o aviso do zoom manda usar o Escanear código do Piu (a câmera comum só mostra texto `piug:`)', () => {
  for (const { code } of LANGS) {
    const hint = tIn(code, 'groupInfo.inviteQr.hint');
    assert.ok(hint.includes(tIn(code, 'chats.scan')), `${code}: ${hint}`);
  }
});
