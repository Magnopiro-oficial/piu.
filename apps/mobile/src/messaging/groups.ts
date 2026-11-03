/**
 * Grupos, canais e comunidades (FUN-006, FUN-007, FUN-008) sobre o protocolo.
 *
 * - Cada grupo tem um ESTADO (nome, membros, papéis, regras, chave atual) com uma revisão crescente.
 *   Só um admin muda o estado, e ele vai para cada membro DENTRO da sessão cifrada 1:1 (autenticado
 *   pelo remetente). Quem recebe só aceita de um admin que já conhece e só revisões mais novas
 *   (sem voltar a uma chave antiga, que reabriria o grupo para quem saiu).
 * - As mensagens do grupo vão num envelope de grupo (`sealGroup`), cifradas com a chave da versão
 *   atual; os relays não leem. Quem foi removido não recebe a chave nova.
 * - Canal: só admins publicam (inscritos leem). Tipo público, privado ou secreto.
 * - Comunidade: um "grupo de avisos" (só admins publicam) que lista grupos e canais relacionados.
 * - Convite por link/QR do grupo: vale 7 dias e até 50 usos (design); com "Aprovar quem entra",
 *   um admin confirma cada pedido.
 */
import { fromUtf8, toHex, utf8 } from '../protocol/bytes';
import { type GroupKey, Priority } from '../protocol/envelope';
import type { IdentityKind, PublicIdentity } from '../protocol/keys';
import { random } from '../protocol/suite';
import { b64url, unb64url } from './card';

export type GroupKind = 'group' | 'channel' | 'community';
export type ChannelVisibility = 'public' | 'private' | 'secret';

/** `mod`: moderador (canal com "Admins e moderadores" publicando). */
export interface GroupMember { id: string; name: string; role: 'admin' | 'mod' | 'member'; pub: PublicIdentity }

export interface GroupState {
  /** 16 bytes em hex. */
  id: string;
  kind: GroupKind;
  name: string;
  desc: string;
  /** Minha identidade usada neste grupo (pública ou anônima). */
  via: IdentityKind;
  /** Revisão do estado (cresce a cada mudança). */
  rev: number;
  /** Versão da chave (cresce a cada remoção). */
  keyV: number;
  key: string;
  members: GroupMember[];
  /** Quem publica: todos ou só admins (canal e comunidade: sempre admins). */
  send: 'all' | 'admins';
  /** Quem pode convidar. */
  inv: 'all' | 'admins';
  approve: boolean;
  /** Canal: moderadores também publicam. */
  postMods?: boolean;
  visibility?: ChannelVisibility;
  /** Comunidade: grupos e canais que ela reúne. */
  children?: { id: string; name: string; kind: 'group' | 'channel' }[];
  /** Grupo ou canal dentro de uma comunidade. */
  parent?: string;
  /** Convite atual do grupo (só os admins guardam o código). */
  invite?: { code: string; expiresAt: number; uses: number };
  /**
   * Total de membros quando `members` é só a parte visível (inscrito de canal privado ou secreto, que
   * recebe só admins, moderadores e a si mesmo). Ausente: `members.length`.
   */
  count?: number;
  /**
   * Prioridade das publicações (canal de alerta, design: "Prioridade Alta"). Definida pelo admin na
   * criação; ausente = Normal. Vai no cabeçalho de cada envelope do canal.
   */
  prio?: GroupPriority;
}

/** Opções de prioridade do design: Normal (padrão) e Alta. */
export type GroupPriority = 'high';
export const groupPriority = (g: Pick<GroupState, 'kind' | 'prio'>): Priority => (g.kind === 'channel' && g.prio === 'high' ? Priority.High : Priority.Normal);

export const GROUP_INVITE_TTL_SEC = 7 * 24 * 3600;
export const GROUP_INVITE_MAX_USES = 50;
export const MAX_GROUP_MEMBERS = 200;

export const newGroupId = () => toHex(random(16));
export const newKey = () => b64url(random(32));

export const isAdmin = (g: GroupState, id: string) => g.members.some(m => m.id === id && m.role === 'admin');
export const isMemberOf = (g: GroupState, id: string) => g.members.some(m => m.id === id);
/** Pode publicar mensagens no grupo? */
export const canPost = (g: GroupState, id: string) =>
  isMemberOf(g, id) && (g.kind === 'group' && g.send === 'all' ? true : isAdmin(g, id) || (!!g.postMods && g.members.some(m => m.id === id && m.role === 'mod')));

export const groupKeyOf = (g: { id: string; keyV: number; key: string }): GroupKey =>
  ({ groupId: Uint8Array.from(g.id.match(/../g)!.map(x => parseInt(x, 16))), version: g.keyV, key: unb64url(g.key) });

/**
 * Canal privado ou secreto: "Entra só com convite. Inscritos não veem uns aos outros" (design, tipo
 * de canal). O secreto é mais fechado que o privado, então vale o mesmo.
 */
export const hidesSubscribers = (g: Pick<GroupState, 'kind' | 'visibility'>) => g.kind === 'channel' && (g.visibility === 'private' || g.visibility === 'secret');

/** Quantos membros (ou inscritos) o grupo tem, mesmo quando a lista recebida é só a parte visível. */
export const memberCount = (g: Pick<GroupState, 'members' | 'count'>) => Math.max(g.count ?? 0, g.members.length);

/**
 * Forma serializada do estado, com as chaves públicas em base64url.
 * - `store`: tudo, para guardar neste aparelho.
 * - `admin`: para outro admin (lista completa e código de convite).
 * - `member`: sem o código de convite (só admins guardam). Em canal privado ou secreto, o inscrito
 *   `to` recebe só admins, moderadores e ele mesmo, mais o total (`count`): ids e chaves dos outros
 *   inscritos não saem do aparelho do admin. A troca de chave continua igual: o estado novo vai, pela
 *   sessão 1:1, a cada um que ficou, e quem recebe confere que veio de um admin que já conhece.
 */
export function encodeState(g: GroupState, view: 'store' | 'admin' | 'member', to?: string): string {
  const { invite, count, ...rest } = g;
  const reduced = view === 'member' && hidesSubscribers(g);
  const members = reduced ? g.members.filter(m => m.role !== 'member' || m.id === to) : g.members;
  return JSON.stringify({
    ...rest,
    ...(view !== 'member' && invite ? { invite } : {}),
    ...(reduced ? { count: memberCount(g) } : view === 'store' && count !== undefined ? { count } : {}),
    members: members.map(m => ({ id: m.id, name: m.name, role: m.role, s: b64url(m.pub.signPk), a: b64url(m.pub.agreePk), b: b64url(m.pub.binding) })),
  });
}

/** Lê e valida a forma recebida. `null` se algo não confere. */
export function decodeState(text: string, via: IdentityKind): GroupState | null {
  try {
    const j = JSON.parse(text);
    if (typeof j.id !== 'string' || !/^[0-9a-f]{32}$/.test(j.id)) return null;
    if (!['group', 'channel', 'community'].includes(j.kind)) return null;
    if (!Number.isInteger(j.rev) || j.rev < 1 || !Number.isInteger(j.keyV) || j.keyV < 1) return null;
    if (typeof j.key !== 'string' || unb64url(j.key).length !== 32) return null;
    if (!Array.isArray(j.members) || j.members.length < 1 || j.members.length > MAX_GROUP_MEMBERS) return null;
    const members: GroupMember[] = j.members.map((m: Record<string, string>) => ({
      id: String(m.id), name: String(m.name ?? '').slice(0, 40), role: m.role === 'admin' ? 'admin' : m.role === 'mod' ? 'mod' : 'member',
      pub: { signPk: unb64url(m.s), agreePk: unb64url(m.a), binding: unb64url(m.b) },
    }));
    if (!members.some(m => m.role === 'admin')) return null;
    const children = Array.isArray(j.children) ? j.children.slice(0, 50).filter((c: Record<string, string>) => /^[0-9a-f]{32}$/.test(c.id)).map((c: Record<string, string>) => ({ id: c.id, name: String(c.name).slice(0, 60), kind: c.kind === 'channel' ? 'channel' as const : 'group' as const })) : undefined;
    return {
      id: j.id, kind: j.kind, name: String(j.name ?? '').slice(0, 60), desc: String(j.desc ?? '').slice(0, 200), via,
      rev: j.rev, keyV: j.keyV, key: j.key, members,
      send: j.kind === 'group' && j.send === 'all' ? 'all' : 'admins', inv: j.inv === 'all' ? 'all' : 'admins', approve: !!j.approve, postMods: j.kind === 'channel' && !!j.postMods,
      visibility: ['public', 'private', 'secret'].includes(j.visibility) ? j.visibility : undefined,
      children, parent: typeof j.parent === 'string' && /^[0-9a-f]{32}$/.test(j.parent) ? j.parent : undefined,
      invite: j.invite && typeof j.invite.code === 'string' ? { code: j.invite.code, expiresAt: Number(j.invite.expiresAt), uses: Number(j.invite.uses) || 0 } : undefined,
      count: Number.isInteger(j.count) && j.count > members.length && j.count <= MAX_GROUP_MEMBERS ? j.count : undefined,
      ...(j.kind === 'channel' && j.prio === 'high' ? { prio: 'high' as const } : {}),
    };
  } catch {
    return null;
  }
}

/** Conteúdo de uma mensagem de grupo (dentro do envelope de grupo). */
/** `l`: localização em texto curto ([lat, lon]), conferida por quem recebe. */
export const encodeGroupText = (msgId: string, text: string, l?: [number, number]) => utf8(JSON.stringify({ i: msgId, x: text, ...(l ? { l } : {}) }));
export function decodeGroupText(b: Uint8Array): { i: string; x: string; l?: unknown } | null {
  try {
    const j = JSON.parse(fromUtf8(b));
    return typeof j.i === 'string' && j.i.length <= 64 && typeof j.x === 'string' ? { i: j.i, x: j.x.slice(0, 4000), ...(j.l !== undefined ? { l: j.l } : {}) } : null;
  } catch { return null; }
}
