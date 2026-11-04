import AsyncStorage from '@react-native-async-storage/async-storage';
import { legacyKeysIn } from './legacyCore';

/** Mesmo prefixo de `persist.ts` (VERSION = 1). */
const PREFIX = 'piu:v1:';

/**
 * Apaga do aparelho os dados de exemplo salvos por versões antigas (lista em `legacyCore.ts`).
 * Nenhum provedor lê esses campos mais; a limpeza só tira o resto do disco. Roda a cada abertura
 * (sem nada para apagar, não faz nada) e nunca derruba o app.
 */
export async function pruneLegacyData(): Promise<number> {
  try {
    const names = (await AsyncStorage.getAllKeys()).filter(k => k.startsWith(PREFIX)).map(k => k.slice(PREFIX.length));
    const old = legacyKeysIn(names);
    if (old.length) await AsyncStorage.multiRemove(old.map(n => PREFIX + n));
    return old.length;
  } catch { return 0; }
}
