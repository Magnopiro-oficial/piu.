import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

/**
 * Persistência local (sem servidor): o estado do app fica no aparelho entre aberturas.
 * - Tudo é lido de uma vez antes do splash sumir (`loadPersisted`), para não piscar o onboarding.
 * - `usePersisted` funciona como `useState` e grava as mudanças com um pequeno atraso.
 * - `clearPersisted` apaga tudo e descarta gravações pendentes ("Apagar dados locais").
 *
 * Importante: chaves privadas reais NÃO devem ficar aqui (AsyncStorage não é cifrado).
 * Quando a criptografia entrar, elas vão para o armazenamento seguro do sistema (Keychain/Keystore).
 * Aumente VERSION se o formato dos dados mudar de forma incompatível.
 */
const VERSION = 1;
const PREFIX = `piu:v${VERSION}:`;
const WRITE_DELAY = 250;

let snapshot: Record<string, unknown> = {};
let loaded = false;
let epoch = 0;
const pending = new Map<string, ReturnType<typeof setTimeout>>();

/** Lê todos os valores salvos para a memória. Falhas de leitura não impedem o app de abrir. */
export async function loadPersisted(): Promise<void> {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter(k => k.startsWith(PREFIX));
    const pairs = await AsyncStorage.multiGet(keys);
    const next: Record<string, unknown> = {};
    for (const [k, v] of pairs) {
      if (v == null) continue;
      try { next[k.slice(PREFIX.length)] = JSON.parse(v); } catch { /* valor corrompido: ignora e usa o padrão */ }
    }
    snapshot = next;
  } catch {
    snapshot = {};
  }
  loaded = true;
}

export const isPersistLoaded = () => loaded;

function schedule(key: string, value: unknown) {
  clearTimeout(pending.get(key));
  const at = epoch;
  pending.set(key, setTimeout(() => {
    pending.delete(key);
    if (at !== epoch) return; // apagado no meio do caminho
    snapshot[key] = value;
    AsyncStorage.setItem(PREFIX + key, JSON.stringify(value)).catch(() => {});
  }, WRITE_DELAY));
}

/** Apaga todos os dados do Piu neste aparelho e cancela gravações pendentes. */
export async function clearPersisted(): Promise<void> {
  epoch += 1;
  pending.forEach(clearTimeout);
  pending.clear();
  snapshot = {};
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter(k => k.startsWith(PREFIX));
    await AsyncStorage.multiRemove(keys);
  } catch { /* nada a fazer */ }
}

/**
 * Como `useState`, mas salvo no aparelho sob `key`.
 * `revive` ajusta o valor lido (ex.: transferências que não podem continuar depois de fechar o app).
 */
export function usePersisted<T>(key: string, initial: T | (() => T), revive?: (saved: T) => T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (key in snapshot) {
      const saved = snapshot[key] as T;
      return revive ? revive(saved) : saved;
    }
    return typeof initial === 'function' ? (initial as () => T)() : initial;
  });
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; } // não regrava o que acabou de ser lido
    schedule(key, value);
  }, [key, value]);
  return [value, setValue];
}
