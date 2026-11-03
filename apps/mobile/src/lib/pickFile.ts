import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { fitSize, PHOTO_PLAN, type PhotoQuality } from './mediaCore';
import { fromBase64 } from '../transport/base64';

export interface PickedFile { name: string; mime: string; data: Uint8Array; /** Prévia (data URI) para fotos pequenas. */ preview?: string }

/** Prévia guardada junto da conversa só até este tamanho (o armazenamento do app é limitado). */
export const PREVIEW_MAX_BYTES = 1.5 * 1024 * 1024;

async function readUri(uri: string): Promise<Uint8Array> {
  const r = await fetch(uri);
  return new Uint8Array(await r.arrayBuffer());
}

/**
 * Foto da galeria. `quality` é o ajuste "Qualidade das fotos enviadas": Econômica e Normal reduzem e
 * regravam em JPEG (lib/mediaCore.ts); Original manda o arquivo escolhido sem regravar.
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
  if (plan) {
    const size = fitSize(a.width, a.height, plan.maxSide);
    let ctx = ImageManipulator.manipulate(a.uri);
    if (size.width !== a.width || size.height !== a.height) ctx = ctx.resize(size);
    const out = await (await ctx.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: plan.compress, base64: true });
    if (!out.base64) throw new Error('Não foi possível preparar a foto.');
    const data = fromBase64(out.base64);
    const name = (a.fileName ?? `foto-${day}`).replace(/\.[A-Za-z0-9]+$/, '') + '.jpg';
    return { name, mime: 'image/jpeg', data, preview: data.length <= PREVIEW_MAX_BYTES ? `data:image/jpeg;base64,${out.base64}` : undefined };
  }
  const data = a.base64 ? fromBase64(a.base64) : await readUri(a.uri);
  const mime = a.mimeType ?? 'image/jpeg';
  const name = a.fileName ?? `foto-${day}.jpg`;
  return { name, mime, data, preview: data.length <= PREVIEW_MAX_BYTES && a.base64 ? `data:${mime};base64,${a.base64}` : undefined };
}

/** Documento qualquer. `null` se a pessoa cancelar. */
export async function pickDocument(): Promise<PickedFile | null> {
  const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
  const a = r.canceled ? null : r.assets[0];
  if (!a) return null;
  return { name: a.name, mime: a.mimeType ?? 'application/octet-stream', data: await readUri(a.uri) };
}
