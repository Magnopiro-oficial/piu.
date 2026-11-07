// Textos da Central de Ajuda (/ajuda/). Fonte visual: design/handoff/design/PiuAjuda.dc.html
// (+ piu-ajuda-dados.js e piu-ajuda-antenas.js, entrega de 06/11).
// O conteúdo NÃO é cópia do protótipo: cada passo foi conferido no código e nos docs (nomes reais de telas
// e botões, comandos que existem, versões de releases.json). O que mudou e por quê: docs/ajuda/ANALISE.md.
// Números marcados com "≈" ou "estimativa" são estimativas, não medições do projeto.
import { ANDROID_CERT_SHA256, ANDROID_FILE, ANDROID_SHA256, ANDROID_SIZE, ANDROID_URL, ANDROID_VERSION } from '../lib/androidRelease';
import { DESKTOP, PROVIDER } from '../lib/desktopRelease';
import { NODE_DEB, NODE_IPK, type NodeFile } from '../lib/nodeRelease';

export type Status = 'on' | 'test' | 'soon';
type B = 0 | 1;
/** Itens das mini telas (mesmo formato de piu-ajuda-dados.js, mais `seg` e `kick`). */
export type SItem =
  | ['row', string, string, string?, B?, B?]
  | ['tog', string, string, B, B?]
  | ['btn', string, B?]
  | ['ghost', string]
  | ['hold', string, B?]
  | ['qr', string?]
  | ['words', string[], number?]
  | ['note', string, string]
  | ['big', string, string, string?]
  | ['prog', string, string]
  | ['term', string[]]
  | ['field', string, string, B?]
  | ['sys', string, string, [string, string]]
  | ['code', string]
  | ['text', string]
  | ['seg', string, string[], number, B?]
  | ['kick', string];
/** f: p = celular, w = janela/navegador, t = terminal. */
export interface Scr { f: 'p' | 'w' | 't'; t?: string; u?: string; i: SItem[] }
/** Link de download vindo de releases.json (url vazia = ainda não publicado). */
export interface Dl { t: string; s: string; url: string }
export interface Step { t: string; d: string; tip?: string; warn?: string; tech?: string[]; s?: Scr; dl?: Dl[] }
export interface Guide {
  id: string; cat: string; icon: string; t: string; sum: string; time: string; lvl: string;
  /** Estado do que o guia descreve, com as mesmas marcas da página "A rede". */
  k: Status;
  needs: string[]; warn?: string; steps: Step[]; tech?: string[]; fim: string;
  kind?: 'prob';
  /** O guia traz estimativas (alcance, perdas, medidas): mostra o aviso. */
  est?: boolean;
  /** Fontes externas citadas (rótulo, URL). */
  src?: [string, string][];
}
export interface AjudaDict {
  path: string; title: string; description: string;
  ui: {
    kicker: string; h1: string; sub: string; search: string; searchLabel: string; popular: string; step: string; of: string; problem: string;
    done: string; mark: string; solved: string; markSolved: string; before: string; progress: string; doneCount: string;
    tech: string; copy: string; copied: string; tip: string; warn: string; back: string; next: string; stuck: string; stuckLink: string;
    results: string; result: string; none: string; steps: string; finish: string; reset: string; inGuide: string; clear: string;
    link: string; linkCopied: string; illus: string; estTitle: string; est: string; sources: string; soonDl: string; nav: string;
    noJs: string; anchor: string; statusLabel: string;
  };
  status: Record<Status, string>;
  cats: { id: string; t: string; d: string }[];
  popular: string[];
  guides: Guide[];
}

const REPO = 'https://github.com/Magnopiro-oficial/piu.';
const MB = ANDROID_SIZE || '≈ 35 MB';
const short = (h: string) => (h ? `${h.slice(0, 8)}…${h.slice(-8)}` : '');
const dl = (r: typeof DESKTOP, os: 'mac' | 'linux' | 'win' | 'mac-x64-dmg', t: string): Dl => {
  const f = os === 'mac-x64-dmg' ? r.files.find(x => x.id === os) : r.mainFile(os);
  return { t, s: f ? `${f.file}${f.size ? ` · ${f.size}` : ''}` : '', url: f?.url ?? '' };
};
/** Pacote do Piu Node (releases.json, produto node): url vazia = "em breve". */
const nodeDl = (f: NodeFile, t: string): Dl => ({ t, s: `${f.file}${f.size ? ` · ${f.size}` : ''}`, url: f.url });
const IPK = NODE_IPK.file;
const IPK_VER = IPK.replace(/^piu-node_|_all\.ipk$/g, '');
const DEB = NODE_DEB.file;
const ANATEL_ATO = 'https://informacoes.anatel.gov.br/legislacao/atos-de-certificacao-de-produtos/2017/1139-ato-14448';
const ANATEL_RES = 'https://informacoes.anatel.gov.br/legislacao/resolucoes/2017/936-resolucao-680';
const ANATEL_14158 = 'https://informacoes.anatel.gov.br/legislacao/atos-de-certificacao-de-produtos/2025/2070-ato-14158';
const OWRT_GUEST = 'https://openwrt.org/docs/guide-user/network/wifi/guestwifi/configuration_command_line';
const ANATEL_SRC: [string, string][] = [
  ['Anatel · Ato nº 14.448/2017 (requisitos técnicos de radiação restrita, Anexo I, itens 10 e 11)', ANATEL_ATO],
  ['Anatel · Ato nº 14.158/2025 (altera o Ato 14.448; obrigatório desde 06/04/2026)', ANATEL_14158],
  ['Anatel · Resolução nº 680/2017 (Regulamento de equipamentos de radiação restrita)', ANATEL_RES],
];

export const ajudaPt: AjudaDict = {
  path: '/ajuda/',
  title: 'Piu · Ajuda',
  description: 'Guias passo a passo do Piu: instalar, passar o app adiante sem internet, guardar as 12 palavras, ajudar a rede, montar um Piu Node e antenas.',
  ui: {
    kicker: 'CENTRAL DE AJUDA', h1: 'Passo a passo, sem complicação.',
    sub: 'Guias para instalar, passar o app adiante, ajudar a rede e montar equipamentos. Cada passo mostra a tela que você vai ver, com os nomes que estão no app hoje. Quem entende de tecnologia encontra os comandos no bloco técnico.',
    search: 'Buscar: instalar, roteador, palavras, QR…', searchLabel: 'Buscar na ajuda', popular: 'Mais procurados',
    step: 'PASSO', of: 'DE', problem: 'PROBLEMA', done: 'Feito', mark: 'Marcar como feito', solved: 'Resolvido', markSolved: 'Marcar como resolvido',
    before: 'Antes de começar', progress: 'Seu progresso', doneCount: 'feitos', tech: 'Bloco técnico', copy: 'Copiar', copied: 'Copiado',
    tip: 'Dica', warn: 'Atenção', back: 'Ajuda', next: 'Próximo guia', stuck: 'Algo deu errado?', stuckLink: 'Ver problemas comuns',
    results: 'resultados', result: 'resultado', none: 'Nada encontrado. Tente outra palavra, como “instalar” ou “roteador”.', steps: 'passos',
    finish: 'Tudo pronto', reset: 'Recomeçar', inGuide: 'em', clear: 'Limpar',
    link: 'Copiar link deste passo', linkCopied: 'Link copiado', illus: 'Ilustração da tela. Os nomes são os do app; os valores são exemplos.',
    estTitle: 'Estimativas', est: 'Alcances, perdas, medidas e contas deste guia são estimativas para começar, não medições do projeto Piu. Confira no seu lugar e na folha de dados do fabricante.',
    sources: 'Fontes', soonDl: 'em breve', nav: 'Seções', noJs: 'A busca e o “marcar como feito” precisam de JavaScript. Os guias abaixo funcionam sem ele.',
    anchor: 'Link para este passo', statusLabel: 'Estado',
  },
  status: { on: 'JÁ FUNCIONA', test: 'EM TESTE', soon: 'A CAMINHO' },
  cats: [
    { id: 'start', t: 'Começar', d: 'Instalar, receber e passar o Piu adiante' },
    { id: 'help', t: 'Ajudar a rede', d: 'Seu celular ou um lugar fortalecendo a malha' },
    { id: 'gear', t: 'Equipamentos', d: 'Roteador, computador e rádio' },
    { id: 'ant', t: 'Antenas', d: 'Do caseiro ao profissional, para quem gosta de pôr a mão na massa' },
    { id: 'desk', t: 'Computador', d: 'O Piu no Mac, no Windows e no Linux' },
    { id: 'fix', t: 'Problemas', d: 'Quando algo não sai como esperado' },
  ],
  popular: ['android', 'share', 'recovery', 'desktop', 'openwrt'],
  guides: [
    // ───────────── Começar ─────────────
    { id: 'android', cat: 'start', icon: 'android', k: 'on', t: 'Instalar o Piu no Android', sum: 'Baixe o app por este site e crie a sua identidade em poucos minutos.', time: '5 min', lvl: 'Fácil',
      needs: ['Android 7 ou mais novo, celular de 64 bits', `${MB} livres para o arquivo, mais o espaço do app`, 'Internet só para baixar. Sem internet? Veja “Receber o app de um amigo”.'],
      steps: [
        { t: 'Baixe o arquivo', d: `No celular, toque no botão abaixo. O arquivo ${ANDROID_FILE} (${MB}) vai para a pasta Downloads.`,
          dl: [{ t: `Baixar o Piu ${ANDROID_VERSION} para Android`, s: `${ANDROID_FILE} · ${MB}`, url: ANDROID_URL }],
          s: { f: 'p', t: 'Baixar', i: [['big', 'android', 'Piu para Android', `${ANDROID_FILE} · ${MB}`], ['btn', 'Baixar para Android', 1], ['text', 'Android 7 ou superior · 64 bits']] } },
        { t: 'Permita a instalação', d: 'Ao abrir o arquivo, o Android avisa que o navegador não pode instalar apps. Toque em Configurações e ligue “Permitir desta fonte”. Volte com a seta. O texto exato muda de um aparelho para outro.',
          warn: 'Só faça isso com arquivos deste site ou de alguém que você conhece. Você pode desligar de novo depois de instalar.',
          s: { f: 'p', t: 'Instalar apps desconhecidos', i: [['row', 'public', 'Navegador', 'o app que baixou o arquivo'], ['tog', 'Permitir desta fonte', '', 1, 1], ['note', 'info', 'Você pode desligar depois de instalar.']] } },
        { t: 'Instale', d: 'Toque em Instalar e espere alguns segundos. Se o Play Protect avisar, toque em “Mais detalhes” e depois na opção de instalar mesmo assim. Antes, se quiser, confira o arquivo pelo bloco técnico.',
          tech: ['Conferir o arquivo (computador)', `sha256sum ${ANDROID_FILE}`, `# esperado: ${ANDROID_SHA256 || '(sem release publicado)'}`, `apksigner verify --print-certs ${ANDROID_FILE}`, `# "certificate SHA-256 digest" esperado: ${ANDROID_CERT_SHA256}`],
          s: { f: 'p', i: [['sys', 'Deseja instalar este app?', 'Piu', ['Cancelar', 'Instalar']]] } },
        { t: 'Crie a sua identidade', d: 'Na tela de boas-vindas, toque em “Criar identidade”. Em “Como você quer aparecer?”, escolha “Identidade pública” (com nome) ou “Identidade anônima” (só uma chave). Não pede telefone nem e-mail.',
          s: { f: 'p', t: 'Como você quer aparecer?', i: [['row', 'person', 'Identidade pública', 'nome e foto que você escolher', 1], ['row', 'masks', 'Identidade anônima', 'sem nome, sem foto'], ['field', 'Seu nome', 'Seu nome', 1], ['btn', 'Gerar minhas chaves']] } },
        { t: 'Entre e faça o backup', d: 'O app gera as chaves no próprio celular e mostra a impressão digital. Toque em “Entrar no Piu”. Logo depois, faça o backup das 12 palavras: sem ele, ninguém recupera a sua conta.',
          tip: 'O guia “Guardar as 12 palavras e recuperar a conta” mostra o caminho: Perfil → Backup cifrado das chaves.',
          s: { f: 'p', t: '', i: [['big', 'key', 'Suas chaves estão prontas.', 'Impressão digital da chave'], ['note', 'info', 'Você pode fazer backup cifrado depois, em Perfil.'], ['btn', 'Entrar no Piu', 1]] } },
      ],
      fim: 'Seu Piu já funciona, mesmo sem internet. Troque o código com alguém por perto (Conversas → Escanear código) para mandar a primeira mensagem.' },

    { id: 'receive', cat: 'start', icon: 'phonelink_ring', k: 'on', t: 'Receber o app de um amigo, sem internet', sum: 'Quem já tem o Piu envia o app direto para o seu celular, por Wi-Fi Direct ou Bluetooth.', time: '5 min', lvl: 'Fácil',
      needs: ['Alguém por perto com o Piu no Android', 'Celular Android 7 ou mais novo, 64 bits', 'Wi-Fi ligado (não precisa estar conectado a nenhuma rede)'],
      steps: [
        { t: 'Peça para o amigo abrir o convite', d: 'No celular dele: Perfil → Convidar para o Piu → “Está longe ou ainda não tem”. Na tela “Enviar convite”, em “A pessoa ainda não tem o Piu?”, ele toca em Wi-Fi Direct (mais rápido) ou Bluetooth.',
          s: { f: 'p', t: 'Enviar convite', i: [['kick', 'A PESSOA AINDA NÃO TEM O PIU?'], ['row', 'wifi_tethering', 'Wi-Fi Direct', 'mais rápido', 1], ['row', 'bluetooth', 'Bluetooth', 'funciona em qualquer Android']] } },
        { t: 'Entre na rede que aparece no celular dele', d: 'Com Wi-Fi Direct, o celular dele mostra “1 · No celular dela, entre nesta rede”, com um QR, o nome da rede e a senha. Aponte a câmera para o QR ou escolha a rede no Wi-Fi e digite a senha. Se o Android avisar que a rede não tem internet, toque em manter conectado.',
          tip: 'A rede fica aberta por 10 minutos. Se fechar, ele toca em “Abrir de novo”.',
          s: { f: 'p', t: 'Enviar convite', i: [['text', '1 · No celular dela, entre nesta rede'], ['qr', 'QR para entrar na rede Wi-Fi'], ['field', 'Rede', 'DIRECT-…'], ['field', 'Senha', '••••••••']] } },
        { t: 'Abra a página e baixe', d: 'No passo “2 · Ela abre a página e baixa o Piu”, leia o segundo QR ou digite o endereço no navegador. A página vem do celular dele, não da internet. Toque em “Baixar o Piu”.',
          tech: ['Como funciona por dentro', '# grupo Wi-Fi Direct temporário, aberto pelo convite (fecha em 10 min)', 'página local: http://192.168.49.1:8765', '# o APK é o mesmo instalado no celular de quem envia'],
          s: { f: 'w', t: 'Baixar o Piu', u: '192.168.49.1:8765', i: [['big', 'phonelink_ring', 'Baixar o Piu', 'Instalador enviado de um celular por perto, sem internet.'], ['btn', `Baixar o Piu (${MB})`, 1]] } },
        { t: 'Confira o instalador', d: 'A página e o app de quem envia (cartão “Conferir o instalador”) mostram o “SHA-256 do arquivo” e o “Certificado (SHA-256)”. O certificado tem de ser o oficial do Piu, o mesmo publicado neste site.',
          warn: 'Se o certificado for diferente, não instale: não é o Piu oficial.',
          s: { f: 'p', t: 'Conferir o instalador', i: [['text', 'Certificado (SHA-256)'], ['code', short(ANDROID_CERT_SHA256)], ['row', 'verified', 'Certificado oficial do Piu', '', 1]] } },
        { t: 'Instale e adicione quem enviou', d: 'Abra o arquivo baixado e siga os passos 2 a 4 de “Instalar o Piu no Android”. Depois, leia o código de convite no celular de quem enviou para virarem contatos.',
          s: { f: 'p', i: [['sys', 'Deseja instalar este app?', 'Piu', ['Cancelar', 'Instalar']]] } },
      ],
      fim: 'O Piu chegou sem internet e sem loja. Agora é só criar a identidade e ler o convite de quem enviou.' },

    { id: 'share', cat: 'start', icon: 'send_to_mobile', k: 'on', t: 'Passar o app para outra pessoa', sum: 'Envie o Piu do seu celular para quem ainda não tem, sem internet.', time: '3 min', lvl: 'Fácil',
      needs: ['O Piu no seu celular Android', 'A pessoa por perto, com Android 7 ou mais novo', 'Wi-Fi ligado no seu celular'],
      steps: [
        { t: 'Abra Perfil → Convidar para o Piu', d: 'Na aba Perfil, toque em “Convidar para o Piu”. O mesmo convite está em Conversas → Nova conversa.',
          s: { f: 'p', t: 'Perfil', i: [['row', 'devices', 'Aparelhos', '', 0, 1], ['row', 'key', 'Backup cifrado das chaves', '', 0, 1], ['row', 'person_add', 'Convidar para o Piu', '', 1, 1]] } },
        { t: 'Toque em “Está longe ou ainda não tem”', d: 'Em “A pessoa já tem o Piu?”, escolha “Está longe ou ainda não tem”. Se ela já tem o app, use “Sim, já tem”: ela lê o seu QR e vocês viram contatos.',
          s: { f: 'p', t: 'Traga alguém para a rede.', i: [['qr', 'uso único · expira em 24 h'], ['kick', 'A PESSOA JÁ TEM O PIU?'], ['row', 'qr_code_2', 'Sim, já tem', '', 0, 1], ['row', 'install_mobile', 'Está longe ou ainda não tem', '', 1, 1]] } },
        { t: 'Escolha Wi-Fi Direct ou Bluetooth', d: 'Wi-Fi Direct abre uma pequena rede só para isso e mostra os QRs para a pessoa. Bluetooth usa o compartilhamento do Android e manda o arquivo do app.',
          tip: 'Se o Android pedir, permita “dispositivos por perto” (ou localização, no Android 12 e antes). Sem isso, a rede não abre.',
          s: { f: 'p', t: 'Enviar convite', i: [['kick', 'A PESSOA AINDA NÃO TEM O PIU?'], ['row', 'wifi_tethering', 'Wi-Fi Direct', '', 1], ['row', 'bluetooth', 'Bluetooth', '']] } },
        { t: 'Mostre os dois QRs', d: 'Primeiro “1 · No celular dela, entre nesta rede”. Depois “2 · Ela abre a página e baixa o Piu”. Deixe os celulares perto e com a tela ligada. A rede fecha sozinha em 10 minutos.',
          s: { f: 'p', t: 'Enviar convite', i: [['note', 'schedule', 'Rede aberta · fecha em 9:41'], ['text', '2 · Ela abre a página e baixa o Piu'], ['qr', 'QR da página para baixar o Piu'], ['ghost', 'Fechar a rede']] } },
        { t: 'Confiram o instalador e o convite', d: 'No cartão “Conferir o instalador”, a pessoa compara o certificado com o do site. Depois que ela instalar, mande o convite: “Confiram este código” mostra 4 palavras que precisam ser iguais nos dois celulares.',
          s: { f: 'p', t: 'Enviar convite', i: [['text', 'Confiram este código'], ['words', ['—', '—', '—', '—']], ['note', 'lock', 'Se as palavras forem diferentes, ela não deve aceitar.']] } },
      ],
      warn: 'iPhone não recebe o app assim. O Piu ainda não está na App Store: por enquanto, só existe o app para Android.',
      fim: 'Mais um celular na rede. Cada pessoa nova deixa o caminho das mensagens mais curto.' },

    { id: 'recovery', cat: 'start', icon: 'key', k: 'on', t: 'Guardar as 12 palavras e recuperar a conta', sum: 'A frase que devolve as suas chaves e a carteira se o celular quebrar, sumir ou for trocado.', time: '5 min', lvl: 'Fácil',
      needs: ['Papel e caneta', 'Um lugar só seu, sem câmeras por perto', 'Bloqueio de tela ligado no celular (PIN, padrão, senha ou biometria)'],
      steps: [
        { t: 'Abra o backup', d: 'Perfil → Backup cifrado das chaves. Toque em “Mostrar a frase”. O app pede a sua biometria ou o PIN do celular. Sem bloqueio de tela, a frase não aparece.',
          s: { f: 'p', t: 'Sua frase de recuperação', i: [['note', 'visibility_off', 'Frase oculta. Toque para mostrar'], ['btn', 'Mostrar a frase', 1]] } },
        { t: 'Escreva as 12 palavras no papel', d: 'Na ordem, com o número de cada uma. Confira letra por letra. Depois toque em “Já anotei”.',
          warn: 'Não tire print nem foto, não mande por mensagem e não guarde na nuvem. Quem tiver estas palavras tem a sua conta. O app bloqueia print nesta tela.',
          s: { f: 'p', t: 'Sua frase de recuperação', i: [['words', ['•••', '•••', '•••', '•••', '•••', '•••', '•••', '•••', '•••', '•••', '•••', '•••']], ['note', 'lock', 'O Piu nunca envia esta frase a ninguém, nem à Lunes.'], ['btn', 'Já anotei', 1]] } },
        { t: 'Confirme 3 palavras', d: 'O app sorteia 3 posições e mostra 3 opções para cada uma. Toque na correta. Se errar, aparece “A palavra nº … não confere. Confira no papel.” O botão Confirmar só libera com as 3 certas.',
          s: { f: 'p', t: 'Confirme 3 palavras', i: [['text', 'Palavra nº 7'], ['words', ['—', '—', '—'], 1], ['btn', 'Confirmar']] } },
        { t: 'Escolha onde guardar a cópia cifrada', d: 'A frase recupera as chaves e a carteira. Para trazer também contatos e conversas, guarde um arquivo cifrado: no cartão SD ou pendrive (com uma senha sua), em outro aparelho seu por perto, ou fique só com a frase no papel.',
          tip: 'Papel estraga com água e fogo. Um saquinho plástico ajuda; uma segunda cópia em outro lugar também.',
          s: { f: 'p', t: 'Onde guardar a cópia cifrada?', i: [['row', 'sd_card', 'Arquivo cifrado no cartão SD ou pendrive', 'sem nuvem · senha sua', 1], ['row', 'devices', 'Outro aparelho seu, por perto', 'cópia direta, cifrada'], ['row', 'edit_note', 'Só a frase, no papel', 'recupera chaves, não o histórico']] } },
        { t: 'Para recuperar em outro celular', d: 'Instale o Piu e, nas boas-vindas, toque em “Restaurar de outro aparelho”. Escolha “Com a frase de 12 palavras” e digite na ordem. Voltam as chaves e a carteira; o histórico só volta com o arquivo de backup ou vindo de outro aparelho seu.',
          s: { f: 'p', t: 'Traga suas chaves para este aparelho.', i: [['row', 'devices', 'De outro aparelho seu, por perto', ''], ['row', 'key', 'Com a frase de 12 palavras', 'chaves e carteira', 1], ['row', 'description', 'De um arquivo de backup', '']] } },
      ],
      tech: ['Detalhes', '# frase BIP39 de 12 palavras, gerada no próprio celular', '# a Lunes não tem cópia: sem a frase (ou o arquivo e a senha), não há recuperação', '# biometria mudou? o app pede a frase de novo ("Confirme a sua frase de novo")'],
      fim: 'Sua conta está protegida. Se trocar de celular, é só ter o papel em mãos.' },

    // ───────────── Ajudar a rede ─────────────
    { id: 'phone-node', cat: 'help', icon: 'cell_tower', k: 'on', t: 'Ajudar a rede com o seu celular (modo nó)', sum: 'Seu celular guarda e repassa mensagens cifradas dos outros, sem conseguir ler nenhuma. Você escolhe os limites.', time: '5 min', lvl: 'Fácil',
      needs: ['O Piu no Android (no iPhone, só repassa com o app aberto)', 'Carregador por perto, se for deixar ligado o dia todo'],
      warn: 'O programa com caução (100 LUNES, 3 avais, 7 dias) ainda não abriu: o endereço da caução não foi publicado e as recompensas estão desligadas. Nada é pago hoje. Os passos 1 a 4 já funcionam.',
      steps: [
        { t: 'Confira a chave “Modo nó”', d: 'Na aba Rede, a chave “Modo nó” (retransmitir mensagens cifradas de outras pessoas) já vem ligada. Desligue se não quiser ajudar.',
          s: { f: 'p', t: 'Rede', i: [['tog', 'Modo nó', 'retransmitir mensagens cifradas de outras pessoas', 1, 1], ['row', 'monitoring', 'Diagnóstico local', '', 0, 1]] } },
        { t: 'Ajuste os limites do nó', d: 'Ainda em Rede, em “LIMITES DO NÓ”: “Parar abaixo de” (20, 30 ou 50% de bateria; padrão 30%), “Espaço para terceiros” (256 MB, 512 MB ou 1 GB; padrão 512 MB) e “Só retransmitir carregando”.',
          s: { f: 'p', t: 'Rede', i: [['kick', 'LIMITES DO NÓ'], ['seg', 'Parar abaixo de', ['20%', '30%', '50%'], 1], ['seg', 'Espaço para terceiros', ['256 MB', '512 MB', '1 GB'], 1], ['tog', 'Só retransmitir carregando', '', 0]] } },
        { t: 'Escolha horário e tráfego', d: 'Perfil → Bateria e limites. Em “HORÁRIO E TRÁFEGO”: Horário (Sempre, 22h–7h ou personalizado), “Tráfego de terceiros por dia” (50, 200 ou 500 MB; padrão 200 MB) e a banda máxima.',
          s: { f: 'p', t: 'Bateria e limites', i: [['tog', 'Retransmitir em segundo plano', '', 1], ['kick', 'HORÁRIO E TRÁFEGO'], ['seg', 'Horário', ['Sempre', '22h–7h', '…'], 0], ['seg', 'Tráfego de terceiros por dia', ['50 MB', '200 MB', '500 MB'], 1, 1]] } },
        { t: 'Escolha por quanto tempo guardar', d: 'Perfil → Armazenamento → “MENSAGENS DE TERCEIROS”: “Espaço máximo” e “Prazo máximo” (24 h, 48 h ou 7 dias; padrão 48 h). Uma mensagem nunca vale mais que 7 dias: depois disso, ninguém mais a carrega.',
          s: { f: 'p', t: 'Armazenamento', i: [['kick', 'MENSAGENS DE TERCEIROS'], ['seg', 'Espaço máximo', ['256 MB', '512 MB', '1 GB'], 1], ['seg', 'Prazo máximo', ['24 h', '48 h', '7 dias'], 1, 1]] } },
        { t: 'O programa com caução (ainda fechado)', d: 'Em Perfil → Painel do provider → “Do celular” aparece “Este celular vira um nó da rede.”, com as regras: caução de 100 LUNES mais a taxa (volta 7 dias depois de sair), 3 avais de nós e 7 dias seguidos ligado. Hoje a lista de requisitos mostra “Programa de caução: Não abriu · endereço da caução não publicado”, e o botão fica desligado.',
          warn: 'Ninguém da Lunes vai pedir LUNES para ativar o modo nó por mensagem ou link. Quando o programa abrir, o endereço sai no app e neste site.',
          s: { f: 'p', t: 'Conectar', i: [['kick', 'MODO NÓ'], ['big', 'cell_tower', 'Este celular vira um nó da rede.', ''], ['row', 'toll', 'Recompensas', 'DESLIGADAS'], ['row', 'block', 'Programa de caução', 'Não abriu · endereço da caução não publicado', 1], ['ghost', 'Agora não']] } },
      ],
      tech: ['Regras do programa (quando abrir)', '# caução: 100 LUNES + taxa · devolvida 7 dias após sair (processo manual)', '# avais: 3, de nós há mais de 7 dias · cada nó dá até 5 por mês · aval vale 90 dias', '# pedido de aval vale 3 dias · 7 dias seguidos ligado', '# no programa: até 200 MB/dia de terceiros, pausa com 30% de bateria, precisa de 1 GB livre', '# recompensas: desligadas · endereço da caução: ainda não definido'],
      fim: 'Seu celular já ajuda a levar mensagens. Você acompanha em Rede → Diagnóstico local.' },

    { id: 'point', cat: 'help', icon: 'storefront', k: 'test', t: 'Criar um Ponto Piu com o Wi-Fi de um lugar', sum: 'Uma padaria, uma escola ou uma igreja vira ponto de encontro das mensagens.', time: '8 min', lvl: 'Fácil',
      needs: ['Celular Android com o Piu, no Wi-Fi do lugar', '“Wi-Fi local” ligado na aba Rede', 'Uma rede de visitante, separada dos aparelhos da casa (ou um celular que crie a própria rede)', 'Ser responsável pelo lugar, ou ter autorização'],
      steps: [
        { t: 'Abra Rede → Pontos Piu', d: 'Na aba Rede, em “PONTOS PIU”, toque em “Criar ponto Piu”. A tela “Um lugar onde a malha fica mais forte.” explica o Multiplicador e o Guardião. Toque em Começar.',
          s: { f: 'p', t: 'Rede', i: [['kick', 'PONTOS PIU'], ['row', 'storefront', 'Criar ponto Piu', 'transforme este Wi-Fi num ponto de encontro da malha', 1, 1]] } },
        { t: 'Escolha a rede', d: 'Em “Em qual rede?”, o Piu usa o Wi-Fi em que o celular já está e nunca pede a senha. Marque “É rede de visitante ou só do ponto” se for o caso. Sem roteador? “Criar a rede neste celular” (Android 8 ou mais novo). Toque em “Testar esta rede”.',
          s: { f: 'p', t: 'Em qual rede?', i: [['row', 'wifi', 'Este celular está em', 'Conectado', 1], ['tog', 'É rede de visitante ou só do ponto', 'separada dos aparelhos da casa', 1], ['row', 'wifi_tethering', 'Criar a rede neste celular', 'sem roteador', 0, 1], ['btn', 'Testar esta rede', 1]] } },
        { t: 'Espere o teste automático', d: 'Quatro conferências: “Aparelhos se enxergam”, “Rede de casa protegida”, “Internet” e “Capacidade”. Verde: “Esta rede serve”. Amarelo: “Funciona, com um ajuste”. Vermelho: “Não dá para usar esta rede” e a ativação fica bloqueada.',
          warn: 'Vermelho quer dizer que visitantes veriam os aparelhos da casa. Use uma rede de visitante ou só do ponto. Amarelo por “Isolamento entre visitantes ligado”: no roteador, desligue “isolar clientes” na rede de visitante, porque os celulares precisam se enxergar.',
          s: { f: 'p', t: 'Testando', i: [['prog', 'Testando 3 de 4', '75%'], ['row', 'check_circle', 'Aparelhos se enxergam', ''], ['row', 'check_circle', 'Rede de casa protegida', 'visitantes não veem a casa'], ['row', 'pending', 'Internet', 'testando…'], ['row', 'pending', 'Capacidade', 'aguardando']] } },
        { t: 'Escolha o nível', d: 'Em “Quanto este ponto faz?”: Multiplicador (só ajuda os aparelhos a se encontrarem), Guardião (também guarda mensagens cifradas), Guardião + app (também entrega o app a quem não tem) ou Gateway (desligado por padrão). Guardião: até 1 GB e até 7 dias; o padrão é 512 MB · 7 dias.',
          s: { f: 'p', t: 'Quanto este ponto faz?', i: [['row', 'device_hub', 'Multiplicador', 'só ajuda os aparelhos a se encontrarem'], ['row', 'inventory_2', 'Guardião', 'também guarda mensagens cifradas', 1], ['seg', 'Espaço', ['256 MB', '512 MB', '1 GB'], 1], ['seg', 'Guardar por', ['1 dia', '3 dias', '7 dias'], 2]] } },
        { t: 'Ative com um toque', d: 'Em “Ativar o ponto?”, dê um nome e, se quiser, informe o nome e a senha da rede para o QR (o Piu não lê senhas salvas). Ativar não move LUNES e as recompensas estão desligadas. Toque em “Ativar ponto”.',
          s: { f: 'p', t: 'Ativar o ponto?', i: [['field', 'Nome do ponto', 'Nome do lugar', 1], ['row', 'toll', 'Recompensas', 'desligadas'], ['note', 'key', 'O ponto ganha uma chave própria, guardada neste celular. Encerrar o ponto apaga essa chave.'], ['btn', 'Ativar ponto', 1]] } },
        { t: 'Imprima o cartaz', d: 'Em “Ponto Piu ativo.”, toque em Cartaz → “Imprimir ou compartilhar (PDF)”, em A4. Quem chega com o Piu no Android recebe “Ponto Piu por perto” e toca em “Entrar no ponto” (Android 10 ou mais novo; antes disso, pela câmera no QR).',
          s: { f: 'p', t: 'Cartaz', i: [['text', 'Aqui tem ponto Piu'], ['qr', 'Aponte a câmera para entrar'], ['btn', 'Imprimir ou compartilhar (PDF)', 1]] } },
        { t: 'Acompanhe no painel', d: 'O painel do ponto mostra aparelhos atendidos hoje, entregas comprovadas, mensagens guardadas e o espaço usado. Pausar, Retomar ou Encerrar (“Encerrar e apagar” apaga a chave do ponto e o que ele guarda). Se a rede cair, o ponto volta sozinho.',
          s: { f: 'p', t: 'Ponto', i: [['row', 'groups', 'aparelhos atendidos hoje', ''], ['row', 'done_all', 'entregas comprovadas', ''], ['row', 'inventory_2', 'mensagens guardadas', ''], ['ghost', 'Pausar']] } },
      ],
      tech: ['Como o ponto funciona', '# descoberta na rede local: anúncio UDP (porta 8423) e mDNS _piu._udp', '# enlace LNNP v1 por TCP (porta 8422), só envelopes cifrados', '# guardião: até 1 GB e até 7 dias (padrão 512 MB · 7 dias)', '# "Guardião + app": página local com o APK, SHA-256 do arquivo e do certificado'],
      fim: 'O lugar virou um Ponto Piu. Quem passa por ali troca mensagens mesmo sem internet.' },

    // ───────────── Equipamentos ─────────────
    { id: 'openwrt', cat: 'gear', icon: 'router', k: 'test', t: 'Montar um Piu Node no roteador OpenWrt', sum: 'Um roteador ligado 24 horas guarda e repassa mensagens cifradas para quem está na rede local.', time: '30 min', lvl: 'Médio',
      needs: ['Roteador com OpenWrt 24.10 (o 23.05 instala mas não inicia; o 25.12 usa .apk)', 'Arquitetura x86_64, aarch64 ou arm com FPU, onde o pacote node exista', '128 MB de RAM no mínimo (256 MB é confortável) e flash folgada', 'Um computador com SSH na rede do roteador'],
      warn: NODE_IPK.url
        ? 'O pacote .ipk está no release do GitHub (link no passo 2), com SHA-256. A instalação num roteador de verdade ainda está “a confirmar”.'
        : 'O pacote .ipk ainda não foi publicado: o link do passo 2 fica “em breve” até o release sair. Enquanto isso, gere a partir do código. A instalação num roteador de verdade ainda está “a confirmar”.',
      steps: [
        { t: 'Confira se o roteador serve', d: 'No painel do roteador (LuCI), em Status → Visão geral, veja a versão do firmware e a arquitetura. Pelo SSH, confira também se existe o pacote node na versão 20.19 ou mais nova.',
          tech: ['Pelo terminal (SSH)', 'ssh root@192.168.1.1', 'ubus call system board', 'free -m', 'opkg update && opkg info node', '# precisa de node >= 20.19 (OpenWrt 24.10 tem 20.20)'],
          s: { f: 'w', t: 'Status', u: '192.168.1.1', i: [['row', 'memory', 'Versão do firmware', 'OpenWrt 24.10', 1], ['row', 'developer_board', 'Arquitetura', 'ex.: aarch64'], ['row', 'storage', 'Memória', 'ex.: 256 MB']] } },
        { t: 'Pegue o pacote', d: NODE_IPK.url
            ? `Baixe ${IPK} (serve para qualquer arquitetura com node) e confira o SHA-256 com o SHA256SUMS.txt do mesmo release.`
            : `O arquivo é ${IPK} (cerca de 6 MiB, serve para qualquer arquitetura com node). Até o release sair, gere a partir do código, na pasta packaging/openwrt, ou baixe o artifact piu-node-openwrt-ipk do CI no GitHub (precisa de login).`,
          dl: [nodeDl(NODE_IPK, 'Pacote para OpenWrt (.ipk)')],
          tech: NODE_IPK.url
            ? ['Conferir o download', `sha256sum -c --ignore-missing SHA256SUMS.txt   # ${IPK}: OK`]
            : ['Gerar o pacote (computador com Node 20.19+)', 'cd packaging/openwrt', 'npm run deps && npm run build:panel', 'npm ci && npm run build', `# sai em dist/${IPK}`] },
        { t: 'Envie e instale', d: 'Copie o arquivo para o /tmp do roteador e instale pelo SSH. O serviço sobe sozinho, com um usuário sem privilégios. O pacote não abre nada no firewall nem mexe na rede do roteador.',
          warn: 'Não desligue o roteador da tomada durante a instalação.',
          tech: ['Pelo terminal', `scp -O ${IPK} root@192.168.1.1:/tmp/`, 'ssh root@192.168.1.1', 'opkg update', 'opkg install node', 'node -v   # precisa ser >= 20.19', `opkg install /tmp/${IPK}`],
          s: { f: 't', t: 'Terminal', i: [['term', [`$ opkg install /tmp/${IPK}`, `Installing piu-node (${IPK_VER}) to root...`, 'Configuring piu-node.']]] } },
        { t: 'Leia o código de pareamento', d: 'O código tem 8 dígitos, vale 10 minutos e é de uso único. Ele não vai para o log: fica num arquivo que só o root lê. Anote também a impressão digital do certificado.',
          tech: ['No roteador', 'cat /etc/piu-node/pairing-code', "logread -e piu-node | grep -A1 'SHA-256'", '# código vencido? gere outro:', '/etc/init.d/piu-node restart'],
          s: { f: 't', t: 'Terminal', i: [['term', ['$ cat /etc/piu-node/pairing-code', '········']]] } },
        { t: 'Abra o painel e pareie o navegador', d: 'No navegador, abra https:// com o IP do roteador e a porta 8420 (por exemplo https://192.168.1.1:8420). O navegador avisa do certificado próprio: compare a impressão digital antes de aceitar. Em “Parear este navegador”, digite o “Código do equipamento” e “Seu nome” e toque em Parear.',
          tip: 'O pacote não anuncia nenhum nome na rede (piu-node.local não abre). Use o IP da lan: ele entra sozinho na lista de nomes aceitos e no certificado.',
          s: { f: 'w', t: 'Parear este navegador', u: '192.168.1.1:8420', i: [['field', 'Código do equipamento', '········', 1], ['field', 'Seu nome', 'Seu nome'], ['btn', 'Parear', 1]] } },
        { t: 'Escolha o que ele empresta', d: 'Em Configurações, escolha banda (20, 50 ou 100 Mbps), armazenamento e horário (sempre, 22h–7h ou 8h–18h). No OpenWrt, as mensagens guardadas ficam na memória e o teto vem em 16 MiB (opção memory_mb).',
          tech: ['Ajustes pelo UCI', "uci set piu-node.lnnp.memory_mb='32'", "uci add_list piu-node.lnnp.peer='192.168.1.20:8422'   # vizinho fixo (opcional)", 'uci commit piu-node   # o serviço reinicia sozinho'],
          s: { f: 'w', t: 'Configurações', u: '192.168.1.1:8420', i: [['seg', 'Banda', ['20', '50', '100 Mbps'], 0], ['seg', 'Horário', ['Sempre', '22h–7h', '8h–18h'], 0], ['row', 'memory', 'Teto em memória', 'memory_mb · 16 MiB no OpenWrt']] } },
        { t: 'Pareie o celular, se quiser aprovar transferências', d: 'Em Configurações → Acesso a este painel → “Parear celular”, o painel mostra um QR. No Piu, em Conversas → Escanear código (ou Rede → Seja um provider → Adicionar equipamento → … → Pelo terminal → “Escanear o QR do painel”), leia o QR. O celular mostra 6 dígitos: digite no painel.',
          s: { f: 'p', t: 'Adicionar contato', i: [['qr', 'QR do painel (piup:…)'], ['note', 'pin', 'O celular mostra 6 dígitos para digitar no painel.']] } },
      ],
      tech: ['Referência', 'painel: https://<IP do roteador>:8420', 'enlace LNNP: 8422/TCP · descoberta: 8423/UDP (só na lan; não abra na wan)', 'config: /etc/config/piu-node · dados: /etc/piu-node', 'logs: logread -e piu-node · estado: /etc/init.d/piu-node status', 'remover: opkg remove piu-node   # /etc/piu-node fica'],
      fim: 'Seu roteador é um Piu Node. Ele conversa com outros Piu Nodes, com o Piu Desktop e com celulares no mesmo Wi-Fi.' },

    { id: 'linux', cat: 'gear', icon: 'developer_board', k: 'on', t: 'Piu Node no computador ou no Raspberry Pi', sum: 'Um computador ligado em casa vira nó da rede. No Mac, no Windows e no Linux x86_64 há um app pronto.', time: '15 min', lvl: 'Médio',
      needs: ['Computador ligado na tomada e na rede de casa', 'App Piu Provider: macOS, Windows 10/11 64 bits ou Linux x86_64', 'Raspberry Pi ou outro Linux com systemd: Node.js 20.19 ou mais novo (o Debian 13 traz o 20.19; no Debian 12 e no Ubuntu 24.04, instale o Node.js 22 da NodeSource antes)'],
      steps: [
        { t: 'Baixe o Piu Provider', d: `O Piu Provider ${PROVIDER.version} roda o Piu Node dentro do app e mostra o painel. Escolha o arquivo do seu sistema.`,
          dl: [dl(PROVIDER, 'mac', 'macOS · Apple Silicon'), dl(PROVIDER, 'mac-x64-dmg', 'macOS · Intel'), dl(PROVIDER, 'win', 'Windows 10 e 11 · 64 bits'), dl(PROVIDER, 'linux', 'Linux · AppImage x86_64')],
          tip: 'Sem assinatura da Apple e da Microsoft por enquanto. No Mac: Ajustes do Sistema → Privacidade e Segurança → Abrir mesmo assim (no macOS 14 ou anterior, botão direito no app → Abrir). No Windows: Mais informações → Executar assim mesmo.' },
        { t: 'Abra: ele pareia sozinho', d: 'Ao abrir, o app sobe o nó, abre o painel e entra com o nome do usuário do computador. A retransmissão começa na rede local (enlace TCP 8422 e descoberta UDP 8423). O painel fica só neste computador.',
          tip: 'Para abrir o painel de outro aparelho da rede, ligue “Nó → Permitir acesso pela rede local” e use “Nó → Mostrar código de pareamento…”.',
          s: { f: 'w', t: 'Piu Provider', i: [['row', 'dashboard', 'Visão geral', '', 1], ['row', 'router', 'Equipamentos', ''], ['row', 'hub', 'Malha', ''], ['row', 'settings', 'Configurações', '']] } },
        { t: 'No Raspberry Pi ou outro Linux: instale o .deb', d: NODE_DEB.url
            ? `O ${DEB} instala o Piu Node como serviço do systemd, com usuário próprio (piu-node) e dados em /var/lib/piu-node. Serve para qualquer arquitetura (é JavaScript): o apt confere se o Node.js do sistema é 20.19 ou mais novo.`
            : 'O pacote .deb ainda não foi publicado (o link fica “em breve”). Dá para gerar o mesmo pacote a partir do código, no próprio Raspberry, e instalar: ele vira serviço do systemd, com usuário próprio (piu-node) e dados em /var/lib/piu-node.',
          dl: [nodeDl(NODE_DEB, 'Debian, Ubuntu e Raspberry Pi OS (.deb)')],
          tech: NODE_DEB.url
            ? ['No Raspberry Pi (Linux)', 'node -v   # precisa ser >= 20.19', `sudo apt install ./${DEB}`, 'systemctl status piu-node', '# ajustes: /etc/default/piu-node, depois sudo systemctl restart piu-node']
            : ['Gerar e instalar a partir do código (no Raspberry, com Node 20.19+ e git)', `git clone ${REPO}.git piu`, 'cd piu/packaging/linux', 'npm run deps && npm run build:panel && npm run build', `sudo apt install ./dist/${DEB}`, 'systemctl status piu-node'],
          tip: 'Sem systemd? Rode direto do código: npm ci && npm run build em apps/provider-panel e em apps/piu-node, depois PIU_NODE_HOSTS=localhost,127.0.0.1,<IP do Raspberry> PIU_NODE_DATA=$HOME/.piu-node node dist/main.js.',
          s: { f: 't', t: 'Terminal', i: [['term', [`$ sudo apt install ./${DEB}`, 'Creating user \'piu-node\' (Piu node) …', 'piu-node: painel em https://<IP deste computador>:8420 · código: sudo cat /var/lib/piu-node/pairing-code']]] } },
        { t: 'Pareie o navegador', d: 'Como serviço, o código de 8 dígitos fica em /var/lib/piu-node/pairing-code, que só o root e o usuário do serviço leem (rodando no terminal, ele aparece na tela). Abra https://<IP>:8420, confira a impressão digital do certificado, digite o “Código do equipamento” e “Seu nome” e toque em Parear.',
          tech: ['No Raspberry Pi', 'sudo cat /var/lib/piu-node/pairing-code', "journalctl -u piu-node | grep -A1 'SHA-256'", '# código vencido? gere outro:', 'sudo systemctl restart piu-node'],
          warn: 'Rodando no terminal, sem o systemd, o nó para se você fechar o terminal ou reiniciar pelo painel.',
          s: { f: 'w', t: 'Parear este navegador', u: '192.168.1.50:8420', i: [['field', 'Código do equipamento', '········', 1], ['field', 'Seu nome', 'Seu nome'], ['btn', 'Parear', 1]] } },
        { t: 'Confira se está funcionando', d: 'No painel, Visão geral e Malha mostram os vizinhos encontrados, o que foi guardado e repassado e os recibos. Os números são reais, contados pelo nó.',
          s: { f: 'w', t: 'Malha', u: 'localhost:8420', i: [['row', 'hub', 'Vizinhos', ''], ['row', 'inventory_2', 'Guardados', ''], ['row', 'receipt_long', 'Recibos', '']] } },
      ],
      tech: ['Referência', 'painel: https://localhost:8420 (ou outra porta livre, no app)', 'enlace LNNP: 8422/TCP · descoberta: 8423/UDP · libere só na rede local', 'pacote .deb: config /etc/default/piu-node · dados /var/lib/piu-node · logs journalctl -u piu-node', 'remover: sudo apt remove piu-node (os dados ficam) · sudo apt purge piu-node (apaga /var/lib/piu-node)', 'variáveis PIU_*: apps/piu-node/README.md · do código como serviço: Restart=on-failure (reinício pelo painel sai com 75)'],
      fim: 'Seu computador é um Piu Node. Deixe ligado: quanto mais tempo online, mais ele ajuda.' },

    { id: 'lora', cat: 'gear', icon: 'settings_input_antenna', k: 'test', t: 'Ligar um rádio LoRa ao Piu Node', sum: 'Mensagens curtas por quilômetros, com um rádio LoRa no USB do nó. Experimental.', time: '45 min', lvl: 'Avançado',
      needs: ['Um Piu Node funcionando (OpenWrt ou Linux)', 'Rádio LoRa USB de 915 MHz com certificado da Anatel e firmware de modem KISS', 'Antena para a faixa de 915 MHz', 'Um lugar alto: janela, laje ou telhado'],
      warn: 'Experimental: o rádio LoRa foi testado só com simulador e cabo virtual, sem placa real em campo. Não há tela no app nem no painel para o rádio: a configuração é pelo UCI ou por variáveis. Firmwares que esperam configuração vinda do computador (como o RNode) não funcionam.',
      steps: [
        { t: 'Escolha o rádio certo', d: 'Use um rádio com certificado da Anatel e firmware de modem KISS, que guarda a frequência, o SF e a banda. A frequência e a potência ficam no firmware do rádio, não no Piu.',
          warn: 'Rádio sem certificado da Anatel pode atrapalhar outros serviços e não é permitido.' },
        { t: 'Configure o firmware dentro da lei', d: 'Faixas de 902–907,5 MHz e 915–928 MHz. Potência de pico de até 1 W (com espalhamento por salto de frequência, depende do número de canais). Antena com mais de 6 dBi: reduza a potência 1 dB para cada dB a mais. Anote SF, banda e taxa de código do firmware.',
          tech: ['Limites (Ato Anatel 14.448/2017, Anexo I, item 10)', '# 902–907,5 e 915–928 MHz', '# digital: até 1 W de pico · salto de frequência: 1 W com 35+ canais, 0,25 W com menos', '# antena > 6 dBi: −1 dB de potência por dB acima de 6 dBi'] },
        { t: 'Coloque a antena antes de ligar', d: 'Rosqueie a antena no rádio e só depois ligue no USB. Leve a antena para o lugar mais alto possível, longe de paredes de concreto.',
          warn: 'Transmitir sem antena pode queimar o rádio.' },
        { t: 'Ligue no USB e ache a porta', d: 'Conecte o rádio ao USB do nó e veja qual porta apareceu. No OpenWrt e no pacote .deb, o usuário do serviço (piu-node) já está no grupo dialout; rodando do código, inclua o seu.',
          tech: ['Pelo terminal', 'ls /dev/ttyUSB* /dev/ttyACM*', '# Linux: sudo usermod -aG dialout $USER'] },
        { t: 'Diga ao Piu Node onde está o rádio', d: 'O formato é lora:<porta>@<velocidade>. SF, banda e taxa de código precisam ser iguais aos do firmware (padrão do Piu: SF 9, 125 kHz, 4/5). O nó limita a ocupação do canal a 10% por hora.',
          tech: ['No OpenWrt (UCI)', 'uci set piu-node.serial=serial', "uci set piu-node.serial.device='lora:/dev/ttyUSB0@115200'", "uci set piu-node.serial.lora_sf='9'", "uci set piu-node.serial.lora_bw_khz='125'", "uci set piu-node.serial.lora_cr='5'", 'uci commit piu-node', '# Linux (.deb): PIU_SERIAL=lora:/dev/ttyUSB0@115200 e PIU_LORA_SF=9 em /etc/default/piu-node', '# depois: sudo systemctl restart piu-node'],
          s: { f: 't', t: 'Terminal', i: [['term', ["$ uci set piu-node.serial.device='lora:/dev/ttyUSB0@115200'", '$ uci commit piu-node', '$ logread -e piu-node']]] } },
        { t: 'Confira no log', d: 'Se a porta não abrir (rádio desligado, porta errada), o nó continua pela rede local e o log diz o que não abriu. Os contadores da porta (pacotes, repetições, tempo no ar, ocupação do canal) saem na API /api/relay do painel.',
          tech: ['Logs', 'logread -f -e piu-node   # OpenWrt', 'journalctl -u piu-node -f   # Linux (.deb)'] },
        { t: 'Saiba o que passa pelo rádio', d: 'Só mensagens pequenas: envelopes de até 1536 bytes, em pacotes de 255 bytes, com confirmação e repetição. Fotos, vídeos e arquivos nunca vão pelo rádio: seguem por outro meio quando houver.' },
      ],
      fim: 'Seu nó agora também fala por rádio. Conte o que deu certo e o que não deu: é assim que o LoRa sai do teste.' },

    // ───────────── Antenas ─────────────
    { id: 'ant-basics', cat: 'ant', icon: 'school', k: 'on', est: true, t: 'Antes de montar: o que faz um rádio chegar longe', sum: 'Altura, visada, cabo, ganho e limite legal. O que decide o alcance de verdade, no Wi-Fi e no LoRa.', time: '10 min de leitura', lvl: 'Amador',
      needs: [],
      src: ANATEL_SRC,
      steps: [
        { t: 'Altura vale mais que ganho', d: 'Em 915 MHz e, mais ainda, em 2,4 e 5 GHz, o sinal anda quase em linha reta. Telhados, árvores e morros bloqueiam. Subir a antena alguns metros costuma render mais do que trocar por uma antena “mais forte”.',
          s: { f: 'w', t: 'Exemplo (estimativa, LoRa 915 MHz, cidade)', i: [['row', 'window', 'Antena na janela · 3 m', '≈ 800 m'], ['row', 'roofing', 'No telhado · 8 m', '≈ 2,5 km'], ['row', 'water_drop', 'Na caixa-d’água · 15 m', '≈ 5 km', 1], ['note', 'info', 'Estimativas. Varia muito de lugar para lugar.']] } },
        { t: 'Enxergue o outro lado, com folga', d: 'Além de “ver” a outra antena, o caminho precisa de espaço livre em volta da linha reta entre elas: a zona de Fresnel. Mantenha pelo menos 60% dela sem obstáculos. Quanto mais alta a frequência, menor a zona.',
          tech: ['Zona de Fresnel (no meio do enlace)', 'r = 8,66 × √(D_km ÷ f_GHz)   # metros', '# 4 km em 915 MHz: r ≈ 18,1 m · 60% ≈ 10,9 m', '# 4 km em 2,4 GHz: r ≈ 11,2 m · 60% ≈ 6,7 m', '# 5 km em 5,8 GHz: r ≈ 8,0 m · 60% ≈ 4,8 m'] },
        { t: 'Ganho é foco, não potência', d: 'Uma omni de 2–3 dBi espalha o sinal em volta. Uma omni de 8 dBi achata o sinal como um disco: vai mais longe no plano, mas atende pior quem está bem abaixo dela. Setoriais e painéis cobrem uma fatia; Yagis e parabólicas, um ponto distante.',
          s: { f: 'w', t: 'Qual antena', i: [['row', 'radio_button_checked', 'Omni 2–3 dBi', 'em volta, terreno irregular'], ['row', 'trip_origin', 'Omni 6–8 dBi', 'mais longe, terreno plano', 1], ['row', 'change_history', 'Setorial 60–120°', 'uma rua, uma praça'], ['row', 'arrow_right_alt', 'Yagi ou parabólica', 'um ponto distante']] } },
        { t: 'Cabo come sinal', d: 'Cada metro de cabo perde parte do sinal, e perde mais nas frequências altas. Use o cabo mais curto possível, ou leve o rádio para perto da antena e desça só um cabo de rede.',
          tech: ['Perda típica por metro (estimativa; confira a folha de dados)', '# cabo       915 MHz    2,4 GHz', '# RG-174     ≈ 1,0 dB   ≈ 1,8 dB', '# RG-58      ≈ 0,5 dB   ≈ 1,0 dB', '# LMR-240    ≈ 0,25 dB  ≈ 0,42 dB', '# LMR-400    ≈ 0,13 dB  ≈ 0,22 dB', '# cada 3 dB perdidos = metade da potência'] },
        { t: 'Respeite o limite legal', d: 'No Brasil, Wi-Fi e LoRa usam faixas de “radiação restrita” (Anatel). Em 2,4 GHz e em 5,725–5,850 GHz, até 1 W de potência de pico no transmissor; com antena acima de 6 dBi, a potência cai 1 dB por dB a mais (em enlace ponto a ponto fixo há exceções). Em 5,15–5,35 e 5,47–5,725 GHz os limites são menores, e DFS e controle de potência são obrigatórios em parte delas. Use só equipamento com certificado da Anatel.',
          warn: 'Não altere o firmware para passar do limite. Além de proibido, atrapalha outros serviços e a própria rede. O Piu não controla a potência do rádio: ela é ajustada no equipamento.',
          tech: ['Resumo (Ato Anatel 14.448/2017, Anexo I)', '# 2400–2483,5 MHz: até 1 W de pico; antena > 6 dBi: −1 dB por dB acima', '#   ponto a ponto fixo: −1 dB a cada 3 dB acima de 6 dBi (item 10.5.1)', '# 5725–5850 MHz: até 1 W; ponto a ponto fixo: sem redução (item 10.5.2)', '# 5150–5250 MHz: ponto de acesso até 30 dBm e 17 dBm/MHz; ao ar livre, ≤ 21 dBm e.i.r.p. acima de 30° de elevação', '# 5250–5350 e 5470–5725 MHz: até 24 dBm e 11 dBm/MHz; DFS e TPC obrigatórios', '# 902–907,5 e 915–928 MHz: até 1 W de pico (salto de frequência: depende dos canais)', '# texto conferido em 07/11/2026 na versão compilada (captura de 04/10/2026; site da Anatel em manutenção)'] },
        { t: 'Mesma polarização dos dois lados', d: 'Antenas em pé conversam com antenas em pé. Se uma estiver deitada, perde-se a maior parte do sinal. Combine com quem está do outro lado.' },
      ],
      fim: 'Agora escolha o seu nível: comece pela antena caseira ou vá direto para o telhado.' },

    { id: 'ant-groundplane', cat: 'ant', icon: 'construction', k: 'test', est: true, t: 'Antena caseira de ¼ de onda para 915 MHz (ground plane)', sum: 'Um conector, fio de cobre e uma hora de trabalho. Para o rádio LoRa, que no Piu ainda é experimental.', time: '1 h', lvl: 'Amador',
      needs: ['Conector SMA ou N fêmea de painel, com 4 furos', '50 cm de fio de cobre rígido de 2,5 mm², ou vareta de latão', 'Ferro de solda, estanho, alicate e régua', 'Um pedaço de cano de PVC com tampa (opcional)'],
      steps: [
        { t: 'Entenda as medidas', d: 'Em 915 MHz, uma onda tem cerca de 328 mm. A antena usa um quarto disso: um fio em pé de cerca de 82 mm e quatro fios “radiais” um pouco maiores, inclinados para baixo. São medidas de partida: o ajuste fino vem medindo.',
          tech: ['Cálculo', 'λ = 300 ÷ 915 = 0,328 m', '¼ λ ≈ 82 mm', '# corte 2–3 mm a mais e apare medindo', '# radiais ≈ 88 mm a 45° para baixo: impedância perto de 50 Ω'],
          s: { f: 'w', t: 'Medidas para 915 MHz (ponto de partida)', i: [['row', 'height', 'Elemento vertical', 'corte 84 mm, ajuste até ≈ 82', 1], ['row', 'call_split', 'Radiais × 4', '≈ 88 mm cada'], ['row', 'rotate_right', 'Ângulo dos radiais', '45° para baixo']] } },
        { t: 'Solde o elemento vertical', d: 'Corte 84 mm de fio. Solde no pino central do conector, bem reto. Deixe esfriar sem mexer.', tip: 'Raspe a ponta do fio e passe estanho nela antes de soldar. A solda pega mais rápido e esquenta menos o conector.' },
        { t: 'Solde os 4 radiais', d: 'Corte 4 fios de 88 mm. Solde um em cada furo do conector, formando uma cruz. Dobre todos para baixo, a cerca de 45°.', warn: 'Os radiais não podem encostar no pino central nem no elemento vertical.' },
        { t: 'Ajuste o comprimento', d: 'Com um NanoVNA ou medidor de ROE, apare o elemento vertical 1 mm por vez até a ROE ficar abaixo de 1,5 em 915 MHz. Sem medidor? Deixe em 82 mm: costuma funcionar bem.',
          s: { f: 'w', t: 'NanoVNA (exemplo)', i: [['row', 'tune', 'Frequência', '915 MHz'], ['row', 'monitoring', 'ROE (SWR)', 'abaixo de 1,5', 1]] } },
        { t: 'Proteja da chuva', d: 'Coloque a antena dentro de um cano de PVC com tampa, ou passe silicone neutro na base. Água no conector estraga o sinal em poucas semanas.' },
        { t: 'Ligue no rádio', d: 'Rosqueie a antena no rádio LoRa antes de ligá-lo. O ganho desta antena fica perto de 2 dBi, bem abaixo do limite de 6 dBi: não precisa reduzir a potência. Siga o guia “Ligar um rádio LoRa ao Piu Node”.' },
      ],
      tech: ['Resumo', 'ganho típico: ≈ 2 dBi · omnidirecional · polarização vertical', 'variação: dipolo de ½ onda com 2 braços de ≈ 78 mm'],
      fim: 'Sua primeira antena está pronta. Coloque-a o mais alto que puder: é aí que ela rende.' },

    { id: 'ant-tuning', cat: 'ant', icon: 'monitoring', k: 'on', est: true, t: 'Medir e ajustar a antena com NanoVNA', sum: 'Confira em que frequência a antena está sintonizada antes de subir no telhado.', time: '30 min', lvl: 'Intermediário',
      needs: ['NanoVNA com o kit de calibração (o H4 vai até 1,5 GHz; para 2,4 GHz, use um modelo que chegue lá, como o V2)', 'Cabo SMA curto', 'A antena montada, longe de paredes e objetos de metal'],
      steps: [
        { t: 'Calibre o aparelho', d: 'Configure a varredura em volta da frequência da antena (para 915 MHz, de 850 a 980 MHz). Calibre na ponta do cabo que vai à antena, com as peças do kit: OPEN, SHORT e LOAD.',
          s: { f: 'w', t: 'NanoVNA', i: [['field', 'Início', '850 MHz'], ['field', 'Fim', '980 MHz'], ['row', 'checklist', 'Calibração', 'OPEN · SHORT · LOAD', 1]] } },
        { t: 'Meça a antena', d: 'Ligue a antena e olhe a curva de ROE (SWR). O ponto mais baixo da curva mostra em que frequência a antena está sintonizada.' },
        { t: 'Interprete o resultado', d: 'Ponto mais baixo abaixo da frequência desejada: a antena está comprida, corte um pouco. Acima: está curta, faça um elemento novo. ROE até 1,5 é ótima; até 2 é aceitável.',
          tech: ['Referência rápida', 'ROE 1,5 ≈ 4% da potência volta', 'ROE 2,0 ≈ 11% volta', '# ¼ λ em 915 MHz: 1 mm ≈ 11 MHz de deslocamento'] },
        { t: 'Apare aos poucos', d: 'Corte 1 mm de cada vez e meça de novo. É fácil cortar e impossível colar.' },
        { t: 'Meça de novo no lugar final', d: 'Mastro, telhado e cabo mudam a sintonia. Depois de instalar, meça de novo pela ponta do cabo que chega ao rádio.' },
      ],
      fim: 'Antena sintonizada. Anote a ROE final: ela ajuda a perceber se algo estragou com o tempo.' },

    { id: 'ant-wifi', cat: 'ant', icon: 'wifi', k: 'test', est: true, t: 'Wi-Fi externo para uma praça ou rua', sum: 'Um roteador de área externa com OpenWrt e uma rede só para o Piu, separada de tudo, cobre uma praça.', time: '2 h', lvl: 'Intermediário',
      needs: ['Roteador ou ponto de acesso externo com OpenWrt 24.10 e certificado da Anatel', 'Fonte PoE e cabo de rede blindado para área externa', 'Autorização do dono do imóvel', 'Um celular com o Piu para testar'],
      src: [...ANATEL_SRC, ['OpenWrt · Guest Wi-Fi pela linha de comando', OWRT_GUEST]],
      steps: [
        { t: 'Escolha a antena pelo formato do lugar', d: 'Praça redonda: omni no centro. Rua comprida: setorial ou painel apontado ao longo da rua. Prefira 2,4 GHz para celulares: atravessa melhor as árvores e todo celular tem.',
          s: { f: 'w', t: 'Qual antena', i: [['row', 'radio_button_checked', 'Omni 2,4 GHz', 'praça, quintal grande'], ['row', 'change_history', 'Setorial 90°', 'rua, campo de futebol', 1], ['row', 'crop_portrait', 'Painel', 'um prédio distante']] } },
        { t: 'Instale no alto, mas nem tanto', d: 'Entre 4 e 8 metros (estimativa). Muito alto, o celular até recebe a antena, mas a antena não ouve o celular de volta: celular tem pouca potência.', tip: 'Setoriais costumam ficar inclinadas de 5° a 10° para baixo.' },
        { t: 'Crie uma rede só para o Piu', d: 'Uma rede aberta, separada da rede da casa e sem saída para a internet. Dentro dela, o isolamento de clientes fica DESLIGADO: os celulares precisam se enxergar para trocar mensagens. Os comandos são do próprio OpenWrt (guia oficial de rede de visitante), não do Piu.',
          tech: ['OpenWrt 24.10 (UCI)', "uci set network.piu_dev=device", "uci set network.piu_dev.type='bridge'", "uci set network.piu_dev.name='br-piu'", "uci set network.piu=interface", "uci set network.piu.proto='static'", "uci set network.piu.device='br-piu'", "uci set network.piu.ipaddr='192.168.50.1/24'", "uci set wireless.piu=wifi-iface", "uci set wireless.piu.device='radio0'", "uci set wireless.piu.mode='ap'", "uci set wireless.piu.network='piu'", "uci set wireless.piu.ssid='piu.praca'", "uci set wireless.piu.encryption='none'", "uci set wireless.piu.isolate='0'", "uci set dhcp.piu=dhcp", "uci set dhcp.piu.interface='piu'", "uci set dhcp.piu.start='100'", "uci set dhcp.piu.limit='150'", "uci set dhcp.piu.leasetime='2h'", "uci set firewall.piu=zone", "uci set firewall.piu.name='piu'", "uci set firewall.piu.network='piu'", "uci set firewall.piu.input='REJECT'", "uci set firewall.piu.output='ACCEPT'", "uci set firewall.piu.forward='REJECT'", "uci set firewall.piu_dhcp=rule", "uci set firewall.piu_dhcp.name='Allow-DHCP-Piu'", "uci set firewall.piu_dhcp.src='piu'", "uci set firewall.piu_dhcp.proto='udp'", "uci set firewall.piu_dhcp.dest_port='67'", "uci set firewall.piu_dhcp.target='ACCEPT'", 'uci commit', 'service network restart && service firewall restart', '# sem "forwarding" para a wan: a rede do Piu não sai para a internet'] },
        { t: 'Se o roteador também for Piu Node', d: 'Instale o Piu Node (guia “Montar um Piu Node no roteador OpenWrt”) e libere as portas do Piu só na rede piu. Acrescente o broadcast da rede piu (192.168.50.255) à lista do anúncio: o broadcast da sub-rede sai pela interface certa mesmo num aparelho com duas redes. Em teste no Linux, com Piu Nodes em contêineres, o broadcast da sub-rede formou o enlace (inclusive com um nó em duas redes); 255.255.255.255 não formou nem entre dois nós numa rede só. Num roteador de verdade, ainda “a confirmar”.',
          tech: ['Portas do Piu na zona piu', "uci set firewall.piu_lnnp=rule", "uci set firewall.piu_lnnp.name='Allow-Piu-LNNP'", "uci set firewall.piu_lnnp.src='piu'", "uci set firewall.piu_lnnp.proto='tcp'", "uci set firewall.piu_lnnp.dest_port='8422'", "uci set firewall.piu_lnnp.target='ACCEPT'", "uci set firewall.piu_disc=rule", "uci set firewall.piu_disc.name='Allow-Piu-Discovery'", "uci set firewall.piu_disc.src='piu'", "uci set firewall.piu_disc.proto='udp'", "uci set firewall.piu_disc.dest_port='8423'", "uci set firewall.piu_disc.target='ACCEPT'", 'uci commit firewall && service firewall restart', "uci add_list piu-node.lnnp.broadcast='192.168.50.255'   # broadcast da rede piu", 'uci commit piu-node'] },
        { t: 'Confira a potência', d: 'Ajuste o país e a potência no próprio roteador, considerando o ganho da antena e a perda do cabo (guia “Antes de montar”).',
          tech: ['OpenWrt', "uci set wireless.radio0.country='BR'", "uci set wireless.radio0.txpower='20'   # dBm; reduza se a antena passar de 6 dBi", 'uci commit wireless && wifi reload'] },
        { t: 'Teste com o Piu', d: 'Conecte um celular à rede piu.praca e rode o teste do Ponto Piu (Rede → Criar ponto Piu → “Testar esta rede”). “Aparelhos se enxergam” precisa passar. Ande pela praça: onde o sinal cair muito, considere um segundo ponto.',
          s: { f: 'p', t: 'Testando', i: [['row', 'check_circle', 'Aparelhos se enxergam', '', 1], ['row', 'check_circle', 'Rede de casa protegida', ''], ['row', 'remove_circle_outline', 'Internet', 'não tem']] } },
      ],
      fim: 'A praça tem uma rede para o Piu. Quem passa entra na malha sem precisar de internet.' },

    { id: 'ant-roof', cat: 'ant', icon: 'roofing', k: 'on', est: true, t: 'Antena externa no telhado, do jeito profissional', sum: 'Mastro, cabo de baixa perda, conectores N e aterramento. Serve para Wi-Fi externo e para LoRa.', time: '1 dia', lvl: 'Profissional',
      needs: ['Antena externa para a faixa do seu equipamento (2,4 GHz, 5 GHz ou 915 MHz), com conector N', 'Mastro galvanizado e dois suportes', 'Cabo LMR-400 ou equivalente, com conectores N crimpados', 'Protetor de surto coaxial e haste de aterramento', 'Fita autofusão e fita isolante com proteção UV', 'Uma segunda pessoa para ajudar'],
      src: ANATEL_SRC,
      steps: [
        { t: 'Planeje o lugar', d: 'Escolha o ponto mais alto e livre, acima da caixa-d’água e de antenas de TV. Fique longe dos fios de energia: no mínimo 1,5 vez a altura do mastro.', warn: 'Nunca instale perto da rede elétrica. Se o mastro cair, ele não pode alcançar fio nenhum.' },
        { t: 'Decida onde fica o rádio', d: 'Rádio embaixo e cabo coaxial subindo: mais simples, mas perde sinal no cabo. Rádio numa caixa vedada junto da antena e cabo de rede descendo (com PoE): perde quase nada. Acima de 10 m de cabo, prefira o rádio no alto.',
          s: { f: 'w', t: 'Comparação (estimativa, 2,4 GHz)', i: [['row', 'cable', 'Rádio embaixo · 15 m de LMR-400', '≈ −3,3 dB'], ['row', 'settings_ethernet', 'Rádio no alto · cabo de rede', '≈ 0 dB', 1]] } },
        { t: 'Monte o mastro', d: 'Fixe o mastro com dois suportes afastados pelo menos 50 cm. A antena fica no topo, sem nada de metal na altura dela num raio de 1 metro.' },
        { t: 'Passe e vede o cabo', d: 'Antes de o cabo entrar na casa, faça uma curva para baixo, como uma gota, para a água escorrer. Nos conectores externos, enrole fita autofusão esticada e cubra com fita isolante UV.', tip: 'Prenda o cabo no mastro a cada 50 cm com abraçadeira UV. Cabo balançando quebra o conector.' },
        { t: 'Aterre e proteja contra raios', d: 'Instale o protetor de surto na entrada da casa e ligue-o à haste de aterramento com cabo de cobre grosso. Aterre também o mastro.', warn: 'Aterramento malfeito é pior que nenhum. Na dúvida, chame um eletricista.' },
        { t: 'Meça e ajuste a potência no equipamento', d: 'Meça a ROE pela ponta do cabo (guia do NanoVNA). Some o ganho da antena e desconte a perda do cabo: se o ganho efetivo passar de 6 dBi, reduza a potência no próprio equipamento (Wi-Fi: no OpenWrt; LoRa: no firmware do rádio). O Piu não ajusta a potência.' },
      ],
      fim: 'Instalação pronta para anos. Revise conectores e fitas a cada 6 meses.' },

    { id: 'ant-link', cat: 'ant', icon: 'settings_input_antenna', k: 'test', est: true, t: 'Enlace Wi-Fi ponto a ponto entre dois lugares', sum: 'Duas antenas de 5 GHz apontadas uma para a outra ligam a rede de dois lugares. Os Piu Nodes conversam por cima.', time: '2 a 4 h', lvl: 'Profissional',
      needs: ['Dois rádios de enlace 5 GHz (CPE) com certificado da Anatel, em modo ponte', 'Um Piu Node em cada ponta (OpenWrt, Piu Provider ou Linux)', 'Mastros firmes nas duas pontas, com visada', 'Alguém do outro lado com celular'],
      warn: 'O Piu não tem ferramenta de alinhamento nem de cálculo de enlace: use a do fabricante do rádio. O que é do Piu aqui é só o vizinho fixo entre os dois nós, que já existe.',
      src: ANATEL_SRC,
      steps: [
        { t: 'Faça a conta antes de comprar', d: 'Potência + ganho das antenas − perdas nos cabos − perda no caminho precisa ficar bem acima da sensibilidade do rádio na velocidade que você quer. No mundo real, desconte de 20 a 30 dB do resultado ideal.',
          tech: ['Cálculo de enlace (estimativa)', 'FSPL(dB) = 32,45 + 20·log10(f_MHz) + 20·log10(D_km)', '# 5800 MHz, 5 km: 32,45 + 75,3 + 14,0 ≈ 121,7 dB', 'Prx = Ptx + Gtx + Grx − cabos − FSPL', '# 20 + 23 + 23 − 1 − 121,7 ≈ −57 dBm (ideal, sem obstáculos)'] },
        { t: 'Confirme a visada', d: 'Num mapa de relevo, veja se não há morro no meio. Da ponta A, tente enxergar a ponta B. Lembre da folga de Fresnel do guia “Antes de montar” (5 km em 5,8 GHz: ≈ 4,8 m livres no meio).' },
        { t: 'Escolha a faixa e respeite o limite', d: 'Em 5,725–5,850 GHz, num enlace ponto a ponto fixo, a Anatel não exige reduzir a potência conduzida (até 1 W) por causa do ganho da antena. Isso não vale para ponto-multiponto nem para antena omni. Use só rádio com certificado da Anatel.' },
        { t: 'Aponte e ajuste pelo sinal do rádio', d: 'Pelo mapa, aponte a antena A na direção da B, e a B na da A. Use o medidor de sinal do próprio rádio: gire pouco de cada vez e pare onde ficar mais forte. Depois, o outro lado faz o mesmo.' },
        { t: 'Ligue os Piu Nodes ao enlace', d: 'Com os rádios em modo ponte, as duas redes viram uma só e os nós se acham pela descoberta da rede local. Se o enlace for roteado (redes diferentes), cadastre o outro nó como vizinho fixo pelo IP.',
          tech: ['Vizinho fixo', "uci add_list piu-node.lnnp.peer='10.0.0.2:8422'   # OpenWrt", 'uci commit piu-node', '# Linux/Provider: PIU_LNNP_PEERS=10.0.0.2:8422', '# libere 8422/TCP entre as pontas, nunca para a internet'] },
        { t: 'Trave e registre', d: 'Aperte as abraçadeiras, marque a posição com fita e anote o azimute e o sinal. Se o sinal cair no futuro, você sabe para onde voltar.' },
      ],
      fim: 'Os dois lugares estão ligados. Mensagens cifradas cruzam a distância sem internet.' },

    // ───────────── Computador ─────────────
    { id: 'desktop', cat: 'desk', icon: 'laptop_mac', k: 'on', t: 'Piu Desktop no Mac, no Windows e no Linux', sum: 'Instale no computador e conecte ao seu celular. O celular continua dono das chaves.', time: '6 min', lvl: 'Fácil',
      needs: ['macOS 12 ou mais novo (Apple Silicon e Intel), Windows 10/11 64 bits, ou Linux x86_64', 'O Piu no celular', 'Celular e computador no mesmo Wi-Fi'],
      steps: [
        { t: 'Baixe e instale', d: `Escolha o arquivo do Piu Desktop ${DESKTOP.version}. No Mac, abra o .dmg e arraste o Piu para Aplicativos. No Windows, rode o instalador. No Linux, dê permissão de execução ao AppImage (ou instale o .deb).`,
          dl: [dl(DESKTOP, 'mac', 'macOS · Apple Silicon'), dl(DESKTOP, 'mac-x64-dmg', 'macOS · Intel'), dl(DESKTOP, 'win', 'Windows 10 e 11 · 64 bits'), dl(DESKTOP, 'linux', 'Linux · AppImage x86_64')],
          tech: ['Conferir e abrir', 'shasum -a 256 ~/Downloads/Piu-*.dmg   # macOS', 'Get-FileHash .\\Piu-*.exe -Algorithm SHA256   # Windows', 'sha256sum -c --ignore-missing SHA256SUMS.txt   # Linux', 'chmod +x Piu-*.AppImage   # ou: sudo apt install ./Piu-*.deb'] },
        { t: 'Abra mesmo sem assinatura', d: 'Ainda não há assinatura da Apple nem da Microsoft. No Mac (macOS 15 ou mais novo): abra uma vez, depois Ajustes do Sistema → Privacidade e Segurança → Abrir mesmo assim; no macOS 14 ou anterior, botão direito no app → Abrir. No Windows, se o SmartScreen avisar: Mais informações → Executar assim mesmo.' },
        { t: 'Escolha “Conectar ao meu celular”', d: 'Na primeira abertura aparecem três opções: “Conectar ao meu celular” (usa a identidade que você já tem), “Criar nova identidade” e “Restaurar com frase” (12 palavras).',
          s: { f: 'w', t: 'Suas conversas, agora no computador.', i: [['row', 'qr_code_scanner', 'Conectar ao meu celular', 'leva 20 segundos', 1, 1], ['row', 'person_add', 'Criar nova identidade', '', 0, 1], ['row', 'key', 'Restaurar com frase', '12 palavras', 0, 1]] } },
        { t: 'Leia o QR com o celular', d: 'No celular: Perfil → Conectar ao computador → “Ler o QR do computador”. Aponte para o QR. Ele muda a cada 30 segundos: se demorar, leia o novo.',
          s: { f: 'w', t: 'Conectar ao meu celular', i: [['qr', 'novo código em 24 s'], ['text', 'Perfil → Conectar ao computador'], ['note', 'wifi', 'Wi-Fi local']] } },
        { t: 'Confira as palavras', d: 'O celular mostra “Confiram as 3 palavras”. No computador aparecem as duas primeiras e quatro opções: toque na última palavra que aparece no celular. Se nenhuma aparece, cancele. No celular, toque em “São iguais · conectar”.',
          s: { f: 'w', t: 'Um celular quer conectar', i: [['text', 'Toque na última palavra que aparece no celular'], ['words', ['—', '—', '—', '—']], ['ghost', 'Nenhuma aparece no celular · cancelar']] } },
        { t: 'Pronto: conversas no computador', d: 'Conversas e contatos aparecem no computador. As chaves ficam só no celular, e um pagamento pedido no computador só sai depois de assinado no celular.',
          tip: 'Para desconectar, abra Perfil → Conectar ao computador no celular e toque em Desconectar.',
          s: { f: 'w', t: 'Piu', i: [['note', 'front_hand', 'O computador nunca paga sozinho: confira e autorize no celular.']] } },
      ],
      fim: 'O Piu está no computador. O celular continua dono das chaves: o computador mostra e envia por ele.' },

    // ───────────── Problemas ─────────────
    { id: 'troubleshoot', cat: 'fix', icon: 'build', k: 'on', kind: 'prob', t: 'Resolver problemas comuns', sum: 'As dúvidas que mais aparecem, com o que fazer em cada uma.', time: '—', lvl: 'Fácil',
      needs: [],
      steps: [
        { t: 'A mensagem fica “na fila”', d: 'É normal quando não há ninguém com o Piu por perto. A mensagem fica guardada no seu aparelho e sai sozinha quando surgir uma rota. Ela vale 48 horas por padrão (nunca mais que 7 dias). Confira se Bluetooth e Wi-Fi estão ligados e abra o app perto de outras pessoas.' },
        { t: 'O Android não deixa instalar', d: 'Abra Configurações → Apps → Acesso especial → Instalar apps desconhecidos (o caminho varia), escolha o navegador ou o app que recebeu o arquivo e ligue “Permitir desta fonte”. Se o Play Protect avisar, confira antes o certificado com o guia “Instalar o Piu no Android”.' },
        { t: 'A rede Wi-Fi Direct não abre para passar o app', d: 'Ligue o Wi-Fi do seu celular (não precisa estar conectado a nenhuma rede) e permita “dispositivos por perto” (ou localização, no Android 12 e antes). Se o Wi-Fi estiver ocupado com outra conexão direta, espere alguns segundos ou envie por Bluetooth.' },
        { t: 'O celular gasta bateria demais', d: 'Na aba Rede, ligue “Só retransmitir carregando” e suba “Parar abaixo de”. Em Perfil → Bateria e limites, diminua o tráfego de terceiros por dia ou escolha o horário 22h–7h.' },
        { t: 'O teste do Ponto Piu deu vermelho ou amarelo', d: 'Vermelho: visitantes veriam os aparelhos da casa. Use uma rede de visitante, separada, ou “Criar a rede neste celular”. Amarelo por isolamento: no roteador, desligue “isolar clientes” na rede de visitante e teste de novo.' },
        { t: 'O painel do Piu Node não abre', d: 'Use https:// e a porta 8420 com o IP do aparelho (o Piu Node não anuncia nome na rede). Erro 421: o nome ou IP não está na lista aceita (PIU_NODE_HOSTS, ou main.host no OpenWrt). No OpenWrt, veja /etc/init.d/piu-node status e logread -e piu-node: com Node antigo, o serviço não inicia e o log diz a versão. No Linux (.deb): systemctl status piu-node e journalctl -u piu-node.' },
        { t: 'O código de pareamento não funciona', d: 'Ele vale 10 minutos e é de uso único; 5 erros apagam o código. No OpenWrt, gere outro com /etc/init.d/piu-node restart e leia em /etc/piu-node/pairing-code. No Linux (.deb): sudo systemctl restart piu-node e sudo cat /var/lib/piu-node/pairing-code. No Piu Provider: Nó → Mostrar código de pareamento.' },
        { t: 'O celular não lê o QR do computador', d: 'Os dois precisam estar no mesmo Wi-Fi. Aumente o brilho da tela e aproxime o celular. O QR muda a cada 30 segundos: se demorar, espere o próximo.' },
        { t: 'O Mac ou o Windows não deixam abrir', d: 'Mac (macOS 15 ou mais novo): Ajustes do Sistema → Privacidade e Segurança → Abrir mesmo assim. macOS 14 ou anterior: botão direito no app → Abrir. Windows: no aviso do SmartScreen, Mais informações → Executar assim mesmo.' },
        { t: 'Perdi o celular', d: 'Instale o Piu em outro celular e recupere com as 12 palavras (“Restaurar de outro aparelho” → “Com a frase de 12 palavras”). Num aparelho que ficou com você, Perfil → Aparelhos → “Revogar aparelho perdido” → “Segure para revogar”. Se o celular perdido pode estar com outra pessoa, crie também uma identidade nova.' },
        { t: 'O app pede a frase de novo', d: 'A biometria do celular mudou (ou o bloqueio de tela foi desligado) e o sistema apagou a cópia protegida da frase. Em “Confirme a sua frase de novo”, digite as 12 palavras ou abra o arquivo de backup. Conversas e contatos continuam no celular.' },
        { t: 'Enviar LUNES pede internet', d: 'Hoje a carteira envia direto para a Lunes Mainnet, com o celular conectado. O envio pela malha, sem internet, está em teste. Quando chegar, a transferência só aparece como confirmada depois que o seu próprio celular conferir na rede Lunes.' },
      ],
      fim: 'Não resolveu? Abra uma issue no GitHub do projeto ou pergunte num canal público da sua comunidade dentro do Piu.' },
  ],
};
