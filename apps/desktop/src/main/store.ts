/**
 * Estado do app no disco (`<userData>/state.bin`): estado do Messenger (sessões Double Ratchet,
 * contatos, fila), conversas e preferências. Cifrado com AES-256-GCM pela chave de dados do cofre
 * (vault.ts). Gravação atômica (tmp + rename). Ilegível (chave trocada, arquivo adulterado) → `null`:
 * o app começa limpo em vez de quebrar.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ConversationsState } from '../shared/conversations';
import type { Prefs } from '../shared/types';

export interface AppState {
  v: 1;
  /** `Messenger.export()` (contém segredos de sessão). */
  messenger: string | null;
  conversations: ConversationsState;
  prefs: Prefs;
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
    try { raw = readFileSync(this.file); } catch { return null; }
    try {
      if (!raw.subarray(0, MAGIC.length).equals(MAGIC)) return null;
      const iv = raw.subarray(MAGIC.length, MAGIC.length + IV_BYTES);
      const tag = raw.subarray(raw.length - 16);
      const ct = raw.subarray(MAGIC.length + IV_BYTES, raw.length - 16);
      const d = createDecipheriv('aes-256-gcm', this.key, iv);
      d.setAuthTag(tag);
      const plain = Buffer.concat([d.update(ct), d.final()]).toString('utf8');
      const j = JSON.parse(plain) as AppState;
      return j && j.v === 1 ? j : null;
    } catch { return null; }
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
