/**
 * Cofre do computador para segredos, pelo `safeStorage` do Electron:
 * Keychain (macOS), Secret Service/libsecret (Linux) e DPAPI (Windows).
 * - a frase de recuperação (de onde saem todas as chaves);
 * - a chave de dados (AES-256) que cifra o estado do app no disco (store.ts).
 * Os arquivos em `<userData>/vault/` só têm o que o cofre cifrou; sem o cofre do sistema, a frase
 * NUNCA é gravada (o app avisa e não cria a identidade).
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** O que usamos do `safeStorage` (injetável nos testes). */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

const PHRASE_FILE = 'phrase.bin';
const DATAKEY_FILE = 'datakey.bin';

export class Vault {
  constructor(private dir: string, private ss: SafeStorageLike) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  /** O cofre do sistema está disponível? (Linux sem Secret Service: não.) */
  get secure() { try { return this.ss.isEncryptionAvailable(); } catch { return false; } }

  private read(name: string): string | null {
    try { return this.ss.decryptString(readFileSync(join(this.dir, name))); } catch { return null; }
  }

  private write(name: string, plain: string) {
    if (!this.secure) throw new Error('O cofre do sistema não está disponível neste computador; a frase não pode ser guardada com segurança.');
    const file = join(this.dir, name), tmp = file + '.tmp';
    writeFileSync(tmp, this.ss.encryptString(plain), { mode: 0o600 });
    renameSync(tmp, file);
  }

  async getPhrase(): Promise<string[] | null> {
    const v = this.read(PHRASE_FILE);
    return v ? v.split(' ') : null;
  }

  async setPhrase(words: string[]): Promise<void> { this.write(PHRASE_FILE, words.join(' ')); }

  /** Chave de dados de 256 bits: criada na primeira abertura com o gerador seguro do sistema. */
  async dataKey(): Promise<Buffer> {
    const saved = this.read(DATAKEY_FILE);
    if (saved && /^[0-9a-f]{64}$/.test(saved)) return Buffer.from(saved, 'hex');
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
