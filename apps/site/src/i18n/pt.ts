// Textos do site em português (idioma padrão). en.ts segue o mesmo formato.
import { ANDROID_FILE, ANDROID_PUBLISHED, ANDROID_SIZE, ANDROID_URL } from '../lib/androidRelease';
import { DESKTOP_PUBLISHED } from '../lib/desktopRelease';
import { redePt } from './rede.pt';

export type Item = { icon: string; title: string; desc: string };

export const pt = {
  lang: 'pt-BR',
  path: '/',
  title: 'Piu · mensagens sem internet',
  description: 'O Piu leva suas conversas de aparelho em aparelho, por Bluetooth, Wi-Fi e rádio. Sem servidor, sem operadora e cifrado de ponta a ponta.',
  nav: { network: 'A rede', how: 'Como funciona', privacy: 'Privacidade', provider: 'Seja provider', lunes: 'LUNES', desktop: 'Desktop', faq: 'Dúvidas', download: 'Baixar', themeLight: 'Usar tema claro', themeDark: 'Usar tema escuro', langLabel: 'Idioma', github: 'Código do projeto no GitHub' },
  hero: {
    kicker: 'LUNES NETWORK · MENSAGEIRO DESCENTRALIZADO',
    title: 'Mensagens que voam sem internet.',
    lead: 'O Piu leva suas conversas de aparelho em aparelho, por Bluetooth, Wi-Fi e rádio. Sem servidor, sem operadora e cifrado de ponta a ponta. Quando a rede cai, a vizinhança continua conversando.',
    primary: 'Baixar para Android',
    secondary: 'Como funciona',
    desktop: 'Também para Mac, Linux e Windows',
    facts: [{ v: '0', l: 'servidores centrais' }, { v: '5', l: 'tipos de conexão' }, { v: '100%', l: 'cifrado ponta a ponta' }],
    // Selos flutuantes ao redor do celular (ícone, texto).
    chips: [['done_all', 'Entregue · 3 saltos'], ['bluetooth', 'Bluetooth · 12 m'], ['lock', 'Cifrado de ponta a ponta']] as [string, string][],
    phoneLabel: 'Demonstração interativa do app Piu: lista de conversas',
  },
  transports: { label: 'VIAJA POR', items: [['bluetooth', 'Bluetooth'], ['wifi_tethering', 'Wi-Fi Direct'], ['hub', 'Wi-Fi local'], ['settings_input_antenna', 'Rádio LoRa'], ['cable', 'Cabo e USB']] as [string, string][] },
  how: {
    kicker: 'COMO FUNCIONA',
    title: 'Cada aparelho é um pedaço da rede.',
    lead: 'Se o destinatário está longe, sua mensagem pula entre celulares, roteadores e antenas da vizinhança até chegar. Se ninguém está por perto, ela espera guardada, cifrada, até surgir uma rota.',
    hops: [['edit', 'Você', 'cifra aqui'], ['smartphone', 'Celular', 'Bluetooth'], ['router', 'Roteador', 'Wi-Fi local'], ['settings_input_antenna', 'Antena', 'LoRa'], ['person', 'Destino', 'confirma']] as [string, string, string][],
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
  // Seção #seguranca: o que protege a frase, o instalador e a carteira (cada item conferido no código).
  security: {
    kicker: 'SEGURANÇA',
    title: 'Proteções que você pode conferir.',
    lead: 'O que guarda a sua frase de recuperação, o instalador que passa de mão em mão e o seu endereço Lunes.',
    items: [
      { icon: 'verified', title: 'Instalador verificável', desc: 'Ao passar o app para alguém, a tela de envio e a página do Wi-Fi Direct mostram o SHA-256 do instalador e do certificado de assinatura. Compare com os valores oficiais em Baixar.' },
      { icon: 'fingerprint', title: 'Frase protegida pela biometria', desc: 'Em celulares com biometria forte, depois do backup, a frase de recuperação só abre com a sua digital ou rosto. Sem biometria, vale o PIN do aparelho. Sem bloqueio de tela, o app recusa mostrar a frase, assinar e transferir.' },
      { icon: 'restart_alt', title: 'Biometria nova, frase de volta', desc: 'Cadastrou uma digital ou rosto novo? O sistema invalida a proteção antiga e o app pede as 12 palavras (ou o arquivo de backup) para religá-la. Conversas e contatos continuam intactos.' },
      { icon: 'lock', title: 'Desktop que falha fechado', desc: 'Se o chaveiro do sistema não abrir, o Piu Desktop mostra “Cofre bloqueado” e não recria nada. Parear pede a 3ª palavra entre 4 opções e mostrar a frase pede Touch ID (ou, sem ele, uma confirmação do sistema).' },
      { icon: 'screenshot_monitor', title: 'Segredos fora das capturas', desc: 'No macOS e no Windows, a frase, o QR de pareamento e a carteira do Piu Desktop não aparecem em capturas nem gravações de tela.' },
      { icon: 'account_balance_wallet', title: 'Endereço Lunes entre contatos', desc: 'Seus contatos públicos aceitos recebem o seu endereço Lunes e você aparece como destinatário na Carteira deles. Nunca pela identidade anônima. Desligue em Ajustes → Privacidade.' },
    ] as Item[],
  },
  provider: {
    kicker: 'SEJA PROVIDER',
    title: 'Seu roteador pode valer LUNES.',
    lead: 'Ligue um roteador, um Raspberry Pi ou uma antena e ajude a vizinhança a se comunicar. Cada entrega comprovada pode virar crédito, que será liquidado em LUNES quando o programa de recompensas abrir (ainda não há pagamento). Tempo ligado e capacidade anunciada não contam: só entregas reais.',
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
    // Piu Provider para computador (apps/provider-desktop): arquivos de releases.json (provider-v<versão>).
    app: {
      title: 'Piu Provider para computador',
      desc: 'Transforma o computador num nó do provider, com o painel embutido. Funciona sem internet.',
      soon: 'Em breve',
      soonNote: 'Os instaladores ainda não foram publicados. Quando saírem, aparecem aqui com tamanho e SHA-256.',
      release: 'Release no GitHub',
      files: {
        'mac-arm64-dmg': 'macOS · Apple Silicon', 'mac-x64-dmg': 'macOS · Intel', 'mac-arm64-zip': 'macOS · Apple Silicon · .zip', 'mac-x64-zip': 'macOS · Intel · .zip',
        'linux-appimage': 'Linux · AppImage', 'linux-deb': 'Linux · .deb', 'win-x64-exe': 'Windows · 64 bits',
      } as Record<string, string>,
    },
  },
  lunes: {
    kicker: 'CARTEIRA LUNES',
    title: 'Uma carteira dentro do app, separada das suas conversas.',
    lead: 'Envie e receba LUNES com a chave só no seu aparelho: a transação é assinada no celular e enviada à Mainnet. Em breve ela também poderá viajar pela malha, sem internet, até um aparelho que a publique. Mensagens nunca vão para a blockchain.',
    rewards: [
      { k: 'BOAS-VINDAS', v: '10', title: 'Para quem instala', desc: 'Liberado depois de 7 dias de uso real e confirmação por um contato. Um aparelho, um bônus.' },
      { k: 'DISTRIBUIÇÃO', v: '25', title: 'Uma vez, por pessoa que você trouxer', desc: 'Pagamento único por convite, quando a pessoa que recebeu o app de você fica ativa. Não se repete todo mês. Até 20 convidados por mês.' },
    ],
    note: 'Programa ainda não lançado: nenhum bônus é pago hoje. Valores ilustrativos. Orçamento, limites e critérios dependem do modelo econômico da Lunes Network. Só indicação direta, sem ganhos em níveis.',
  },
  download: {
    kicker: 'BAIXAR',
    title: 'Pegue de um amigo. Ou daqui.',
    lead: 'Quem já tem o Piu pode passar o app para o seu celular, sem internet. A cópia é conferida pela assinatura na primeira abertura.',
    options: [
      { id: 'apk', icon: 'android', title: 'Android', desc: 'APK assinado para Android 7 ou superior (celulares de 64 bits). Ou receba de alguém por perto, sem internet.', cta: ANDROID_PUBLISHED ? `Baixar APK · ${ANDROID_SIZE}` : 'APK em breve', primary: true,
        href: ANDROID_URL,
        note: ANDROID_PUBLISHED ? `Baixando ${ANDROID_FILE} (${ANDROID_SIZE}). Ao abrir o arquivo, o Android pede para permitir a instalação deste app: permita e instale.` : 'O APK ainda não foi publicado. Enquanto isso, receba de alguém que já tem o Piu.' },
      { id: 'friend', icon: 'phonelink_ring', title: 'De um amigo', desc: 'Sem internet e sem loja: quem já tem o Piu envia o app direto para o seu celular.', cta: 'Como receber', primary: false, href: '',
        note: 'Peça para quem já tem o Piu abrir Convidar → “Está longe ou ainda não tem” e escolher Bluetooth ou Wi-Fi Direct. O app chega sem internet.' },
      { id: 'node', icon: 'router', title: 'Piu Node', desc: 'Para roteadores OpenWrt, Linux, Raspberry Pi e mini-PCs. Torne-se provider.', cta: 'Em breve', primary: false, href: '',
        note: 'Os pacotes (.ipk para OpenWrt, .deb para Linux e Raspberry Pi) ainda não foram publicados. Quando saírem, cada um virá com o SHA-256 para conferir.' },
    ],
    source: { title: 'Código aberto', desc: 'Todo o Piu é software livre (AGPL-3.0): app, Piu Node, painel e protocolo. Confira, audite, faça um fork ou contribua.', cta: 'Ver no GitHub' },
    // Rótulos da faixa de assinatura; os hashes vêm de src/lib/androidRelease.ts.
    signature: ['Certificado do app (SHA-256)', 'SHA-256'],
    // Seção "Como verificar o download" (#verificar). Os valores oficiais ficam na faixa logo acima.
    verify: {
      title: 'Como verificar o download',
      lead: 'Antes de abrir, calcule o SHA-256 do arquivo e compare com o valor oficial: o do APK na faixa acima, o dos pacotes para computador no SHA256SUMS.txt do release. Um caractere diferente = não abra.',
      items: [
        { icon: 'laptop_mac', os: 'macOS', how: 'No Terminal:', cmd: 'shasum -a 256 ~/Downloads/Piu-*.dmg' },
        { icon: 'desktop_windows', os: 'Windows', how: 'No PowerShell:', cmd: 'Get-FileHash .\\Piu-*.exe -Algorithm SHA256' },
        { icon: 'terminal', os: 'Linux', how: 'No terminal, na pasta do download:', cmd: 'sha256sum -c --ignore-missing SHA256SUMS.txt' },
        { icon: 'android', os: 'Android (APK)', how: 'Com o Android SDK, confira o certificado ("SHA-256 digest") e o arquivo:', cmd: 'apksigner verify --print-certs Piu-*.apk && sha256sum Piu-*.apk' },
      ],
      friend: 'Recebeu de um amigo? A tela de envio do Piu e a página do Wi-Fi Direct mostram o SHA-256 do instalador e do certificado. Compare com a faixa acima antes de instalar.',
    },
    // Toast fixo no rodapé com o aviso de cada download (some sozinho em 6,5 s).
    toastClose: 'Fechar aviso',
  },
  // Seção #desktop (dentro de Baixar). Nomes e URLs dos pacotes vêm de src/lib/desktopRelease.ts.
  desktop: {
    kicker: 'PIU DESKTOP · MAC, LINUX E WINDOWS',
    title: 'Suas conversas, também no computador.',
    lead: 'Pareie com o celular pelo QR em segundos, restaure com as 12 palavras ou crie uma identidade só para o computador. Carteira, notificações do sistema e atalhos de teclado.',
    tabsLabel: 'Sistema do computador',
    previewLabel: 'Demonstração interativa do Piu Desktop: conversas',
    dl: 'Baixar',
    started: 'Download iniciado: ',
    tip: 'No macOS e no Windows, o app confere a cada abertura se o próprio pacote não foi alterado.',
    sums: 'Ver SHA256SUMS.txt',
    soon: 'Em breve',
    soonNote: 'Os pacotes para computador ainda não foram publicados. Quando saírem, os links, tamanhos e SHA-256 aparecem aqui.',
    release: 'Todos os pacotes no GitHub',
    sigNote: 'Esta versão ainda não tem assinatura da Apple nem da Microsoft. Confira o SHA-256 de cada arquivo no SHA256SUMS.txt do release.',
    sigNoteSigned: 'Ainda sem assinatura da Apple e da Microsoft, mas a lista de hashes de cada versão é assinada com a chave do projeto. Confira antes de abrir.',
    sigFile: 'Assinatura (SHA256SUMS.txt.asc)',
    keyLink: 'Chave pública',
    keyFpr: 'Chave de release do Piu:',
    verify: 'Para conferir (no macOS, troque sha256sum por shasum -a 256):',
    os: {
      mac: { tab: 'macOS', label: 'Baixar para macOS', sub: 'Apple Silicon · .dmg', req: 'macOS 12 ou superior · Apple Silicon e Intel',
        openTitle: 'Como abrir sem assinatura da Apple', open: 'Arraste o Piu para Aplicativos e abra uma vez (o macOS vai bloquear). No macOS 15 ou mais novo, vá em Ajustes do Sistema → Privacidade e Segurança e clique em Abrir mesmo assim; o clique direito → Abrir não basta mais. No macOS 14 ou anterior, clique com o botão direito no app e escolha Abrir.' },
      linux: { tab: 'Linux', label: 'Baixar para Linux', sub: 'AppImage · x86_64', req: 'x86_64 · Ubuntu 20.04+, Debian 11+, Fedora 36+ e similares',
        openTitle: 'Como abrir o AppImage', open: 'AppImage: dê permissão de execução (chmod +x Piu-*.AppImage ou Propriedades → Permitir executar) e abra. .deb: sudo apt install ./Piu-*.deb ou abra no gerenciador de pacotes.' },
      win: { tab: 'Windows', label: 'Baixar para Windows', sub: 'Instalador · 64 bits', req: 'Windows 10 ou 11 · 64 bits',
        openTitle: 'Como abrir sem assinatura da Microsoft', open: 'Se o SmartScreen avisar, clique em Mais informações → Executar assim mesmo. O instalador deixa você escolher a pasta.' },
    },
    // Título e dica por arquivo, pela chave `id` de desktopRelease.ts.
    files: {
      'mac-arm64-dmg': { t: 'Apple Silicon (M1 ou mais novo)', tip: 'Abra o arquivo e arraste o Piu para Aplicativos.' },
      'mac-x64-dmg': { t: 'Intel', tip: 'Abra o arquivo e arraste o Piu para Aplicativos.' },
      'mac-arm64-zip': { t: 'Apple Silicon · .zip', tip: 'Descompacte e mova o Piu para Aplicativos.' },
      'mac-x64-zip': { t: 'Intel · .zip', tip: 'Descompacte e mova o Piu para Aplicativos.' },
      'linux-appimage': { t: 'AppImage · qualquer distribuição', tip: 'Dê permissão de execução e abra.' },
      'linux-deb': { t: 'Ubuntu, Debian e Mint', tip: 'Instale com apt ou pelo gerenciador de pacotes.' },
      'win-x64-exe': { t: 'Windows 10 e 11 · 64 bits', tip: 'Se o SmartScreen avisar, clique em Mais informações → Executar assim mesmo.' },
    } as Record<string, { t: string; tip: string }>,
  },
  faq: {
    title: 'Dúvidas',
    items: [
      ['Precisa de internet?', 'Não. O Piu funciona com Bluetooth, Wi-Fi local e rádio. A internet nunca é uma rota obrigatória para as mensagens. A carteira LUNES ainda precisa de internet hoje para enviar à Mainnet; o envio pela malha está em teste.'],
      ['Até onde uma mensagem chega?', 'Até onde houver aparelhos e equipamentos encadeados. No bairro, celulares e roteadores bastam. Entre cidades, são necessárias antenas e nós intermediários reais.'],
      ['Alguém no caminho pode ler minhas mensagens?', 'Não. Elas são cifradas de ponta a ponta. Quem retransmite só vê um envelope fechado e os metadados mínimos para encaminhar.'],
      ['Tem versão para computador?', `Sim. O Piu Desktop roda no Mac, no Linux e no Windows. Pareie com o celular pelo QR, restaure com as 12 palavras ou crie uma identidade só para o computador. ${DESKTOP_PUBLISHED ? 'Baixe na seção Baixar.' : 'Os pacotes para baixar chegam em breve.'}`],
      ['Funciona no iPhone?', 'Ainda não. O iPhone só instala apps pela App Store, e o Piu ainda não está lá: por enquanto, só existe o app para Android. Quando chegar, a retransmissão no iPhone vai acontecer só com o app aberto.'],
      ['Como eu ganho LUNES?', 'Ainda não: o programa de recompensas não foi lançado e nada é pago hoje. Quando abrir, as recompensas virão de retransmitir mensagens de outras pessoas com entrega comprovada, operar equipamentos como provider ou trazer novos usuários que fiquem ativos. Duplicatas e tráfego artificial não contam.'],
      ['O Piu é anônimo?', 'Você pode usar uma identidade anônima, sem nome nem telefone. Mas nenhum sistema por rádio garante anonimato absoluto: horários e padrões de sinal podem permitir correlação.'],
      ['Preciso comprar algum equipamento?', 'Não. Celulares comuns já formam a rede. Roteadores, computadores e rádios de mercado podem participar, sem hardware oficial da Lunes.'],
    ] as [string, string][],
  },
  // Página "A rede" (/rede/), textos em rede.pt.ts.
  rede: redePt,
  footer: {
    tagline: 'Um produto da Lunes Network. Comunicação comunitária, aberta e distribuída.',
    cols: [
      { t: 'PRODUTO', links: [['Como funciona', '#como'], ['A rede', '/rede/'], ['Privacidade', '#privacidade'], ['Segurança', '#seguranca'], ['Baixar', '#baixar'], ['Piu Desktop', '#desktop']] },
      { t: 'PROVIDER', links: [['Seja provider', '#provider'], ['Painel do provider', '/painel/'], ['Piu Node', '#baixar']] },
      { t: 'PROJETO', links: [['Telas do app', 'https://github.com/Magnopiro-oficial/piu./tree/main/design'], ['Código no GitHub', 'https://github.com/Magnopiro-oficial/piu.'], ['Manifesto', 'https://github.com/Magnopiro-oficial/piu./blob/main/MANIFESTO.md'], ['Especificação LNNP', 'https://github.com/Magnopiro-oficial/piu./blob/main/docs/lnnp/especificacao-v1.md'], ['Documento de requisitos v1.1', 'https://github.com/Magnopiro-oficial/piu./tree/main/docs/requisitos']] },
    ] as { t: string; links: [string, string][] }[],
    legal: '© 2026 Lunes Network · Sem servidor central · Mensagens nunca vão para a blockchain',
  },
};

export type Dict = typeof pt;
