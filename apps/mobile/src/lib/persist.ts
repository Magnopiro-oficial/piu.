import { gcm } from '@noble/ciphers/aes.js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { clearDataKey, loadOrCreateDataKey } from './vault';
import { completePersistedWrite, createResetGuard, missingStoredKeys, oncePerProcess, readSealedValue } from './persistSafety';

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
let storageReadFailed = true;
const unreadable = new Set<string>();
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
// Geração dos dados e "reset em andamento" ("Apagar dados locais").
const guard = createResetGuard();
/** Geração atual dos dados: muda a cada "Apagar dados locais". */
export const persistEpoch = () => guard.epoch();
const pending = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Lê todos os valores salvos para a memória. Falhas de leitura não impedem o app de abrir.
 * Uma vez por processo: o núcleo (core/node.ts) e a tela que remonta depois de deslizar o app dos
 * recentes dividem o mesmo `snapshot`; reler o disco perderia gravações ainda no atraso de `schedule`.
 */
export const loadPersisted = oncePerProcess(async (): Promise<void> => {
  storageReadFailed = true;
  unreadable.clear();
  try {
    dataKey = await loadOrCreateDataKey();
    const keys = (await AsyncStorage.getAllKeys()).filter(k => k.startsWith(PREFIX));
    const pairs = await AsyncStorage.multiGet(keys);
    for (const k of missingStoredKeys(keys, pairs.map(([key]) => key))) unreadable.add(k.slice(PREFIX.length));
    const next: Record<string, unknown> = {};
    for (const [k, v] of pairs) {
      const name = k.slice(PREFIX.length);
      if (v == null) { unreadable.add(name); continue; }
      // Só vale o que abre com a chave; texto puro ou adulterado fica ilegível (não confundir com ausência).
      const r = readSealedValue(v, s => open(name, s));
      if (r.ok) next[name] = r.value; else unreadable.add(name);
    }
    snapshot = next;
    storageReadFailed = false;
  } catch {
    snapshot = {};
  }
  loaded = true;
});

export const isPersistLoaded = () => loaded;
/** Uma falha geral ou no campo impede assumir que ele estava ausente. */
export const persistedReadFailed = (key: string) => storageReadFailed || unreadable.has(key);

function schedule(key: string, value: unknown) {
  clearTimeout(pending.get(key));
  const at = guard.epoch();
  pending.set(key, setTimeout(() => {
    pending.delete(key);
    if (at !== guard.epoch()) return; // apagado no meio do caminho
    if (guard.resetting()) { schedule(key, value); return; } // estado novo: espera o apagamento terminar
    snapshot[key] = value;
    let sealed: string;
    try { sealed = seal(key, value); } catch { return; } // sem chave, não grava em texto puro
    AsyncStorage.setItem(PREFIX + key, sealed).catch(() => {});
  }, WRITE_DELAY));
}

/** Valor salvo (já carregado por `loadPersisted`), sem hook. */
export const readPersisted = <T,>(key: string): T | undefined => snapshot[key] as T | undefined;

/**
 * Grava já, sem atraso, e só resolve depois de gravado. Para estado que não pode voltar atrás
 * (ex.: catraca das sessões: reusar uma chave de mensagem depois de um travamento seria grave).
 */
export async function persistNow(key: string, value: unknown): Promise<void> {
  guard.assertWritable(); // durante o "Apagar dados locais" nada é regravado, nem em memória
  clearTimeout(pending.get(key));
  pending.delete(key);
  const at = guard.epoch();
  // Mantém a atualização imediata em memória usada por assinantes existentes.
  snapshot[key] = value;
  const sealed = seal(key, value); // sem chave, falha: quem chama não deve transmitir
  await completePersistedWrite(at, guard.epoch,
    () => AsyncStorage.setItem(PREFIX + key, sealed),
    () => AsyncStorage.removeItem(PREFIX + key),
    () => {});
}

/** Apaga todos os dados do Piu neste aparelho e cancela gravações pendentes. */
export async function clearPersisted(): Promise<void> {
  storageReadFailed = true;
  unreadable.clear();
  pending.forEach(clearTimeout);
  pending.clear();
  // A memória é limpa na hora e de novo ao final; no intervalo, gravações são recusadas.
  await guard.run(() => { snapshot = {}; }, async () => {
    try {
      const keys = (await AsyncStorage.getAllKeys()).filter(k => k.startsWith(PREFIX));
      await AsyncStorage.multiRemove(keys);
    } catch { /* nada a fazer */ }
    // Sem a chave antiga, qualquer resto no disco fica ilegível; uma nova é criada para o próximo uso.
    await clearDataKey();
    dataKey = await loadOrCreateDataKey().catch(() => null);
  });
}

/**
 * Apaga um campo que o app não usa mais (migração). Fica fora do disco, não só da memória.
 */
export async function forgetPersisted(key: string): Promise<void> {
  clearTimeout(pending.get(key));
  pending.delete(key);
  if (!(key in snapshot)) return;
  delete snapshot[key];
  try { await AsyncStorage.removeItem(PREFIX + key); } catch { /* fica cifrado; some no próximo "Apagar dados locais" */ }
}

/** Tamanho aproximado do que o Piu guarda neste aparelho (bytes, antes da cifragem). */
export function persistedBytes(): number {
  let n = 0;
  for (const [k, v] of Object.entries(snapshot)) n += k.length + (JSON.stringify(v)?.length ?? 0);
  return n;
}

/**
 * Como `useState`, mas salvo no aparelho sob `key`.
 * `revive` ajusta o valor lido (ex.: transferências que não podem continuar depois de fechar o app,
 * ou a limpeza dos dados de exemplo). Se `revive` mudar o valor, o resultado é regravado.
 */
export function usePersisted<T>(key: string, initial: T | (() => T), revive?: (saved: T) => T): [T, Dispatch<SetStateAction<T>>] {
  const revived = useRef(false);
  const [value, setValue] = useState<T>(() => {
    if (key in snapshot) {
      const saved = snapshot[key] as T;
      if (!revive) return saved;
      const v = revive(saved);
      revived.current = v !== saved;
      return v;
    }
    return typeof initial === 'function' ? (initial as () => T)() : initial;
  });
  const first = useRef(true);
  useEffect(() => {
    // Não regrava o que acabou de ser lido (a não ser que `revive` tenha mudado algo).
    if (first.current) { first.current = false; if (!revived.current) return; }
    schedule(key, value);
  }, [key, value]);
  return [value, setValue];
}
