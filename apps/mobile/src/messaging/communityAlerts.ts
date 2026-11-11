/**
 * Alertas da comunidade: publicados por qualquer membro de uma comunidade e classificados pelos
 * próprios membros. Não dependem de órgão oficial e não são aviso oficial. TypeScript puro, testado
 * no Node.
 *
 * Onde andam: no grupo da própria comunidade (o "grupo de avisos" que reúne os grupos e canais dela,
 * `GroupState.kind === 'community'`), cifrados com a chave atual dele, como conteúdo de grupo com um
 * campo próprio (`ca` alerta, `cv` classificação, `cc` encerramento). Versões antigas do app não
 * reconhecem esses campos e ignoram. O remetente vem autenticado pelo envelope de grupo; aqui só
 * conta quem é membro da comunidade no estado atual.
 *
 * - Publicar: categoria, gravidade, título, texto, área (opcional) e validade (1, 6, 24 ou 72 h).
 *   Limite: no máximo 3 alertas ativos por membro em cada comunidade e 1 a cada 10 min.
 * - Classificar: "Confirmo" ou "Não procede", um voto por membro (vale o mais recente). O autor não
 *   classifica o próprio alerta.
 * - Estado, calculado igual em todo aparelho a partir dos votos de membros atuais:
 *   Contestado: não procede ≥ 2 e ≥ confirmações. Confirmado: confirmações ≥ 2 e ≥ 2× não procede.
 *   Senão, Não confirmado. Encerrado: pelo autor ou por admin/moderador da comunidade. Vencido: passou
 *   da validade.
 * - Guarda: some do aparelho 24 h depois de vencer (histórico curto).
 */
import { fromUtf8, utf8 } from '../protocol/bytes';
import { stripBidi } from './bidi';
import type { GroupMember } from './groups';

export type AlertCategory = 'clima' | 'agua' | 'fogo' | 'via' | 'seguranca' | 'saude' | 'servico' | 'outro';
/** Categorias (o design não define categorias de alerta: conjunto curto e genérico). */
export const ALERT_CATEGORIES: { id: AlertCategory; label: string; icon: string }[] = [
  { id: 'clima', label: 'Clima', icon: 'thunderstorm' },
  { id: 'agua', label: 'Enchente/água', icon: 'flood' },
  { id: 'fogo', label: 'Incêndio', icon: 'local_fire_department' },
  { id: 'via', label: 'Trânsito/via', icon: 'traffic' },
  { id: 'seguranca', label: 'Segurança', icon: 'shield' },
  { id: 'saude', label: 'Saúde', icon: 'medical_services' },
  { id: 'servico', label: 'Falta de luz/água', icon: 'power_off' },
  { id: 'outro', label: 'Outro', icon: 'campaign' },
];
const CATS = new Set(ALERT_CATEGORIES.map(c => c.id));
export const categoryOf = (id: AlertCategory) => ALERT_CATEGORIES.find(c => c.id === id) ?? ALERT_CATEGORIES[ALERT_CATEGORIES.length - 1]!;

export type AlertSeverity = 'info' | 'warn' | 'grave';
export const SEVERITIES: { id: AlertSeverity; label: string }[] = [
  { id: 'info', label: 'Informativo' }, { id: 'warn', label: 'Atenção' }, { id: 'grave', label: 'Grave' },
];
export const severityLabel = (s: AlertSeverity) => SEVERITIES.find(x => x.id === s)!.label;

/** Validades oferecidas (segundos). Padrão: 24 h. */
export const ALERT_DURATIONS: { sec: number; label: string }[] = [
  { sec: 3600, label: '1 h' }, { sec: 6 * 3600, label: '6 h' }, { sec: 24 * 3600, label: '24 h' }, { sec: 72 * 3600, label: '72 h' },
];
export const DEFAULT_DURATION_SEC = 24 * 3600;
const DURS = new Set(ALERT_DURATIONS.map(d => d.sec));
const MAX_DURATION_SEC = 72 * 3600;

export const MAX_ACTIVE_PER_MEMBER = 3;
export const MIN_INTERVAL_SEC = 10 * 60;
/** Vencido ou encerrado continua na lista (histórico) por 24 h e depois sai do aparelho. */
export const HISTORY_SEC = 24 * 3600;
export const TITLE_MAX = 80;
export const TEXT_MAX = 1000;
export const AREA_MAX = 120;
/** Relógio de quem publicou adiantado demais: o alerta é recusado. */
const FUTURE_SKEW_SEC = 10 * 60;
const MAX_ALERTS = 500;
const MAX_LOOSE = 2000;

export const OFFICIAL_NOTE = 'Publicado por um membro da comunidade. Não é aviso oficial.';
/** Motivos de não poder publicar (`canPublish`), em pt-BR; a tela compara com estes para traduzir (`alerts.limit.*`). */
export const LIMIT_MSG = {
  wait: 'Espere 10 minutos entre um alerta e outro.',
  max: `Você já tem ${MAX_ACTIVE_PER_MEMBER} alertas ativos nesta comunidade. Encerre um antes de publicar outro.`,
  member: 'Só membros da comunidade publicam alertas.',
} as const;

export interface CommunityAlert {
  /** 32 hex (o id da mensagem de grupo). */
  id: string;
  community: string;
  author: string;
  authorName: string;
  cat: AlertCategory;
  sev: AlertSeverity;
  title: string;
  text: string;
  area: string;
  /** Envio (s, relógio de quem publicou, autenticado no envelope) e fim da validade. */
  at: number;
  until: number;
}
export type Vote = 'confirm' | 'deny';
/** `n`: revisão do voto daquele membro (cresce a cada mudança); empate: o mais novo, depois o maior id. */
interface VoteRec { v: Vote; at: number; i: string; n: number }

export type AlertStatus = 'unconfirmed' | 'confirmed' | 'contested' | 'closed' | 'expired';
export const STATUS_LABEL: Record<AlertStatus, string> = {
  unconfirmed: 'Não confirmado', confirmed: 'Confirmado pela comunidade', contested: 'Contestado', closed: 'Encerrado', expired: 'Vencido',
};

/** Quem é da comunidade agora, com o papel. */
export type Roster = Pick<GroupMember, 'id' | 'role'>[];

export interface AlertView extends CommunityAlert {
  status: AlertStatus;
  confirms: number;
  denies: number;
  myVote: Vote | null;
  mine: boolean;
  /** Ativo: dentro da validade e não encerrado (contestado continua ativo, rebaixado). */
  active: boolean;
  canVote: boolean;
  canClose: boolean;
  closedAt: number | null;
  /** Nome da comunidade (para listas e notificações). */
  communityName: string;
}

// ── formato na malha ──────────────────────────────────────────────

export type WireAlert =
  | { kind: 'alert'; i: string; cat: AlertCategory; sev: AlertSeverity; title: string; text: string; area: string; dur: number }
  | { kind: 'vote'; i: string; alert: string; v: Vote; n: number }
  | { kind: 'close'; i: string; alert: string };

const ID_RE = /^[0-9a-f]{32}$/;
const clip = (v: unknown, max: number) => (typeof v === 'string' ? stripBidi(v).trim().slice(0, max) : '');

export function encodeAlertPayload(p: WireAlert): Uint8Array {
  if (p.kind === 'alert') return utf8(JSON.stringify({ i: p.i, ca: { c: p.cat, s: p.sev, t: p.title, x: p.text, ...(p.area ? { r: p.area } : {}), d: p.dur } }));
  if (p.kind === 'vote') return utf8(JSON.stringify({ i: p.i, cv: { a: p.alert, v: p.v === 'confirm' ? 'c' : 'n', n: p.n } }));
  return utf8(JSON.stringify({ i: p.i, cc: { a: p.alert } }));
}

/** Lê o conteúdo de grupo; `null` se não é alerta, voto ou encerramento válido. */
export function decodeAlertPayload(b: Uint8Array): WireAlert | null {
  let j: Record<string, unknown>;
  try { j = JSON.parse(fromUtf8(b)); } catch { return null; }
  if (!j || typeof j !== 'object' || typeof j.i !== 'string' || !ID_RE.test(j.i)) return null;
  const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : null);
  const ca = obj(j.ca), cv = obj(j.cv), cc = obj(j.cc);
  if (ca) {
    const cat = ca.c as AlertCategory, sev = ca.s as AlertSeverity, dur = ca.d as number;
    const title = clip(ca.t, TITLE_MAX);
    if (!CATS.has(cat) || !SEVERITIES.some(s => s.id === sev) || !DURS.has(dur) || !title) return null;
    return { kind: 'alert', i: j.i, cat, sev, title, text: clip(ca.x, TEXT_MAX), area: clip(ca.r, AREA_MAX), dur };
  }
  if (cv) {
    if (typeof cv.a !== 'string' || !ID_RE.test(cv.a) || (cv.v !== 'c' && cv.v !== 'n')) return null;
    const n = Number.isInteger(cv.n) && (cv.n as number) >= 1 && (cv.n as number) <= 1e6 ? (cv.n as number) : 1;
    return { kind: 'vote', i: j.i, alert: cv.a, v: cv.v === 'c' ? 'confirm' : 'deny', n };
  }
  if (cc) {
    if (typeof cc.a !== 'string' || !ID_RE.test(cc.a)) return null;
    return { kind: 'close', i: j.i, alert: cc.a };
  }
  return null;
}

/** Confere o que a pessoa digitou antes de publicar. Devolve o motivo em português ou `null`. */
/** O que falta no rascunho (código; a tela traduz), ou null. */
export type DraftIssue = 'cat' | 'sev' | 'title' | 'titleLong' | 'textLong' | 'areaLong' | 'dur';
export function draftIssue(d: { cat: string; sev: string; title: string; text: string; area?: string; dur: number }): DraftIssue | null {
  if (!CATS.has(d.cat as AlertCategory)) return 'cat';
  if (!SEVERITIES.some(s => s.id === d.sev)) return 'sev';
  if (!d.title.trim()) return 'title';
  if (d.title.trim().length > TITLE_MAX) return 'titleLong';
  if (d.text.trim().length > TEXT_MAX) return 'textLong';
  if ((d.area ?? '').trim().length > AREA_MAX) return 'areaLong';
  if (!DURS.has(d.dur)) return 'dur';
  return null;
}
export function checkDraft(d: { cat: string; sev: string; title: string; text: string; area?: string; dur: number }): string | null {
  const k = draftIssue(d);
  if (k === 'cat') return 'Escolha uma categoria.';
  if (k === 'sev') return 'Escolha a gravidade.';
  if (k === 'title') return 'Escreva um título curto.';
  if (k === 'titleLong') return `Título com até ${TITLE_MAX} caracteres.`;
  if (k === 'textLong') return `Texto com até ${TEXT_MAX} caracteres.`;
  if (k === 'areaLong') return `Área com até ${AREA_MAX} caracteres.`;
  if (k === 'dur') return 'Escolha a validade.';
  return null;
}

// ── agregação ─────────────────────────────────────────────────────

/** Estado pelos votos (sem encerramento e validade). Determinístico: só depende das contagens. */
export function voteStatus(confirms: number, denies: number): 'unconfirmed' | 'confirmed' | 'contested' {
  if (denies >= 2 && denies >= confirms) return 'contested';
  if (confirms >= 2 && confirms >= 2 * denies) return 'confirmed';
  return 'unconfirmed';
}

const canModerate = (roster: Roster, id: string) => roster.some(m => m.id === id && (m.role === 'admin' || m.role === 'mod'));
const isIn = (roster: Roster, id: string) => roster.some(m => m.id === id);

/** O que merece notificação nesta mudança. `null`: só aparece na lista. */
export interface AlertNotice { level: 'critical' | 'normal'; update: boolean }
export function noticeFor(prev: AlertStatus | null, v: Pick<AlertView, 'sev' | 'status' | 'mine'>): AlertNotice | null {
  if (v.mine || v.status === 'contested' || v.status === 'closed' || v.status === 'expired') return null;
  if (prev === null) return v.sev === 'grave' ? { level: 'critical', update: false } : v.sev === 'warn' ? { level: 'normal', update: false } : null;
  if (v.status === 'confirmed' && prev !== 'confirmed' && v.sev === 'grave') return { level: 'critical', update: true };
  return null;
}

/** Ordem da lista: ativos antes; Graves, depois Atenção, depois Informativo; contestados rebaixados; mais novos primeiro. */
const SEV_RANK: Record<AlertSeverity, number> = { grave: 0, warn: 1, info: 2 };
export function sortViews(list: AlertView[]): AlertView[] {
  const rank = (v: AlertView) => (v.active ? 0 : 2) + (v.status === 'contested' ? 1 : 0);
  return [...list].sort((a, b) => rank(a) - rank(b) || SEV_RANK[a.sev] - SEV_RANK[b.sev] || b.at - a.at);
}

/** Para a tela bloqueada: Graves vigentes, não contestados nem encerrados. */
export const lockAlerts = (list: AlertView[]) => sortViews(list.filter(v => v.active && v.sev === 'grave' && v.status !== 'contested'));

// ── livro de alertas (no aparelho, salvo junto do mensageiro) ─────

interface Saved { a?: CommunityAlert[]; v?: [string, [string, VoteRec][]][]; c?: [string, [string, number][]][] }

export class AlertBook {
  private alerts = new Map<string, CommunityAlert>();
  /** alerta → votante → voto (votos podem chegar antes do alerta). */
  private votes = new Map<string, Map<string, VoteRec>>();
  /** alerta → quem pediu para encerrar → quando. A permissão é conferida no cálculo (papel atual). */
  private closes = new Map<string, Map<string, number>>();

  constructor(saved?: unknown) {
    const s = (saved && typeof saved === 'object' ? saved : {}) as Saved;
    for (const a of Array.isArray(s.a) ? s.a : []) if (a && typeof a.id === 'string' && ID_RE.test(a.id) && CATS.has(a.cat) && typeof a.until === 'number') this.alerts.set(a.id, a);
    for (const [id, list] of Array.isArray(s.v) ? s.v : []) if (Array.isArray(list)) this.votes.set(id, new Map(list.filter(x => Array.isArray(x) && x[1] && (x[1].v === 'confirm' || x[1].v === 'deny')).map(([k, r]) => [k, { ...r, n: Number(r.n) || 1 }] as [string, VoteRec])));
    for (const [id, list] of Array.isArray(s.c) ? s.c : []) if (Array.isArray(list)) this.closes.set(id, new Map(list));
  }

  export(): Saved {
    return { a: [...this.alerts.values()], v: [...this.votes].map(([id, m]) => [id, [...m]]), c: [...this.closes].map(([id, m]) => [id, [...m]]) };
  }

  get(id: string) { return this.alerts.get(id); }
  all() { return [...this.alerts.values()]; }

  /** Encerrado por quem pode (autor, admin ou moderador atual): quando, ou `null`. */
  private closedAt(a: CommunityAlert, roster: Roster): number | null {
    let at: number | null = null;
    for (const [by, t] of this.closes.get(a.id) ?? []) {
      if (by !== a.author && !canModerate(roster, by)) continue;
      at = at === null ? t : Math.min(at, t);
    }
    return at;
  }

  /**
   * Alertas do autor nesta comunidade que contam para o limite no instante `at`.
   * Só contam os que começaram até `at`: assim o alerta mais novo que chega antes dos antigos
   * não faz os antigos serem recusados. A resposta ainda pode variar com a ordem de chegada. Em aberto: quem
   * retrodata do mais novo para o mais velho ainda passa do teto de 3 ativos.
   */
  private limitReason(community: string, author: string, at: number, roster: Roster, except?: string): string | null {
    let active = 0;
    for (const x of this.alerts.values()) {
      if (x.id === except || x.community !== community || x.author !== author) continue;
      if (Math.abs(at - x.at) < MIN_INTERVAL_SEC) return LIMIT_MSG.wait;
      const closed = this.closedAt(x, roster);
      if (x.at <= at && at < x.until && (closed === null || closed > at)) active++;
    }
    return active >= MAX_ACTIVE_PER_MEMBER ? LIMIT_MSG.max : null;
  }

  /** Posso publicar agora? Motivo em português, ou `null`. */
  canPublish(community: string, author: string, now: number, roster: Roster): string | null {
    if (!isIn(roster, author)) return LIMIT_MSG.member;
    return this.limitReason(community, author, now, roster);
  }

  /**
   * Alerta que chegou (ou que eu publiquei). Recusa quem não é membro, relógio adiantado demais,
   * id repetido de outro autor e quem passou do limite (o mesmo cálculo em todo aparelho).
   */
  addAlert(a: CommunityAlert, now: number, roster: Roster): 'ok' | 'dup' | 'rejected' {
    const cur = this.alerts.get(a.id);
    if (cur) return 'dup';
    if (!isIn(roster, a.author) || a.at > now + FUTURE_SKEW_SEC || a.until - a.at > MAX_DURATION_SEC || a.until <= a.at) return 'rejected';
    if (this.limitReason(a.community, a.author, a.at, roster)) return 'rejected';
    if (a.until + HISTORY_SEC <= now) return 'rejected';
    this.alerts.set(a.id, a);
    if (this.alerts.size > MAX_ALERTS) {
      const oldest = [...this.alerts.values()].sort((x, y) => x.until - y.until)[0]!;
      this.forget(oldest.id);
    }
    return 'ok';
  }

  /** Revisão do próximo voto meu neste alerta. */
  nextVoteRev(alertId: string, voter: string) { return (this.votes.get(alertId)?.get(voter)?.n ?? 0) + 1; }

  /** Voto de um membro. Vale a maior revisão (empate: o mais recente, depois o maior id de mensagem). */
  addVote(alertId: string, voter: string, v: Vote, at: number, msgId: string, roster: Roster, n = 1): boolean {
    if (!isIn(roster, voter)) return false;
    const a = this.alerts.get(alertId);
    if (a && a.author === voter) return false;
    let m = this.votes.get(alertId);
    const cur = m?.get(voter);
    if (cur && (cur.n > n || (cur.n === n && (cur.at > at || (cur.at === at && cur.i >= msgId))))) return false;
    if (!m) { m = new Map(); this.votes.set(alertId, m); }
    m.set(voter, { v, at, i: msgId, n });
    this.trimLoose();
    return true;
  }

  addClose(alertId: string, by: string, at: number, roster: Roster): boolean {
    if (!isIn(roster, by)) return false;
    const a = this.alerts.get(alertId);
    if (a && by !== a.author && !canModerate(roster, by)) return false;
    let m = this.closes.get(alertId);
    if (m?.has(by)) return false;
    if (!m) { m = new Map(); this.closes.set(alertId, m); }
    m.set(by, at);
    this.trimLoose();
    return true;
  }

  /** Visão do alerta para a tela, calculada agora com os membros atuais. */
  view(id: string, roster: Roster, me: string, now: number, communityName = ''): AlertView | null {
    const a = this.alerts.get(id);
    if (!a) return null;
    let confirms = 0, denies = 0;
    for (const [voter, r] of this.votes.get(id) ?? []) {
      if (voter === a.author || !isIn(roster, voter)) continue;
      if (r.v === 'confirm') confirms++; else denies++;
    }
    const closedAt = this.closedAt(a, roster);
    const expired = now >= a.until;
    const status: AlertStatus = closedAt !== null ? 'closed' : expired ? 'expired' : voteStatus(confirms, denies);
    const active = closedAt === null && !expired;
    const mine = a.author === me;
    const myVote = this.votes.get(id)?.get(me)?.v ?? null;
    return {
      ...a, communityName, status, confirms, denies, myVote, mine, active, closedAt,
      canVote: active && !mine && isIn(roster, me),
      canClose: active && (mine || canModerate(roster, me)),
    };
  }

  /** Tira do aparelho o que venceu há mais de 24 h. Devolve se algo saiu. */
  prune(now: number): boolean {
    let changed = false;
    for (const a of [...this.alerts.values()]) if (a.until + HISTORY_SEC <= now) { this.forget(a.id); changed = true; }
    // Votos e encerramentos de alerta que nunca chegou: saem depois do maior prazo possível.
    const horizon = now - MAX_DURATION_SEC - HISTORY_SEC;
    for (const [id, m] of [...this.votes]) if (!this.alerts.has(id) && [...m.values()].every(r => r.at <= horizon)) { this.votes.delete(id); changed = true; }
    for (const [id, m] of [...this.closes]) if (!this.alerts.has(id) && [...m.values()].every(t => t <= horizon)) { this.closes.delete(id); changed = true; }
    return changed;
  }

  /** Saí da comunidade: os alertas dela saem deste aparelho. */
  dropCommunity(community: string): boolean {
    let changed = false;
    for (const a of [...this.alerts.values()]) if (a.community === community) { this.forget(a.id); changed = true; }
    return changed;
  }

  private forget(id: string) { this.alerts.delete(id); this.votes.delete(id); this.closes.delete(id); }

  /** Votos e encerramentos sem alerta conhecido têm teto (contra enxurrada). */
  private trimLoose() {
    const loose = [...this.votes.keys()].filter(id => !this.alerts.has(id));
    for (const id of loose.slice(0, Math.max(0, loose.length - MAX_LOOSE))) this.votes.delete(id);
    const looseC = [...this.closes.keys()].filter(id => !this.alerts.has(id));
    for (const id of looseC.slice(0, Math.max(0, looseC.length - MAX_LOOSE))) this.closes.delete(id);
  }
}
