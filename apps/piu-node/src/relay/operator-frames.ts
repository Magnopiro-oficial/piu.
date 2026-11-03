/**
 * Extensão de operador do LNNP v1 (docs/lnnp/especificacao-v1.md, seção 8.1): certificado do nó
 * assinado pela chave de operador, passos de rotação dessa chave e lista de revogação assinada.
 *
 * - Certificado (`OPERATOR_CERT`, 0x40): "este nó é meu", assinado pela chave de operador. Com ele,
 *   dois nós do mesmo operador se reconhecem depois do handshake, sem revelar quem é o operador
 *   (só a chave pública dele, que não é a identidade de conversa nem a carteira).
 * - Rotação: a chave antiga assina a nova. O certificado leva a cadeia de passos, e quem confia na
 *   antiga passa a confiar na nova ("equipamentos recebem a nova chave na próxima sincronização").
 * - Revogação (`REVOCATION_LIST`, 0x41): lista completa e numerada das chaves de nó revogadas pelo
 *   operador. A de número maior substitui a anterior. O nó recusa o handshake das chaves revogadas e
 *   repassa a lista aos vizinhos do mesmo operador.
 *
 * - Ajustes de equipamento (`DEVICE_POLICY`, 0x42): pausa e regras (banda, armazenamento, horário)
 *   de um equipamento, por chave de nó, assinados pela chave de operador e numerados (o número maior
 *   vale). O nó a que se referem aplica no motor; os outros do mesmo operador só repassam.
 * - Resumo do equipamento (`DEVICE_REPORT`, 0x43): contadores do motor, assinados pela chave técnica
 *   do próprio nó, para o painel do operador mostrar os outros equipamentos dele.
 *
 * Nós que não conhecem estes tipos os ignoram (seção 8: tipo desconhecido DEVE ser ignorado).
 */
import { concat, equal, ProtocolError, Reader, toHex, utf8, Writer } from '../protocol/bytes.js';
import type { KeyPair } from '../protocol/keys.js';
import { hash, kdf, sign } from '../protocol/suite.js';

export const FRAME_OPERATOR_CERT = 0x40;
export const FRAME_REVOCATION_LIST = 0x41;
/** Pausa e regras de um equipamento, assinadas pela chave de operador (seção 8.2). */
export const FRAME_DEVICE_POLICY = 0x42;
/** Resumo periódico das estatísticas de um nó, assinado pela chave técnica dele (seção 8.2). */
export const FRAME_DEVICE_REPORT = 0x43;
/** Mais passos de rotação do que isto num certificado: malformado. */
export const MAX_ROTATION_STEPS = 16;
/** Mais chaves revogadas do que isto numa lista: malformada (cabe num quadro de 64 KiB). */
export const MAX_REVOKED = 1024;

export interface RotationStep { prevPk: Uint8Array; nextPk: Uint8Array; at: number; sig: Uint8Array }
export interface OperatorCert { operatorPk: Uint8Array; nodePk: Uint8Array; issuedAt: number; sig: Uint8Array; chain: RotationStep[] }
export interface RevocationList { operatorPk: Uint8Array; seq: number; issuedAt: number; revoked: Uint8Array[]; sig: Uint8Array }

/** Chave Ed25519 do operador a partir da semente dele (rótulo próprio: nunca a mesma de outro uso). */
export function operatorKeyPair(seed: Uint8Array): KeyPair {
  const sk = kdf(seed, utf8('piu/v0/root'), 'operator/0/sign');
  return { sk, pk: sign.publicKey(sk) };
}

/** Impressão digital: SHA-256 da chave pública, 16 bytes em 8 grupos de 4 (como no design). */
export const fingerprint = (pk: Uint8Array) => (toHex(hash(concat(utf8('piu/operator/fp'), pk)).slice(0, 16)).toUpperCase().match(/..../g) ?? []);

const u32 = (n: number) => new Writer().u32(n).done();
const certMessage = (operatorPk: Uint8Array, nodePk: Uint8Array, issuedAt: number) => hash(concat(utf8('piu/lnnp/v1/operator-cert'), operatorPk, nodePk, u32(issuedAt)));
const rotationMessage = (prevPk: Uint8Array, nextPk: Uint8Array, at: number) => hash(concat(utf8('piu/lnnp/v1/operator-rotation'), prevPk, nextPk, u32(at)));
const listMessage = (operatorPk: Uint8Array, seq: number, issuedAt: number, revoked: Uint8Array[]) =>
  hash(concat(utf8('piu/lnnp/v1/revocation'), operatorPk, u32(seq), u32(issuedAt), new Writer().u16(revoked.length).done(), ...revoked));

export function makeCert(op: KeyPair, nodePk: Uint8Array, issuedAt: number, chain: RotationStep[] = []): OperatorCert {
  return { operatorPk: op.pk, nodePk, issuedAt, sig: sign.sign(certMessage(op.pk, nodePk, issuedAt), op.sk), chain };
}
export const verifyCert = (c: OperatorCert) => sign.verify(c.sig, certMessage(c.operatorPk, c.nodePk, c.issuedAt), c.operatorPk);

export function makeRotation(prev: KeyPair, nextPk: Uint8Array, at: number): RotationStep {
  return { prevPk: prev.pk, nextPk, at, sig: sign.sign(rotationMessage(prev.pk, nextPk, at), prev.sk) };
}
export const verifyRotation = (s: RotationStep) => sign.verify(s.sig, rotationMessage(s.prevPk, s.nextPk, s.at), s.prevPk);

export function makeRevocationList(op: KeyPair, seq: number, issuedAt: number, revoked: Uint8Array[]): RevocationList {
  // Ordem canônica e sem repetição: a mesma lista dá a mesma assinatura em qualquer nó.
  const uniq = [...new Map(revoked.map(pk => [toHex(pk), pk])).entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, pk]) => pk);
  if (uniq.length > MAX_REVOKED) throw new Error('Lista de revogação grande demais.');
  return { operatorPk: op.pk, seq, issuedAt, revoked: uniq, sig: sign.sign(listMessage(op.pk, seq, issuedAt, uniq), op.sk) };
}
export const verifyRevocationList = (l: RevocationList) => sign.verify(l.sig, listMessage(l.operatorPk, l.seq, l.issuedAt, l.revoked), l.operatorPk);

/**
 * A chave do certificado vem de uma chave em que confio? Anda pela cadeia de rotação a partir de
 * qualquer chave confiável. Devolve as chaves novas que passam a ser confiáveis (vazio se nenhuma),
 * ou `null` se o certificado não se liga a nada confiável.
 */
export function trustPath(c: OperatorCert, trusted: Set<string>): string[] | null {
  const target = toHex(c.operatorPk);
  if (trusted.has(target)) return [];
  const known = new Set(trusted), added: string[] = [];
  for (const s of c.chain) {
    if (!known.has(toHex(s.prevPk)) || !verifyRotation(s)) continue;
    const next = toHex(s.nextPk);
    if (!known.has(next)) { known.add(next); added.push(next); }
  }
  return known.has(target) ? added : null;
}

// ── codificação dos quadros ────────────────────────────────

export function encodeCert(c: OperatorCert): Uint8Array {
  const w = new Writer().bytes(c.operatorPk).bytes(c.nodePk).u32(c.issuedAt).bytes(c.sig).u8(c.chain.length);
  for (const s of c.chain) w.bytes(s.prevPk).bytes(s.nextPk).u32(s.at).bytes(s.sig);
  return w.done();
}

export function decodeCert(b: Uint8Array): OperatorCert {
  const r = new Reader(b);
  const c: OperatorCert = { operatorPk: r.bytes(32), nodePk: r.bytes(32), issuedAt: r.u32(), sig: r.bytes(64), chain: [] };
  const n = r.u8();
  if (n > MAX_ROTATION_STEPS) throw new ProtocolError('MALFORMED', 'Cadeia de rotação longa demais.');
  for (let i = 0; i < n; i++) c.chain.push({ prevPk: r.bytes(32), nextPk: r.bytes(32), at: r.u32(), sig: r.bytes(64) });
  return c; // bytes a mais: reservados para versões futuras (ignorados)
}

export function encodeRevocationList(l: RevocationList): Uint8Array {
  const w = new Writer().bytes(l.operatorPk).u32(l.seq).u32(l.issuedAt).u16(l.revoked.length);
  for (const pk of l.revoked) w.bytes(pk);
  return w.bytes(l.sig).done();
}

export function decodeRevocationList(b: Uint8Array): RevocationList {
  const r = new Reader(b);
  const operatorPk = r.bytes(32), seq = r.u32(), issuedAt = r.u32(), n = r.u16();
  if (n > MAX_REVOKED) throw new ProtocolError('MALFORMED', 'Lista de revogação grande demais.');
  const revoked: Uint8Array[] = [];
  for (let i = 0; i < n; i++) revoked.push(r.bytes(32));
  return { operatorPk, seq, issuedAt, revoked, sig: r.bytes(64) };
}

/** Forma JSON (para o `data/` e a API): binários em hex. */
export const certToJson = (c: OperatorCert) => ({
  operatorPk: toHex(c.operatorPk), nodePk: toHex(c.nodePk), issuedAt: c.issuedAt, sig: toHex(c.sig),
  chain: c.chain.map(s => ({ prevPk: toHex(s.prevPk), nextPk: toHex(s.nextPk), at: s.at, sig: toHex(s.sig) })),
});
export type CertJson = ReturnType<typeof certToJson>;
export const listToJson = (l: RevocationList) => ({ operatorPk: toHex(l.operatorPk), seq: l.seq, issuedAt: l.issuedAt, revoked: l.revoked.map(toHex), sig: toHex(l.sig) });
export type ListJson = ReturnType<typeof listToJson>;

export const unhex = (s: string): Uint8Array => {
  if (typeof s !== 'string' || s.length % 2 || !/^[0-9a-f]*$/i.test(s)) throw new Error('hex inválido');
  return Uint8Array.from(Buffer.from(s, 'hex'));
};
export const certFromJson = (j: CertJson): OperatorCert => ({
  operatorPk: unhex(j.operatorPk), nodePk: unhex(j.nodePk), issuedAt: j.issuedAt, sig: unhex(j.sig),
  chain: (j.chain ?? []).map(s => ({ prevPk: unhex(s.prevPk), nextPk: unhex(s.nextPk), at: s.at, sig: unhex(s.sig) })),
});
export const listFromJson = (j: ListJson): RevocationList => ({ operatorPk: unhex(j.operatorPk), seq: j.seq, issuedAt: j.issuedAt, revoked: j.revoked.map(unhex), sig: unhex(j.sig) });

export const samePk = (a: Uint8Array, b: Uint8Array) => a.length === b.length && equal(a, b);

// ── ajustes e resumo dos equipamentos do operador (seção 8.2) ──

export type PolicyHours = 'always' | 'night' | 'day';
/** Regras do equipamento: as mesmas opções do assistente (banda em Mbps, armazenamento em GB). */
export interface PolicyLimits { bw: 5 | 20 | 50; sto: 1 | 4 | 8; hours: PolicyHours }
/** Ajustes de um equipamento, assinados pela chave de operador. `seq` maior substitui o anterior. */
export interface DevicePolicy { operatorPk: Uint8Array; nodePk: Uint8Array; seq: number; issuedAt: number; paused: boolean; limits: PolicyLimits | null; sig: Uint8Array }
/**
 * Resumo do motor de um nó (contadores desde que ele ligou), assinado pela chave técnica dele.
 * `at` + `seq` crescem sempre (`seq` recomeça a cada vez que o nó liga, `at` não volta).
 */
export interface DeviceReport {
  nodePk: Uint8Array; at: number; seq: number; startedAt: number;
  forwarded: number; stored: number; receipts: number; neighbors: number;
  paused: boolean; relaying: boolean;
  /** Número dos ajustes do operador em vigor neste nó (0: nenhum). */
  policySeq: number;
  sig: Uint8Array;
}

const BW = [5, 20, 50] as const, STO = [1, 4, 8] as const, HOURS: PolicyHours[] = ['always', 'night', 'day'];

function policyBody(p: Omit<DevicePolicy, 'sig'>): Uint8Array {
  const flags = (p.paused ? 1 : 0) | (p.limits ? 2 : 0);
  const l = p.limits;
  return new Writer().bytes(p.operatorPk).bytes(p.nodePk).u32(p.seq).u32(p.issuedAt).u8(flags)
    .u8(l ? l.bw : 0).u8(l ? l.sto : 0).u8(l ? HOURS.indexOf(l.hours) : 0).done();
}
const policyMessage = (p: Omit<DevicePolicy, 'sig'>) => hash(concat(utf8('piu/lnnp/v1/device-policy'), policyBody(p)));

export function makeDevicePolicy(op: KeyPair, nodePk: Uint8Array, seq: number, issuedAt: number, v: { paused: boolean; limits: PolicyLimits | null }): DevicePolicy {
  const p = { operatorPk: op.pk, nodePk, seq, issuedAt, paused: v.paused, limits: v.limits ? { bw: v.limits.bw, sto: v.limits.sto, hours: v.limits.hours } : null };
  return { ...p, sig: sign.sign(policyMessage(p), op.sk) };
}
export const verifyDevicePolicy = (p: DevicePolicy) => sign.verify(p.sig, policyMessage(p), p.operatorPk);

export const encodeDevicePolicy = (p: DevicePolicy) => concat(policyBody(p), p.sig);

export function decodeDevicePolicy(b: Uint8Array): DevicePolicy {
  const r = new Reader(b);
  const operatorPk = r.bytes(32), nodePk = r.bytes(32), seq = r.u32(), issuedAt = r.u32(), flags = r.u8();
  const bw = r.u8(), sto = r.u8(), hours = r.u8();
  const sig = r.bytes(64);
  let limits: PolicyLimits | null = null;
  if (flags & 2) {
    if (!(BW as readonly number[]).includes(bw) || !(STO as readonly number[]).includes(sto) || !HOURS[hours]) throw new ProtocolError('MALFORMED', 'Regras do equipamento fora das opções.');
    limits = { bw: bw as PolicyLimits['bw'], sto: sto as PolicyLimits['sto'], hours: HOURS[hours]! };
  }
  return { operatorPk, nodePk, seq, issuedAt, paused: (flags & 1) !== 0, limits, sig };
}

/** Os mesmos ajustes (pausa e regras), sem olhar número nem assinatura. */
export const samePolicyValue = (a: { paused: boolean; limits: PolicyLimits | null }, b: { paused: boolean; limits: PolicyLimits | null }) =>
  a.paused === b.paused && (a.limits === null ? b.limits === null : !!b.limits && a.limits.bw === b.limits.bw && a.limits.sto === b.limits.sto && a.limits.hours === b.limits.hours);

const U32 = 0xffff_ffff;
const clampU32 = (n: number) => Math.max(0, Math.min(U32, Math.floor(n)));

function reportBody(r: Omit<DeviceReport, 'sig'>): Uint8Array {
  return new Writer().bytes(r.nodePk).u32(r.at).u32(r.seq).u32(r.startedAt)
    .u32(clampU32(r.forwarded)).u32(clampU32(r.stored)).u32(clampU32(r.receipts)).u16(Math.min(0xffff, r.neighbors))
    .u8((r.paused ? 1 : 0) | (r.relaying ? 2 : 0)).u32(r.policySeq).done();
}
const reportMessage = (r: Omit<DeviceReport, 'sig'>) => hash(concat(utf8('piu/lnnp/v1/device-report'), reportBody(r)));

export function makeDeviceReport(node: KeyPair, r: Omit<DeviceReport, 'sig' | 'nodePk'>): DeviceReport {
  const body = {
    ...r, nodePk: node.pk, forwarded: clampU32(r.forwarded), stored: clampU32(r.stored), receipts: clampU32(r.receipts), neighbors: Math.min(0xffff, r.neighbors),
  };
  return { ...body, sig: sign.sign(reportMessage(body), node.sk) };
}
export const verifyDeviceReport = (r: DeviceReport) => sign.verify(r.sig, reportMessage(r), r.nodePk);
export const encodeDeviceReport = (r: DeviceReport) => concat(reportBody(r), r.sig);

export function decodeDeviceReport(b: Uint8Array): DeviceReport {
  const r = new Reader(b);
  const nodePk = r.bytes(32), at = r.u32(), seq = r.u32(), startedAt = r.u32();
  const forwarded = r.u32(), stored = r.u32(), receipts = r.u32(), neighbors = r.u16(), flags = r.u8(), policySeq = r.u32();
  return { nodePk, at, seq, startedAt, forwarded, stored, receipts, neighbors, paused: (flags & 1) !== 0, relaying: (flags & 2) !== 0, policySeq, sig: r.bytes(64) };
}

/** Resumo mais novo que o anterior? (`at` maior, ou o mesmo `at` com `seq` maior) */
export const newerReport = (r: DeviceReport, prev: DeviceReport | undefined | null) => !prev || r.at > prev.at || (r.at === prev.at && r.seq > prev.seq);

export const policyToJson = (p: DevicePolicy) => ({ operatorPk: toHex(p.operatorPk), nodePk: toHex(p.nodePk), seq: p.seq, issuedAt: p.issuedAt, paused: p.paused, limits: p.limits, sig: toHex(p.sig) });
export type PolicyJson = ReturnType<typeof policyToJson>;
export const policyFromJson = (j: PolicyJson): DevicePolicy => ({
  operatorPk: unhex(j.operatorPk), nodePk: unhex(j.nodePk), seq: j.seq, issuedAt: j.issuedAt, paused: !!j.paused, limits: j.limits ?? null, sig: unhex(j.sig),
});
