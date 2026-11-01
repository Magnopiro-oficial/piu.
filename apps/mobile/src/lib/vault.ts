import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Cofre da frase de recuperação (de onde saem todas as chaves).
 * - Android/iPhone: armazenamento seguro do sistema (Keystore/Keychain), só neste aparelho
 *   e só com ele desbloqueado; não vai para backup na nuvem.
 * - Web: SEM cofre seguro. A versão web é só demonstração/testes e guarda no localStorage.
 */
const KEY = 'piu.phrase.v1';
const OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export const vaultIsSecure = Platform.OS !== 'web';

export async function loadPhrase(): Promise<string[] | null> {
  try {
    const v = Platform.OS === 'web' ? globalThis.localStorage?.getItem(KEY) ?? null : await SecureStore.getItemAsync(KEY, OPTS);
    return v ? v.split(' ') : null;
  } catch {
    return null;
  }
}

export async function savePhrase(words: string[]): Promise<void> {
  const v = words.join(' ');
  if (Platform.OS === 'web') globalThis.localStorage?.setItem(KEY, v);
  else await SecureStore.setItemAsync(KEY, v, OPTS);
}

export async function clearPhrase(): Promise<void> {
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.removeItem(KEY);
    else await SecureStore.deleteItemAsync(KEY, OPTS);
  } catch { /* nada a apagar */ }
}
