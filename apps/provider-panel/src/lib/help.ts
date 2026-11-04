import type { PageId } from '../types';

export interface Term { term: string; plain: string }

/** Termos do painel em palavras simples, para quem nunca operou uma rede. */
export const GLOSSARY = {
  node: { term: 'Nó', plain: 'Um aparelho com o Piu Node instalado: este computador, um roteador, um Raspberry Pi. Ele passa adiante e guarda mensagens cifradas para quem está por perto.' },
  neighbor: { term: 'Vizinho', plain: 'Outro aparelho com o Piu que este nó alcança agora, pelo mesmo Wi-Fi, cabo ou rádio. Sem vizinhos, o nó não tem para quem passar mensagens.' },
  envelope: { term: 'Envelope', plain: 'Uma mensagem cifrada. O nó carrega, mas não consegue ler o conteúdo nem saber quem conversa com quem.' },
  receipt: { term: 'Recibo', plain: 'Comprovante assinado de que o nó entregou ou guardou um envelope. É o recibo que vira ganho depois.' },
  duplicate: { term: 'Duplicata', plain: 'Cópia de um envelope que o nó já tinha. É descartada e não gera ganho.' },
  batch: { term: 'Lote', plain: 'Um conjunto de recibos enviado para conferência. Só depois de conferido ele vira pagamento.' },
  validator: { term: 'Validador', plain: 'O serviço da Lunes que confere os recibos antes de pagar. Nesta versão ele ainda não está ligado: os recibos esperam guardados aqui.' },
  settlement: { term: 'Liquidação', plain: 'O pagamento em LUNES de um lote já conferido, na carteira que você informou.' },
  lunes: { term: 'LUNES', plain: 'A moeda da rede Lunes. É nela que os ganhos dos seus equipamentos são pagos.' },
  providerWallet: { term: 'Carteira de provider', plain: 'Uma carteira só para os ganhos dos equipamentos, separada da que você usa para conversar. Assim ninguém liga uma coisa à outra.' },
  operatorKey: { term: 'Chave de operador', plain: 'A sua assinatura digital como dono dos equipamentos. Sem a chave e sem o backup dela, você perde o controle deles.' },
  backup: { term: 'Backup da chave', plain: 'Uma cópia cifrada da chave de operador, protegida por uma senha sua. Guarde fora deste computador: pendrive, nuvem ou outro aparelho.' },
  deviceCode: { term: 'Código do equipamento', plain: 'Os 8 dígitos que aparecem no Piu Provider (ou no console do equipamento). Provam que você está perto dele; ações sensíveis pedem um código novo.' },
  techId: { term: 'Identidade técnica', plain: 'Uma chave criada dentro de cada equipamento para ele provar quem é. Você a assina com a sua chave de operador e pode revogar depois.' },
  link: { term: 'Enlace (LNNP)', plain: 'A conexão direta e cifrada entre dois nós. LNNP é o nome do protocolo que o Piu usa nela.' },
  accessPoint: { term: 'Ponto de Acesso', plain: 'Um roteador comum, sem o Piu Node. Ele só espalha o sinal; guardar mensagens e assinar recibos fica com o nó pai.' },
  parentNode: { term: 'Nó pai', plain: 'O seu nó com o Piu Node ligado a um Ponto de Acesso, por cabo ou repetição. É ele que guarda as mensagens e assina os recibos.' },
  publicName: { term: 'Nome público', plain: 'O nome que as pessoas por perto veem, como piu.padaria-do-ze. Não mostra o seu nome nem a sua carteira.' },
  clientIsolation: { term: 'Isolamento de clientes', plain: 'Opção do roteador que impede os aparelhos conectados de se verem (às vezes “AP isolation”). Precisa ficar desligada para os celulares trocarem mensagens.' },
  multicast: { term: 'Multicast e mDNS', plain: 'O jeito de os aparelhos avisarem “estou aqui” na rede. Precisam estar permitidos no roteador para o Piu se encontrar sozinho.' },
  signedPackage: { term: 'Pacote assinado', plain: 'O instalador do Piu Node. A Lunes assina cada pacote, e o instalador não roda se alguém tiver mexido nele.' },
  bandwidth: { term: 'Banda', plain: 'Quanto da velocidade da sua rede local você empresta para mensagens de outras pessoas. O resto continua só seu.' },
  storage: { term: 'Armazenamento', plain: 'Espaço em disco para guardar mensagens cifradas de quem está fora de alcance, até a pessoa aparecer.' },
  hours: { term: 'Horário de operação', plain: 'Quando o nó trabalha para a rede. Fora do horário ele não passa mensagens de terceiros.' },
} as const satisfies Record<string, Term>;

export type TermId = keyof typeof GLOSSARY;

export interface PageHelp { what: string; todo: string[]; terms: TermId[] }

/** O que cada página mostra e o que fazer nela, sem jargão. */
export const HELP: Record<PageId, PageHelp> = {
  overview: {
    what: 'O resumo do que este nó fez hoje e no mês: mensagens recebidas, repassadas e os recibos que depois viram ganho.',
    todo: ['Siga os “Primeiros passos” até o guia sumir.', 'Se “Vizinhos agora” estiver em 0, o nó ainda não tem com quem trocar mensagens: veja a Malha.', 'Os números se atualizam sozinhos; não precisa recarregar a página.'],
    terms: ['node', 'neighbor', 'envelope', 'receipt', 'duplicate'],
  },
  devices: {
    what: 'Os aparelhos que você opera: este computador e os que você adicionou (roteadores, Raspberry Pi, rádios).',
    todo: ['Use “Adicionar equipamento” e siga as 4 etapas do assistente.', 'Clique num equipamento para ver o estado dele, pausar, mudar as regras ou revogar.', 'Pausar tira o equipamento da rede sem apagar nada.'],
    terms: ['node', 'techId', 'accessPoint', 'parentNode', 'publicName'],
  },
  mesh: {
    what: 'Quem este nó alcança agora e por onde (Wi-Fi, cabo ou rádio). Cada vizinho é um caminho para as mensagens.',
    todo: ['Para um vizinho aparecer, outro aparelho com o Piu precisa estar na mesma rede.', 'Se o roteador bloquear o anúncio, adicione o outro nó pelo endereço no assistente de equipamento.', 'Mais vizinhos = mais caminhos e mais entregas.'],
    terms: ['neighbor', 'link', 'multicast'],
  },
  earnings: {
    what: 'Os recibos que este nó assinou, dia a dia, e o caminho até eles virarem LUNES.',
    todo: ['O caminho é: recibo → lote → conferência pelo validador → pagamento.', 'Nesta versão o validador ainda não está ligado: os recibos ficam guardados aqui e nada se perde.', '“Exportar CSV” salva o histórico neste computador.'],
    terms: ['receipt', 'batch', 'validator', 'settlement', 'lunes'],
  },
  wallet: {
    what: 'Onde os seus ganhos chegam. O saldo é lido direto na rede Lunes.',
    todo: ['Toque em “Receber” e cole o endereço da sua carteira Lunes.', 'Prefira uma carteira só para isso, separada da que você usa para conversar.', 'Transferências pedem aprovação no celular pareado ou um código novo do equipamento.'],
    terms: ['providerWallet', 'lunes', 'settlement', 'deviceCode'],
  },
  settings: {
    what: 'Quanto este nó empresta para a rede, o que ele aceita passar e a segurança da sua conta.',
    todo: ['Ajuste banda, espaço e horário ao que você não usa no dia a dia.', 'Em “Identidade de operador”, toque em “Exportar backup cifrado” e guarde o arquivo fora daqui.', 'Em “Acesso a este painel”, toque em “Parear celular” para aprovar transferências pelo app.'],
    terms: ['bandwidth', 'storage', 'hours', 'operatorKey', 'backup'],
  },
};

export const termsOf = (page: PageId): Term[] => [...new Set(HELP[page].terms)].map(t => GLOSSARY[t]);
