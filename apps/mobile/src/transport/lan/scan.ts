/**
 * Varredura leve da sub-rede (descoberta, último recurso): só quando o anúncio UDP e o mDNS não
 * acharam ninguém por um tempo, só em /24 ou menor, uma discagem por vez num ritmo fixo, na porta fixa
 * do LNNP, e no máximo uma varredura a cada `cooldownMs`. Desligada com bateria baixa.
 */
import { SCAN_MIN_PREFIX } from './addr';

export interface ScanPolicy {
  /** Sem ninguém pelo anúncio nem pelo mDNS por este tempo (desde que o LAN ligou) → pode varrer. */
  afterMs: number;
  /** Intervalo entre duas discagens da varredura (254 endereços a 400 ms ≈ 100 s). */
  intervalMs: number;
  /** Espera mínima entre duas varreduras completas. */
  cooldownMs: number;
  /** Prazo de cada tentativa (sem resposta = ninguém nesse endereço). */
  dialTimeoutMs: number;
  /** Teto de endereços por varredura. */
  maxHosts: number;
}

export const DEFAULT_SCAN: ScanPolicy = { afterMs: 3 * 60_000, intervalMs: 400, cooldownMs: 30 * 60_000, dialTimeoutMs: 1500, maxHosts: 254 };

export interface ScanInputs {
  now: number;
  /** Quando o transporte LAN começou nesta rede Wi-Fi. */
  startedAt: number;
  /** Último vizinho visto pelo anúncio UDP ou pelo mDNS (ou enlace aberto); `null` = nenhum. */
  lastSeenAt: number | null;
  /** Fim da última varredura. */
  lastScanAt: number | null;
  prefix: number | null;
  lowPower: boolean;
  /** Já varrendo. */
  scanning: boolean;
}

/** Decide se uma varredura automática começa agora. */
export function shouldScan(s: ScanInputs, p: ScanPolicy = DEFAULT_SCAN): boolean {
  if (s.scanning || s.lowPower) return false;
  if (s.prefix === null || s.prefix < SCAN_MIN_PREFIX) return false;
  if (s.lastSeenAt !== null) return false;
  if (s.now - s.startedAt < p.afterMs) return false;
  return s.lastScanAt === null || s.now - s.lastScanAt >= p.cooldownMs;
}
