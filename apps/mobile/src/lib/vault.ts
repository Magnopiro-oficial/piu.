import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Cofre do aparelho para segredos:
 * - a frase de recuperação (de onde saem todas as chaves);
 * - a chave de dados (AES-256) que cifra o que o app salva no AsyncStorage (lib/persist.ts).
 * Android/iPhone: armazenamento seguro do sistema (Keystore/Keychain), só neste aparelho,
 * só com ele desbloqueado, fora de backups na nuvem.
 * Web: NÃO há cofre seguro. A versão web é só demonstração/testes e usa o localStorage.
 */
const PHRASE_KEY = 'piu.phrase.v1';
const DATA_KEY = 'piu.datakey.v1';
const OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export const vaultIsSecure = Platform.OS !== 'web';

async function get(k: string): Promise<string | null> {
  try { return Platform.OS === 'web' ? globalThis.localStorage?.getItem(k) ?? null : await SecureStore.getItemAsync(k, OPTS); } catch { return null; }
}
async function set(k: string, v: string): Promise<void> {
  if (Platform.OS === 'web') globalThis.localStorage?.setItem(k, v);
  else await SecureStore.setItemAsync(k, v, OPTS);
}
async function del(k: string): Promise<void> {
  try { if (Platform.OS === 'web') globalThis.localStorage?.removeItem(k); else await SecureStore.deleteItemAsync(k, OPTS); } catch { /* nada a apagar */ }
}

export async function loadPhrase(): Promise<string[] | null> { const v = await get(PHRASE_KEY); return v ? v.split(' ') : null; }
export const savePhrase = (words: string[]) => set(PHRASE_KEY, words.join(' '));
export const clearPhrase = () => del(PHRASE_KEY);

const toHex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
const fromHex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], x => parseInt(x, 16));

/** Chave de dados de 256 bits: criada na primeira abertura com o gerador seguro do sistema. */
export async function loadOrCreateDataKey(): Promise<Uint8Array> {
  const saved = await get(DATA_KEY);
  if (saved && saved.length === 64) return fromHex(saved);
  const key = new Uint8Array(32);
  globalThis.crypto.getRandomValues(key);
  await set(DATA_KEY, toHex(key));
  return key;
}

/** Apagar a chave torna ilegível qualquer resto cifrado (crypto-shredding). */
export const clearDataKey = () => del(DATA_KEY);
