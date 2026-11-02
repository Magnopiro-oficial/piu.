// Gera dados de demonstração para o validador: 4 nós, 400 entregas na época 2026-S40 (10% sem prova)
// e carteiras de 3 nós para o lote 2026-S41. Uso: npm run validator:demo -- <pasta>
import { mkdirSync, writeFileSync } from 'node:fs';
import { encodeAddress } from '@polkadot/util-crypto';
import { toHex } from '../src/protocol/bytes.js';
import { deriveNodeKey, newSeed } from '../src/protocol/keys.js';
import { makePayoutClaim, makeRelayReceipt } from '../src/protocol/receipts.js';
import { hash, random } from '../src/protocol/suite.js';
import { epochStart, toClaims, toEvidence } from '../src/validator.js';
const D = process.argv[2] ?? 'dados';
for (const s of ['evidencias', 'carteiras']) mkdirSync(`${D}/${s}`, { recursive: true });
const nodes = Array.from({ length: 4 }, () => deriveNodeKey(newSeed()));
const receipts = [], proofs = [];
for (let i = 0; i < 400; i++) {
  const id = toHex(random(16)), secret = random(16), ah = hash(secret).slice(0, 16);
  const relays = nodes.filter((_, j) => (i + j) % 3 !== 0).slice(0, 1 + (i % 3));
  for (const n of relays) receipts.push(makeRelayReceipt(n, id, ah, epochStart('2026-S40') + (i % 7) * 86400 + 3600));
  if (i % 10 !== 0) proofs.push({ envelopeId: id, ackSecret: secret }); // 10% sem prova de entrega
}
writeFileSync(`${D}/evidencias/gateway-a.json`, JSON.stringify(toEvidence(receipts, proofs)));
writeFileSync(`${D}/carteiras/2026-S41.json`, JSON.stringify(toClaims(nodes.slice(0, 3).map((n, k) => makePayoutClaim(n, '2026-S41', encodeAddress(new Uint8Array(32).fill(k + 1), 42))))));
