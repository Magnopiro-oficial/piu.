// Textos da página "A rede" (/rede/). Fonte visual: design/handoff/design/Piu Site Rede.dc.html.
// Fonte técnica (estado de cada parte): docs/rede/fluxograma-rede-piu.md. As marcas de estado daqui
// seguem as de lá: ✅ → 'on' (JÁ FUNCIONA), 🧪 → 'test' (EM TESTE), 🔜 → 'soon' (A CAMINHO).
// Onde o protótipo prometia além do código (transferência LUNES pela malha, recompensas), o texto foi ajustado.

export type Status = 'on' | 'test' | 'soon';
type Tile = { icon: string; title: string; desc: string };

export interface RedeDict {
  path: string;
  title: string;
  description: string;
  navLabel: string;
  nav: [string, string][];
  status: Record<Status, string>;
  hero: { kicker: string; t1: string; t2: string; lead: string; cta: string; offline: string; locked: string; ana: string; bruno: string; artLabel: string; legendLabel: string };
  pillars: Tile[];
  layers: { kicker: string; title: string; lead: string; label: string; items: { icon: string; t: string; sub: string; d: string; k: Status; nodes: [string, string][] }[] };
  msg: {
    kicker: string; title: string; lead: string; stepOf: string; anaSees: string; controls: string;
    steps: { t: string; d: string; tech: string }[];
    nodes: string[];
    notes: { writing: string; sent: string; delivered: string; guarding: string; relayed: string; read: string };
    envelope: string; oi: string; delivered: string;
    anaStates: string[];
    prev: string; next: string; pause: string; play: string; goTo: string;
  };
  relay: { kicker: string; title: string; lead: string; rules: [string, string][]; steps: { icon: string; q: string; d: string; bk?: string; bt?: string }[] };
  medium: { kicker: string; title: string; lead: string; cards: { icon: string; when: string; name: string; k: Status; a: string; b: string }[]; bridgeB: string; bridge: string };
  tx: {
    kicker: string; k: Status; title: string; lead: string; stepOf: string; allSteps: string;
    nodes: string[]; steps: { t: string; d: string }[];
    tok: { amount: string; block: string; notice: string; confirmed: string };
    notes: [string, string][];
  };
  pontos: { kicker: string; title: string; lead: string; place: string; guardian: string; steps: [string, string][]; chips: [string, string][] };
  pc: { kicker: string; title: string; words: string[]; cards: { t: string; d: string }[] };
  rewards: { kicker: string; badge: string; title: string; lead: string; cards: Tile[]; pay: Tile };
  doc: { title: string; desc: string; cta: string };
  end: { title: string; lead: string; download: string; back: string };
}

export const redePt: RedeDict = {
  path: '/rede/',
  title: 'Piu · como a rede funciona',
  description: 'Como uma mensagem do Piu viaja de aparelho em aparelho, sem internet e sem servidor central, passo a passo.',
  navLabel: 'Seções da página',
  nav: [['camadas', 'Camadas'], ['mensagem', 'A viagem'], ['relay', 'No caminho'], ['caminho', 'O meio certo'], ['dinheiro', 'LUNES'], ['pontos', 'Pontos Piu'], ['computador', 'Celular + computador'], ['recompensas', 'Recompensas']],
  status: { on: 'JÁ FUNCIONA', test: 'EM TESTE', soon: 'A CAMINHO' },
  hero: {
    kicker: 'COMO A REDE PIU FUNCIONA',
    t1: 'De mão em mão.',
    t2: 'E ninguém lê.',
    lead: 'Sem internet e sem servidor central, o Piu usa os aparelhos que estão por perto para levar a sua mensagem. Esta página mostra o caminho inteiro, passo a passo.',
    cta: 'Ver a viagem de uma mensagem',
    offline: 'Sem internet',
    locked: 'Trancada o caminho todo',
    ana: 'Ana',
    bruno: 'Bruno',
    artLabel: 'Ilustração: a mensagem da Ana passa por um celular e por uma pessoa em movimento até chegar ao Bruno.',
    legendLabel: 'Legenda de estado',
  },
  pillars: [
    { icon: 'lock', title: 'Trancada de ponta a ponta', desc: 'Quem carrega a mensagem vê só um envelope fechado.' },
    { icon: 'masks', title: 'Você não aparece no caminho', desc: 'Os aparelhos usam chaves próprias, que mudam, e nunca o seu nome ou a sua carteira.' },
    { icon: 'hub', title: 'Sem servidor central', desc: 'A internet é só mais um caminho, nunca obrigatório.' },
  ],
  layers: {
    kicker: '01 · AS CAMADAS',
    title: 'Cinco jeitos de chegar. Você não escolhe nenhum.',
    lead: 'O Piu usa o que estiver disponível, do mais simples ao mais longe. Toque numa camada para ver como ela funciona.',
    label: 'CAMADA',
    items: [
      { icon: 'smartphone', t: 'Direto', sub: 'Celular com celular', d: 'Os celulares conversam entre si pelo Bluetooth e pelo Wi-Fi Direct, como um walkie-talkie digital. Não precisa de nenhuma antena nem roteador.', k: 'on', nodes: [['smartphone', 'Ana'], ['smartphone', 'Vizinho'], ['smartphone', 'Bruno']] },
      { icon: 'wifi', t: 'Rede local', sub: 'Qualquer Wi-Fi, mesmo sem internet', d: 'Num Wi-Fi de casa, escola ou trabalho, os aparelhos Piu se acham e trocam mensagens pelo roteador. A internet pode estar desligada. Já funciona no computador e no Piu Node; no celular, está a caminho.', k: 'on', nodes: [['smartphone', 'Celular'], ['router', 'Roteador comum'], ['computer', 'Piu Desktop']] },
      { icon: 'storefront', t: 'Pontos Piu', sub: 'Lugares que fortalecem a rede', d: 'Um roteador ou um celular parado num lugar movimentado vira ponto de encontro. O ponto guardião guarda as mensagens trancadas até o destinatário passar por ali.', k: 'test', nodes: [['smartphone', 'Visitante'], ['storefront', 'Ponto'], ['inventory_2', 'Guardião']] },
      { icon: 'settings_input_antenna', t: 'Espinha dorsal', sub: 'Longas distâncias', d: 'Rádios LoRa levam mensagens curtas por quilômetros. E pessoas em movimento carregam mensagens de um bairro a outro, guardando até encontrar o próximo aparelho. A malha entre roteadores está a caminho.', k: 'on', nodes: [['settings_input_antenna', 'Rádio LoRa'], ['directions_walk', 'Pessoas em movimento'], ['settings_input_antenna', 'Rádio LoRa']] },
      { icon: 'public', t: 'Gateways', sub: 'A internet como atalho', d: 'Um aparelho com internet poderá publicar na rede Lunes as transferências de quem está sem conexão. A lógica já existe e está em teste, mas ainda não chegou ao app. É um atalho opcional, nunca obrigatório.', k: 'test', nodes: [['smartphone', 'Sem internet'], ['cell_tower', 'Gateway'], ['public', 'Lunes']] },
    ],
  },
  msg: {
    kicker: '02 · A VIAGEM DE UM “OI”',
    title: 'Da Ana ao Bruno, em seis passos.',
    lead: 'Antes de tudo, a Ana leu o QR do Bruno uma vez. A partir daí os dois celulares se reconhecem, mesmo sem internet.',
    stepOf: 'PASSO {n} DE 6',
    anaSees: 'O que a Ana vê na conversa',
    controls: 'Controles da animação',
    steps: [
      { t: 'A Ana escreve “oi”', d: 'Sem internet, sem chip e sem Wi-Fi. Só o Piu aberto e alguém por perto.', tech: 'mensagem criada' },
      { t: 'O Piu tranca a mensagem', d: 'Antes de sair, ela vira um envelope lacrado que só o celular do Bruno consegue abrir. Nem o nome da Ana vai do lado de fora. A mensagem vale por 48 horas.', tech: 'cifrada de ponta a ponta · remetente escondido' },
      { t: 'Sai pelo ar até o vizinho', d: 'O celular mais perto recebe o envelope por Bluetooth ou Wi-Fi Direct. Pode ser o celular de um desconhecido.', tech: 'Bluetooth · Wi-Fi Direct · rede local' },
      { t: 'Passa de mão em mão', d: 'Cada aparelho guarda o envelope trancado e repassa quando encontra outro. Ninguém no caminho consegue ler, e ninguém sabe de quem é.', tech: 'guarda e repassa · nunca volta para quem mandou' },
      { t: 'Chega ao Bruno', d: 'O celular do Bruno confere se o envelope é verdadeiro, se não foi mexido e se não é repetido. Só então abre e mostra o “oi”.', tech: 'conferência de integridade e autenticidade' },
      { t: 'O “entregue” volta', d: 'Um recibo faz o caminho de volta, disfarçado de mensagem comum. Na conversa da Ana aparece: entregue.', tech: 'recibo dentro da conversa' },
    ],
    nodes: ['Ana', 'Vizinho', 'Alguém passando', 'Bruno'],
    notes: { writing: 'escrevendo', sent: 'enviou', delivered: 'entregue', guarding: 'guardando', relayed: 'repassou', read: 'leu “oi”' },
    envelope: 'envelope',
    oi: 'oi',
    delivered: 'entregue',
    anaStates: ['criada', 'aguardando', 'encaminhada', 'entregue'],
    prev: 'Passo anterior',
    next: 'Próximo passo',
    pause: 'Pausar',
    play: 'Reproduzir',
    goTo: 'Ir para o passo {n}',
  },
  relay: {
    kicker: '03 · NO CAMINHO',
    title: 'O que cada aparelho decide em um instante.',
    lead: 'Qualquer celular com o Piu pode carregar mensagens de outras pessoas, sem conseguir ler nenhuma. Antes de guardar, ele faz estas perguntas.',
    rules: [
      ['battery_5_bar', 'No modo nó do celular (em teste), só carrega o dos outros com bateria acima de 30% e até 200 MB por dia.'],
      ['low_priority', 'Quando falta espaço, sai primeiro o que é menos urgente e vence antes.'],
      ['image_not_supported', 'Fotos e vídeos nunca vão pelo rádio de longa distância.'],
    ],
    steps: [
      { icon: 'move_to_inbox', q: 'Chegou um envelope de um vizinho', d: 'Cada vizinho tem uma cota. Quem manda demais é ignorado.' },
      { icon: 'content_copy', q: 'Já vi este? Já venceu?', d: 'Repetidos e envelopes com mais de 7 dias são descartados.', bk: 'SIM', bt: 'joga fora' },
      { icon: 'person_search', q: 'É para mim?', d: 'Se for, abre e mostra a mensagem. Se não for, não consegue abrir.', bk: 'SIM', bt: 'abre e mostra' },
      { icon: 'sd_card', q: 'Tenho espaço e bateria?', d: 'Cada aparelho tem limites de espaço, de dados e de bateria para os envelopes dos outros.', bk: 'NÃO', bt: 'não guarda' },
      { icon: 'inventory_2', q: 'Guarda trancado', d: 'Na primeira vez, assina um recibo dizendo que ajudou.' },
      { icon: 'share', q: 'Apareceu alguém por perto?', d: 'Repassa adiante, nunca de volta para quem mandou, e sem fazer cópias demais. Se ninguém aparecer, espera até vencer.' },
    ],
  },
  medium: {
    kicker: '04 · O MEIO CERTO',
    title: 'O celular escolhe o caminho sozinho.',
    lead: 'Texto curto vai pelo mais econômico. Arquivo grande, pelo mais rápido. Tudo ao mesmo tempo, com todos os vizinhos.',
    cards: [
      { icon: 'bluetooth', when: 'Mensagem curta ou bateria baixa', name: 'Bluetooth', k: 'on', a: '~10 kB/s', b: 'gasta pouco' },
      { icon: 'wifi_tethering', when: 'Foto, vídeo, arquivo', name: 'Wi-Fi Direct', k: 'on', a: '~500 kB/s', b: '50× mais rápido' },
      { icon: 'router', when: 'Num Wi-Fi com outros aparelhos Piu', name: 'Rede local', k: 'test', a: 'o roteador faz a ponte', b: 'sem internet' },
    ],
    bridgeB: 'A caminho:',
    bridge: 'o que chega por Bluetooth poderá seguir pelo Wi-Fi, e vice-versa. Um celular no meio vira ponte entre dois grupos.',
  },
  tx: {
    kicker: '05 · LUNES SEM INTERNET',
    k: 'soon',
    title: 'Hoje, pagar pede internet. Em breve, também pela malha.',
    lead: 'Hoje a carteira do Piu envia LUNES direto para a Lunes Mainnet, com o celular conectado. O próximo passo é a transferência viajar como uma mensagem até um aparelho com internet. A lógica da carteira para isso já existe e está em teste, mas as telas e os gateways ainda não estão no ar. Veja como vai funcionar.',
    stepOf: 'PASSO {n} DE 6',
    allSteps: 'Os seis passos da transferência pela malha',
    nodes: ['Sua carteira', 'Malha', 'Gateway', 'Rede Lunes'],
    steps: [
      { t: 'Você assina no celular', d: 'Sem internet, com o mesmo gesto de sempre: segurar para assinar. A partir daí, nada novo sai da carteira até esta resolver.' },
      { t: 'Viaja pela malha', d: 'De aparelho em aparelho, igual a uma mensagem. Pode levar horas ou dias.' },
      { t: 'Um gateway publica', d: 'O primeiro aparelho com internet que receber entrega a transferência à rede Lunes, sem mudar nada nela.' },
      { t: 'A rede Lunes registra', d: 'A transferência entra num bloco e é finalizada pela rede.' },
      { t: 'Um aviso volta', d: 'O gateway manda um recibo pela malha. É só um aviso: qualquer um no caminho poderia inventá-lo, por isso o Piu não confia nele.' },
      { t: 'Confirmada de verdade', d: 'Quando o seu celular volta a ter internet, ele mesmo confere na Lunes. Só então aparece “confirmada”.' },
    ],
    tok: { amount: '25 LUNES', block: 'em bloco', notice: 'aviso', confirmed: 'confirmada' },
    notes: [
      ['wifi', 'Já funciona hoje: com internet, a carteira do Piu envia LUNES e confere a confirmação na própria Lunes Mainnet.'],
      ['lock_clock', 'Pela malha, enquanto uma transferência estiver a caminho, nenhuma outra sai da sua carteira. Assim ninguém gasta o mesmo dinheiro duas vezes.'],
      ['visibility_off', 'A transferência sai com um remetente descartável, que não liga ao seu nome nas conversas.'],
    ],
  },
  pontos: {
    kicker: '06 · PONTOS PIU',
    title: 'Um roteador comum vira ponto de encontro.',
    lead: 'Em teste: uma padaria, uma escola, uma igreja. Quem passa por ali entra no Wi-Fi, e os celulares trocam mensagens entre si, mesmo sem internet. O roteador não precisa de nada novo.',
    place: 'Padaria do Zé',
    guardian: 'Guardião',
    steps: [
      ['O dono cria o ponto no app', 'Sem pedir a senha do Wi-Fi de casa. Um celular velho também serve, criando a própria rede.'],
      ['Um teste confere a rede', 'Se os aparelhos da casa ficariam expostos aos visitantes, o ponto não liga.'],
      ['Um toque e um QR na parede', 'Quem chega recebe o aviso “Ponto Piu por perto — entrar?”.'],
    ],
    chips: [['device_hub', 'Multiplicador: faz todos se acharem'], ['inventory_2', 'Guardião: guarda até a pessoa passar']],
  },
  pc: {
    kicker: '07 · CELULAR + COMPUTADOR',
    title: 'O computador espelha. O celular manda.',
    words: ['lua', 'ponte', 'sal'],
    cards: [
      { t: 'Leia o QR', d: 'O Piu Desktop mostra um código que muda a cada 30 segundos.' },
      { t: 'Confira 3 palavras', d: 'No computador, você escolhe a terceira palavra entre quatro. É a prova de que ninguém se meteu no meio.' },
      { t: 'Conversas espelhadas', d: 'Conversas e contatos aparecem no computador, trancados no caminho.' },
      { t: 'O computador nunca paga', d: 'O Piu Desktop nunca assina transações. Qualquer pagamento precisa ser aprovado no celular.' },
    ],
  },
  rewards: {
    kicker: '08 · RECOMPENSAS',
    badge: 'PROGRAMA AINDA NÃO LANÇADO',
    title: 'Ajudar a entregar deixa um rastro que dá para provar.',
    lead: 'O programa de recompensas ainda não foi lançado e nada é pago hoje. A base já existe: cada entrega pode ser comprovada sem revelar quem conversou com quem.',
    cards: [
      { icon: 'receipt_long', title: 'Quem carrega assina um recibo', desc: '“Eu ajudei a levar este envelope.”' },
      { icon: 'approval', title: 'Quem recebe confirma', desc: 'Com um apelido, sem o seu nome.' },
      { icon: 'fact_check', title: 'Um validador confere', desc: 'Recibo e confirmação precisam bater. Fraude não conta.' },
    ],
    pay: { icon: 'toll', title: 'Pagamento em LUNES', desc: 'Ainda não lançado. Só abre com regras públicas e limites para ninguém abusar.' },
  },
  doc: {
    title: 'Para quem quer os detalhes técnicos',
    desc: 'O fluxograma completo da rede, com o estado de cada parte no código (✅ pronto, 🧪 em teste, 🔜 a caminho), fica no GitHub.',
    cta: 'Ver o fluxograma',
  },
  end: {
    title: 'Cada celular com o Piu deixa a rede mais forte.',
    lead: 'Instale, abra perto de quem você conhece e pronto: você já faz parte do caminho.',
    download: 'Baixar o Piu',
    back: 'Voltar ao site',
  },
};
