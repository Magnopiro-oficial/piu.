import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { fromBase64 } from '../transport/base64';

export interface PickedFile { name: string; mime: string; data: Uint8Array; /** Prévia (data URI) para fotos pequenas. */ preview?: string }

/** Prévia guardada junto da conversa só até este tamanho (o armazenamento do app é limitado). */
export const PREVIEW_MAX_BYTES = 1.5 * 1024 * 1024;

async function readUri(uri: string): Promise<Uint8Array> {
  const r = await fetch(uri);
  return new Uint8Array(await r.arrayBuffer());
}

/** Foto da galeria (JPEG). `null` se a pessoa cancelar ou negar o acesso. */
export async function pickImage(): Promise<PickedFile | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, base64: true, exif: false });
  const a = r.canceled ? null : r.assets[0];
  if (!a) return null;
  const data = a.base64 ? fromBase64(a.base64) : await readUri(a.uri);
  const mime = a.mimeType ?? 'image/jpeg';
  const name = a.fileName ?? `foto-${new Date().toISOString().slice(0, 10)}.jpg`;
  return { name, mime, data, preview: data.length <= PREVIEW_MAX_BYTES && a.base64 ? `data:${mime};base64,${a.base64}` : undefined };
}

/** Documento qualquer. `null` se a pessoa cancelar. */
export async function pickDocument(): Promise<PickedFile | null> {
  const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
  const a = r.canceled ? null : r.assets[0];
  if (!a) return null;
  return { name: a.name, mime: a.mimeType ?? 'application/octet-stream', data: await readUri(a.uri) };
}
