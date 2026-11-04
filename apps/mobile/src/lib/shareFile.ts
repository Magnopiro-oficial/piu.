/**
 * Compartilha um arquivo de texto gerado no aparelho (folha do sistema: salvar, mandar por e-mail,
 * levar ao validador). Arquivo temporário no cache, apagado em seguida; na web, baixa o arquivo.
 */
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

export async function shareTextFile(name: string, text: string, o: { mimeType: string; dialogTitle: string }): Promise<'shared' | 'downloaded'> {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([text], { type: o.mimeType }));
    const a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return 'downloaded';
  }
  if (!(await Sharing.isAvailableAsync())) throw new Error('Compartilhar não está disponível neste aparelho.');
  const tmp = new File(Paths.cache, name);
  try {
    if (tmp.exists) tmp.delete();
    tmp.create();
    await tmp.write(text);
    await Sharing.shareAsync(tmp.uri, { mimeType: o.mimeType, UTI: 'public.json', dialogTitle: o.dialogTitle });
    return 'shared';
  } finally {
    try { if (tmp.exists) tmp.delete(); } catch { /* o sistema limpa o cache */ }
  }
}
