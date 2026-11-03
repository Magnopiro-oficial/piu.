import { createHash } from 'node:crypto';
import { loadConfig } from './config.js';
import { type NodeServer, RESTART_EXIT_CODE, startNode } from './server.js';

const config = loadConfig();

/** O código só aparece aqui, no console/tela do próprio equipamento. Nunca vai para a rede nem para o log. */
const show = (reason: string, code: string) =>
  process.stdout.write(`\n  ${reason}\n  Código de pareamento: ${code.slice(0, 4)} ${code.slice(4)}  (vale 10 min, uso único)\n\n`);

// Parar o serviço (systemd, Ctrl+C) ou reiniciar pelo painel: grava as mensagens guardadas e o
// histórico antes de sair. No reinício, sai com RESTART_EXIT_CODE: o supervisor (procd com respawn,
// systemd com Restart=on-failure) sobe o nó de novo. Sem supervisor, o nó só para.
let stopping = false;
let running: NodeServer | null = null;
const stop = (code: number) => {
  if (stopping) process.exit(1);
  stopping = true;
  void (running?.close() ?? Promise.resolve()).catch(() => {}).finally(() => process.exit(code));
};

const node = await startNode(config, {
  logger: true,
  log: msg => process.stdout.write(`  ${msg}\n`),
  onCode: (code, reason) => show(reason === 'locked' ? 'Código anterior bloqueado por tentativas erradas.' : 'Código usado. Novo código para o próximo pareamento:', code),
  onRestart: () => {
    process.stdout.write(`  Reinício pedido pelo painel: gravando o estado e saindo (código ${RESTART_EXIT_CODE}) para o supervisor subir de novo.\n`);
    stop(RESTART_EXIT_CODE);
  },
});
running = node;

process.stdout.write(`\n  piu-node · painel em ${node.url}\n`);
process.stdout.write(`  Certificado TLS (SHA-256): ${node.fingerprint}\n  Confira esta impressão digital no navegador antes de aceitar o certificado.\n`);
process.stdout.write(
  config.releasePubKey
    ? `  Pacotes assinados oferecidos: ${node.packages.length} · chave de release ${createHash('sha256').update(config.releasePubKey).digest('hex').slice(0, 16)}\n`
    : '  PIU_RELEASE_PUBKEY não definida: nenhum pacote do instalador será oferecido.\n',
);
process.stdout.write(
  node.relay
    ? `  Retransmissão LNNP v1: enlace TCP ${node.relay.port}, descoberta UDP ${node.relay.discoveryPort ?? 'desligada'}, nó ${node.relay.engine.stats().node}${node.relay.engine.relaying ? '' : ' (sem retransmitir agora)'}\n`
    : '  Retransmissão LNNP desligada.\n',
);
process.stdout.write(
  node.alerts
    ? `  Alertas oficiais (CAP): ${node.alerts.feeds.join(', ')} · a cada ${Math.round(node.alerts.pollMs / 60_000)} min\n`
    : '  Alertas oficiais desligados (PIU_ALERT_FEEDS vazio).\n',
);
show('Para entrar no painel, use este código:', node.issueCode());

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => stop(0));
