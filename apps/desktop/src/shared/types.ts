/**
 * Tipos compartilhados entre o processo principal e o renderer (a ponte do preload só passa JSON).
 * Nada daqui toca Node nem Electron.
 */

import type { LangPref, Region } from './i18n/core';

export type IdentityKind = 'public' | 'anon';

/** Estado de uma mensagem na conversa (os mesmos do celular: messaging/README.md). */
export type MessageStatus = 'criada' | 'aguardando' | 'encaminhada' | 'entregue' | 'expirada' | 'recebida';

/** Rota de um envelope, do ponto de vista deste computador. */
export interface Route {
  /** Vizinho (id curto do nó LNNP) que recebeu ou entregou. */
  peer: string;
  /** Classe do enlace: `eth` = rede local. */
  via?: string;
  bytes: number;
  /** Saltos usados até aqui (só em mensagens recebidas). */
  hops?: number;
  priority?: number;
}

export interface Message {
  id: string;
  contactId: string;
  dir: 'out' | 'in';
  text: string;
  /** Segundos (relógio do protocolo). */
  at: number;
  status: MessageStatus;
  route?: Route;
  /** Nome do remetente em conversa coletiva espelhada do celular. */
  sender?: string;
  /** Quando saiu deste computador para um vizinho (s). */
  forwardedAt?: number;
  /** Quando o recibo cifrado do destino voltou (s). */
  deliveredAt?: number;
  /** Mensagem temporária: some deste computador neste instante (s). */
  expiresAt?: number;
}

/** Prazo das mensagens temporárias de uma conversa. */
export type TempMode = 'off' | '1h' | '24h' | '7d';

export interface ContactInfo {
  id: string;
  name: string;
  /** Qual das MINHAS identidades conversa com este contato. */
  via: IdentityKind;
  /** Tipo informado pelo celular; ausente em contatos antigos significa conversa direta. */
  kind?: 'direct' | 'group' | 'channel' | 'community' | 'unknown';
  /** Permissão de escrita recebida do celular para conversas coletivas. */
  canPost?: boolean;
  /** Subtítulo real informado pelo celular, quando presente. */
  subtitle?: string;
  /** Escreveu primeiro, usando o meu convite (pedido de conversa). */
  request: boolean;
  /**
   * Endereço Lunes do contato, quando conhecido. Hoje nenhum caminho o preenche (o cartão de contato e o
   * espelho do celular não carregam carteira); a Carteira só oferece como destinatário quem tem este campo.
   */
  lunesAddress?: string;
}

export interface ConversationSummary {
  contact: ContactInfo;
  last: Message | null;
  unread: number;
  /** Mensagens ainda na fila (aguardando rota ou confirmação). */
  pending: number;
  /** Conversa silenciada neste computador (sem aviso nem contador; as mensagens chegam igual). */
  muted?: boolean;
  /** Mensagens temporárias ligadas nesta conversa (ausente = desligadas). */
  temp?: TempMode;
  /** Contato bloqueado neste computador. */
  blocked?: boolean;
}

/** Contato bloqueado neste computador (o mensageiro descarta o que ele manda e não manda recibos a ele). */
export interface BlockedContact { id: string; name: string; via: IdentityKind; at: number }

/** Espaço usado pelo Piu neste computador (bytes), medido na pasta de dados. */
export interface StorageUsage {
  /** Tudo na pasta de dados, inclusive caches do Chromium. */
  total: number;
  /** Estado cifrado (conversas, contatos, sessões) e diário de pagamentos, sem a parte de retransmissão. */
  messages: number;
  /** Envelopes de terceiros guardados para retransmitir (`null`: não medido, ex. vinculado ao celular). */
  relay: number | null;
  /** O computador ainda não guarda mídia: sempre 0. */
  media: number;
}

/** Conversas → Armazenamento (D4): o uso, o disco e o histórico de cada conversa neste computador. */
export interface StorageDetail extends StorageUsage {
  /** Livre no disco da pasta de dados (`null`: o sistema não informou). */
  free: number | null;
  /** Menos de 1 GB livre (D4e). */
  low: boolean;
  /** Envelopes de OUTRAS pessoas na fila da malha: o que "Limpar fila da malha" apaga. */
  relayOthers: number | null;
  conversations: { id: string; name: string; kind: ContactInfo['kind']; via: IdentityKind; bytes: number; count: number }[];
  /** Vinculado ao celular: nada fica guardado aqui, não há o que limpar. */
  linked: boolean;
}

export interface MeInfo {
  publicId: string;
  anonId: string;
  name: string;
  /** Chave técnica do nó LNNP (hex), para o diagnóstico de rede. */
  nodePk: string;
}

/** Vínculo com o celular (lado do desktop; shared/desktopLink.ts). */
export type LinkState =
  | { state: 'off' }
  /** QR na tela; renova a cada 30 s. */
  | { state: 'waiting'; uri: string; expiresAt: number; host: string; port: number }
  /**
   * Celular conectou: aqui aparecem as 2 primeiras palavras e 4 `options` para a 3ª, que só quem olha o
   * celular sabe qual é (M-04). A resposta vai para `linkConfirm(palavra)`; errar cancela e gera QR novo.
   */
  | { state: 'confirm'; words: string[]; options: string[] }
  /** Confirmado nos dois lados; `synced` quando o snapshot das conversas chegou. */
  | { state: 'linked'; me: MeInfo | null; since: number; synced: boolean }
  | { state: 'dropped'; reason: string };

export interface SessionInfo {
  /**
   * `linked`: sem identidade local, espelhando o celular vinculado.
   * `locked`: o cofre do sistema recusou abrir o que está guardado (Keychain negado/bloqueado); nada foi
   * recriado nem apagado. A interface mostra `lockedReason` e "Tentar de novo" (`retryVault`).
   */
  state: 'none' | 'ready' | 'linked' | 'locked';
  lockedReason?: string;
  me: MeInfo | null;
  platform: 'darwin' | 'linux' | 'win32' | string;
  version: string;
  /** O cofre do sistema está disponível (Keychain, Secret Service, DPAPI)? */
  vaultSecure: boolean;
  hostname: string;
}

export type PeerState = 'connecting' | 'connected' | 'failed';

export interface PeerInfo {
  /** `host:porta` do enlace (vizinho fixo) ou endereço de quem conectou. */
  address: string;
  source: 'config' | 'manual' | 'discovered';
  state: PeerState;
  nodeId: string | null;
  pk: string | null;
  since: number | null;
  error: string | null;
  attempts: number;
}

export type TransportState = 'off' | 'starting' | 'running' | 'unavailable';

export interface NetworkStatus {
  lan: {
    state: TransportState;
    reason?: string;
    port: number | null;
    discoveryPort: number | null;
    peers: PeerInfo[];
    /** Enlaces LNNP abertos agora. */
    links: number;
  };
  ble: { state: TransportState; reason?: string };
  /** Modo nó: retransmite envelopes de terceiros. */
  relay: boolean;
}

export interface WalletState {
  /** Endereço em uso: o informado na Carteira; senão a carteira do celular vinculado; senão o derivado da frase. */
  address: string | null;
  /** De onde veio `address`: digitado (`manual`), espelho do celular (`phone`), derivado da frase (`phrase`) ou nenhum. */
  source: 'manual' | 'phone' | 'phrase' | null;
  hidden: boolean;
  status: 'idle' | 'loading' | 'ok' | 'error';
  error: string | null;
  /** Saldo livre em planck (texto, porque bigint não passa pela ponte). */
  free: string | null;
  reserved: string | null;
  block: number | null;
  endpoint: string | null;
  /** Quando foi lido (ms). */
  at: number | null;
}

export interface Prefs {
  theme: 'light' | 'dark' | 'system';
  notifications: boolean;
  /** Animações da interface (respeita também prefers-reduced-motion). */
  animations: boolean;
  relay: boolean;
  /** Vizinhos fixos adicionados em Rede (host:porta). */
  peers: string[];
  walletAddress: string | null;
  hideBalance: boolean;
  /** Nome de exibição (identidade pública). */
  displayName: string;
  /** Segurança da tela (como no Signal): bloquear captura/gravação da janela (macOS e Windows). */
  screenSecurity: boolean;
  /** Compartilhar meu endereço Lunes com os contatos públicos aceitos (para eu ser destinatário na Carteira deles). */
  shareWalletAddress: boolean;
  /** Transporte da rede local ligado. */
  lan: boolean;
  /** O que a notificação nativa mostra. */
  notifPreview: 'always' | 'name' | 'never';
  /** Som na notificação nativa. */
  notifSound: boolean;
  /** Identidade em uso na interface (as conversas são listas separadas). */
  identity: IdentityKind;
  /** Aparência: tamanho do texto das mensagens, densidade da lista, Enter envia. */
  fontSize: 's' | 'm' | 'l';
  density: 'comfort' | 'compact';
  enterSends: boolean;
  /** Notificações por tipo (Ajustes → Notificações), além de `notifications` (mensagens diretas). */
  notifGroups: boolean;
  notifChannels: boolean;
  /** LUNES recebidos (o saldo lido na Mainnet subiu). */
  notifWallet: boolean;
  /** Alertas da comunidade (Ajustes → Notificações → Alertas de emergência). Graves passam pelo Não perturbe. */
  notifAlerts: boolean;
  /** Contador de não lidas no ícone (Dock no macOS, Unity no Linux). */
  badge: boolean;
  /** Não perturbe: nenhum aviso (o computador ainda não recebe alertas de emergência). */
  dnd: boolean;
  /** Privacidade (como no celular, `set.priv`): recibo de leitura, "digitando…", quem me encontra. */
  readReceipts: boolean;
  typing: boolean;
  find: 'all' | 'contacts' | 'none';
  /** Metadados: atraso aleatório no envio (até 30 s) e preenchimento dos envelopes. */
  randomDelay: boolean;
  pad: boolean;
  /** Bloqueio do app (Privacidade → Bloqueio): só liga com a senha do Piu criada. */
  lockOnSuspend: boolean;
  lockAfter: '5' | '15' | '60' | 'never';
  /** Banda para retransmitir mensagens de terceiros (Mbps) e por quanto tempo guardá-las (h). */
  relayBandwidth: '1' | '5' | '20';
  relayRetention: '24' | '48' | '168';
  /** Espaço máximo da fila da malha (MB): o teto do roteador (`maxBytes`); as minhas mensagens têm prioridade. */
  relayStorage: '100' | '250' | '500';
  /**
   * "Avisar quando sair versão nova" (Sistema → Atualizações): confere no GitHub ao abrir o Piu e avisa na
   * lista de conversas. Nada é baixado nem instalado sozinho (substitui "Automático / Perguntar").
   */
  updateNotify: boolean;
  /** Mensagens temporárias por padrão em conversas novas. */
  tempDefault: 'off' | '24h' | '7d';
  /** Sistema: abrir ao iniciar sessão e ícone na barra de menus/bandeja (fechar a janela não encerra). */
  openAtLogin: boolean;
  tray: boolean;
  /** Idioma do Piu neste computador (Ajustes → Idioma): um dos 11 do celular ou `auto` (o do sistema). */
  lang: LangPref;
  /** Corretor ortográfico do sistema (macOS e Windows). No Linux fica desligado: o Chromium baixaria dicionários do Google. */
  spellcheck: boolean;
  /** Formato de data e números: do idioma, 1.234,56 (br) ou 1,234.56 (us). */
  region: Region;
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'system', notifications: true, animations: true, relay: true, peers: [], walletAddress: null, hideBalance: false, displayName: '', screenSecurity: true, shareWalletAddress: true,
  lan: true, notifPreview: 'always', notifSound: true, identity: 'public', fontSize: 'm', density: 'comfort', enterSends: true,
  // Mesmos padrões do celular (state/settings.tsx e data/settings.ts).
  notifGroups: true, notifChannels: true, notifWallet: true, notifAlerts: true, badge: true, dnd: false,
  readReceipts: true, typing: true, find: 'all', randomDelay: false, pad: true,
  lockOnSuspend: false, lockAfter: 'never', relayBandwidth: '5', relayRetention: '48', tempDefault: 'off', relayStorage: '500', updateNotify: true,
  openAtLogin: false, tray: false, lang: 'auto', region: 'auto', spellcheck: true,
};

export type { DesktopPayment, DesktopPaymentState, PaymentRequestInput } from './paymentTypes';
import type { GuardianConfig, GuardianLevel, GuardianNetwork, GuardianState, GuardianTest } from './guardian';
export type { GuardianConfig, GuardianLevel, GuardianNetwork, GuardianState, GuardianTest } from './guardian';
import type { DesktopPaymentState, PaymentRequestInput } from './paymentTypes';

/** Eventos do processo principal para o renderer. */
export interface PiuEvents {
  /** A lista de conversas (ou algo nela) mudou: recarregue. */
  conversations: void;
  /** Mensagem nova ou estado alterado numa conversa. */
  message: { contactId: string; message: Message };
  network: NetworkStatus;
  wallet: WalletState;
  walletPayment: DesktopPaymentState;
  session: SessionInfo;
  /** Preferências mudaram (no processo principal: aplicar segurança da tela etc.). */
  prefs: Prefs;
  /** Estado do vínculo com o celular mudou. */
  link: LinkState;
  /** Aviso curto para a interface (toast). */
  notice: { text: string; kind: 'info' | 'error' };
  /** O contato está digitando (some sozinho depois de alguns segundos). */
  typing: { contactId: string };
  /** Bloqueio do app mudou (tela D1). */
  appLock: AppLockState;
  /** Atualização: procura, download e conferência (Ajustes → Sistema). */
  update: UpdateState;
  /** Ponto Piu deste computador (guardião, E4/E5). */
  guardian: GuardianState;
}

/**
 * Bloqueio do Piu (D1/D1e/D1x). Bloqueado, a janela só recebe isto: nenhum nome nem conteúdo.
 * `newMessages`: recebidas desde que bloqueou. `wait`: espera em curso depois de 5 senhas erradas.
 * `last`: resultado da última tentativa (para o tremor do campo e o aviso).
 */
export interface AppLockState {
  locked: boolean;
  reason: 'suspend' | 'idle' | 'manual' | 'start';
  at: number;
  newMessages: number;
  /** Senha do Piu criada (sem ela, nada bloqueia). `storable`: há cofre do sistema para guardá-la. */
  hasPassword: boolean;
  storable: boolean;
  /** macOS com Touch ID disponível agora. */
  touchId: boolean;
  triesLeft: number;
  wait: { remainingSec: number; totalSec: number; until: number } | null;
  /** Minutos de inatividade que bloquearam (quando `reason === 'idle'`). */
  idleMin: number | null;
  last?: 'wrong' | 'wait' | 'cancel';
}

/** Resultado de "Verificar atualizações" (main/system.ts). Nada é baixado nem instalado. */
export type UpdateCheck = { state: 'available' | 'latest'; current: string; latest: string | null; url: string | null };

/** Versão nova encontrada no GitHub (main/updater.ts). `asset`/`size`: o pacote deste sistema, se houver. */
export interface UpdateInfo { current: string; version: string; url: string; notes: string[]; asset: string | null; size: number | null; arch: string }
/**
 * Atualização (Ajustes → Sistema). `verify`: 'no-key' = o Piu ainda não traz a chave pública do projeto,
 * então não há como conferir a assinatura e nada é baixado (só abrir a página da versão).
 * `install`: o que "Reiniciar e atualizar" faz neste sistema ('dev' = modo de desenvolvimento, não instala).
 */
export type UpdateState =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'latest'; current: string; at: number }
  | { state: 'available'; info: UpdateInfo; verify: 'ok' | 'no-key' | 'no-asset'; at?: number }
  | { state: 'downloading'; info: UpdateInfo; step: 'sums' | 'package' | 'hash'; received: number; total: number }
  | { state: 'ready'; info: UpdateInfo; signer: string; install: 'appimage' | 'deb' | 'dmg' | 'nsis' | 'dev' }
  | { state: 'bad'; info: UpdateInfo; reason: 'signature' | 'hash' | 'unlisted'; expected: string; got: string }
  /** `kind`: 'offline' = sem internet (E2d); 'github' = o GitHub respondeu erro (E2e); 'other' = no download/conferência. */
  | { state: 'error'; message: string; info: UpdateInfo | null; kind?: 'offline' | 'github' | 'other'; at?: number };

export type PiuEventName = keyof PiuEvents;

/** O que o preload expõe em `window.piu`. Promessas rejeitadas trazem a mensagem para a pessoa. */
export interface PiuApi {
  getSession(): Promise<SessionInfo>;
  /** A frase não volta daqui (M-01): fica em Ajustes → Backup, mostrada só com reautenticação. */
  createIdentity(o: { kind: IdentityKind; name: string }): Promise<void>;
  restoreIdentity(o: { phrase: string[]; name: string }): Promise<void>;
  /** Frase de recuperação guardada no cofre (Backup → Mostrar frase). Pede Touch ID/confirmação nativa antes; recusado → rejeita. */
  revealPhrase(): Promise<string[] | null>;
  /** Cofre bloqueado na abertura (`session.state === 'locked'`): tenta abrir de novo, sem recriar nada. */
  retryVault(): Promise<SessionInfo>;
  exportIdentityBackup(password: string): Promise<'saved' | 'cancelled'>;
  suggestWords(prefix: string): Promise<string[]>;
  /** Apaga identidade, conversas e chaves deste computador. */
  eraseAll(): Promise<void>;

  myCard(kind: IdentityKind, fresh?: boolean): Promise<{ card: string; expiresAt: number; id: string }>;
  addContactByCard(text: string): Promise<ContactInfo>;
  listConversations(): Promise<ConversationSummary[]>;
  listGroupCandidates(): Promise<ContactInfo[]>;
  createGroup(options: { kind: 'group' | 'channel'; name: string; via: IdentityKind; memberIds: string[] }): Promise<ContactInfo>;
  /** Detalhes → Convidar: contatos aceitos fora do grupo; convidar; sair (apaga a conversa daqui). */
  groupInviteCandidates(groupId: string): Promise<ContactInfo[]>;
  addGroupMembers(groupId: string, memberIds: string[]): Promise<void>;
  leaveGroup(groupId: string): Promise<void>;
  getMessages(contactId: string): Promise<Message[]>;
  sendText(contactId: string, text: string): Promise<Message>;
  markRead(contactId: string): Promise<void>;
  removeContact(contactId: string): Promise<void>;
  /** Código de segurança (12 grupos de 5 dígitos) entre mim e o contato. */
  safetyCode(contactId: string): Promise<string[]>;

  networkStatus(): Promise<NetworkStatus>;
  addPeer(address: string): Promise<PeerInfo[]>;
  removePeer(address: string): Promise<PeerInfo[]>;

  wallet(): Promise<WalletState>;
  walletPayment(): Promise<DesktopPaymentState>;
  requestWalletPayment(input: PaymentRequestInput): Promise<DesktopPaymentState>;
  setWalletAddress(address: string | null): Promise<WalletState>;
  refreshWallet(): Promise<WalletState>;

  getPrefs(): Promise<Prefs>;
  setPrefs(patch: Partial<Prefs>): Promise<Prefs>;

  copy(text: string): Promise<void>;
  /** Mostra uma notificação nativa de exemplo (Ajustes → Notificações → Testar). */
  testNotification(): Promise<void>;
  /** Avisa o processo principal se há uma conversa aberta na janela (Segurança da tela só protege conversas). */
  setConversationOpen(open: boolean): Promise<void>;
  /** Tela com segredo visível (frase, QR/palavras do vínculo, carteira): bloqueia capturas mesmo com o ajuste desligado. */
  setSecretVisible(screen: 'phrase' | 'link' | 'wallet', visible: boolean): Promise<void>;

  /** Vínculo com o celular: mostrar QR, confirmar as 3 palavras, cancelar/desvincular, estado atual. */
  linkStart(): Promise<LinkState>;
  linkConfirm(word: string): Promise<LinkState>;
  linkCancel(): Promise<LinkState>;
  linkStatus(): Promise<LinkState>;

  /** Silenciar a conversa neste computador (sem aviso nem contador). */
  setMuted(contactId: string, muted: boolean): Promise<void>;
  listBlocked(): Promise<BlockedContact[]>;
  blockContact(contactId: string): Promise<BlockedContact[]>;
  unblockContact(contactId: string): Promise<BlockedContact[]>;
  /** Mensagens temporárias da conversa (direta, com identidade própria). */
  setTemp(contactId: string, mode: TempMode): Promise<void>;
  /** Estou digitando (só sai com o ajuste ligado e vizinho por perto). */
  typing(contactId: string): Promise<void>;
  storageUsage(): Promise<StorageUsage>;
  storageDetail(): Promise<StorageDetail>;
  /** Apaga o histórico de uma conversa neste computador (o contato fica). `freed`: bytes a menos no disco. */
  clearConversation(contactId: string): Promise<{ freed: number }>;
  /** Apaga os envelopes de outras pessoas guardados para repassar. */
  clearRelayQueue(): Promise<{ freed: number }>;
  checkForUpdates(): Promise<UpdateCheck>;
  openReleasePage(url: string): Promise<void>;
  appLockState(): Promise<AppLockState>;
  /** Bloqueia agora (⌘L / Ctrl L). Sem a senha do Piu criada, rejeita com a explicação. */
  lockApp(): Promise<AppLockState>;
  /** Com `password`: confere a senha do Piu. Sem: Touch ID (macOS). */
  unlockApp(password?: string): Promise<AppLockState>;
  /** Criar (`current` nulo) ou trocar a senha do Piu. */
  setLockPassword(current: string | null, next: string): Promise<AppLockState>;
  removeLockPassword(current: string): Promise<AppLockState>;

  updateState(): Promise<UpdateState>;
  /** Procura no GitHub agora (Atualizar = Perguntar só procura assim). */
  checkUpdate(): Promise<UpdateState>;
  /** Baixa e confere a assinatura e o SHA-256 (só com a chave do projeto no app). */
  downloadUpdate(): Promise<UpdateState>;
  /** "Reiniciar e atualizar": só com o pacote conferido; fecha o Piu. */
  installUpdate(): Promise<void>;
  /** Fecha o aviso (pacote descartado ou erro) e apaga downloads. */
  dismissUpdate(): Promise<UpdateState>;

  // ── ponto Piu neste computador (guardião, E4/E5; docs/rede/guardiao-desktop.md) ──
  guardianState(): Promise<GuardianState>;
  /** Rede em que o computador está agora (nome do Wi-Fi quando o sistema diz; nunca a senha). */
  guardianNetwork(): Promise<GuardianNetwork>;
  /** Teste automático (E4): aparelhos se veem, rede de casa, internet, espaço. Só sondas de conexão. */
  guardianTest(): Promise<GuardianTest>;
  /** "Ativar ponto" (E4e): chave própria nova, guardada cifrada neste computador. */
  guardianActivate(config: Partial<GuardianConfig> & { name: string; level: GuardianLevel }): Promise<GuardianState>;
  guardianUpdate(patch: Partial<GuardianConfig>): Promise<GuardianState>;
  guardianPause(paused: boolean): Promise<GuardianState>;
  /** O computador mudou de rede: continuar o ponto nesta (a pessoa confirmou). */
  guardianAdoptNetwork(): Promise<GuardianState>;
  /** Senha da rede do ponto digitada pela pessoa (para o QR de Wi-Fi); `null` apaga. */
  guardianSetWifi(w: { password: string | null; open: boolean }): Promise<GuardianState>;
  /** Encerrar (E5d): apaga a chave do ponto e o que ele guarda de outras pessoas. */
  guardianEnd(): Promise<GuardianState>;
  /** Copia uma imagem PNG (data URL do QR do ponto) para a área de transferência. */
  copyImage(dataUrl: string): Promise<void>;

  on<K extends PiuEventName>(event: K, cb: (payload: PiuEvents[K]) => void): () => void;
}

declare global {
  interface Window { piu: PiuApi }
}
