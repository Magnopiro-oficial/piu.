/**
 * Cofre do computador para segredos, pelo `safeStorage` do Electron:
 * Keychain (macOS), Secret Service/libsecret (Linux) e DPAPI (Windows).
 * - a frase de recuperação (de onde saem todas as chaves);
 * - a chave de dados (AES-256) que cifra o estado do app no disco (store.ts).
 * Os arquivos em `<userData>/vault/` só têm o que o cofre cifrou; sem o cofre do sistema, a frase
 * NUNCA é gravada (o app avisa e não cria a identidade).
 * Falha fechada: arquivo que existe mas não abre (Keychain negado/bloqueado, libsecret sem resposta,
 * conteúdo estranho) é `VaultLockedError`, nunca "não existe" — nada é gerado nem gravado por cima.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tm } from './i18n';

/** O que usamos do `safeStorage` (injetável nos testes). */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
  /** Só Linux: backend em uso (`basic_text` = senha fixa conhecida, não é cofre). */
  getSelectedStorageBackend?(): string;
}

/** O cofre do sistema existe, mas recusou abrir o que está guardado (ou o conteúdo não é o esperado). */
export class VaultLockedError extends Error {
  constructor(message = tm('main.vault.denied')) {
    super(message);
    this.name = 'VaultLockedError';
  }
}

/** Backends do Linux sem segredo de verdade (a "cifra" usa senha fixa). */
const INSECURE_LINUX_BACKENDS = ['basic_text', 'unknown'];

const PHRASE_FILE = 'phrase.bin';
const DATAKEY_FILE = 'datakey.bin';

export class Vault {
  constructor(private dir: string, private ss: SafeStorageLike, private platform: string = process.platform) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  /** O cofre do sistema está disponível? (Linux sem Secret Service ou com `basic_text`: não.) */
  get secure() {
    try {
      if (this.platform === 'linux' && this.ss.getSelectedStorageBackend && INSECURE_LINUX_BACKENDS.includes(this.ss.getSelectedStorageBackend())) return false;
      return this.ss.isEncryptionAvailable();
    } catch { return false; }
  }

  /** `null` só quando o arquivo NÃO existe; existir e não abrir é `VaultLockedError`. */
  private read(name: string): string | null {
    let raw: Buffer;
    try { raw = readFileSync(join(this.dir, name)); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new VaultLockedError(); }
    try { return this.ss.decryptString(raw); } catch { throw new VaultLockedError(); }
  }

  /** Nunca grava por cima de um segredo existente (apagar é sempre explícito, por `clear`). */
  private write(name: string, plain: string) {
    if (!this.secure) throw new Error(tm('main.vault.unavailable'));
    const file = join(this.dir, name), tmp = file + '.tmp';
    if (existsSync(file)) throw new Error(tm('main.vault.secretExists'));
    writeFileSync(tmp, this.ss.encryptString(plain), { mode: 0o600 });
    renameSync(tmp, file);
  }

  /** Há frase guardada (mesmo que o cofre não a deixe abrir agora)? */
  hasPhrase() { return existsSync(join(this.dir, PHRASE_FILE)); }

  async getPhrase(): Promise<string[] | null> {
    const v = this.read(PHRASE_FILE);
    return v ? v.split(' ') : null;
  }

  async setPhrase(words: string[]): Promise<void> {
    if (this.hasPhrase()) throw new Error(tm('main.vault.phraseExists'));
    this.write(PHRASE_FILE, words.join(' '));
  }

  /** Chave de dados de 256 bits: criada na primeira abertura com o gerador seguro do sistema. */
  async dataKey(): Promise<Buffer> {
    const saved = this.read(DATAKEY_FILE);
    if (saved !== null) {
      if (/^[0-9a-f]{64}$/.test(saved)) return Buffer.from(saved, 'hex');
      // Existe mas não é uma chave: não gera outra por cima (o estado cifrado ficaria ilegível para sempre).
      throw new VaultLockedError(tm('main.vault.dataKeyUnreadable'));
    }
    const key = Buffer.alloc(32);
    globalThis.crypto.getRandomValues(key);
    this.write(DATAKEY_FILE, key.toString('hex'));
    return key;
  }

  /** Apaga frase e chave de dados: o estado cifrado restante fica ilegível (crypto-shredding). */
  async clear(): Promise<void> {
    for (const f of [PHRASE_FILE, DATAKEY_FILE]) rmSync(join(this.dir, f), { force: true });
  }
}
