// Release do Piu Android. Nome, URL, tamanho e SHA-256 do APK vêm de releases.json, preenchido por
// `node scripts/sync-release.mjs --android android-v<versão>` a partir do release publicado (digest do asset).
// Os textos (i18n) e a faixa de assinatura do site leem daqui, nada de hash escrito à mão em cada idioma.
//
// certSha256 não vem do GitHub: apksigner verify --print-certs Piu-<versão>.apk (muda só se a chave de
// release mudar). apps/mobile/src/lib/apkIntegrity.ts tem o mesmo valor (um teste confere).
import { fmtSize, release } from './releases';

const r = release('android');
const apk = r.assets.apk;

export const ANDROID_VERSION = r.version;
export const ANDROID_TAG = r.tag;
/** Há APK publicado (release não-rascunho com o arquivo)? Sem ele o site mostra "em breve". */
export const ANDROID_PUBLISHED = !!apk;
export const ANDROID_FILE = apk?.name ?? `Piu-${ANDROID_VERSION}.apk`;
export const ANDROID_URL = apk?.url ?? '';
export const ANDROID_SIZE = apk ? fmtSize(apk.size) : '';
/** SHA-256 completo do APK publicado (64 hexa), vazio sem release. */
export const ANDROID_SHA256 = apk?.sha256 ?? '';
/** SHA-256 do certificado de assinatura do app (o mesmo em todas as versões). */
export const ANDROID_CERT_SHA256 = '595bdc6a2d574fec59f0f781eb9d8d479a84f4907d70405f83b4b1e578b7ff31';

if (!/^[0-9a-f]{64}$/.test(ANDROID_CERT_SHA256)) throw new Error('androidRelease: ANDROID_CERT_SHA256 precisa ter 64 hexa minúsculos.');

/** "595B DC6A 2D57 …": o hash inteiro em grupos de 4 (quebra linha entre os grupos). */
export const groupHex = (hex: string, upper = false) => (upper ? hex.toUpperCase() : hex).replace(/(.{4})(?=.)/g, '$1 ');
