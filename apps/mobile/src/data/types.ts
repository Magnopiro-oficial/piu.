export type Kind = 'direct' | 'group' | 'channel' | 'community';
export type Status = 'criada' | 'aguardando' | 'encaminhada' | 'entregue' | 'expirada' | 'falha';
export type IdentityKind = 'public' | 'anon';

export interface Msg { id: string; from: 'me' | 'them' | 'sys'; text: string; time: string; status?: Status; sender?: string; fresh?: boolean }
export interface RouteNode { n: string; k: string }
/** Conversa (Conversation/Group/Channel/Community no modelo da seção 12). */
export interface Chat {
  id: string; ident: IdentityKind; kind: Kind; name: string; initials: string; time: string; unread: number;
  inv?: boolean; sub?: string; via?: string; viaIcon?: string; preview?: string; offline?: boolean; priority?: string; owner?: boolean;
  route?: { nodes: RouteNode[]; vias: string[] };
  msgs?: Msg[];
}
