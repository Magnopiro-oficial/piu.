import { createHash, X509Certificate } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generate } from 'selfsigned';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { loadPackages, releaseKey } from './packages.js';
import { Pairing } from './security/pairing.js';
import { Store } from './store.js';

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
// Mesmo que a pasta já exista com permissão frouxa: só o usuário do serviço lê estado, certificado e pacotes.
chmodSync(config.dataDir, 0o700);

/** TLS na rede local: certificado próprio do nó (P-256), gerado na primeira execução; chave com 0600. */
async function tls() {
  const dir = join(config.dataDir, 'tls');
  const keyPath = join(dir, 'key.pem');
  const certPath = join(dir, 'cert.pem');
  if (!existsSync(keyPath) || !existsSync(certPath)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const names = config.allowedHosts.filter(h => !h.includes(':'));
    const pems = await generate([{ name: 'commonName', value: names[0] ?? 'piu-node.local' }], {
      keyType: 'ec',
      algorithm: 'sha256',
      notAfterDate: new Date(Date.now() + 397 * 86400_000),
      extensions: [{ name: 'subjectAltName', altNames: names.map(n => (/^\d+\.\d+\.\d+\.\d+$/.test(n) ? { type: 7, ip: n } : { type: 2, value: n })) }],
    });
    writeFileSync(keyPath, pems.private, { mode: 0o600 });
    writeFileSync(certPath, pems.cert, { mode: 0o644 });
  }
  const cert = readFileSync(certPath, 'utf8');
  return { key: readFileSync(keyPath, 'utf8'), cert, fingerprint: new X509Certificate(cert).fingerprint256 };
}

const pairing = new Pairing();
/** O código só aparece aqui, no console/tela do próprio equipamento. Nunca vai para a rede nem para o log. */
function showCode(reason: string) {
  const code = pairing.issue(Date.now());
  process.stdout.write(`\n  ${reason}\n  Código de pareamento: ${code.slice(0, 4)} ${code.slice(4)}  (vale 10 min, uso único)\n\n`);
}

const t = await tls();
const key = config.releasePubKey ? releaseKey(config.releasePubKey) : null;
const packagesDir = join(config.dataDir, 'packages');
const packages = loadPackages(packagesDir, key);

const app = await buildApp({
  config,
  store: new Store(config.dataDir),
  pairing,
  packages,
  packagesDir,
  https: { key: t.key, cert: t.cert },
  logger: true,
  onCodeSpent: reason => {
    // Bloqueado: espera 60 s antes de mostrar outro (freia quem tenta adivinhar pela rede).
    if (reason === 'locked') setTimeout(() => showCode('Código anterior bloqueado por tentativas erradas.'), 60_000);
    else showCode('Código usado. Novo código para o próximo pareamento:');
  },
});
await app.listen({ port: config.port, host: config.host });

process.stdout.write(`\n  piu-node · painel em https://${config.allowedHosts[0]}:${config.port}\n`);
process.stdout.write(`  Certificado TLS (SHA-256): ${t.fingerprint}\n  Confira esta impressão digital no navegador antes de aceitar o certificado.\n`);
process.stdout.write(
  key
    ? `  Pacotes assinados oferecidos: ${packages.length} · chave de release ${createHash('sha256').update(config.releasePubKey!).digest('hex').slice(0, 16)}\n`
    : '  PIU_RELEASE_PUBKEY não definida: nenhum pacote do instalador será oferecido.\n',
);
showCode('Para entrar no painel, use este código:');
