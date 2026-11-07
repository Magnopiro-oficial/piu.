/**
 * Ponto Piu neste celular (docs/rede/pontos-piu-roteadores.md, fase 2; telas design "Piu 13", P1–P9).
 * Lógica pura, testada em src/lib/__tests__/pointCore.test.ts. O estado e os efeitos ficam em
 * state/point.tsx; a chave do ponto em lib/pointKey.ts.
 *
 * Regras da casa:
 * - "Ativar ponto = um toque": nada aqui move LUNES; recompensas desligadas (o programa não abriu).
 * - Ponto sem internet por padrão: o nível gateway só existe se o teste achou internet, e começa desligado.
 * - A senha do Wi-Fi só entra no QR se o dono digitou ou se veio do hotspot local (LocalOnlyHotspot);
 *   o Piu nunca lê senhas salvas do sistema.
 * - Rede de casa exposta (vermelho) bloqueia a ativação.
 * - Números do painel só de medições reais (contagens; ninguém identificado).
 */
import { MAX_TTL_SEC } from '../protocol/envelope';
import type { LanCheckResult } from '../transport/lan/lanCheck';
import type { ProbeResult } from '../transport/lan/types';

// ── níveis e limites ─────────────────────────────────────

/** P5: só a rede · guarda e repassa · guarda + página do app · gateway (com internet; desligado de fábrica). */
export type PointLevel = 'multiplier' | 'guardian' | 'guardianApp' | 'gateway';
export const POINT_LEVELS: readonly PointLevel[] = ['multiplier', 'guardian', 'guardianApp', 'gateway'];
export const isPointLevel = (x: unknown): x is PointLevel => typeof x === 'string' && (POINT_LEVELS as readonly string[]).includes(x);

/**
 * Espaço para mensagens de terceiros (MB) e por quantos dias: passos do controle −/+ do P5.
 * Regra única do Piu, igual no celular e no Desktop (apps/desktop/src/shared/guardian.ts, docs/rede/guardiao-desktop.md):
 * até 1 GB e até 7 dias. Um envelope vale no máximo `MAX_TTL_SEC` (7 dias) no protocolo, então guardar mais não serve;
 * e o roteador guarda em memória. Padrão: 512 MB e 7 dias.
 */
export const SPACE_STEPS_MB = [256, 512, 1024] as const;
export const MAX_GUARD_DAYS = MAX_TTL_SEC / 86_400;
export const DAYS_STEPS = [1, 3, MAX_GUARD_DAYS] as const;
export const DEFAULT_SPACE_MB = 512;
export const DEFAULT_DAYS = MAX_GUARD_DAYS;

const stepIn = (steps: readonly number[], cur: number, dir: 1 | -1) => {
  const i = steps.findIndex(s => s >= cur);
  const at = i < 0 ? steps.length - 1 : steps[i] === cur ? i : dir > 0 ? i - 1 : i;
  return steps[Math.max(0, Math.min(steps.length - 1, at + dir))]!;
};
export const stepSpace = (cur: number, dir: 1 | -1) => stepIn(SPACE_STEPS_MB, cur, dir);
export const stepDays = (cur: number, dir: 1 | -1) => stepIn(DAYS_STEPS, cur, dir);

/** O nível guarda mensagens de terceiros? (multiplicador: não guarda nada). */
export const levelStores = (l: PointLevel) => l !== 'multiplier';
/** O nível serve a página local do app (P9)? */
export const levelServesApp = (l: PointLevel) => l === 'guardianApp';

// ── configuração ─────────────────────────────────────────

/** `wifi`: rede Wi-Fi que já existe (forma A). `hotspot`: rede criada por este celular (forma B, LocalOnlyHotspot). */
export type PointNetKind = 'wifi' | 'hotspot';
export type WifiSecurity = 'WPA' | 'nopass';

export interface PointNetwork {
  kind: PointNetKind;
  /** Nome da rede para o QR (lido do sistema, digitado pelo dono ou gerado pelo hotspot). `null` = sem QR de Wi-Fi. */
  ssid: string | null;
  security: WifiSecurity;
  /** Só se o dono digitou ou se veio do hotspot local. Nunca lida das redes salvas do sistema. */
  password: string | null;
  /** O dono disse que é rede de visitante ou só do ponto (separada da rede da casa). Hotspot: sempre. */
  separated: boolean;
}

export interface PointConfig {
  v: 1;
  /** Id público do ponto (16 hex da chave do ponto). */
  id: string;
  /** Nome mostrado no QR e no cartaz ("Piu · Padaria do Zé"). */
  name: string;
  network: PointNetwork;
  level: PointLevel;
  spaceMb: number;
  days: number;
  createdAt: number;
  paused: boolean;
}

export const NAME_PREFIX = 'Piu · ';
const MAX_NAME = 40;
const MAX_SSID_BYTES = 32;
/** WPA2-PSK: 8 a 63 caracteres ASCII imprimíveis. */
export const validWpaPassword = (p: string) => /^[\x20-\x7e]{8,63}$/.test(p);
export const validSsid = (s: string) => s.trim().length > 0 && new TextEncoder().encode(s).length <= MAX_SSID_BYTES;

/** Nome do ponto com o prefixo "Piu · ", sem quebras, até 40 caracteres. */
export function pointName(raw: string, fallback: string): string {
  let n = (raw ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  n = n.replace(/^piu\s*[·•\-:]\s*/i, '');
  if (!n) n = fallback.trim() || 'Piu';
  return (NAME_PREFIX + n).slice(0, MAX_NAME + NAME_PREFIX.length);
}

/** Valida e normaliza uma configuração salva (dado do aparelho, mas pode vir de versão antiga). */
export function reviveConfig(x: unknown): PointConfig | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Partial<PointConfig>;
  if (o.v !== 1 || typeof o.id !== 'string' || !/^[0-9a-f]{16}$/.test(o.id) || typeof o.name !== 'string' || !isPointLevel(o.level)) return null;
  const n = o.network as Partial<PointNetwork> | undefined;
  if (!n || (n.kind !== 'wifi' && n.kind !== 'hotspot')) return null;
  return {
    v: 1, id: o.id, name: o.name, level: o.level,
    network: {
      kind: n.kind, ssid: typeof n.ssid === 'string' && validSsid(n.ssid) ? n.ssid : null,
      security: n.security === 'nopass' ? 'nopass' : 'WPA',
      password: typeof n.password === 'string' && validWpaPassword(n.password) ? n.password : null,
      separated: n.kind === 'hotspot' ? true : !!n.separated,
    },
    spaceMb: SPACE_STEPS_MB.includes(o.spaceMb as never) ? o.spaceMb! : DEFAULT_SPACE_MB,
    days: DAYS_STEPS.includes(o.days as never) ? o.days! : DEFAULT_DAYS,
    createdAt: typeof o.createdAt === 'number' ? o.createdAt : 0,
    paused: !!o.paused,
  };
}

/**
 * O que o ponto liga no app agora (lido pelo mensageiro, pelo transporte e pelo serviço em primeiro plano).
 * Pausado = não atende ninguém, mas o que já está guardado continua.
 */
export interface PointRuntime {
  active: boolean;
  /** Guardar e repassar mensagens de terceiros (o roteador do mensageiro, com os limites do ponto). */
  relay: boolean;
  /** Teto de espaço para terceiros (bytes) e retenção (s); `null` = os do modo nó. */
  maxBytes: number | null;
  retentionSec: number | null;
  serveApp: boolean;
  gateway: boolean;
  /** Manter o processo vivo em segundo plano (serviço em primeiro plano do modo nó). */
  background: boolean;
}

export const NO_POINT: PointRuntime = { active: false, relay: false, maxBytes: null, retentionSec: null, serveApp: false, gateway: false, background: false };

export function pointRuntime(c: PointConfig | null): PointRuntime {
  if (!c || c.paused) return NO_POINT;
  const stores = levelStores(c.level);
  return {
    active: true, relay: stores,
    maxBytes: stores ? c.spaceMb * 1024 * 1024 : null,
    retentionSec: stores ? c.days * 86_400 : null,
    serveApp: levelServesApp(c.level), gateway: c.level === 'gateway', background: true,
  };
}

/** Política do roteador com o ponto: o maior entre o modo nó e o ponto (o ponto nunca reduz o que a pessoa escolheu). */
export function mergePolicy(base: { maxBytes: number; retentionSec: number }, p: PointRuntime) {
  return {
    maxBytes: p.maxBytes !== null ? Math.max(base.maxBytes, p.maxBytes) : base.maxBytes,
    retentionSec: p.retentionSec !== null ? Math.max(base.retentionSec, p.retentionSec) : base.retentionSec,
  };
}

// ── teste de compatibilidade (P4 a–c) ────────────────────

export type CheckRowKey = 'peers' | 'home' | 'homeNetwork' | 'routerAdmin' | 'isolation' | 'internet' | 'capacity' | 'lanOff' | 'noWifi';
export type CheckState = 'ok' | 'warn' | 'bad';
export interface CheckRow { key: CheckRowKey; state: CheckState; count?: number }
export interface PointCheckView {
  verdict: 'green' | 'yellow' | 'red';
  rows: CheckRow[];
  /** Vermelho: sem "Continuar", só alternativas (P4c). */
  blocks: boolean;
  internet: boolean;
  peers: number;
  /** Endereços na sub-rede (estimativa pelo prefixo; o roteador pode aceitar menos). */
  subnet: number | null;
}

/**
 * Traduz o `runLanCheck` para as telas P4a–c.
 * - Vermelho (bloqueia): sem Wi-Fi; rede que o dono NÃO marcou como de visitante/só do ponto (visitantes
 *   entrariam na rede da casa); ou, numa rede marcada como separada, roteador de outra rede privada
 *   respondendo (a casa está alcançável).
 * - Amarelo (segue com instrução): isolamento entre visitantes, página do roteador abrindo, ninguém
 *   respondeu ainda, Wi-Fi local desligado.
 * - Hotspot deste celular: separado por construção (a rede é do próprio celular, sem saída para a casa).
 */
export function pointCheckView(r: LanCheckResult, o: { separated: boolean; hotspot: boolean }): PointCheckView {
  const peers = r.peers.broadcast + r.peers.mdns + r.peers.scan + r.peers.links;
  const base = { internet: r.internet, peers, subnet: r.subnetSize };
  if (!r.wifi) return { ...base, verdict: 'red', blocks: true, rows: [{ key: 'noWifi', state: 'bad' }] };
  const rows: CheckRow[] = [];
  if (r.issues.includes('lanOff')) rows.push({ key: 'lanOff', state: 'warn' });
  if (r.isolation === 'suspected') rows.push({ key: 'isolation', state: 'warn' });
  else rows.push({ key: 'peers', state: peers > 0 ? 'ok' : 'warn', count: peers });
  if (o.hotspot) rows.push({ key: 'home', state: 'ok' });
  else if (!o.separated) rows.push({ key: 'homeNetwork', state: 'bad' });
  else if (r.homeExposure.otherLans.length) rows.push({ key: 'home', state: 'bad', count: r.homeExposure.otherLans.length });
  else {
    rows.push({ key: 'home', state: 'ok' });
    if (r.homeExposure.routerAdmin) rows.push({ key: 'routerAdmin', state: 'warn' });
  }
  rows.push({ key: 'internet', state: 'ok' });
  rows.push({ key: 'capacity', state: 'ok', ...(r.subnetSize !== null ? { count: r.subnetSize } : {}) });
  const bad = rows.some(x => x.state === 'bad');
  const warn = rows.some(x => x.state === 'warn');
  return { ...base, verdict: bad ? 'red' : warn ? 'yellow' : 'green', blocks: bad, rows };
}

/** Nome da rede sugere visitante/ponto (só para pré-marcar a opção; o dono confirma). */
export const looksSeparated = (ssid: string | null) => !!ssid && /(visit|guest|convid|invit|piu|ponto|hotspot|public|p[uú]blic)/i.test(ssid);

// ── QR de Wi-Fi (P6) ─────────────────────────────────────

const esc = (s: string) => s.replace(/([\\;,:"])/g, '\\$1');

/**
 * QR de Wi-Fi padrão (a câmera do Android e do iPhone entendem): `WIFI:T:<WPA|nopass>;S:<ssid>;P:<senha>;;`.
 * Sem senha conhecida numa rede com senha, o QR leva só o nome e o tipo (a câmera pede a senha).
 */
export function pointWifiQr(n: { ssid: string; security: WifiSecurity; password: string | null }): string {
  if (!validSsid(n.ssid)) throw new Error('Nome da rede inválido.');
  if (n.security === 'nopass') return `WIFI:T:nopass;S:${esc(n.ssid)};;`;
  return n.password ? `WIFI:T:WPA;S:${esc(n.ssid)};P:${esc(n.password)};;` : `WIFI:T:WPA;S:${esc(n.ssid)};;`;
}

/** Lê um QR `WIFI:` (o do ponto ou de qualquer cartaz). `null` se não for. */
export function parseWifiQr(text: string): { ssid: string; security: WifiSecurity; password: string | null } | null {
  if (typeof text !== 'string' || !/^WIFI:/i.test(text.trim())) return null;
  const body = text.trim().slice(5);
  const fields: Record<string, string> = {};
  let key = '', val = '', inKey = true;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch === '\\' && i + 1 < body.length) { (inKey ? (key += body[++i]) : (val += body[++i])); continue; }
    if (inKey) { if (ch === ':') inKey = false; else if (ch === ';') key = ''; else key += ch; continue; }
    if (ch === ';') { fields[key.toUpperCase()] = val; key = ''; val = ''; inKey = true; continue; }
    val += ch;
  }
  const ssid = fields.S;
  if (!ssid || !validSsid(ssid)) return null;
  const t = (fields.T ?? '').toUpperCase();
  const security: WifiSecurity = t === '' || t === 'NOPASS' ? 'nopass' : 'WPA';
  return { ssid, security, password: security === 'WPA' && fields.P ? fields.P : null };
}

/** Rede com nome de ponto Piu ("Piu · Padaria do Zé"). */
export const isPiuSsid = (ssid: string | null | undefined) => !!ssid && /^piu\s*[·•\-:]\s*\S/i.test(ssid.trim());

// ── redes por perto (P3) ─────────────────────────────────

export interface ScannedNet { ssid: string; level: number; secure: boolean }

/** Barras de sinal (0–3) a partir do dBm. */
export const signalBars = (dbm: number) => (dbm >= -55 ? 3 : dbm >= -67 ? 2 : dbm >= -78 ? 1 : 0);

/** Lista de P3: sem a rede atual, sem nomes vazios, uma linha por nome (a mais forte), pontos Piu primeiro. */
export function nearbyList(list: ScannedNet[], current: string | null, max = 12): ScannedNet[] {
  const best = new Map<string, ScannedNet>();
  for (const n of list) {
    if (!n.ssid || !n.ssid.trim() || n.ssid === current) continue;
    const cur = best.get(n.ssid);
    if (!cur || n.level > cur.level) best.set(n.ssid, n);
  }
  return [...best.values()].sort((a, b) => Number(isPiuSsid(b.ssid)) - Number(isPiuSsid(a.ssid)) || b.level - a.level).slice(0, max);
}

// ── visitante (P8, P8n) ──────────────────────────────────

const DAY_MS = 86_400_000;

/** Uma notificação por ponto por dia (P8n). Devolve se avisa e o registro atualizado (só os últimos 2 dias). */
export function shouldNotifyPoint(log: Record<string, number>, key: string, now: number): { notify: boolean; log: Record<string, number> } {
  const kept: Record<string, number> = {};
  for (const [k, at] of Object.entries(log)) if (now - at < 2 * DAY_MS && Object.keys(kept).length < 64) kept[k] = at;
  const last = kept[key];
  if (last !== undefined && now - last < DAY_MS) return { notify: false, log: kept };
  return { notify: true, log: { ...kept, [key]: now } };
}

// ── painel (P7) ──────────────────────────────────────────

export interface PointStats {
  /** Dia (UTC) das contagens "hoje". */
  day: number;
  /** Vizinhos distintos vistos hoje: só resumos (hash curto com o dia), nunca os ids. Teto 5000. */
  seenToday: string[];
  /** Mensagens repassadas desde que o ponto ligou (soma das diferenças do contador diário do mensageiro). */
  relayed: number;
  /** Último valor do contador "repassadas hoje" do mensageiro e o dia dele. */
  relayedMark: { day: number; value: number };
}

export const emptyStats = (day: number): PointStats => ({ day, seenToday: [], relayed: 0, relayedMark: { day, value: 0 } });

/** Resumo de um id de vizinho para a contagem do dia (não liga dias diferentes). */
export function seenKey(id: string, day: number): string {
  let h = 0x811c9dc5 ^ day;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/** Junta uma leitura (vizinhos vistos agora e o contador do mensageiro) às contagens do ponto. */
export function accumulateStats(s: PointStats, o: { day: number; peerIds: string[]; relayedToday: number | null }): PointStats {
  let seen = s.day === o.day ? s.seenToday : [];
  const set = new Set(seen);
  for (const id of o.peerIds) { if (set.size >= 5000) break; set.add(seenKey(id, o.day)); }
  if (set.size !== seen.length) seen = [...set];
  let relayed = s.relayed, mark = s.relayedMark;
  if (o.relayedToday !== null) {
    const prev = mark.day === o.day ? mark.value : 0;
    relayed += Math.max(0, o.relayedToday - prev);
    mark = { day: o.day, value: Math.max(prev, o.relayedToday) };
  }
  return { day: o.day, seenToday: seen, relayed, relayedMark: mark };
}

/** Entregas comprovadas desde que o ponto ligou: créditos do roteador com prova, a partir de `since` (ms). */
export function proofsSince(credits: { at: number; state: string; proof?: string; sealed?: string[] }[], sinceMs: number): number {
  const since = sinceMs / 1000; // `Credit.at` é em segundos
  return credits.filter(c => c.at >= since && c.state !== 'rejeitado' && (!!c.proof || !!c.sealed?.length || c.state !== 'pendente')).length;
}

// ── estados do painel (P7a–c) ────────────────────────────

export type PointHealth = 'ok' | 'paused' | 'netDown' | 'isolating';

export interface IsolationSample {
  /** IPv4 do celular na rede do ponto (troca = outra rede, não é isolamento). */
  ip: string | null;
  /** Vizinhos LAN com enlace agora (endereços IP). */
  linked: string[];
  /** O roteador respondeu agora (porta 80/443 abriu ou recusou). */
  routerUp: boolean;
  /** Resultado de discar de novo para os vizinhos que sumiram (porta do LNNP). */
  redial: ProbeResult[];
}

/**
 * Começo de isolamento (P7c): na leitura anterior havia 2+ vizinhos com enlace; agora todos sumiram de
 * uma vez, na MESMA rede, com o roteador respondendo, e nenhum responde a uma discagem direta.
 * Um só vizinho saindo é gente indo embora; todos de uma vez, com o roteador vivo, é o roteador.
 */
export function isolationOnset(prev: IsolationSample | null, now: IsolationSample): boolean {
  if (!prev || !prev.ip || prev.ip !== now.ip) return false;
  if (prev.linked.length < 2 || now.linked.length > 0) return false;
  if (!now.routerUp) return false;
  return now.redial.length > 0 && now.redial.every(p => p !== 'open' && p !== 'refused');
}

/** Estado do painel. A rede do ponto caiu: Wi-Fi desconectado ou hotspot desligado pelo sistema. */
export function pointHealth(c: PointConfig, o: { wifiUp: boolean; hotspotUp: boolean; isolating: boolean }): PointHealth {
  if (c.paused) return 'paused';
  if (c.network.kind === 'hotspot' ? !o.hotspotUp : !o.wifiUp) return 'netDown';
  return o.isolating ? 'isolating' : 'ok';
}

// ── formatação ───────────────────────────────────────────

/** "AB12 CD34 EF56 7890": id do ponto para conferir no cartaz. */
export const groupId = (id: string) => id.toUpperCase().replace(/(.{4})(?=.)/g, '$1 ');
