/**
 * Tipos compartilhados entre o processo principal e o renderer (a ponte do preload só passa JSON).
 * Nada daqui toca Node nem Electron.
 */

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
}

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
}

export interface ConversationSummary {
  contact: ContactInfo;
  last: Message | null;
  unread: number;
  /** Mensagens ainda na fila (aguardando rota ou confirmação). */
  pending: number;
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
  /** Celular conectou: comparar as 3 palavras nas duas telas. */
  | { state: 'confirm'; words: string[] }
  /** Confirmado nos dois lados; `synced` quando o snapshot das conversas chegou. */
  | { state: 'linked'; me: MeInfo | null; since: number; synced: boolean }
  | { state: 'dropped'; reason: string };

export interface SessionInfo {
  /** `linked`: sem identidade local, espelhando o celular vinculado. */
  state: 'none' | 'ready' | 'linked';
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
  address: string | null;
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
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'system', notifications: true, animations: true, relay: true, peers: [], walletAddress: null, hideBalance: false, displayName: '', screenSecurity: true,
  lan: true, notifPreview: 'always', notifSound: true, identity: 'public', fontSize: 'm', density: 'comfort', enterSends: true,
};

export type { DesktopPayment, DesktopPaymentState, PaymentRequestInput } from './paymentTypes';
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
}

export type PiuEventName = keyof PiuEvents;

/** O que o preload expõe em `window.piu`. Promessas rejeitadas trazem a mensagem para a pessoa. */
export interface PiuApi {
  getSession(): Promise<SessionInfo>;
  createIdentity(o: { kind: IdentityKind; name: string }): Promise<{ phrase: string[] }>;
  restoreIdentity(o: { phrase: string[]; name: string }): Promise<void>;
  /** Frase de recuperação guardada no cofre (Backup → Mostrar frase). */
  revealPhrase(): Promise<string[] | null>;
  exportIdentityBackup(password: string): Promise<'saved' | 'cancelled'>;
  suggestWords(prefix: string): Promise<string[]>;
  /** Apaga identidade, conversas e chaves deste computador. */
  eraseAll(): Promise<void>;

  myCard(kind: IdentityKind, fresh?: boolean): Promise<{ card: string; expiresAt: number; id: string }>;
  addContactByCard(text: string): Promise<ContactInfo>;
  listConversations(): Promise<ConversationSummary[]>;
  listGroupCandidates(): Promise<ContactInfo[]>;
  createGroup(options: { kind: 'group' | 'channel'; name: string; via: IdentityKind; memberIds: string[] }): Promise<ContactInfo>;
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

  openExternal(url: string): Promise<void>;
  copy(text: string): Promise<void>;
  /** Mostra uma notificação nativa de exemplo (Ajustes → Notificações → Testar). */
  testNotification(): Promise<void>;
  /** Avisa o processo principal se há uma conversa aberta na janela (Segurança da tela só protege conversas). */
  setConversationOpen(open: boolean): Promise<void>;

  /** Vínculo com o celular: mostrar QR, confirmar as 3 palavras, cancelar/desvincular, estado atual. */
  linkStart(): Promise<LinkState>;
  linkConfirm(): Promise<LinkState>;
  linkCancel(): Promise<LinkState>;
  linkStatus(): Promise<LinkState>;

  on<K extends PiuEventName>(event: K, cb: (payload: PiuEvents[K]) => void): () => void;
}

declare global {
  interface Window { piu: PiuApi }
}
