/**
 * Chave de operador (design, Configurações: "Identidade de operador · Assina seus equipamentos.
 * Separada da sua identidade de conversa").
 *
 * - Uma chave Ed25519 por operador, gerada neste nó, guardada em `<data>/operator/keys.json` (0600,
 *   pasta 0700, gravação atômica), fora do `state.json`. Não tem relação com a identidade de
 *   conversa (o nó não tem nenhuma) nem com a carteira, nem com a chave técnica do nó.
 * - Assina a identidade técnica de cada equipamento (certificado `OPERATOR_CERT`, ver
 *   relay/operator-frames.ts) e a lista de revogação.
 * - Backup cifrado com senha: scrypt (N = 2^16, r = 8, p = 1) + XChaCha20-Poly1305, como o arquivo
 *   `.piu` do app (apps/mobile/src/lib/backupFile.ts), com o cabeçalho como dado associado.
 * - Rotação: chave nova; a antiga assina a nova (passo de rotação). Os certificados dos equipamentos
 *   e a lista de revogação são assinados de novo pela nova, e os outros nós do operador recebem a
 *   nova chave na próxima sincronização (quando o enlace LNNP com eles abre de novo ou na hora, se
 *   já estão conectados).
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomic } from './fsutil.js';
import { toHex, utf8 } from './protocol/bytes.js';
import type { KeyPair } from './protocol/keys.js';
import {
  type CertJson, fingerprint, type ListJson, listFromJson, listToJson, makeCert, makeRevocationList, makeRotation, type OperatorCert,
  operatorKeyPair, type RevocationList, type RotationStep, unhex,
} from './relay/operator-frames.js';

interface StepJson { prevPk: string; nextPk: string; at: number; sig: string }
interface KeyRecord {
  /** Semente atual (hex). Só aqui e no backup cifrado. */
  seed: string;
  createdAt: number;
  /** Passos de rotação, do mais antigo ao mais novo (a chave atual é o `nextPk` do último). */
  chain: StepJson[];
  revocation: ListJson | null;
  lastBackupAt?: number;
}
interface FileShape { v: 1; keys: Record<string, KeyRecord> }

export const MIN_BACKUP_PASSWORD = 10;
export const BACKUP_FILENAME = 'piu-operador.backup';
const DEFAULT_N = 1 << 16, MIN_N = 1 << 14, MAX_N = 1 << 20;
const MAX_BACKUP_BYTES = 256 * 1024;

export class OperatorKeyError extends Error {
  constructor(public code: 'PASSWORD' | 'FORMAT' | 'AUTH' | 'LIMIT', message: string) { super(message); }
}

/** A senha do backup serve? `null` = sim. */
export function backupPasswordProblem(p: string): string | null {
  if (p.length < MIN_BACKUP_PASSWORD) return `Use pelo menos ${MIN_BACKUP_PASSWORD} caracteres.`;
  if (new Set(p).size < 5) return 'Senha repetitiva demais.';
  return null;
}

const stepToJson = (s: RotationStep): StepJson => ({ prevPk: toHex(s.prevPk), nextPk: toHex(s.nextPk), at: s.at, sig: toHex(s.sig) });
const stepFromJson = (s: StepJson): RotationStep => ({ prevPk: unhex(s.prevPk), nextPk: unhex(s.nextPk), at: s.at, sig: unhex(s.sig) });
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const unb64 = (s: string) => Uint8Array.from(Buffer.from(s, 'base64url'));

interface BackupHeader { piu: 'operator-backup'; v: 1; kdf: { alg: 'scrypt'; N: number; r: number; p: number; salt: string }; aead: 'xchacha20poly1305'; nonce: string }
const headerAd = (h: BackupHeader) => utf8(['piu/operator-backup', h.v, h.kdf.alg, h.kdf.N, h.kdf.r, h.kdf.p, h.kdf.salt, h.aead, h.nonce].join('|'));
const deriveKey = (password: string, h: BackupHeader) =>
  scryptAsync(utf8(password.normalize('NFKC')), unb64(h.kdf.salt), { N: h.kdf.N, r: h.kdf.r, p: h.kdf.p, dkLen: 32, maxmem: 2 ** 31, asyncTick: 25 });

export class OperatorVault {
  private file: string | null;
  private s: FileShape = { v: 1, keys: {} };

  constructor(dataDir: string | null) {
    this.file = dataDir ? join(dataDir, 'operator', 'keys.json') : null;
    if (this.file && existsSync(this.file)) {
      chmodSync(this.file, 0o600);
      // Ilegível: erro ao subir, nunca uma chave nova por cima (sobrescrever perderia a chave do operador).
      const j = JSON.parse(readFileSync(this.file, 'utf8')) as FileShape;
      if (j?.v !== 1 || typeof j.keys !== 'object') throw new Error(`Chaves de operador ilegíveis em ${this.file}.`);
      this.s = j;
    }
  }

  private save() { if (this.file) writeFileAtomic(this.file, JSON.stringify(this.s)); }

  has(operatorId: string) { return !!this.s.keys[operatorId]; }

  /** Chave do operador, criada na primeira vez. */
  ensure(operatorId: string, now: number): KeyPair {
    if (!this.s.keys[operatorId]) {
      this.s.keys[operatorId] = { seed: toHex(randomBytes(32)), createdAt: now, chain: [], revocation: null };
      this.save();
    }
    return this.keyPair(operatorId)!;
  }

  keyPair(operatorId: string): KeyPair | null {
    const k = this.s.keys[operatorId];
    return k ? operatorKeyPair(unhex(k.seed)) : null;
  }

  /** Passos de rotação (vão no certificado, para os outros nós seguirem até a chave atual). */
  chain(operatorId: string): RotationStep[] { return (this.s.keys[operatorId]?.chain ?? []).map(stepFromJson); }

  /** Chaves da linhagem do operador, da primeira à atual (hex). */
  lineage(operatorId: string): string[] {
    const k = this.keyPair(operatorId);
    if (!k) return [];
    const chain = this.chain(operatorId);
    return chain.length ? [toHex(chain[0]!.prevPk), ...chain.map(s => toHex(s.nextPk))] : [toHex(k.pk)];
  }

  info(operatorId: string) {
    const k = this.s.keys[operatorId];
    const kp = this.keyPair(operatorId);
    if (!k || !kp) return null;
    return { publicKey: toHex(kp.pk), fingerprint: fingerprint(kp.pk), createdAt: k.createdAt, rotations: k.chain.length, rotatedAt: k.chain.at(-1)?.at ? k.chain.at(-1)!.at * 1000 : null, lastBackupAt: k.lastBackupAt ?? null };
  }

  /** Certificado da identidade técnica de um equipamento, assinado pela chave atual. */
  certify(operatorId: string, nodePk: Uint8Array, now: number): OperatorCert {
    return makeCert(this.ensure(operatorId, now), nodePk, Math.floor(now / 1000), this.chain(operatorId));
  }

  revocation(operatorId: string): RevocationList | null {
    const r = this.s.keys[operatorId]?.revocation;
    return r ? listFromJson(r) : null;
  }

  /** Revoga chaves de nó: nova lista (número maior), assinada pela chave atual. */
  revoke(operatorId: string, nodePks: Uint8Array[], now: number): RevocationList {
    const op = this.ensure(operatorId, now);
    const prev = this.revocation(operatorId);
    const list = makeRevocationList(op, (prev?.seq ?? 0) + 1, Math.floor(now / 1000), [...(prev?.revoked ?? []), ...nodePks]);
    this.s.keys[operatorId]!.revocation = listToJson(list);
    this.save();
    return list;
  }

  /** Rotação: chave nova assinada pela antiga; a lista de revogação passa para a nova (número maior). */
  rotate(operatorId: string, now: number): { previous: string; current: string } {
    const old = this.ensure(operatorId, now);
    const seed = randomBytes(32);
    const next = operatorKeyPair(seed);
    const k = this.s.keys[operatorId]!;
    if (k.chain.length >= 16) throw new OperatorKeyError('LIMIT', 'Rotações demais para esta chave. Gere uma chave nova restaurando outro backup.');
    k.chain.push(stepToJson(makeRotation(old, next.pk, Math.floor(now / 1000))));
    k.seed = toHex(seed);
    const prev = k.revocation ? listFromJson(k.revocation) : null;
    k.revocation = prev ? listToJson(makeRevocationList(next, prev.seq + 1, Math.floor(now / 1000), prev.revoked)) : null;
    this.save();
    return { previous: toHex(old.pk), current: toHex(next.pk) };
  }

  /** Backup cifrado com a senha escolhida (texto JSON de uma linha). `N` só muda nos testes. */
  async backup(operatorId: string, operatorName: string, password: string, now: number, o: { N?: number } = {}): Promise<string> {
    const problem = backupPasswordProblem(password);
    if (problem) throw new OperatorKeyError('PASSWORD', problem);
    this.ensure(operatorId, now);
    const k = this.s.keys[operatorId]!;
    const N = o.N ?? DEFAULT_N;
    const h: BackupHeader = { piu: 'operator-backup', v: 1, kdf: { alg: 'scrypt', N, r: 8, p: 1, salt: b64(randomBytes(16)) }, aead: 'xchacha20poly1305', nonce: b64(randomBytes(24)) };
    const key = await deriveKey(password, h);
    const content = { operator: operatorName, seed: k.seed, createdAt: k.createdAt, chain: k.chain, revocation: k.revocation, exportedAt: now };
    const ct = xchacha20poly1305(key, unb64(h.nonce), headerAd(h)).encrypt(utf8(JSON.stringify(content)));
    key.fill(0);
    k.lastBackupAt = now;
    this.save();
    return JSON.stringify({ ...h, ct: b64(ct) });
  }

  /**
   * Restaura um backup (por exemplo, num segundo nó do mesmo operador): a chave deste operador passa
   * a ser a do arquivo. Senha errada e arquivo adulterado dão o mesmo erro, de propósito.
   */
  async restore(operatorId: string, text: string, password: string): Promise<void> {
    if (text.length > MAX_BACKUP_BYTES) throw new OperatorKeyError('FORMAT', 'Arquivo grande demais para um backup de operador.');
    let f: BackupHeader & { ct: string };
    try { f = JSON.parse(text) as BackupHeader & { ct: string }; } catch { throw new OperatorKeyError('FORMAT', 'Não é um backup de operador do Piu.'); }
    if (f?.piu !== 'operator-backup' || f.v !== 1 || f.aead !== 'xchacha20poly1305' || f.kdf?.alg !== 'scrypt' || typeof f.ct !== 'string' || typeof f.nonce !== 'string' || typeof f.kdf.salt !== 'string') {
      throw new OperatorKeyError('FORMAT', 'Não é um backup de operador do Piu.');
    }
    const { N, r, p } = f.kdf;
    if (!Number.isInteger(N) || N < MIN_N || N > MAX_N || (N & (N - 1)) !== 0 || r !== 8 || p !== 1) throw new OperatorKeyError('FORMAT', 'Parâmetros do backup fora do esperado.');
    const key = await deriveKey(password, f);
    let content: { seed: string; createdAt: number; chain: StepJson[]; revocation: ListJson | null };
    try {
      const pt = xchacha20poly1305(key, unb64(f.nonce), headerAd(f)).decrypt(unb64(f.ct));
      content = JSON.parse(new TextDecoder().decode(pt));
    } catch { throw new OperatorKeyError('AUTH', 'Senha errada ou arquivo adulterado.'); } finally { key.fill(0); }
    if (typeof content.seed !== 'string' || !/^[0-9a-f]{64}$/.test(content.seed) || !Array.isArray(content.chain)) throw new OperatorKeyError('FORMAT', 'Backup incompleto.');
    this.s.keys[operatorId] = { seed: content.seed, createdAt: Number(content.createdAt) || 0, chain: content.chain, revocation: content.revocation ?? null };
    this.save();
  }
}
