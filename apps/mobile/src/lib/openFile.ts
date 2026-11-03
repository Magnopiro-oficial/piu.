/**
 * Abrir/compartilhar um arquivo recebido. O conteúdo fica só na memória (state/messaging.tsx,
 * `receivedFiles`): para entregar a outro app, vai para um arquivo temporário no cache do Piu, a
 * folha do sistema abre (abrir com, salvar em Arquivos, mandar por outro app) e o temporário é
 * apagado logo depois. Na web, o navegador baixa o arquivo.
 */
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { safeFileName } from './mediaCore';

/** Pasta dos temporários (apagada inteira se sobrar algo de uma vez anterior). */
const TMP_DIR = 'recebidos';

export async function shareReceivedFile(f: { name: string; mime: string; data: Uint8Array }): Promise<'shared' | 'downloaded'> {
  const name = safeFileName(f.name, f.mime);
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([f.data as BlobPart], { type: f.mime || 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return 'downloaded';
  }
  if (!(await Sharing.isAvailableAsync())) throw new Error('Abrir e compartilhar não estão disponíveis neste aparelho.');
  const dir = new Directory(Paths.cache, TMP_DIR);
  try {
    if (dir.exists) dir.delete();
    dir.create({ intermediates: true });
    const tmp = new File(dir, name);
    tmp.create();
    await tmp.write(f.data);
    await Sharing.shareAsync(tmp.uri, { mimeType: f.mime || 'application/octet-stream', dialogTitle: name });
    return 'shared';
  } finally {
    // O outro app já recebeu a cópia: o temporário sai do aparelho.
    try { if (dir.exists) dir.delete(); } catch { /* o sistema limpa o cache */ }
  }
}
