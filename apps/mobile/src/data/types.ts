export type Kind = 'direct' | 'group' | 'channel' | 'community';
export type Status = 'criada' | 'aguardando' | 'encaminhada' | 'entregue' | 'expirada' | 'falha';
export type IdentityKind = 'public' | 'anon';

/** Arquivo enviado em blocos (FUN-009): pausa quando a rota vira LoRa e retoma depois. */
export type FileState = 'sending' | 'paused' | 'userPaused' | 'resuming' | 'verified';
export interface FileXfer {
  name: string; mb: number; blocks: number; icon: 'image' | 'description'; done: number; state: FileState; pausedOnce?: boolean;
  /** Envio real pelo protocolo (conversas pelo QR), não a simulação do protótipo. */
  real?: boolean;
  /** Recebendo (do contato) em vez de enviando. */
  incoming?: boolean;
  /** Prévia de foto (data URI), só para fotos pequenas. */
  preview?: string;
  /** Depois de reabrir o app, o envio real não continua (o conteúdo não fica guardado). */
  lost?: boolean;
}

export interface Msg { id: string; from: 'me' | 'them' | 'sys'; text: string; time: string; status?: Status; /** Quando foi criada (ms), para o banner de entrega. */ at?: number; sender?: string; fresh?: boolean; file?: FileXfer }
export interface RouteNode { n: string; k: string }
/** Conversa (Conversation/Group/Channel/Community no modelo da seção 12). */
export interface Chat {
  id: string; ident: IdentityKind; kind: Kind; name: string; initials: string; time: string; unread: number;
  inv?: boolean; sub?: string; via?: string; viaIcon?: string; preview?: string; offline?: boolean; priority?: string; owner?: boolean;
  route?: { nodes: RouteNode[]; vias: string[] };
  /** Contato real (`piu:…`): as mensagens vão cifradas pelo transporte, não pela simulação. */
  peer?: string;
  /** Foto do perfil público que o contato mandou (data URI JPEG de 96 px). */
  photo?: string;
  /** Escreveu primeiro, sem que você tivesse o código dele: confira antes de confiar. */
  request?: boolean;
  /** Grupo, canal ou comunidade real (id do grupo no protocolo). */
  group?: string;
  /** Silenciado: sem banners desta conversa. */
  muted?: boolean;
  msgs?: Msg[];
}

export interface Member { id: string; name: string; initials: string; role: string }
export type ChannelType = 'public' | 'private' | 'secret';
export interface ToastData {
  icon?: string; av?: string; title: string; body: string; go?: () => void;
  /** Botão à direita (ex.: "Ver", "Reenviar"). */
  action?: string;
  /** Ícone de moeda girando (LUNES recebidos). */
  coin?: boolean;
  /** Tipo de notificação (Ajustes → Notificações): desligado ou em silêncio, o banner não aparece. */
  kind?: 'msg' | 'group' | 'channel' | 'nearby' | 'wallet' | 'network';
}
