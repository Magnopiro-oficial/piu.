/**
 * Ferramentas de release (rodam no ambiente de build da Lunes, NUNCA no nó):
 *   npm run release:keygen -- <pasta>                                gera o par Ed25519 de release (privada com 0600)
 *   npm run release:sign -- <privada.pem> <arquivo> <nome> <versão>   gera <arquivo>.manifest.json
 * A chave pública (SPKI DER em base64) vai para PIU_RELEASE_PUBKEY no nó e no instalador.
 */
import { createHash, createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signedPayload } from '../src/packages.js';

const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'keygen') {
  // A privada nunca nasce dentro do repositório (um `git add .` a publicaria): a pasta é obrigatória e fora dele.
  const dir = args[0];
  const repo = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
  const rel = dir ? relative(repo, resolve(dir)) : '';
  if (!dir || !rel.startsWith('..')) {
    console.error('uso: keygen <pasta FORA do repositório> (ex.: ~/cofre/piu-release-keys)');
    process.exit(2);
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  writeFileSync(join(dir, 'release-private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const spki = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  writeFileSync(join(dir, 'release-public.txt'), spki + '\n');
  console.log(`Chave pública de release (PIU_RELEASE_PUBKEY):\n${spki}\nGuarde a privada fora de qualquer repositório (idealmente em HSM/cofre).`);
} else if (cmd === 'sign') {
  const [privPath, file, name, version] = args;
  if (!privPath || !file || !name || !version) {
    console.error('uso: sign <privada.pem> <arquivo> <nome> <versão>');
    process.exit(2);
  }
  const bytes = readFileSync(file);
  const base = { name, version, file: basename(file), size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  const signature = sign(null, signedPayload(base), createPrivateKey(readFileSync(privPath))).toString('base64');
  writeFileSync(`${file}.manifest.json`, JSON.stringify({ ...base, signature }, null, 2) + '\n');
  console.log(`Manifesto assinado: ${file}.manifest.json`);
} else {
  console.error('comandos: keygen | sign');
  process.exit(2);
}
