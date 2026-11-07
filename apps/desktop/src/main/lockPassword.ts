/**
 * Senha do Piu (Ajustes → Privacidade → Bloqueio), sem Electron (testada em test/lockPassword.test.ts).
 * O Electron não tem como conferir a senha do sistema, então o bloqueio usa uma senha que a pessoa cria
 * só para o Piu. Fica guardado apenas o scrypt dela, com sal aleatório, dentro do `state.bin` cifrado;
 * a comparação é em tempo constante.
 * Tentativas: 5 erros seguidos e começa a espera — 30 s, 1 min e 2 min (teto) a cada erro novo.
 * O contador fica no estado gravado, então fechar e abrir o Piu não zera a espera.
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { tm } from './i18n';

export interface LockSecret { kdf: 'scrypt'; N: number; r: number; p: number; salt: string; hash: string }
/** `until`: fim da espera (ms, 0 = sem espera); `wait`: duração dela (s). */
export interface LockAttempts { fails: number; until: number; wait: number }

export const LOCK_MAX_TRIES = 5;
export const LOCK_WAITS_SEC = [30, 60, 120] as const;
export const NO_ATTEMPTS: LockAttempts = { fails: 0, until: 0, wait: 0 };

// ~64 MiB e ~100 ms por tentativa: caro para quem copia o arquivo, imperceptível para quem digita.
const PARAMS = { N: 1 << 16, r: 8, p: 1 } as const;
const KEYLEN = 32;

function derive(password: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((ok, fail) => scrypt(password.normalize('NFC'), salt, KEYLEN, { N, r, p, maxmem: 256 * N * r }, (e, k) => (e ? fail(e) : ok(k))));
}

/** Motivo para recusar a senha nova, ou `null` se serve. */
export function lockPasswordProblem(pw: string): string | null {
  if (typeof pw !== 'string' || [...pw].length < 6) return tm('main.lockpw.short');
  if (pw.length > 256) return tm('main.lockpw.long');
  if (new Set(pw).size < 3) return tm('main.lockpw.repetitive');
  return null;
}

export async function hashLockPassword(pw: string): Promise<LockSecret> {
  const salt = randomBytes(16);
  const k = await derive(pw, salt, PARAMS.N, PARAMS.r, PARAMS.p);
  return { kdf: 'scrypt', ...PARAMS, salt: salt.toString('hex'), hash: k.toString('hex') };
}

/** Segredo estranho (parâmetros fora do esperado, hex inválido) é recusa, nunca "aceita". */
export async function verifyLockPassword(pw: string, s: LockSecret): Promise<boolean> {
  try {
    if (!s || s.kdf !== 'scrypt' || s.N !== PARAMS.N || s.r !== PARAMS.r || s.p !== PARAMS.p) return false;
    if (typeof pw !== 'string' || !pw || !/^[0-9a-f]{32}$/.test(s.salt) || !/^[0-9a-f]{64}$/.test(s.hash)) return false;
    const k = await derive(pw, Buffer.from(s.salt, 'hex'), s.N, s.r, s.p);
    return timingSafeEqual(k, Buffer.from(s.hash, 'hex'));
  } catch { return false; }
}

export function attemptsAfterFailure(a: LockAttempts, now: number): LockAttempts {
  const fails = a.fails + 1;
  if (fails < LOCK_MAX_TRIES) return { fails, until: 0, wait: 0 };
  const wait = LOCK_WAITS_SEC[Math.min(fails - LOCK_MAX_TRIES, LOCK_WAITS_SEC.length - 1)]!;
  return { fails, until: now + wait * 1000, wait };
}

export const triesLeft = (a: LockAttempts) => Math.max(0, LOCK_MAX_TRIES - a.fails);

/** Espera em curso (o anel do D1x), ou `null`. */
export function lockWait(a: LockAttempts, now: number): { remainingSec: number; totalSec: number; until: number } | null {
  if (!a.until || !a.wait || now >= a.until) return null;
  return { remainingSec: Math.min(a.wait, Math.ceil((a.until - now) / 1000)), totalSec: a.wait, until: a.until };
}
