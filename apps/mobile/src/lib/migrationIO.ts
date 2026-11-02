/**
 * Arquivo de backup no aparelho: salvar (cartão SD/pendrive/Arquivos) e escolher para restaurar.
 * Nada passa por servidor: no Android a pessoa escolhe a pasta (SAF, inclusive cartão SD e pendrive
 * USB); no iPhone abre a folha do sistema ("Salvar em Arquivos"); na web baixa o arquivo.
 */
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { BACKUP_MIME, MAX_BACKUP_BYTES } from './backupFile';

export type SaveResult = 'saved' | 'shared' | 'downloaded' | 'cancelled';

/** Salva o texto do backup com o nome dado. */
export async function saveBackupFile(name: string, text: string): Promise<SaveResult> {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([text], { type: BACKUP_MIME }));
    const a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return 'downloaded';
  }
  if (Platform.OS === 'android') {
    // A pessoa escolhe a pasta (cartão SD, pendrive, Downloads…). Cancelar volta sem salvar.
    let dir: Directory | null = null;
    try { dir = await Directory.pickDirectoryAsync(); } catch { dir = null; }
    if (!dir) return 'cancelled';
    const f = dir.createFile(name, BACKUP_MIME);
    await f.write(text);
    return 'saved';
  }
  // iPhone: arquivo temporário + folha de compartilhar ("Salvar em Arquivos"); apagado em seguida.
  const tmp = new File(Paths.cache, name);
  try {
    if (tmp.exists) tmp.delete();
    tmp.create();
    await tmp.write(text);
    if (!(await Sharing.isAvailableAsync())) throw new Error('Compartilhar não está disponível neste aparelho.');
    await Sharing.shareAsync(tmp.uri, { mimeType: BACKUP_MIME, UTI: 'public.data', dialogTitle: 'Salvar o backup cifrado' });
    return 'shared';
  } finally {
    try { if (tmp.exists) tmp.delete(); } catch { /* o sistema limpa o cache */ }
  }
}

/** Escolhe um arquivo de backup e devolve o texto (null se cancelou). */
export async function pickBackupFile(): Promise<{ name: string; text: string } | null> {
  const r = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
  if (r.canceled || !r.assets?.length) return null;
  const a = r.assets[0];
  if (a.size && a.size > MAX_BACKUP_BYTES) throw new Error('Arquivo grande demais para ser um backup do Piu.');
  if (Platform.OS === 'web' && a.file) return { name: a.name, text: await a.file.text() };
  const f = new File(a.uri);
  try { return { name: a.name, text: await f.text() }; }
  finally { try { f.delete(); } catch { /* cópia no cache */ } }
}
