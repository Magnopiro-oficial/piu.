/**
 * Alertas oficiais (CAP 1.2) no celular, em TypeScript puro e testado no Node.
 *
 * De onde vêm: o Piu Node pareado lê os feeds CAP públicos (padrão: INMET) e o app busca em
 * `GET /api/alerts` (lib/nodeApi.ts). Os órgãos não distribuem chave de assinatura para apps de
 * terceiros, então nada aqui é "assinado pela Defesa Civil": é um alerta público RETRANSMITIDO pelo
 * nó da pessoa, e a tela diz isso.
 *
 * Região: a pessoa escolhe a UF (e, se quiser, um trecho do nome da área). Sem GPS. O filtro usa o
 * código IBGE do município no `geocode` (os 2 primeiros dígitos são a UF) e, sem código IBGE, o
 * nome ou a sigla da UF no `areaDesc`.
 */
import type { NodeAlert } from './nodeApi';

export type Uf = 'AC' | 'AL' | 'AP' | 'AM' | 'BA' | 'CE' | 'DF' | 'ES' | 'GO' | 'MA' | 'MT' | 'MS' | 'MG' | 'PA' | 'PB' | 'PR' | 'PE' | 'PI' | 'RJ' | 'RN' | 'RS' | 'RO' | 'RR' | 'SC' | 'SP' | 'SE' | 'TO';
/** UFs com o código IBGE (2 dígitos) e o nome. */
export const UFS: [Uf, string, string][] = [
  ['AC', '12', 'Acre'], ['AL', '27', 'Alagoas'], ['AP', '16', 'Amapá'], ['AM', '13', 'Amazonas'], ['BA', '29', 'Bahia'],
  ['CE', '23', 'Ceará'], ['DF', '53', 'Distrito Federal'], ['ES', '32', 'Espírito Santo'], ['GO', '52', 'Goiás'],
  ['MA', '21', 'Maranhão'], ['MT', '51', 'Mato Grosso'], ['MS', '50', 'Mato Grosso do Sul'], ['MG', '31', 'Minas Gerais'],
  ['PA', '15', 'Pará'], ['PB', '25', 'Paraíba'], ['PR', '41', 'Paraná'], ['PE', '26', 'Pernambuco'], ['PI', '22', 'Piauí'],
  ['RJ', '33', 'Rio de Janeiro'], ['RN', '24', 'Rio Grande do Norte'], ['RS', '43', 'Rio Grande do Sul'], ['RO', '11', 'Rondônia'],
  ['RR', '14', 'Roraima'], ['SC', '42', 'Santa Catarina'], ['SP', '35', 'São Paulo'], ['SE', '28', 'Sergipe'], ['TO', '17', 'Tocantins'],
];
const UF_BY = new Map(UFS.map(([uf, code, name]) => [uf, { code, name }]));

export type Severity = NodeAlert['info']['severity'];
export const SEVERITY_PT: Record<Severity, string> = { Extreme: 'Extrema', Severe: 'Severa', Moderate: 'Moderada', Minor: 'Leve', Unknown: 'Não informada' };
const SEVERITY_RANK: Record<Severity, number> = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4 };

/** Alerta guardado no aparelho: o que o nó mandou, qual nó retransmitiu e até quando vale. */
export interface OfficialAlert extends NodeAlert {
  /** Nome do Piu Node que retransmitiu. */
  via: string;
  /** Fim da vigência (ms). */
  until: number;
}
export interface AlertRegion { uf: Uf | null; area: string }
export const DEFAULT_REGION: AlertRegion = { uf: null, area: '' };

/** Sem `expires` (opcional no CAP), vale 24 h depois do `sent`, como no nó. */
export const NO_EXPIRES_MS = 24 * 3600_000;
const MAX_ALERTS = 300;

const str = (v: unknown, max: number) => (typeof v === 'string' ? (v.length > max ? v.slice(0, max) : v) : '');
const SEVERITIES = Object.keys(SEVERITY_RANK) as Severity[];

export function untilOf(a: Pick<NodeAlert, 'sent' | 'info'>): number {
  const exp = Date.parse(a.info.expires);
  return Number.isFinite(exp) ? exp : Date.parse(a.sent) + NO_EXPIRES_MS;
}

/**
 * Confere o que veio do nó (é rede: formato e tamanho não são garantidos). `null` se faltar o
 * essencial, se for cancelamento ou se já venceu.
 */
export function sanitizeAlert(raw: unknown, via: string, now: number): OfficialAlert | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const info = (r.info && typeof r.info === 'object' ? r.info : {}) as Record<string, unknown>;
  const src = (r.source && typeof r.source === 'object' ? r.source : {}) as Record<string, unknown>;
  const id = str(r.id, 600), identifier = str(r.identifier, 256), sender = str(r.sender, 256), sent = str(r.sent, 40);
  if (!id || !identifier || !sender || !Number.isFinite(Date.parse(sent))) return null;
  const msgType = r.msgType === 'Update' ? 'Update' : r.msgType === 'Alert' ? 'Alert' : null;
  if (!msgType) return null;
  const severity = SEVERITIES.includes(info.severity as Severity) ? (info.severity as Severity) : 'Unknown';
  const areas = (Array.isArray(info.areas) ? info.areas : []).slice(0, 50).map(a => {
    const x = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>;
    const geocodes = (Array.isArray(x.geocodes) ? x.geocodes : []).slice(0, 2000).map(g => {
      const y = (g && typeof g === 'object' ? g : {}) as Record<string, unknown>;
      return { valueName: str(y.valueName, 64), value: str(y.value, 64) };
    }).filter(g => g.value);
    return { areaDesc: str(x.areaDesc, 1000), geocodes };
  });
  const a: NodeAlert = {
    id, identifier, sender, sent, msgType,
    info: {
      language: str(info.language, 16), senderName: str(info.senderName, 200), event: str(info.event, 200), severity,
      urgency: str(info.urgency, 16), certainty: str(info.certainty, 32), headline: str(info.headline, 300),
      description: str(info.description, 4000), instruction: str(info.instruction, 4000),
      web: /^https?:\/\//i.test(str(info.web, 500)) ? str(info.web, 500) : '',
      effective: str(info.effective, 40), onset: str(info.onset, 40), expires: str(info.expires, 40), areas,
    },
    source: { feed: str(src.feed, 500), url: str(src.url, 500) },
    receivedAt: typeof r.receivedAt === 'number' && Number.isFinite(r.receivedAt) ? r.receivedAt : now,
  };
  const until = untilOf(a);
  if (!Number.isFinite(until) || until <= now) return null;
  return { ...a, via: via.slice(0, 80), until };
}

/**
 * Junta o que já estava guardado com a resposta nova. A resposta de um nó é a lista completa dos
 * vigentes dele: o que esse nó não manda mais (cancelado, substituído) sai. Vencidos saem sempre.
 */
export function mergeAlerts(saved: OfficialAlert[], incoming: OfficialAlert[], now: number, fromNodes: string[] = []): OfficialAlert[] {
  const refreshed = new Set(fromNodes);
  const by = new Map<string, OfficialAlert>();
  for (const a of saved) if (a.until > now && !refreshed.has(a.via)) by.set(a.id, a);
  for (const a of incoming) if (a.until > now) by.set(a.id, a);
  return [...by.values()].sort((a, b) => b.until - a.until).slice(0, MAX_ALERTS);
}

/** Texto para comparar sem acento e sem caixa. */
export const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** O texto da área cita a UF pelo nome ("Goiás") ou pela sigla em maiúsculas ("- GO", "(GO)", "/GO"). */
function descMentions(desc: string, uf: Uf): boolean {
  const name = fold(UF_BY.get(uf)!.name);
  // "Mato Grosso" não pode casar com "Mato Grosso do Sul".
  const tail = uf === 'MT' ? '(?! do sul)' : '';
  if (new RegExp(`(^|[^a-z])${escapeRe(name)}${tail}([^a-z]|$)`).test(fold(desc))) return true;
  return new RegExp(`(^|[\\s(/,;-])${uf}([\\s)/,;.-]|$)`).test(desc);
}

/** O alerta cobre a região escolhida? Sem UF, vale o Brasil inteiro. */
export function inRegion(a: Pick<NodeAlert, 'info'>, r: AlertRegion): boolean {
  const areas = a.info.areas;
  if (r.uf) {
    const code = UF_BY.get(r.uf)!.code;
    const ibge = areas.flatMap(x => x.geocodes).map(g => g.value).filter(v => /^\d{7}$/.test(v));
    // Com código IBGE do município, ele decide (mais preciso que o texto).
    const ok = ibge.length ? ibge.some(v => v.startsWith(code)) : areas.some(x => descMentions(x.areaDesc, r.uf!));
    if (!ok) return false;
  }
  const want = fold(r.area.trim());
  if (want && !areas.some(x => fold(x.areaDesc).includes(want))) return false;
  return true;
}

/** Vigentes na região, os mais graves primeiro (e, empatados, os mais recentes). */
export function visibleAlerts(list: OfficialAlert[], r: AlertRegion, now: number): OfficialAlert[] {
  return list.filter(a => a.until > now && inRegion(a, r))
    .sort((a, b) => SEVERITY_RANK[a.info.severity] - SEVERITY_RANK[b.info.severity] || Date.parse(b.sent) - Date.parse(a.sent));
}

/** Só severidade Severa ou Extrema vira notificação do sistema. */
export const isUrgent = (a: Pick<NodeAlert, 'info'>) => a.info.severity === 'Severe' || a.info.severity === 'Extreme';

/** Os que ainda não foram notificados (vigentes, na região, severos ou extremos). */
export function toNotify(list: OfficialAlert[], notified: string[], r: AlertRegion, now: number): OfficialAlert[] {
  const done = new Set(notified);
  return visibleAlerts(list, r, now).filter(a => isUrgent(a) && !done.has(a.id));
}

/** Quem publicou: o `senderName` do CAP (ex.: "INMET") ou o `sender`. */
export const publisherOf = (a: Pick<NodeAlert, 'sender' | 'info'>) => a.info.senderName.trim() || a.sender;

/** Origem explícita: publicado pelo órgão em CAP e retransmitido pelo nó (sem assinatura do órgão). */
export const sourceLabel = (a: Pick<NodeAlert, 'sender' | 'info'>) => `Fonte: ${publisherOf(a)} (CAP) · recebido pelo seu Piu Node`;

/** Título curto: o `headline` ou, sem ele, o evento. */
export const alertTitle = (a: Pick<NodeAlert, 'info'>) => a.info.headline.trim() || a.info.event.trim() || 'Alerta oficial';

/** Áreas numa linha (para listas e notificações). */
export const areaLine = (a: Pick<NodeAlert, 'info'>, max = 140) => {
  const s = a.info.areas.map(x => x.areaDesc.replace(/^Aviso para as Áreas:\s*/i, '').trim()).filter(Boolean).join(' · ');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
};
