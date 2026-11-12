/**
 * Cópias em claro que os seletores deixam no cache do app (auditoria 2026-11-09): o seletor de fotos,
 * o de documentos e o ImageManipulator gravam a cópia numa pasta própria do cache; os arquivos
 * recebidos abertos/compartilhados vão para "recebidos" (lib/openFile.ts). TypeScript puro (testado no Node).
 */

/** Pastas do cache do Piu que só guardam temporários (apagadas em "Apagar dados locais"). */
export const PICKER_CACHE_DIRS: readonly string[] = ['ImagePicker', 'ImageManipulator', 'DocumentPicker', 'recebidos'];

/** Caminho comparável: sem "file://", sem barra no fim, e /private/var igual a /var (iPhone). */
const norm = (u: string) => decodeURI(u.replace(/^file:\/\//, '')).replace(/^\/private\/var\//, '/var/').replace(/\/+$/, '');

/**
 * `uri` é uma cópia temporária de um seletor, dentro do cache do app (`cacheUri`)? Só essas são
 * apagadas: nunca o arquivo original da pessoa.
 */
export function isPickerTemp(uri: string, cacheUri: string): boolean {
  if (!cacheUri || !uri.startsWith('file://') || uri.includes('/../')) return false;
  let p: string; let c: string;
  try { p = norm(uri); c = norm(cacheUri); } catch { return false; }
  if (!c) return false;
  return PICKER_CACHE_DIRS.some(d => p.startsWith(`${c}/${d}/`));
}
