/**
 * Foto do perfil público e imagem da identidade anônima (design: Perfil → toque no avatar).
 *
 * - Pública: foto da galeria ou da câmera frontal, recortada quadrada (aparece em círculo) e
 *   regravada aqui no aparelho. Regravar descarta os metadados do arquivo original (EXIF: local,
 *   aparelho, data). Ficam duas versões: 256 px para o próprio perfil e 96 px para mandar aos
 *   contatos públicos pela sessão cifrada.
 * - Anônima: nunca usa foto. É um ícone com uma cor, sorteado aqui (mesmo sorteio do design), ou só
 *   o código da chave. Nada sai do aparelho além do que os contatos anônimos já veem.
 */
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

export interface ProfilePhoto { /** 256 px, para o próprio perfil (data URI JPEG). */ full: string; /** 96 px, o que vai para os contatos (base64 JPEG). */ small: string }
export { ANON_ICONS, anonChoices, anonColors, type AnonAvatar, oklchHex, sameAnon } from './avatarCore';

/** Recorta no centro, reduz e regrava em JPEG (sem os metadados do original). */
async function reencode(uri: string, w: number, h: number): Promise<ProfilePhoto> {
  const side = Math.min(w, h);
  const ctx = ImageManipulator.manipulate(uri).crop({ originX: Math.floor((w - side) / 2), originY: Math.floor((h - side) / 2), width: side, height: side });
  const big = await (await ctx.resize({ width: 256, height: 256 }).renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.82, base64: true });
  const small = await (await ImageManipulator.manipulate(uri).crop({ originX: Math.floor((w - side) / 2), originY: Math.floor((h - side) / 2), width: side, height: side })
    .resize({ width: 96, height: 96 }).renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: true });
  if (!big.base64 || !small.base64) throw new Error('Não foi possível preparar a foto.');
  return { full: `data:image/jpeg;base64,${big.base64}`, small: small.base64 };
}

/** Foto da galeria ou da câmera frontal. `null` se a pessoa cancelar ou negar o acesso. */
export async function pickProfilePhoto(source: 'library' | 'camera'): Promise<ProfilePhoto | null> {
  const perm = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], shape: 'oval', quality: 1, exif: false };
  const r = source === 'camera'
    ? await ImagePicker.launchCameraAsync({ ...opts, cameraType: ImagePicker.CameraType.front })
    : await ImagePicker.launchImageLibraryAsync(opts);
  const a = r.canceled ? null : r.assets[0];
  if (!a) return null;
  return reencode(a.uri, a.width, a.height);
}

export { isJpegBase64, MAX_PEER_PHOTO_B64 } from '../messaging/photo';
