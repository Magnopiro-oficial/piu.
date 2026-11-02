#!/usr/bin/env node
// Verificação do instalador ANTES de executar qualquer pacote baixado do piu-node (Node >= 18, sem dependências).
// Uso: PIU_RELEASE_PUBKEY=<base64> node verify-package.mjs <arquivo> <arquivo.manifest.json>
// Sai com código 0 só se: a assinatura Ed25519 do manifesto confere com a chave de release FIXADA,
// e nome, tamanho e SHA-256 do arquivo conferem. Qualquer outra situação: código 1 e NÃO instale.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const [file, manifestPath] = process.argv.slice(2);
const pub = process.env.PIU_RELEASE_PUBKEY;
const die = msg => {
  console.error(`RECUSADO: ${msg}`);
  process.exit(1);
};
if (!file || !manifestPath) die('uso: verify-package.mjs <arquivo> <manifesto>');
if (!pub) die('PIU_RELEASE_PUBKEY não definida (a chave de release precisa estar fixada no instalador).');

let m;
try { m = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch { die('manifesto ilegível.'); }
const payload = Buffer.from(JSON.stringify({ name: m.name, version: m.version, file: m.file, size: m.size, sha256: m.sha256 }));
let ok = false;
try {
  ok = verify(null, payload, createPublicKey({ key: Buffer.from(pub, 'base64'), format: 'der', type: 'spki' }), Buffer.from(String(m.signature), 'base64'));
} catch { ok = false; }
if (!ok) die('assinatura do manifesto não confere com a chave de release.');
if (basename(file) !== m.file) die('nome do arquivo diferente do manifesto.');
let bytes;
try { bytes = readFileSync(file); } catch { die('arquivo não encontrado.'); }
if (bytes.length !== m.size) die('tamanho diferente do manifesto.');
if (createHash('sha256').update(bytes).digest('hex') !== m.sha256) die('SHA-256 diferente do manifesto (arquivo alterado).');
console.log(`OK: ${m.name} ${m.version} · assinado pela Lunes · sha256 ${m.sha256}`);
