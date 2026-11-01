import { gcm } from '@noble/ciphers/aes.js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { clearDataKey, loadOrCreateDataKey } from './vault';

/**
 * Persistência local (sem servidor): o estado do app fica no aparelho entre aberturas.
 * - Tudo é lido de uma vez antes do splash sumir (`loadPersisted`), para não piscar o onboarding.
 * - `usePersisted` funciona como `useState` e grava as mudanças com um pequeno atraso.
 * - `clearPersisted` apaga tudo e descarta gravações pendentes ("Apagar dados locais").
 *
 * Cifragem em repouso: cada valor é cifrado com AES-256-GCM (nonce aleatório de 96 bits, o nome do
 * campo como dado associado) antes de ir para o AsyncStorage. A chave de 256 bits fica no cofre do
 * sistema (lib/vault.ts), fora de backups. Sem a chave, o que está no disco é ilegível.
 * As chaves de identidade NÃO ficam aqui: a frase de recuperação vai direto para o cofre.
 * Aumente VERSION se o formato dos dados mudar de forma incompatível.
 */
const VERSION = 1;
const PREFIX = `piu:v${VERSION}:`;
const WRITE_DELAY = 250;

let snapshot: Record<string, unknown> = {};
let loaded = false;
let dataKey: Uint8Array | null = null;
const enc = new TextEncoder(), dec = new TextDecoder();
const MARK = 'e1:';

function b64(b: Uint8Array) { let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s); }
function unb64(s: string) { const r = atob(s); return Uint8Array.from(r, c => c.charCodeAt(0)); }

function seal(key: string, value: unknown): string {
  if (!dataKey) throw new Error('Chave de dados indisponível.');
  const nonce = new Uint8Array(12); globalThis.crypto.getRandomValues(nonce);
  const ct = gcm(dataKey, nonce, enc.encode(PREFIX + key)).encrypt(enc.encode(JSON.stringify(value)));
  const out = new Uint8Array(12 + ct.length); out.set(nonce); out.set(ct, 12);
  return MARK + b64(out);
}

/** `undefined` se não abrir (chave errada, dado adulterado ou corrompido). */
function open(key: string, stored: string): unknown {
  if (!stored.startsWith(MARK) || !dataKey) return undefined;
  try {
    const raw = unb64(stored.slice(MARK.length));
    const pt = gcm(dataKey, raw.slice(0, 12), enc.encode(PREFIX + key)).decrypt(raw.slice(12));
    return JSON.parse(dec.decode(pt));
  } catch { return undefined; }
}
let epoch = 0;
const pending = new Map<string, ReturnType<typeof setTimeout>>();

/** Lê todos os valores salvos para a memória. Falhas de leitura não impedem o app de abrir. */
export async function loadPersisted(): Promise<void> {
  try {
    dataKey = await loadOrCreateDataKey();
    const keys = (await AsyncStorage.getAllKeys()).filter(k => k.startsWith(PREFIX));
    const pairs = await AsyncStorage.multiGet(keys);
    const next: Record<string, unknown> = {};
    const migrate: [string, string][] = [];
    for (const [k, v] of pairs) {
      if (v == null) continue;
      const name = k.slice(PREFIX.length);
      const opened = open(name, v);
      if (opened !== undefined) { next[name] = opened; continue; }
      if (v.startsWith(MARK)) continue; // cifrado com outra chave ou adulterado: descarta e usa o padrão
      // Formato antigo (texto puro): lê uma vez e regrava cifrado.
      try { next[name] = JSON.parse(v); migrate.push([k, seal(name, next[name])]); } catch { /* corrompido */ }
    }
    if (migrate.length) await AsyncStorage.multiSet(migrate);
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
    let sealed: string;
    try { sealed = seal(key, value); } catch { return; } // sem chave, não grava em texto puro
    AsyncStorage.setItem(PREFIX + key, sealed).catch(() => {});
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
  // Sem a chave antiga, qualquer resto no disco fica ilegível; uma nova é criada para o próximo uso.
  await clearDataKey();
  dataKey = await loadOrCreateDataKey().catch(() => null);
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
