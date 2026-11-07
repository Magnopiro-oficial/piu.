/**
 * Desktop como guardião de ponto Piu (Piu 12 · E4/E5): tipos e regras puras, usados pelo processo
 * principal (main/guardian/*) e pela interface (screens/Guardian.tsx). Documentação: docs/rede/guardiao-desktop.md.
 *
 * Níveis:
 * - `multiplier` (Multiplicador): faz os aparelhos da mesma rede se encontrarem e repassa na hora para quem
 *   está conectado; nada de terceiros fica guardado (buffer só em memória, alguns minutos, nunca no disco).
 * - `guardian` (Guardião): store-and-forward com limites: guarda envelopes cifrados de terceiros até o
 *   destinatário (ou outro nó) aparecer, com teto de espaço e de dias, gravados cifrados neste computador.
 * - `guardian-app` (Guardião + app): só com o APK do Piu baixado E conferido (assinatura + SHA-256) neste
 *   computador. Sem isso, o nível aparece desligado, com o motivo.
 * Gateway é um papel a mais (só com internet, desligado por padrão): envia à Lunes as transferências que
 * chegam pela malha e devolve o recibo, como o gateway do piu-node.
 */

import { fmtNumber, t } from './i18n';

export type GuardianLevel = 'multiplier' | 'guardian' | 'guardian-app';

/** Validade máxima de um envelope no protocolo (apps/mobile/src/protocol/envelope.ts `MAX_TTL_SEC`): guardar mais que isso não serve. */
export const MAX_GUARD_DAYS = 7;
/** Espaço (MB) e dias que o guardião oferece. O protótipo propôs 10 GB · 30 dias; o envelope vale no máximo 7 dias e o roteador guarda em memória. */
export const STORAGE_OPTIONS_MB = [256, 512, 1024] as const;
export const DAYS_OPTIONS = [1, 3, 7] as const;
export const DEFAULT_STORAGE_MB = 512;
export const DEFAULT_DAYS = 7;
/** Multiplicador: o que fica em trânsito, só em memória. */
export const MULTIPLIER_BUFFER_MB = 16;
export const MULTIPLIER_HOLD_SEC = 10 * 60;

export interface GuardianConfig {
  name: string;
  level: GuardianLevel;
  storageMB: number;
  days: number;
  /** Papel de gateway (só com internet). */
  gateway: boolean;
  /** Liga junto com o Piu (e com o computador, se "Abrir o Piu ao ligar o computador" estiver ligado). */
  autoStart: boolean;
}

/** Rede em que o computador está agora. `ssid`: nome do Wi-Fi (quando o sistema diz); `cidr`: a sub-rede. */
export interface GuardianNetwork {
  up: boolean;
  wired: boolean;
  ssid: string | null;
  iface: string | null;
  address: string | null;
  cidr: string | null;
  gateway: string | null;
  /** Como mostrar: o nome do Wi-Fi, ou "Rede local · 192.168.0.0/24". */
  label: string;
}

export type CheckLevel = 'ok' | 'warn' | 'fail';
export interface CheckStep { id: 'peers' | 'home' | 'internet' | 'capacity'; level: CheckLevel; label: string; detail: string }
/** Teste automático (E4): quatro etapas; `fail` em qualquer uma bloqueia "Continuar". */
export interface GuardianTest { network: GuardianNetwork; steps: CheckStep[]; at: number; internet: boolean; verdict: CheckLevel }

export interface GuardianStats {
  /** Aparelhos (nós LNNP) conectados agora e distintos hoje (só contagem; nenhum id fica na interface). */
  peersNow: number;
  peersToday: number;
  /** Envelopes de terceiros guardados agora e o espaço deles (bytes) diante do teto. */
  stored: number;
  storedBytes: number;
  maxBytes: number;
  /** Envelopes repassados a outros aparelhos (desde que o ponto foi criado) e recibos de repasse assinados. */
  forwarded: number;
  receipts: number;
  /** Bytes que passaram pelo ponto hoje (entrada + saída), só rede local. */
  bytesToday: number;
  /** Gateway: alcança a Lunes agora? `null` = papel desligado. Transferências enviadas desde que ligou. */
  gatewayOnline: boolean | null;
  gatewaySent: number;
}

export type GuardianStatus = 'off' | 'active' | 'paused' | 'down' | 'changed' | 'isolating';

export interface GuardianState {
  status: GuardianStatus;
  /** Há onde guardar a chave do ponto (cofre do sistema)? Sem cofre, não ativa. */
  canStore: boolean;
  point: null | (GuardianConfig & {
    /** Id curto do ponto (16 hex da chave própria do ponto, como os vizinhos LNNP o veem). */
    id: string;
    createdAt: number;
    /** Rede em que foi ativado. */
    network: { label: string; ssid: string | null; cidr: string | null };
    /** Senha da rede do ponto digitada pela pessoa (nunca lida do sistema): `set`/`open` e o conteúdo do QR. */
    wifi: { set: boolean; open: boolean };
    qr: string | null;
  });
  stats: GuardianStats | null;
  /** "Guardião + app": só com APK conferido neste computador. */
  apk: { available: boolean; reason: string };
  /** Motivo de `down` / `changed` / `isolating`, para a interface. */
  reason?: string;
}

/** Escapa `\ ; , : "` (formato WIFI: dos leitores de QR do Android/iOS). */
export const escapeWifi = (s: string) => s.replace(/([\\;,:"])/g, '\\$1');

/**
 * QR padrão de Wi-Fi ("WIFI:T:WPA;S:<rede>;P:<senha>;;"). Só com a senha que a PESSOA digitou (o Piu nunca lê
 * a senha guardada no sistema); rede aberta: `T:nopass`. Sem rede ou sem senha (e não aberta): `null`.
 */
export function wifiQr(ssid: string | null, wifi: { password: string | null; open: boolean }): string | null {
  if (!ssid || !ssid.trim()) return null;
  if (wifi.open) return `WIFI:T:nopass;S:${escapeWifi(ssid)};;`;
  if (!wifi.password) return null;
  return `WIFI:T:WPA;S:${escapeWifi(ssid)};P:${escapeWifi(wifi.password)};;`;
}

/** Senha WPA: 8 a 63 caracteres (ou 64 hex). */
export function wifiPasswordProblem(pw: string): string | null {
  if (typeof pw !== 'string') return t('guardian.wifi.invalid');
  if (/^[0-9a-fA-F]{64}$/.test(pw)) return null;
  if ([...pw].length < 8) return t('guardian.wifi.short');
  if ([...pw].length > 63) return t('guardian.wifi.long');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(pw)) return t('guardian.wifi.badChars');
  return null;
}

export const levelName = (l: GuardianLevel) => t(l === 'multiplier' ? 'guardian.level.multiplier' : l === 'guardian' ? 'guardian.level.guardian' : 'guardian.level.guardianApp');
export const fmtStorage = (mb: number) => (mb >= 1024 ? `${fmtNumber(mb / 1024, { maximumFractionDigits: 1 })} GB` : `${mb} MB`);
/** "1 dia" / "7 dias". */
export const fmtDays = (days: number) => t('guardian.days', { count: days });
/** "Guardião · 512 MB · 7 dias" / "Multiplicador · nada guardado". */
export function levelSummary(c: Pick<GuardianConfig, 'level' | 'storageMB' | 'days'>) {
  if (c.level === 'multiplier') return t('guardian.summary.multiplier');
  return t('guardian.summary.level', { level: levelName(c.level), storage: fmtStorage(c.storageMB), days: fmtDays(c.days) });
}

/** Confere a configuração vinda da interface (só valores conhecidos). */
export function sanitizeGuardianConfig(raw: unknown, base?: GuardianConfig): GuardianConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Configuração inválida.');
  const r = raw as Record<string, unknown>;
  const allowed = new Set(['name', 'level', 'storageMB', 'days', 'gateway', 'autoStart']);
  for (const k of Object.keys(r)) if (!allowed.has(k)) throw new Error(`Campo inválido: ${k}`);
  const pick = <T>(k: string, ok: (v: unknown) => boolean, def: T | undefined): T => {
    if (r[k] === undefined) { if (def === undefined) throw new Error(`Falta: ${k}`); return def; }
    if (!ok(r[k])) throw new Error(`Valor inválido: ${k}`);
    return r[k] as T;
  };
  const name = pick<string>('name', v => typeof v === 'string' && v.trim().length >= 1 && v.length <= 60, base?.name).trim().replace(/\s+/g, ' ').slice(0, 40);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f<>]/.test(name)) throw new Error('Valor inválido: name');
  return {
    name,
    level: pick<GuardianLevel>('level', v => v === 'multiplier' || v === 'guardian' || v === 'guardian-app', base?.level),
    storageMB: pick<number>('storageMB', v => (STORAGE_OPTIONS_MB as readonly unknown[]).includes(v), base?.storageMB ?? DEFAULT_STORAGE_MB),
    days: pick<number>('days', v => (DAYS_OPTIONS as readonly unknown[]).includes(v), base?.days ?? DEFAULT_DAYS),
    gateway: pick<boolean>('gateway', v => typeof v === 'boolean', base?.gateway ?? false),
    autoStart: pick<boolean>('autoStart', v => typeof v === 'boolean', base?.autoStart ?? true),
  };
}
