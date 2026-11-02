import { createHash } from 'node:crypto';
import { loadConfig } from './config.js';
import { startNode } from './server.js';

const config = loadConfig();

/** O código só aparece aqui, no console/tela do próprio equipamento. Nunca vai para a rede nem para o log. */
const show = (reason: string, code: string) =>
  process.stdout.write(`\n  ${reason}\n  Código de pareamento: ${code.slice(0, 4)} ${code.slice(4)}  (vale 10 min, uso único)\n\n`);

const node = await startNode(config, {
  logger: true,
  onCode: (code, reason) => show(reason === 'locked' ? 'Código anterior bloqueado por tentativas erradas.' : 'Código usado. Novo código para o próximo pareamento:', code),
});

process.stdout.write(`\n  piu-node · painel em ${node.url}\n`);
process.stdout.write(`  Certificado TLS (SHA-256): ${node.fingerprint}\n  Confira esta impressão digital no navegador antes de aceitar o certificado.\n`);
process.stdout.write(
  config.releasePubKey
    ? `  Pacotes assinados oferecidos: ${node.packages.length} · chave de release ${createHash('sha256').update(config.releasePubKey).digest('hex').slice(0, 16)}\n`
    : '  PIU_RELEASE_PUBKEY não definida: nenhum pacote do instalador será oferecido.\n',
);
show('Para entrar no painel, use este código:', node.issueCode());
