/**
 * Estado do app no disco (`<userData>/state.bin`): estado do Messenger (sessões Double Ratchet,
 * contatos, fila), conversas e preferências. Cifrado com AES-256-GCM pela chave de dados do cofre
 * (vault.ts). Gravação atômica (tmp + rename). Inexistente → `null`. Ilegível (chave trocada, arquivo
 * adulterado) → `StoreUnreadableError`: quem abre decide, e o arquivo vai para quarentena
 * (`state.bin.corrupt-<ts>`) antes de qualquer gravação nova — nunca é sobrescrito em silêncio.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ConversationsState } from '../shared/conversations';
import type { BlockedContact, Prefs, TempMode } from '../shared/types';
import type { LockAttempts, LockSecret } from './lockPassword';
import { tm } from './i18n';

export interface AppState {
  v: 1;
  /** `Messenger.export()` (contém segredos de sessão). */
  messenger: string | null;
  conversations: ConversationsState;
  prefs: Prefs;
  /** Último endereço Lunes compartilhado com os contatos (evita reenviar a cada abertura). */
  walletShared?: string | null;
  /** Conversas silenciadas neste computador (ids). */
  muted?: string[];
  /** Contatos bloqueados neste computador (o mensageiro descarta o que eles mandam). */
  blocked?: BlockedContact[];
  /** Mensagens temporárias por conversa. */
  temp?: Record<string, TempMode>;
  /** Senha do Piu (só o scrypt com sal) e as tentativas erradas seguidas, para a espera valer depois de reabrir. */
  lock?: { secret: LockSecret | null; attempts: LockAttempts };
}

export class StoreUnreadableError extends Error {
  constructor() { super(tm('main.store.unreadable')); this.name = 'StoreUnreadableError'; }
}

const MAGIC = Buffer.from('PIUD1');
const IV_BYTES = 12;

export class Store {
  constructor(private file: string, private key: Buffer) {
    if (key.length !== 32) throw new Error('Chave de dados inválida.');
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  }

  load(): AppState | null {
    let raw: Buffer;
    try { raw = readFileSync(this.file); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new StoreUnreadableError(); }
    let j: AppState;
    try {
      if (!raw.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('formato');
      const iv = raw.subarray(MAGIC.length, MAGIC.length + IV_BYTES);
      const tag = raw.subarray(raw.length - 16);
      const ct = raw.subarray(MAGIC.length + IV_BYTES, raw.length - 16);
      const d = createDecipheriv('aes-256-gcm', this.key, iv);
      d.setAuthTag(tag);
      const plain = Buffer.concat([d.update(ct), d.final()]).toString('utf8');
      j = JSON.parse(plain) as AppState;
    } catch { throw new StoreUnreadableError(); }
    if (!j || j.v !== 1) throw new StoreUnreadableError();
    return j;
  }

  /** Move o arquivo ilegível para `state.bin.corrupt-<ts>` (fica guardado como estava). Devolve o caminho novo. */
  quarantine(): string | null {
    if (!existsSync(this.file)) return null;
    let to = `${this.file}.corrupt-${Date.now()}`;
    for (let i = 1; existsSync(to); i++) to = `${this.file}.corrupt-${Date.now() + i}`;
    renameSync(this.file, to);
    return to;
  }

  save(state: AppState) {
    const iv = randomBytes(IV_BYTES);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([c.update(JSON.stringify(state), 'utf8'), c.final()]);
    const out = Buffer.concat([MAGIC, iv, ct, c.getAuthTag()]);
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, out, { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}
