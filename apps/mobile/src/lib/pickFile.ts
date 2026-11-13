import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';
import { fitSize, PHOTO_PLAN, PREVIEW_MAX_BYTES, type PhotoQuality } from './mediaCore';
import { isJpeg, photoName, stripJpegMetadata } from './photoMeta';
import { isPickerTemp, PICKER_CACHE_DIRS } from './pickerTemp';
import { fromBase64, toBase64 } from '../transport/base64';

export interface PickedFile { name: string; mime: string; data: Uint8Array; /** Prévia (data URI) para fotos pequenas. */ preview?: string }

export { PREVIEW_MAX_BYTES };

async function readUri(uri: string): Promise<Uint8Array> {
  const r = await fetch(uri);
  return new Uint8Array(await r.arrayBuffer());
}

/** Apaga as cópias em claro que os seletores deixaram no cache (só elas, nunca o original). */
function dropTemps(...uris: (string | undefined)[]) {
  if (Platform.OS === 'web') return;
  for (const u of uris) {
    try { if (u && isPickerTemp(u, Paths.cache.uri)) { const f = new File(u); if (f.exists) f.delete(); } } catch { /* o sistema limpa o cache */ }
  }
}

/** "Apagar dados locais": as pastas de temporários dos seletores (e dos recebidos abertos) saem inteiras. */
export function clearPickerCache() {
  if (Platform.OS === 'web') return;
  for (const n of PICKER_CACHE_DIRS) {
    try { const d = new Directory(Paths.cache, n); if (d.exists) d.delete(); } catch { /* fica para o sistema */ }
  }
}

/** Regrava em JPEG sem reduzir (tira os metadados). */
async function reencode(uri: string, compress: number, size?: { width: number; height: number }) {
  let ctx = ImageManipulator.manipulate(uri);
  if (size) ctx = ctx.resize(size);
  const out = await (await ctx.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress, base64: true });
  dropTemps(out.uri);
  if (!out.base64) throw new Error('Não foi possível preparar a foto.');
  return out.base64;
}

/**
 * Foto da galeria. `quality` é o ajuste "Qualidade das fotos enviadas": Econômica e Normal reduzem e
 * regravam em JPEG (lib/mediaCore.ts); Original manda a imagem sem recomprimir, mas sem metadados
 * (local, aparelho, data: lib/photoMeta.ts). O nome enviado é sempre neutro (foto-AAAA-MM-DD).
 * A cópia que o seletor deixa no cache é apagada logo depois de lida.
 * `null` se a pessoa cancelar ou negar o acesso.
 */
export async function pickImage(quality: PhotoQuality = 'normal'): Promise<PickedFile | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const plan = PHOTO_PLAN[quality];
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, base64: !plan, exif: false });
  const a = r.canceled ? null : r.assets[0];
  if (!a) return null;
  const day = new Date().toISOString().slice(0, 10);
  try {
    if (plan) {
      const size = fitSize(a.width, a.height, plan.maxSide);
      const b64 = await reencode(a.uri, plan.compress, size.width !== a.width || size.height !== a.height ? size : undefined);
      const data = fromBase64(b64);
      return { name: photoName(day, 'image/jpeg'), mime: 'image/jpeg', data, preview: data.length <= PREVIEW_MAX_BYTES ? `data:image/jpeg;base64,${b64}` : undefined };
    }
    const raw = a.base64 ? fromBase64(a.base64) : await readUri(a.uri);
    let data: Uint8Array | null = raw;
    let mime = a.mimeType ?? 'image/jpeg';
    if (isJpeg(raw)) {
      // No iPhone o seletor já entrega JPEG (mesmo de uma HEIC): o tipo segue os bytes.
      mime = 'image/jpeg';
      data = stripJpegMetadata(raw);
    } else if (/^image\/(hei[cf]|tiff)/i.test(mime)) {
      data = null; // HEIC/TIFF levam EXIF: regrava em JPEG sem reduzir
    }
    if (!data) { data = fromBase64(await reencode(a.uri, 1)); mime = 'image/jpeg'; }
    return { name: photoName(day, mime), mime, data, preview: data.length <= PREVIEW_MAX_BYTES ? `data:${mime};base64,${toBase64(data)}` : undefined };
  } finally {
    dropTemps(a.uri);
  }
}

/** Documento qualquer. `null` se a pessoa cancelar. */
export async function pickDocument(): Promise<PickedFile | null> {
  const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
  const a = r.canceled ? null : r.assets[0];
  if (!a) return null;
  try { return { name: a.name, mime: a.mimeType ?? 'application/octet-stream', data: await readUri(a.uri) }; }
  finally { dropTemps(a.uri); }
}
