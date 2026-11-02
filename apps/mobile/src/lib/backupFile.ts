/**
 * Arquivo de backup cifrado (`.piu`): leva a frase de recuperação (e, opcionalmente, dados do app)
 * protegida por uma senha escolhida pela pessoa. TypeScript puro: roda no app e no Node (testes).
 *
 * - Senha → chave: scrypt (N = 2^16, r = 8, p = 1, 64 MiB de memória; @noble/hashes) com sal aleatório de 16 bytes.
 * - Cifra: XChaCha20-Poly1305 (@noble/ciphers) com nonce aleatório de 24 bytes.
 * - O cabeçalho inteiro (versão, parâmetros do scrypt, sal e nonce) entra como dado associado:
 *   trocar qualquer campo (ex.: baixar o custo do scrypt) faz a abertura falhar.
 * - Senha errada e arquivo adulterado são indistinguíveis de propósito (o AEAD só diz "não confere").
 *
 * Formato (texto JSON, uma linha):
 * {"piu":"backup","v":1,"kdf":{"alg":"scrypt","N":65536,"r":8,"p":1,"salt":"…"},"aead":"xchacha20poly1305","nonce":"…","ct":"…"}
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { b64url, unb64url } from '../messaging/card';
import { fromUtf8, utf8 } from '../protocol/bytes';
import { isValidPhrase } from '../protocol/phrase';

export const BACKUP_VERSION = 1;
export const BACKUP_EXT = '.piu';
export const BACKUP_MIME = 'application/octet-stream';
/** Senha mínima. O scrypt encarece cada tentativa, mas senha curta continua fraca. */
export const MIN_PASSWORD = 10;
/** Custo padrão do scrypt (2^16). Aceitamos de 2^14 a 2^20 ao abrir: abaixo é fraco demais, acima trava o aparelho. */
export const DEFAULT_N = 1 << 16;
const MIN_N = 1 << 14, MAX_N = 1 << 20;
/** Arquivos maiores que isso são recusados antes de qualquer conta. */
export const MAX_BACKUP_BYTES = 32 * 1024 * 1024;

/** O que vai dentro do arquivo. `data`: valores salvos do app (histórico), sem as chaves de sessão. */
export interface BackupContent {
  phrase: string[];
  createdAt: number;
  /** Nome do aparelho de origem (só informativo). */
  from?: string;
  data?: Record<string, unknown>;
}

interface Header { piu: 'backup'; v: number; kdf: { alg: 'scrypt'; N: number; r: number; p: number; salt: string }; aead: 'xchacha20poly1305'; nonce: string }
interface FileShape extends Header { ct: string }

export class BackupError extends Error {
  /** FORMAT: não é um backup do Piu (ou versão desconhecida). AUTH: senha errada ou arquivo adulterado. */
  constructor(public code: 'FORMAT' | 'AUTH' | 'CONTENT' | 'PASSWORD', message: string) { super(message); this.name = 'BackupError'; }
}

export interface KdfProgress { onProgress?: (fraction: number) => void }

/** Dado associado: o cabeçalho em ordem fixa (não depende da ordem das chaves no JSON). */
const headerAd = (h: Header) => utf8(['piu/backup', h.v, h.kdf.alg, h.kdf.N, h.kdf.r, h.kdf.p, h.kdf.salt, h.aead, h.nonce].join('|'));

const normalizePassword = (p: string) => utf8(p.normalize('NFKC'));

async function deriveKey(password: string, h: Header, o: KdfProgress) {
  return scryptAsync(normalizePassword(password), unb64url(h.kdf.salt), {
    N: h.kdf.N, r: h.kdf.r, p: h.kdf.p, dkLen: 32, maxmem: 2 ** 31, asyncTick: 25, onProgress: o.onProgress,
  });
}

/** Avalia a senha escolhida para o arquivo. `null` = boa o suficiente. */
export function passwordProblem(p: string): string | null {
  if (p.length < MIN_PASSWORD) return `Use pelo menos ${MIN_PASSWORD} caracteres.`;
  if (new Set(p).size < 5) return 'Senha repetitiva demais.';
  return null;
}

/** Cifra o conteúdo com a senha e devolve o texto do arquivo. `N` só muda nos testes. */
export async function sealBackup(content: BackupContent, password: string, o: KdfProgress & { N?: number } = {}): Promise<string> {
  if (!isValidPhrase(content.phrase)) throw new BackupError('CONTENT', 'Frase inválida.');
  const problem = passwordProblem(password);
  if (problem) throw new BackupError('PASSWORD', problem);
  const N = o.N ?? DEFAULT_N;
  if (N < MIN_N || N > MAX_N || (N & (N - 1)) !== 0) throw new BackupError('FORMAT', 'Custo do scrypt fora do intervalo.');
  const h: Header = { piu: 'backup', v: BACKUP_VERSION, kdf: { alg: 'scrypt', N, r: 8, p: 1, salt: b64url(randomBytes(16)) }, aead: 'xchacha20poly1305', nonce: b64url(randomBytes(24)) };
  const key = await deriveKey(password, h, o);
  const ct = xchacha20poly1305(key, unb64url(h.nonce), headerAd(h)).encrypt(utf8(JSON.stringify(content)));
  key.fill(0);
  const file: FileShape = { ...h, ct: b64url(ct) };
  return JSON.stringify(file);
}

/** Lê só o cabeçalho (sem senha): confere se parece um backup do Piu. Lança BackupError('FORMAT'). */
export function parseBackupHeader(text: string): Header {
  if (text.length > MAX_BACKUP_BYTES * 2) throw new BackupError('FORMAT', 'Arquivo grande demais.');
  let f: Partial<FileShape>;
  try { f = JSON.parse(text.trim()); } catch { throw new BackupError('FORMAT', 'Este arquivo não é um backup do Piu.'); }
  const k = f?.kdf;
  const ok = f && f.piu === 'backup' && f.aead === 'xchacha20poly1305' && typeof f.nonce === 'string' && typeof f.ct === 'string'
    && k && k.alg === 'scrypt' && Number.isInteger(k.N) && Number.isInteger(k.r) && Number.isInteger(k.p) && typeof k.salt === 'string';
  if (!ok) throw new BackupError('FORMAT', 'Este arquivo não é um backup do Piu.');
  if (f.v !== BACKUP_VERSION) throw new BackupError('FORMAT', 'Backup de uma versão do Piu que este app não conhece. Atualize o app.');
  if (k!.N < MIN_N || k!.N > MAX_N || (k!.N & (k!.N - 1)) !== 0 || k!.r !== 8 || k!.p !== 1) throw new BackupError('FORMAT', 'Parâmetros de cifragem inválidos.');
  return { piu: 'backup', v: f.v!, kdf: { alg: 'scrypt', N: k!.N, r: k!.r, p: k!.p, salt: k!.salt }, aead: 'xchacha20poly1305', nonce: f.nonce! };
}

/** Abre o arquivo com a senha. Lança BackupError (FORMAT, AUTH ou CONTENT). */
export async function openBackup(text: string, password: string, o: KdfProgress = {}): Promise<BackupContent> {
  const h = parseBackupHeader(text);
  let salt: Uint8Array, nonce: Uint8Array, ct: Uint8Array;
  try { salt = unb64url(h.kdf.salt); nonce = unb64url(h.nonce); ct = unb64url((JSON.parse(text.trim()) as FileShape).ct); }
  catch { throw new BackupError('FORMAT', 'Arquivo corrompido.'); }
  if (salt.length !== 16 || nonce.length !== 24) throw new BackupError('FORMAT', 'Arquivo corrompido.');
  const key = await deriveKey(password, h, o);
  let pt: Uint8Array;
  try { pt = xchacha20poly1305(key, nonce, headerAd(h)).decrypt(ct); }
  catch { throw new BackupError('AUTH', 'Senha errada ou arquivo adulterado.'); }
  finally { key.fill(0); }
  let c: BackupContent;
  try { c = JSON.parse(fromUtf8(pt)); } catch { throw new BackupError('CONTENT', 'Conteúdo do backup ilegível.'); }
  if (!Array.isArray(c?.phrase) || !isValidPhrase(c.phrase)) throw new BackupError('CONTENT', 'O backup não traz uma frase válida.');
  return { phrase: c.phrase, createdAt: Number(c.createdAt) || 0, from: typeof c.from === 'string' ? c.from : undefined, data: c.data && typeof c.data === 'object' ? c.data : undefined };
}

/** Nome sugerido: piu-backup-2026-11-02.piu */
export const backupFileName = (d = new Date()) =>
  `piu-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}${BACKUP_EXT}`;
