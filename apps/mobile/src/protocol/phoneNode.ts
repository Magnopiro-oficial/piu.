/**
 * Celular como nó que rende (docs/economia/no-celular.md). Fonte da verdade: este arquivo é copiado
 * para apps/settlement/src/protocol/ por `npm run protocol:sync`, e o validador confere com ele.
 *
 * - Chave de operador do celular: HKDF da semente do Piu com rótulo próprio
 *   (`phone-node/operator/0/sign`). Não é a identidade de conversa, nem a chave do nó do dia, nem a
 *   carteira; sai da semente sem biometria (como a chave do nó), para o segundo plano funcionar.
 * - Certificado do nó do dia: o MESMO `OPERATOR_CERT` que o piu-node emite
 *   (apps/piu-node/src/relay/operator-frames.ts, mensagem `piu/lnnp/v1/operator-cert`), sem cadeia de
 *   rotação. O validador lê pelo mesmo caminho dos equipamentos (registry.ts).
 * - Registro do celular: classe `phone`, carteira declarada e a transação da caução, assinado pela
 *   chave de operador do celular E pela chave sr25519 da carteira (prova de que a caução é dela).
 * - Aval: declaração assinada pela chave de operador de quem avaliza sobre a chave de operador do
 *   celular e um dia (UTC). Viaja pelo mensageiro (payload `av`) e vai no arquivo de registro.
 * - Saída: pedido assinado de sair do programa, amarrado à caução (devolução manual, no validador).
 * - Retirada de aval: assinada por quem avalizou; o aval também vence 90 dias depois de visto.
 */
import { concat, toHex, utf8, Writer } from './bytes';
import type { KeyPair } from './keys';
import { hash, kdf, sign } from './suite';

/** Rótulo da chave de operador do celular (nunca reutilizar outro rótulo). */
export const PHONE_OPERATOR_LABEL = 'phone-node/operator/0/sign';
const ROOT_SALT = utf8('piu/v0/root');

/** Chave Ed25519 de operador do celular, a partir da semente do Piu. */
export function derivePhoneOperatorKey(seed: Uint8Array): KeyPair {
  const sk = kdf(seed, ROOT_SALT, PHONE_OPERATOR_LABEL);
  return { sk, pk: sign.publicKey(sk) };
}

const u32 = (n: number) => new Writer().u32(n).done();
const hexRe = (bytes: number) => new RegExp(`^[0-9a-f]{${bytes * 2}}$`);
const HEX32 = hexRe(32), HEX64 = hexRe(64);
export const isPkHex = (s: unknown): s is string => typeof s === 'string' && HEX32.test(s);

export function hexBytes(s: string): Uint8Array {
  if (typeof s !== 'string' || s.length % 2 || !/^[0-9a-f]*$/i.test(s)) throw new Error('hex inválido');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const okInt = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 0xffff_ffff;

// ── certificado do nó do dia (OPERATOR_CERT do LNNP v1) ─────

export interface CertJson { operatorPk: string; nodePk: string; issuedAt: number; sig: string; chain: [] }

export const operatorCertMessage = (operatorPk: Uint8Array, nodePk: Uint8Array, issuedAt: number) =>
  hash(concat(utf8('piu/lnnp/v1/operator-cert'), operatorPk, nodePk, u32(issuedAt)));

/** Certificado igual ao do piu-node (Ed25519 é determinístico: mesma entrada, mesma assinatura). */
export function makeOperatorCert(op: KeyPair, nodePk: Uint8Array, issuedAt: number): CertJson {
  return { operatorPk: toHex(op.pk), nodePk: toHex(nodePk), issuedAt, sig: toHex(sign.sign(operatorCertMessage(op.pk, nodePk, issuedAt), op.sk)), chain: [] };
}

export function verifyOperatorCert(c: CertJson): boolean {
  try {
    if (!isPkHex(c?.operatorPk) || !isPkHex(c.nodePk) || !okInt(c.issuedAt) || typeof c.sig !== 'string' || !HEX64.test(c.sig)) return false;
    return sign.verify(hexBytes(c.sig), operatorCertMessage(hexBytes(c.operatorPk), hexBytes(c.nodePk), c.issuedAt), hexBytes(c.operatorPk));
  } catch { return false; }
}

// ── aval ────────────────────────────────────────────────────

/**
 * `inPerson`: quem avaliza AFIRMA ter conferido o código de segurança do contato pessoalmente (o app
 * só deixa avalizar contato verificado). O validador não tem como conferir; exige a afirmação de
 * avalistas celulares (docs/economia/no-celular.md).
 */
export interface EndorsementJson { endorserPk: string; phonePk: string; day: number; inPerson: boolean; sig: string }

/** Dia UTC (dias desde 1970) de um horário em segundos. */
export const dayOfSec = (sec: number) => Math.floor(sec / 86400);

export const endorsementMessage = (endorserPk: Uint8Array, phonePk: Uint8Array, day: number, inPerson: boolean) =>
  hash(concat(utf8('piu/phone-node/v2/endorsement'), endorserPk, phonePk, new Writer().u32(day).u8(inPerson ? 1 : 0).done()));

/** Aval assinado pela chave de operador de quem avaliza (celular habilitado ou operador de piu-node). */
export function makeEndorsement(endorser: KeyPair, phonePk: Uint8Array, day: number, o: { inPerson: boolean } = { inPerson: true }): EndorsementJson {
  if (toHex(endorser.pk) === toHex(phonePk)) throw new Error('Ninguém avaliza a si mesmo.');
  return { endorserPk: toHex(endorser.pk), phonePk: toHex(phonePk), day, inPerson: o.inPerson, sig: toHex(sign.sign(endorsementMessage(endorser.pk, phonePk, day, o.inPerson), endorser.sk)) };
}

export function verifyEndorsement(e: EndorsementJson): boolean {
  try {
    if (!isPkHex(e?.endorserPk) || !isPkHex(e.phonePk) || e.endorserPk === e.phonePk || !okInt(e.day) || typeof e.inPerson !== 'boolean' || typeof e.sig !== 'string' || !HEX64.test(e.sig)) return false;
    return sign.verify(hexBytes(e.sig), endorsementMessage(hexBytes(e.endorserPk), hexBytes(e.phonePk), e.day, e.inPerson), hexBytes(e.endorserPk));
  } catch { return false; }
}

// ── registro do celular (classe "phone") ────────────────────

export interface BondRef { txHash: string; block: number }
export interface PhoneRegistrationJson {
  v: 1; class: 'phone'; operatorPk: string;
  /** Carteira Lunes (SS58) que pagou a caução e recebe as recompensas. */
  wallet: string;
  bond: BondRef;
  /** sr25519 da carteira sobre `bondOwnerMessage(operatorPk, wallet, endereço da caução)` (hex, 64 bytes). */
  walletSig: string;
  /** Ed25519 da chave de operador do celular sobre `registrationMessage`. */
  sig: string;
}

const TX_HASH = /^0x[0-9a-f]{64}$/;
const okBond = (b: BondRef | undefined): b is BondRef => !!b && typeof b.txHash === 'string' && TX_HASH.test(b.txHash) && okInt(b.block);
const okWallet = (w: unknown): w is string => typeof w === 'string' && w.length >= 40 && w.length <= 64 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(w);

/**
 * O que a CARTEIRA assina (bytes crus, sr25519 com o contexto "substrate"): "as cauções desta
 * carteira para este endereço de caução valem para esta chave de operador de celular". Sem o hash
 * da transação: o app assina ANTES de pagar (na ativação), e o registro (assinado pela chave de
 * operador) fecha depois, sem pedir biometria de novo. Texto legível de propósito.
 */
export const bondOwnerMessage = (operatorPkHex: string, wallet: string, bondAddress: string) =>
  utf8(`piu/phone-node/v2/bond-owner\n${operatorPkHex}\n${wallet}\n${bondAddress}`);

export const registrationMessage = (operatorPk: Uint8Array, wallet: string, bond: BondRef, walletSig: Uint8Array) =>
  hash(concat(utf8('piu/phone-node/v1/registration'), operatorPk, new Writer().vbytes(utf8(wallet)).vbytes(utf8(bond.txHash)).u32(bond.block).done(), walletSig));

/** Monta o registro. `walletSig` vem da carteira (lib, com a frase lida na hora). */
export function makePhoneRegistration(op: KeyPair, wallet: string, bond: BondRef, walletSig: Uint8Array): PhoneRegistrationJson {
  if (!okWallet(wallet) || !okBond(bond) || walletSig.length !== 64) throw new Error('Registro do celular malformado.');
  return { v: 1, class: 'phone', operatorPk: toHex(op.pk), wallet, bond: { txHash: bond.txHash, block: bond.block }, walletSig: toHex(walletSig), sig: toHex(sign.sign(registrationMessage(op.pk, wallet, bond, walletSig), op.sk)) };
}

/**
 * Confere a forma e a assinatura do operador. A assinatura da carteira (sr25519) e a caução na chain
 * são conferidas por quem tem as bibliotecas da Lunes (validador: bond.ts; app: walletKey.ts).
 */
export function verifyPhoneRegistration(r: PhoneRegistrationJson): boolean {
  try {
    if (r?.v !== 1 || r.class !== 'phone' || !isPkHex(r.operatorPk) || !okWallet(r.wallet) || !okBond(r.bond) || typeof r.walletSig !== 'string' || !HEX64.test(r.walletSig) || typeof r.sig !== 'string' || !HEX64.test(r.sig)) return false;
    return sign.verify(hexBytes(r.sig), registrationMessage(hexBytes(r.operatorPk), r.wallet, r.bond, hexBytes(r.walletSig)), hexBytes(r.operatorPk));
  } catch { return false; }
}

// ── saída do programa ───────────────────────────────────────

/**
 * Pedido de saída (`kind: 'exit'`) ou "voltar a ser nó" (`kind: 'cancel'`), amarrado à caução
 * (`txHash`). Vale o evento de `at` maior daquela caução; a devolução vence 7 dias depois da saída.
 */
export interface PhoneExitJson { operatorPk: string; txHash: string; at: number; kind: 'exit' | 'cancel'; sig: string }
export const exitMessage = (operatorPk: Uint8Array, txHash: string, at: number, kind: 'exit' | 'cancel') =>
  hash(concat(utf8('piu/phone-node/v2/exit'), operatorPk, new Writer().vbytes(utf8(txHash)).u32(at).u8(kind === 'cancel' ? 1 : 0).done()));
export function makePhoneExit(op: KeyPair, txHash: string, at: number, kind: 'exit' | 'cancel' = 'exit'): PhoneExitJson {
  if (!TX_HASH.test(txHash)) throw new Error('Caução inválida.');
  return { operatorPk: toHex(op.pk), txHash, at, kind, sig: toHex(sign.sign(exitMessage(op.pk, txHash, at, kind), op.sk)) };
}
export function verifyPhoneExit(x: PhoneExitJson): boolean {
  try {
    if (!isPkHex(x?.operatorPk) || typeof x.txHash !== 'string' || !TX_HASH.test(x.txHash) || !okInt(x.at) || (x.kind !== 'exit' && x.kind !== 'cancel') || typeof x.sig !== 'string' || !HEX64.test(x.sig)) return false;
    return sign.verify(hexBytes(x.sig), exitMessage(hexBytes(x.operatorPk), x.txHash, x.at, x.kind), hexBytes(x.operatorPk));
  } catch { return false; }
}

// ── retirar um aval ─────────────────────────────────────────

/**
 * Quem avalizou retira o aval (assinado pela mesma chave). Vale a partir de quando o validador viu a
 * retirada (não do `at` escolhido por quem assina). Vai no arquivo de registro de quem avaliza.
 */
export interface EndorsementRevocationJson { endorserPk: string; phonePk: string; at: number; sig: string }
export const endorsementRevocationMessage = (endorserPk: Uint8Array, phonePk: Uint8Array, at: number) =>
  hash(concat(utf8('piu/phone-node/v1/endorsement-revoke'), endorserPk, phonePk, u32(at)));
export function makeEndorsementRevocation(endorser: KeyPair, phonePk: Uint8Array, at: number): EndorsementRevocationJson {
  return { endorserPk: toHex(endorser.pk), phonePk: toHex(phonePk), at, sig: toHex(sign.sign(endorsementRevocationMessage(endorser.pk, phonePk, at), endorser.sk)) };
}
export function verifyEndorsementRevocation(r: EndorsementRevocationJson): boolean {
  try {
    if (!isPkHex(r?.endorserPk) || !isPkHex(r.phonePk) || !okInt(r.at) || typeof r.sig !== 'string' || !HEX64.test(r.sig)) return false;
    return sign.verify(hexBytes(r.sig), endorsementRevocationMessage(hexBytes(r.endorserPk), hexBytes(r.phonePk), r.at), hexBytes(r.endorserPk));
  } catch { return false; }
}
