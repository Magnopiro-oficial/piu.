export type Kind = 'direct' | 'group' | 'channel' | 'community';
export type Status = 'criada' | 'aguardando' | 'encaminhada' | 'entregue' | 'expirada' | 'falha';
export type IdentityKind = 'public' | 'anon';

/** Arquivo enviado em blocos (FUN-009): pausa quando a rota vira LoRa e retoma depois. */
export type FileState = 'sending' | 'paused' | 'userPaused' | 'resuming' | 'verified';
export interface FileXfer { name: string; mb: number; blocks: number; icon: 'image' | 'description'; done: number; state: FileState; pausedOnce?: boolean }

export interface Msg { id: string; from: 'me' | 'them' | 'sys'; text: string; time: string; status?: Status; sender?: string; fresh?: boolean; file?: FileXfer }
export interface RouteNode { n: string; k: string }
/** Conversa (Conversation/Group/Channel/Community no modelo da seção 12). */
export interface Chat {
  id: string; ident: IdentityKind; kind: Kind; name: string; initials: string; time: string; unread: number;
  inv?: boolean; sub?: string; via?: string; viaIcon?: string; preview?: string; offline?: boolean; priority?: string; owner?: boolean;
  route?: { nodes: RouteNode[]; vias: string[] };
  /** Contato real (`piu:…`): as mensagens vão cifradas pelo transporte, não pela simulação. */
  peer?: string;
  /** Escreveu primeiro, sem que você tivesse o código dele: confira antes de confiar. */
  request?: boolean;
  msgs?: Msg[];
}

export interface Member { id: string; name: string; initials: string; role: string }
export type ChannelType = 'public' | 'private' | 'secret';
export interface ToastData { icon?: string; av?: string; title: string; body: string; go?: () => void }
