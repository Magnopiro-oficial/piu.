// Ajudantes dos testes do validador v2: nós registrados, envelopes reais, provas seladas.
import { toHex, utf8 } from '../src/protocol/bytes.js';
import { MsgType, parseHeader, sealDirect } from '../src/protocol/envelope.js';
import { deriveIdentity, deriveNodeKey, type Identity, type KeyPair, newSeed, toPublic } from '../src/protocol/keys.js';
import { makeDeliveryProof, sealDeliveryProof, validatorProofKey } from '../src/protocol/proof.js';
import { makeRelayReceipt, type RelayReceipt } from '../src/protocol/receipts.js';
import { sign } from '../src/protocol/suite.js';
import { makeCertJson, NodeRegistry, type OperatorsFile, type RegistryFile } from '../src/registry.js';
import { type AuditFile, buildLedger as build, type EvidenceFile, toEvidence } from '../src/validator.js';

export const PROOF_KEY = validatorProofKey(newSeed());
export const operators: OperatorsFile = { v: 1, operators: [] };
export const registryFile: RegistryFile = { v: 1, certs: [], revocations: [] };

export function operatorKey(admit = true): KeyPair {
  const sk = newSeed();
  const kp = { sk, pk: sign.publicKey(sk) };
  if (admit) operators.operators.push({ pk: toHex(kp.pk) });
  return kp;
}

/** Nó registrado: por padrão, cada um com o seu operador admitido (operadores independentes). */
export function node(op: KeyPair = operatorKey()): KeyPair {
  const n = deriveNodeKey(newSeed());
  registryFile.certs!.push(makeCertJson(op, n.pk, 0));
  return n;
}
/** Chave de nó nova, sem certificado: é o Sybil de graça do C-01. */
export const unregistered = (): KeyPair => deriveNodeKey(newSeed());

export const registry = () => NodeRegistry.build([operators], [registryFile]);

export interface Delivery {
  envelopeId: string; bytes: Uint8Array; ackSecret: Uint8Array; to: Identity;
  receipts: RelayReceipt[]; proofs: { envelopeId: string; ackSecret: Uint8Array }[]; sealed: { envelopeId: string; sealed: Uint8Array }[];
}

/** Uma mensagem direta real (remetente → destino), recibos dos relays e a prova v2 selada do destino. */
export function delivery(relays: KeyPair[], at: number, proven = true, to: Identity = deriveIdentity(newSeed(), 'public')): Delivery {
  const from = deriveIdentity(newSeed(), 'public');
  const m = sealDirect({ from, to: toPublic(to), type: MsgType.Text, body: utf8('oi'), now: at, pad: false });
  const ackHash = parseHeader(m.bytes).ackHash;
  const receipts = relays.map(r => makeRelayReceipt(r, m.id, ackHash, at));
  const sealed = proven ? [{ envelopeId: m.id, sealed: sealDeliveryProof(makeDeliveryProof(m.bytes, to, m.ackSecret, at + 60, PROOF_KEY.pk), PROOF_KEY.pk) }] : [];
  return { envelopeId: m.id, bytes: m.bytes, ackSecret: m.ackSecret, to, receipts, proofs: [{ envelopeId: m.id, ackSecret: m.ackSecret }], sealed };
}

export function evidence(ds: Delivery[], extra: RelayReceipt[] = []): EvidenceFile {
  return toEvidence([...ds.flatMap(d => d.receipts), ...extra], [], ds.flatMap(d => d.sealed));
}

export const buildLedger = (ev: EvidenceFile[], audits: AuditFile[], now: number, reg = registry()) =>
  build(ev, audits, now, { registry: reg, proofKey: PROOF_KEY });
