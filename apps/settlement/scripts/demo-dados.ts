// Gera dados de demonstração para o validador v2: 4 nós registrados (2 operadores admitidos), 400
// entregas reais na época 2026-S40 (10% sem prova v2), a chave das provas e carteiras de 3 nós para o
// lote 2026-S41. Uso: npm run validator:demo -- <pasta>
import { mkdirSync, writeFileSync } from 'node:fs';
import { encodeAddress } from '@polkadot/util-crypto';
import { toHex, utf8 } from '../src/protocol/bytes.js';
import { MsgType, parseHeader, sealDirect } from '../src/protocol/envelope.js';
import { deriveIdentity, deriveNodeKey, newSeed, toPublic } from '../src/protocol/keys.js';
import { makeDeliveryProof, sealDeliveryProof, validatorProofKey } from '../src/protocol/proof.js';
import { makePayoutClaim, makeRelayReceipt, type RelayReceipt } from '../src/protocol/receipts.js';
import { sign } from '../src/protocol/suite.js';
import { makeCertJson } from '../src/registry.js';
import { epochStart, toClaims, toEvidence } from '../src/validator.js';
const D = process.argv[2] ?? 'dados';
for (const s of ['evidencias', 'carteiras', 'registro']) mkdirSync(`${D}/${s}`, { recursive: true });
const seed = newSeed(), key = validatorProofKey(seed);
writeFileSync(`${D}/chave-provas.json`, JSON.stringify({ v: 1, seed: toHex(seed) }), { mode: 0o600 });
const ops = [newSeed(), newSeed()].map(sk => ({ sk, pk: sign.publicKey(sk) }));
writeFileSync(`${D}/operadores.json`, JSON.stringify({ v: 1, operators: ops.map((o, i) => ({ pk: toHex(o.pk), name: `operador ${i + 1}` })) }));
const nodes = Array.from({ length: 4 }, () => deriveNodeKey(newSeed()));
writeFileSync(`${D}/registro/operadores.json`, JSON.stringify({ v: 1, certs: nodes.map((n, i) => makeCertJson(ops[i % 2]!, n.pk, 0)) }));
const receipts: RelayReceipt[] = [], sealed: { envelopeId: string; sealed: Uint8Array }[] = [];
for (let i = 0; i < 400; i++) {
  const at = epochStart('2026-S40') + (i % 7) * 86400 + 3600;
  const from = deriveIdentity(newSeed(), 'public'), to = deriveIdentity(newSeed(), 'public');
  const m = sealDirect({ from, to: toPublic(to), type: MsgType.Text, body: utf8('demo'), now: at, pad: false });
  const relays = nodes.filter((_, j) => (i + j) % 3 !== 0).slice(0, 1 + (i % 3));
  for (const n of relays) receipts.push(makeRelayReceipt(n, m.id, parseHeader(m.bytes).ackHash, at));
  if (i % 10 !== 0) sealed.push({ envelopeId: m.id, sealed: sealDeliveryProof(makeDeliveryProof(m.bytes, to, m.ackSecret, at + 60, key.pk), key.pk) }); // 10% sem prova
}
writeFileSync(`${D}/evidencias/gateway-a.json`, JSON.stringify(toEvidence(receipts, [], sealed)));
writeFileSync(`${D}/carteiras/2026-S41.json`, JSON.stringify(toClaims(nodes.slice(0, 3).map((n, k) => makePayoutClaim(n, '2026-S41', encodeAddress(new Uint8Array(32).fill(k + 1), 42))))));
