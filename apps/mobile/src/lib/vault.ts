import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { seedFromPhrase, isValidPhrase } from '../protocol/phrase';
import { confirmDevice } from './deviceAuth';
import type { VaultDeps } from './phraseVault';
import { walletAddressFromPhrase } from './walletKey';

/**
 * Cofre do aparelho para segredos:
 * - a frase de recuperação (de onde saem todas as chaves) e as chaves de uso diário: regras em
 *   lib/phraseVault.ts (B-01: a frase fica atrás da biometria do sistema quando dá);
 * - a chave de dados (AES-256) que cifra o que o app salva no AsyncStorage (lib/persist.ts).
 * Android/iPhone: armazenamento seguro do sistema (Keystore/Keychain), só neste aparelho,
 * só com ele desbloqueado, fora de backups na nuvem.
 * Web: NÃO há cofre seguro. A versão web é só demonstração/testes e usa o localStorage.
 */
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

export const toHex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
export const fromHex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], x => parseInt(x, 16));

/**
 * Item com `requireAuthentication` (expo-secure-store 58): o Android decifra só com a chave do Keystore
 * liberada pela biometria forte (CryptoObject); o iPhone usa `biometryCurrentSet`. Lança se a pessoa
 * cancelar ou não houver biometria; devolve null se o sistema invalidou a chave (biometria trocada).
 */
const authOpts = (prompt?: string): SecureStore.SecureStoreOptions => ({ ...OPTS, requireAuthentication: true, ...(prompt ? { authenticationPrompt: prompt } : {}) });

/** Biometria que o `requireAuthentication` aceita: Android só forte; iPhone Face ID/Touch ID. */
async function strongBiometrics(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    if (!SecureStore.canUseBiometricAuthentication()) return false;
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    return level >= (Platform.OS === 'android' ? LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG : LocalAuthentication.SecurityLevel.BIOMETRIC_WEAK);
  } catch { return false; }
}

/** Cofre real para lib/phraseVault.ts. Na web (demonstração) não há biometria: fica no localStorage. */
export const vaultDeps: VaultDeps = {
  store: {
    get: (k, auth) => (auth && Platform.OS !== 'web' ? SecureStore.getItemAsync(k, authOpts(auth.prompt)) : get(k)),
    set: (k, v, auth) => (auth && Platform.OS !== 'web' ? SecureStore.setItemAsync(k, v, authOpts(auth.prompt)) : set(k, v)),
    del: async (k, auth) => { if (auth && Platform.OS !== 'web') await SecureStore.deleteItemAsync(k, authOpts()); else await del(k); },
  },
  seedOf: w => toHex(seedFromPhrase(w)),
  walletOf: w => { try { return Platform.OS === 'web' ? null : walletAddressFromPhrase(w); } catch { return null; } },
  isValid: isValidPhrase,
  strongBiometrics,
  confirmDevice,
  now: Date.now,
};

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

/** Nós do provider que este celular aprova (lib/approvals.ts): o segredo de cada um fica só aqui. */
const APPROVALS_KEY = 'piu.approvals.v1';
export async function loadApprovalNodes<T>(): Promise<T[]> {
  try { const v = await get(APPROVALS_KEY); return v ? JSON.parse(v) as T[] : []; } catch { return []; }
}
export const saveApprovalNodes = <T>(list: T[]) => set(APPROVALS_KEY, JSON.stringify(list));
