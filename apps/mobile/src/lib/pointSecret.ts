/**
 * Segredo do ponto Piu (de onde sai a chave do ponto, lib/pointKey.ts) no cofre do aparelho:
 * Keystore/Keychain, só neste aparelho, só desbloqueado, fora de backup. Encerrar o ponto apaga.
 * Web (demonstração): localStorage, como lib/vault.ts.
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { fromHex, toHex } from './vault';

const KEY = 'piu.point.secret.v1';
const OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export async function loadPointSecret(): Promise<Uint8Array | null> {
  try {
    const v = Platform.OS === 'web' ? globalThis.localStorage?.getItem(KEY) ?? null : await SecureStore.getItemAsync(KEY, OPTS);
    return v && /^[0-9a-f]{64}$/.test(v) ? fromHex(v) : null;
  } catch { return null; }
}

export async function savePointSecret(secret: Uint8Array): Promise<void> {
  const v = toHex(secret);
  if (Platform.OS === 'web') globalThis.localStorage?.setItem(KEY, v);
  else await SecureStore.setItemAsync(KEY, v, OPTS);
}

export async function deletePointSecret(): Promise<void> {
  try { if (Platform.OS === 'web') globalThis.localStorage?.removeItem(KEY); else await SecureStore.deleteItemAsync(KEY, OPTS); } catch { /* nada a apagar */ }
}
