/**
 * Foto em qualidade "Original" sem metadados (auditoria 2026-11-09): o JPEG segue com os mesmos bytes
 * da imagem (sem recomprimir), mas sem EXIF (local, aparelho, data), XMP, IPTC, comentários e as
 * imagens extras depois do fim (MPF). Só a orientação fica, para a foto não aparecer deitada.
 * TypeScript puro (testado no Node).
 */

export const isJpeg = (b: Uint8Array) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

const startsWith = (b: Uint8Array, at: number, s: string) => {
  for (let i = 0; i < s.length; i++) if (b[at + i] !== s.charCodeAt(i)) return false;
  return true;
};

/** Orientação (1 a 8) guardada no EXIF de um APP1; null se não houver. */
function orientationOf(b: Uint8Array, start: number, end: number): number | null {
  if (!startsWith(b, start, 'Exif\0\0')) return null;
  const t = start + 6;
  const le = startsWith(b, t, 'II');
  if (!le && !startsWith(b, t, 'MM')) return null;
  const u16 = (o: number) => (o + 2 <= end ? (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]) : -1);
  const u32 = (o: number) => (o + 4 <= end ? (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000 : b[o] * 0x1000000 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3])) : -1);
  const ifd = u32(t + 4);
  if (ifd < 0) return null;
  const n = u16(t + ifd);
  for (let i = 0; i < n; i++) {
    const e = t + ifd + 2 + i * 12;
    if (u16(e) === 0x0112) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : null; }
  }
  return null;
}

/** APP1 mínimo, só com a orientação (TIFF big-endian, um campo). */
const orientationApp1 = (o: number) => [
  0xff, 0xe1, 0, 34, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8,
  0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0,
];

/**
 * JPEG sem metadados. Mantém APP0 (JFIF), o perfil de cor (APP2 ICC) e as tabelas; a imagem não é
 * recomprimida. `null` se não for um JPEG que dê para ler até o fim (quem chama regrava a foto).
 */
export function stripJpegMetadata(b: Uint8Array): Uint8Array | null {
  if (!isJpeg(b)) return null;
  const keep: Uint8Array[] = [b.subarray(0, 2)];
  let orientation: number | null = null;
  let i = 2;
  for (;;) {
    if (i + 4 > b.length || b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; } // bytes de preenchimento
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) return null;
    const p = i + 4; const end = i + 2 + len;
    if (m === 0xda) {
      // Início da imagem: daqui até o fim (FF D9) vai como está; nada do que vem depois.
      let j = end;
      while (j + 1 < b.length && !(b[j] === 0xff && b[j + 1] === 0xd9)) j++;
      if (j + 1 >= b.length) return null;
      keep.push(b.subarray(i, j + 2));
      break;
    }
    const drop = m === 0xe1 || m === 0xed || m === 0xfe || (m === 0xe2 && !startsWith(b, p, 'ICC_PROFILE\0')) || (m >= 0xe3 && m <= 0xef && m !== 0xee);
    if (m === 0xe1 && orientation === null) orientation = orientationOf(b, p, end);
    if (!drop) keep.push(b.subarray(i, end));
    i = end;
  }
  if (orientation && orientation !== 1) keep.splice(1, 0, Uint8Array.from(orientationApp1(orientation)));
  const out = new Uint8Array(keep.reduce((s, x) => s + x.length, 0));
  let o = 0;
  for (const x of keep) { out.set(x, o); o += x.length; }
  return out;
}

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif' };

/** Nome neutro da foto enviada: nada do nome original do arquivo (pode trazer data, aparelho, nome). */
export const photoName = (day: string, mime: string) => `foto-${day}.${EXT[mime.toLowerCase()] ?? 'jpg'}`;
