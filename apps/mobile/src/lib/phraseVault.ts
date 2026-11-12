/**
 * Frase de recuperação atrás da biometria do sistema (auditoria 2026-11-06, B-01).
 * Desenho, migração e tradeoffs: docs/seguranca/biometria-cofre.md. TypeScript puro (testado no Node):
 * o cofre real (`expo-secure-store`) e o pedido de bloqueio entram por `VaultDeps` (lib/vault.ts).
 *
 * - `KEYS_KEY` (sem autenticação): semente do Piu (identidades, chave do nó) + endereço da carteira.
 *   Abre o app e serve o segundo plano. Não deixa chegar à frase nem à chave da carteira.
 * - `BIO_KEY` (`requireAuthentication`): a frase, lida só para revelar, assinar e transferir.
 * - `LEGACY_KEY` (sem autenticação, versão anterior): fica enquanto a frase não foi movida.
 *   Só é movida com biometria forte E cópia da frase fora do aparelho (backup feito ou restaurado
 *   pela frase/arquivo): troca de biometria invalida o item e, sem cópia, seria perda definitiva.
 */
import type { AuthResult } from './deviceAuth';

export const LEGACY_KEY = 'piu.phrase.v1';
export const KEYS_KEY = 'piu.keys.v2';
export const BIO_KEY = 'piu.phrase.bio.v1';
/** Depois de uma falha que não foi a pessoa cancelando, a migração espera um dia. */
export const MIGRATE_RETRY_MS = 24 * 60 * 60 * 1000;

export interface VaultStore {
  /** Com `auth`, lê o item com biometria (o sistema mostra o pedido). Pode lançar (cancelado, sem biometria…). */
  get(key: string, auth?: { prompt: string }): Promise<string | null>;
  set(key: string, value: string, auth?: { prompt: string }): Promise<void>;
  del(key: string, auth?: boolean): Promise<void>;
}

export interface VaultDeps {
  store: VaultStore;
  /** Semente do Piu em hexa (protocol/phrase.ts `seedFromPhrase`). */
  seedOf: (words: string[]) => string;
  /** Endereço da carteira (público); null se não der para derivar. */
  walletOf: (words: string[]) => string | null;
  isValid: (words: string[]) => boolean;
  /** Dá para usar `requireAuthentication` (Android: biometria forte; iPhone: Face ID/Touch ID)? */
  strongBiometrics: () => Promise<boolean>;
  confirmDevice: (prompt: string) => Promise<AuthResult>;
  now: () => number;
}

/** Chaves de uso diário: o que o app precisa sem pedir nada. */
export interface DailyKeys {
  v: 2;
  seed: string;
  wallet: string | null;
  /** Onde está a frase: item antigo (sem autenticação) ou item com biometria. */
  at: 'legacy' | 'bio';
  /** A pessoa já tem a frase fora do aparelho (restaurou digitando ou pelo arquivo). */
  known?: boolean;
  /** Não tentar migrar antes deste instante (ms). */
  retryAt?: number;
}

export type Unlock =
  | { status: 'ok'; words: string[] }
  | { status: 'denied' }
  /** Aparelho sem bloqueio de tela: quem chama recusa (M-01), a não ser na web. */
  | { status: 'unavailable' }
  /** A frase não pode ser lida neste aparelho: pedir de novo (frase ou arquivo de backup). */
  | { status: 'recover'; reason: 'invalidated' | 'noBiometrics' | 'missing' };

export interface UnlockOptions {
  /** Texto do pedido (operação). */
  prompt: string;
  /** Texto do pedido ao gravar a frase com biometria (só na migração; o Android pede também ao gravar). */
  protectPrompt: string;
  /** Backup concluído (`set.backupDone`). */
  backedUp: boolean;
  /** Seguir sem bloqueio de tela (só a web, que é demonstração). */
  allowWithoutLock?: boolean;
}

/** Erro do pedido de biometria do `expo-secure-store` (mensagem nativa, Android e iPhone). */
export function classifyAuthError(e: unknown): 'cancel' | 'noBiometrics' | 'other' {
  const m = (e instanceof Error ? e.message : typeof e === 'string' ? e : '').toLowerCase();
  if (m.includes('cancel')) return 'cancel';
  if (/no biometrics|not enrolled|none enrolled|no hardware|hardware not present|biometric authentication is unsupported|passcode not set/.test(m)) return 'noBiometrics';
  return 'other';
}

const split = (v: string | null) => (v ? v.split(' ') : null);

async function readKeys(d: VaultDeps): Promise<DailyKeys | null> {
  try {
    const v = await d.store.get(KEYS_KEY);
    if (!v) return null;
    const k = JSON.parse(v) as DailyKeys;
    return k && k.v === 2 && typeof k.seed === 'string' && (k.at === 'legacy' || k.at === 'bio') ? k : null;
  } catch { return null; }
}

const writeKeys = (d: VaultDeps, k: DailyKeys) => {
  const { retryAt, known, ...rest } = k;
  return d.store.set(KEYS_KEY, JSON.stringify({ ...rest, ...(known !== undefined ? { known } : {}), ...(retryAt ? { retryAt } : {}) }));
};

async function readLegacy(d: VaultDeps): Promise<string[] | null> {
  try { return split(await d.store.get(LEGACY_KEY)); } catch { return null; }
}

const matches = (d: VaultDeps, w: string[] | null, k: DailyKeys): w is string[] => {
  if (!w || !d.isValid(w)) return false;
  try { return d.seedOf(w) === k.seed; } catch { return false; }
};

const quietDel = async (d: VaultDeps, key: string, auth?: boolean) => { try { await d.store.del(key, auth); } catch { /* fica para a próxima */ } };

/**
 * Abertura (sem pedir nada). Instalação da versão anterior: deriva as chaves do dia do item antigo,
 * grava e segue; o item antigo não é apagado aqui.
 */
export async function bootVault(d: VaultDeps): Promise<DailyKeys | null> {
  const k = await readKeys(d);
  if (k) return k;
  const old = await readLegacy(d);
  if (!old || !d.isValid(old)) return null;
  const keys: DailyKeys = { v: 2, seed: d.seedOf(old), wallet: d.walletOf(old), at: 'legacy' };
  try { await writeKeys(d, keys); } catch { /* segue com elas na memória; tenta de novo na próxima abertura */ }
  return keys;
}

/** Criar ou restaurar: item antigo + chaves do dia; o item com biometria de antes sai. */
export async function storePhrase(d: VaultDeps, words: string[], o: { known?: boolean } = {}): Promise<DailyKeys> {
  const keys: DailyKeys = { v: 2, seed: d.seedOf(words), wallet: d.walletOf(words), at: 'legacy', known: !!o.known };
  await d.store.set(LEGACY_KEY, words.join(' '));
  await writeKeys(d, keys);
  await quietDel(d, BIO_KEY, true);
  return keys;
}

/** Move a frase para o item com biometria. 'ok' só depois de ler de volta igual e apagar o antigo. */
async function migrate(d: VaultDeps, k: DailyKeys, words: string[], o: UnlockOptions): Promise<'ok' | 'cancel' | 'fail'> {
  const undo = () => quietDel(d, BIO_KEY, true);
  const fail = async () => {
    await undo();
    try { await writeKeys(d, { ...k, retryAt: d.now() + MIGRATE_RETRY_MS }); } catch { /* tenta de novo antes, sem problema */ }
    return 'fail' as const;
  };
  const joined = words.join(' ');
  await undo(); // resto de uma tentativa anterior
  try { await d.store.set(BIO_KEY, joined, { prompt: o.protectPrompt }); }
  catch (e) { if (classifyAuthError(e) === 'cancel') { await undo(); return 'cancel'; } return fail(); }
  let back: string | null;
  try { back = await d.store.get(BIO_KEY, { prompt: o.prompt }); }
  catch (e) { if (classifyAuthError(e) === 'cancel') { await undo(); return 'cancel'; } return fail(); }
  if (back !== joined) return fail();
  try { await writeKeys(d, { ...k, at: 'bio', retryAt: undefined }); } catch { return fail(); }
  await quietDel(d, LEGACY_KEY);
  return 'ok';
}

/** Frase para revelar, assinar ou transferir. Faz a migração no momento em que a pessoa espera o pedido. */
export async function unlockPhrase(d: VaultDeps, o: UnlockOptions): Promise<Unlock> {
  let k = await readKeys(d);
  if (!k) return { status: 'recover', reason: 'missing' };
  if (k.at === 'bio') {
    let v: string | null = null;
    let noBio = false;
    try { v = await d.store.get(BIO_KEY, { prompt: o.prompt }); }
    catch (e) {
      const c = classifyAuthError(e);
      if (c !== 'noBiometrics') return { status: 'denied' };
      noBio = true;
    }
    const words = split(v);
    if (matches(d, words, k)) { await quietDel(d, LEGACY_KEY); return { status: 'ok', words }; }
    // Ilegível (biometria trocada, bloqueio removido) ou sem biometria: o item antigo ainda existe?
    const old = await readLegacy(d);
    if (!matches(d, old, k)) return { status: 'recover', reason: noBio ? 'noBiometrics' : 'invalidated' };
    k = { ...k, at: 'legacy' };
    try { await writeKeys(d, k); } catch { /* segue */ }
  }
  const old = await readLegacy(d);
  if (!matches(d, old, k)) return { status: 'recover', reason: 'missing' };
  const eligible = (o.backedUp || !!k.known) && !(k.retryAt && k.retryAt > d.now()) && await d.strongBiometrics().catch(() => false);
  if (eligible) {
    const r = await migrate(d, k, old, o);
    if (r === 'ok') return { status: 'ok', words: old };
    if (r === 'cancel') return { status: 'denied' };
  }
  const a = await d.confirmDevice(o.prompt);
  if (a === 'denied') return { status: 'denied' };
  if (a === 'unavailable' && !o.allowWithoutLock) return { status: 'unavailable' };
  return { status: 'ok', words: old };
}

/**
 * A frase ficou ilegível (biometria trocada): a pessoa digita de novo (ou abre o arquivo de backup).
 * Só aceita a frase desta identidade (mesma semente). Volta para o item antigo; a próxima operação migra.
 */
export async function recoverPhrase(d: VaultDeps, words: string[]): Promise<boolean> {
  const k = await readKeys(d);
  if (!k || !matches(d, words, k)) return false;
  await d.store.set(LEGACY_KEY, words.join(' '));
  await writeKeys(d, { ...k, at: 'legacy', known: true, retryAt: undefined });
  await quietDel(d, BIO_KEY, true);
  return true;
}

/**
 * Itens do cofre que "Apagar dados locais" remove além da frase e das chaves do dia: os nós pareados
 * do provider (lib/vault.ts, com o segredo de aprovação de cada um) e o segredo do ponto
 * (lib/pointSecret.ts). A chave de dados sai em clearPersisted (lib/persist.ts).
 * Teste em __tests__/vaultWipe.test.ts: chave nova do cofre fora desta lista faz o teste falhar.
 */
const OTHER_KEYS = ['piu.approvals.v1', 'piu.point.secret.v1'];
export const VAULT_WIPE_KEYS: readonly string[] = [BIO_KEY, LEGACY_KEY, KEYS_KEY, ...OTHER_KEYS];

/** "Apagar dados locais". */
export async function wipeVault(d: VaultDeps): Promise<void> {
  await quietDel(d, BIO_KEY, true);
  await quietDel(d, LEGACY_KEY);
  await quietDel(d, KEYS_KEY);
  for (const k of OTHER_KEYS) await quietDel(d, k);
}
