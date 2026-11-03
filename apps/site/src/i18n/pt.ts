// Textos do site em português (idioma padrão). en.ts segue o mesmo formato.
export type Item = { icon: string; title: string; desc: string };

export const pt = {
  lang: 'pt-BR',
  path: '/',
  title: 'Piu · mensagens sem internet',
  description: 'O Piu leva suas conversas de aparelho em aparelho, por Bluetooth, Wi-Fi e rádio. Sem servidor, sem operadora e cifrado de ponta a ponta.',
  nav: { how: 'Como funciona', privacy: 'Privacidade', provider: 'Seja provider', lunes: 'LUNES', faq: 'Dúvidas', download: 'Baixar', themeLight: 'Usar tema claro', themeDark: 'Usar tema escuro', langLabel: 'Idioma', github: 'Código do projeto no GitHub' },
  hero: {
    kicker: 'LUNES NETWORK · MENSAGEIRO DESCENTRALIZADO',
    title: 'Mensagens que voam sem internet.',
    lead: 'O Piu leva suas conversas de aparelho em aparelho, por Bluetooth, Wi-Fi e rádio. Sem servidor, sem operadora e cifrado de ponta a ponta. Quando a rede cai, a vizinhança continua conversando.',
    primary: 'Baixar para Android',
    secondary: 'Como funciona',
    facts: [{ v: '0', l: 'servidores centrais' }, { v: '5', l: 'tipos de conexão' }, { v: '100%', l: 'cifrado ponta a ponta' }],
    phoneLabel: 'Demonstração interativa do app Piu: lista de conversas',
  },
  transports: { label: 'VIAJA POR', items: [['bluetooth', 'Bluetooth'], ['wifi_tethering', 'Wi-Fi Direct'], ['hub', 'Wi-Fi Mesh'], ['settings_input_antenna', 'Rádio LoRa'], ['cable', 'Cabo e USB']] as [string, string][] },
  how: {
    kicker: 'COMO FUNCIONA',
    title: 'Cada aparelho é um pedaço da rede.',
    lead: 'Se o destinatário está longe, sua mensagem pula entre celulares, roteadores e antenas da vizinhança até chegar. Se ninguém está por perto, ela espera guardada, cifrada, até surgir uma rota.',
    hops: [['edit', 'Você', 'cifra aqui'], ['smartphone', 'Celular', 'Bluetooth'], ['router', 'Roteador', 'Wi-Fi Mesh'], ['settings_input_antenna', 'Antena', 'LoRa'], ['person', 'Destino', 'confirma']] as [string, string, string][],
    steps: [
      { n: '01', title: 'Cifrada antes de sair', desc: 'A mensagem é trancada no seu aparelho. Só o destinatário tem a chave para abrir.' },
      { n: '02', title: 'Pula de nó em nó', desc: 'Celulares, roteadores e antenas passam o envelope adiante pelo melhor caminho. Se não há caminho, guardam por até 48 h.' },
      { n: '03', title: 'Chega e confirma', desc: 'O destino devolve um recibo assinado. Você vê cada estado: na fila, encaminhada, entregue.' },
    ],
  },
  features: [
    { icon: 'forum', title: 'Conversas, grupos e canais', desc: 'Grupos com convites e moderação. Canais públicos, privados ou secretos. Comunidades que reúnem tudo.' },
    { icon: 'person_off', title: 'Identidade pública ou anônima', desc: 'Sem telefone, sem e-mail. Duas identidades com chaves separadas, sem vínculo entre elas.' },
    { icon: 'description', title: 'Arquivos em blocos', desc: 'Fotos e documentos vão em pedaços, retomam quando a rota muda e chegam conferidos.' },
    { icon: 'warning', title: 'Alertas da comunidade', desc: 'Qualquer membro da comunidade publica um alerta, e a própria comunidade confirma ou contesta.' },
    { icon: 'radar', title: 'Por perto', desc: 'Encontre perfis públicos ao redor, sem localização exata. Visível só quando você quiser.' },
    { icon: 'schedule_send', title: 'Funciona fora de alcance', desc: 'Sem rede por perto? A mensagem espera na fila e sai sozinha quando surgir uma rota.' },
  ] as Item[],
  privacy: {
    kicker: 'PRIVACIDADE',
    title: 'Quem carrega não consegue ler.',
    lead: 'Toda mensagem sai cifrada do seu aparelho. Os celulares e roteadores no caminho só transportam um envelope fechado e minimizam o que fica registrado.',
    noPromiseTitle: 'O que não prometemos',
    noPromise: 'Anonimato absoluto. Horários, padrões de sinal e observação física podem permitir correlação. A identidade anônima e as opções de metadados reduzem esse risco, sem eliminá-lo.',
    items: [
      { icon: 'lock', title: 'Cifrado de ponta a ponta', desc: 'Conversas, grupos e canais privados. Nem a Lunes consegue ler.' },
      { icon: 'hub', title: 'Retransmissores às cegas', desc: 'Quem carrega sua mensagem não recebe a chave nem o conteúdo.' },
      { icon: 'badge', title: 'Identidades separadas', desc: 'Pública e anônima não compartilham chaves nem identificadores.' },
      { icon: 'database', title: 'Nada na blockchain', desc: 'Mensagens, arquivos e rotas nunca são registrados on-chain.' },
      { icon: 'verified_user', title: 'Código de segurança', desc: 'Compare com o contato pessoalmente e tenha certeza de que ninguém está no meio.' },
    ] as Item[],
  },
  provider: {
    kicker: 'SEJA PROVIDER',
    title: 'Seu roteador vale LUNES.',
    lead: 'Ligue um roteador, um Raspberry Pi ou uma antena e ajude a vizinhança a se comunicar. Você recebe créditos por entrega comprovada, liquidados em LUNES. Tempo ligado e capacidade anunciada não contam: só entregas reais.',
    classes: [
      { icon: 'router', title: 'Home Node', desc: 'Roteador com OpenWrt ou computador ligado em casa. Guarda e entrega 24 h.', ex: 'OpenWrt · Linux · Raspberry Pi', tag: 'beta' },
      { icon: 'settings_input_antenna', title: 'Super Node', desc: 'Antena ou rádio de maior alcance. Liga bairros e áreas distantes.', ex: 'LoRa 915 MHz homologado', tag: 'beta' },
      { icon: 'dns', title: 'Gateway Local', desc: 'Mini-PC que conecta Wi-Fi, rádio, USB e cabo. Não precisa de internet.', ex: 'Intel N100 · adaptadores', tag: 'estável' },
      { icon: 'wifi', title: 'Roteador comum', desc: 'Sem instalar nada: vira Ponto de Acesso de um nó seu, com nome piu.alguma-coisa.', ex: 'qualquer roteador ou repetidor', tag: 'sem instalação' },
    ],
    panelTitle: 'Painel do provider, direto no seu equipamento',
    panelSub: 'Abre na rede local, em piu-node.local. Funciona sem internet.',
    panelCta: 'Ver o painel',
    panelFrame: 'Demonstração do painel do provider',
  },
  lunes: {
    kicker: 'CARTEIRA LUNES',
    title: 'Uma carteira dentro do app, separada das suas conversas.',
    lead: 'Envie e receba LUNES até sem internet: a transação é assinada no aparelho, viaja pela malha e é liquidada quando um gateway alcança a Mainnet. Mensagens nunca vão para a blockchain.',
    rewards: [
      { k: 'BOAS-VINDAS', v: '10', title: 'Para quem instala', desc: 'Liberado depois de 7 dias de uso real e confirmação por um contato. Um aparelho, um bônus.' },
      { k: 'DISTRIBUIÇÃO', v: '25', title: 'Por pessoa que você trouxer', desc: 'Para quem passa o app de celular para celular, quando o convidado fica ativo. Até 20 por mês.' },
    ],
    note: 'Valores ilustrativos. Orçamento, limites e critérios dependem do modelo econômico da Lunes Network. Só indicação direta, sem ganhos em níveis.',
  },
  download: {
    kicker: 'BAIXAR',
    title: 'Pegue de um amigo. Ou daqui.',
    lead: 'Quem já tem o Piu pode passar o app para o seu celular, sem internet. A cópia é conferida pela assinatura na primeira abertura.',
    options: [
      { id: 'apk', icon: 'android', title: 'Android', desc: 'APK assinado para Android 9 ou superior. Ou receba de alguém por perto, sem internet.', cta: 'Baixar APK · 38 MB', primary: true,
        note: 'Download iniciado: Piu-0.1.4.apk (38,2 MB). Na primeira abertura, o app confere a própria assinatura.' },
      { id: 'friend', icon: 'phonelink_ring', title: 'De um amigo', desc: 'Sem internet e sem loja: quem já tem o Piu envia o app direto para o seu celular.', cta: 'Como receber', primary: false,
        note: 'Peça para quem já tem o Piu abrir Perfil → Convidar → “Ainda não tem”. O app chega por Wi-Fi Direct, sem internet.' },
      { id: 'node', icon: 'router', title: 'Piu Node', desc: 'Para roteadores OpenWrt, Linux, Raspberry Pi e mini-PCs. Torne-se provider.', cta: 'Ver pacotes', primary: false,
        note: 'Escolha o pacote do seu equipamento: .ipk para OpenWrt, .deb para Linux e Raspberry Pi. Todos assinados.' },
    ],
    source: { title: 'Código aberto', desc: 'Todo o Piu é software livre (AGPL-3.0): app, Piu Node, painel e protocolo. Confira, audite, faça um fork ou contribua.', cta: 'Ver no GitHub' },
    signature: ['Assinatura Lunes Network · 4C9A 7B21 … 09D3 E1F0', 'Piu 0.1.4 · SHA-256 a91f 0c3e … 52d8 7b2d'],
  },
  faq: {
    title: 'Dúvidas',
    items: [
      ['Precisa de internet?', 'Não. O Piu funciona com Bluetooth, Wi-Fi local e rádio. A internet nunca é uma rota obrigatória; ela só ajuda a liquidar LUNES na Mainnet quando estiver disponível.'],
      ['Até onde uma mensagem chega?', 'Até onde houver aparelhos e equipamentos encadeados. No bairro, celulares e roteadores bastam. Entre cidades, são necessárias antenas e nós intermediários reais.'],
      ['Alguém no caminho pode ler minhas mensagens?', 'Não. Elas são cifradas de ponta a ponta. Quem retransmite só vê um envelope fechado e os metadados mínimos para encaminhar.'],
      ['Funciona no iPhone?', 'O iPhone só instala apps pela App Store, e por lá a versão está a caminho. Lembre-se: no iPhone, a retransmissão acontece só com o app aberto.'],
      ['Como eu ganho LUNES?', 'Retransmitindo mensagens de outras pessoas com entrega comprovada, operando equipamentos como provider ou trazendo novos usuários que fiquem ativos. Duplicatas e tráfego artificial são rejeitados.'],
      ['O Piu é anônimo?', 'Você pode usar uma identidade anônima, sem nome nem telefone. Mas nenhum sistema por rádio garante anonimato absoluto: horários e padrões de sinal podem permitir correlação.'],
      ['Preciso comprar algum equipamento?', 'Não. Celulares comuns já formam a rede. Roteadores, computadores e rádios de mercado podem participar, sem hardware oficial da Lunes.'],
    ] as [string, string][],
  },
  footer: {
    tagline: 'Um produto da Lunes Network. Comunicação comunitária, aberta e distribuída.',
    cols: [
      { t: 'PRODUTO', links: [['Como funciona', '#como'], ['Privacidade', '#privacidade'], ['Baixar', '#baixar']] },
      { t: 'PROVIDER', links: [['Seja provider', '#provider'], ['Painel do provider', '/painel/'], ['Piu Node', '#baixar']] },
      { t: 'PROJETO', links: [['Telas do app', 'https://github.com/Magnopiro-oficial/piu./tree/main/design'], ['Código no GitHub', 'https://github.com/Magnopiro-oficial/piu.'], ['Manifesto', 'https://github.com/Magnopiro-oficial/piu./blob/main/MANIFESTO.md'], ['Especificação LNNP', 'https://github.com/Magnopiro-oficial/piu./blob/main/docs/lnnp/especificacao-v1.md'], ['Documento de requisitos v1.1', 'https://github.com/Magnopiro-oficial/piu./tree/main/docs/requisitos']] },
    ] as { t: string; links: [string, string][] }[],
    legal: '© 2026 Lunes Network · Sem servidor central · Mensagens nunca vão para a blockchain',
  },
};

export type Dict = typeof pt;
