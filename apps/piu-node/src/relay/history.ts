/**
 * Histórico das estatísticas de retransmissão, para os gráficos do painel (Visão geral, Ganhos).
 *
 * O motor só tem contadores desde que o processo subiu. Aqui, a cada rodada (padrão: 5 min), a
 * diferença dos contadores vira uma amostra, e as amostras se somam por dia (hora local do
 * equipamento). Fica em `<data>/relay-history.json` (0600, gravação atômica), com limite de tamanho:
 * 24 h de amostras e 120 dias de totais. Nada de conteúdo, destino, chave ou id de envelope: só
 * contagens.
 *
 * Os recibos contados são os assinados por este nó (um por envelope de terceiro). Valor em LUNES não
 * existe aqui: depende do validador e da liquidação na Mainnet.
 */
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Counters } from './engine.js';

/** Contadores guardados no histórico (os que viram gráfico ou tabela no painel). */
export const HISTORY_FIELDS = ['received', 'stored', 'forwarded', 'duplicates', 'rejected', 'relayOff', 'full', 'expired', 'receipts', 'receiptsReceived'] as const;
export type HistoryField = (typeof HISTORY_FIELDS)[number];
export type Totals = Record<HistoryField, number>;

/** Uma rodada: o que aconteceu desde a anterior, mais o estado no fim dela. */
export interface Sample extends Totals { at: number; neighbors: number; storedBytes: number }
/** Totais de um dia (`AAAA-MM-DD`, hora local). */
export interface Day extends Totals { day: string }

export const SAMPLE_MS = 5 * 60_000;
export const MAX_DAYS = 120;
const SAMPLE_WINDOW_MS = 24 * 3_600_000;
/** Teto de amostras mesmo com rodadas curtas (testes, `PIU_RELAY_SAMPLE_MS` baixo). */
const MAX_SAMPLES = 2_000;

const zero = (): Totals => Object.fromEntries(HISTORY_FIELDS.map(k => [k, 0])) as Totals;
const pad = (n: number) => String(n).padStart(2, '0');
/** Dia local do equipamento (o mesmo relógio do horário de operação). */
export const dayKey = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
/** Lê só o que tem o formato esperado: arquivo corrompido ou editado à mão não derruba o nó. */
function clean<T extends object>(raw: unknown, extra: (r: Record<string, unknown>) => T | null): (T & Totals) | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const t = zero();
  for (const k of HISTORY_FIELDS) { const v = r[k]; t[k] = isCount(v) ? Math.floor(v) : 0; }
  const e = extra(r);
  return e ? { ...t, ...e } : null;
}

export class RelayHistory {
  private samples: Sample[] = [];
  private days: Day[] = [];
  /** Contadores na rodada anterior (só em memória: o motor zera os dele ao reiniciar). */
  private last: Totals | null = null;

  constructor(private file: string | null, private now: () => number = Date.now) {
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as { samples?: unknown[]; days?: unknown[] };
      this.samples = (raw.samples ?? []).map(s => clean(s, r => (isCount(r.at) ? { at: r.at, neighbors: isCount(r.neighbors) ? r.neighbors : 0, storedBytes: isCount(r.storedBytes) ? r.storedBytes : 0 } : null))).filter((s): s is Sample => !!s);
      this.days = (raw.days ?? []).map(d => clean(d, r => (typeof r.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.day) ? { day: r.day } : null))).filter((d): d is Day => !!d);
    } catch { /* primeira execução ou arquivo ilegível: começa vazio */ }
    this.trim();
  }

  /**
   * Fecha uma rodada com os contadores atuais do motor. Os contadores começam em zero quando o
   * processo sobe, então a primeira rodada conta tudo desde a subida (nada é contado duas vezes).
   */
  record(c: Counters, state: { neighbors: number; storedBytes: number }) {
    const now = this.now();
    const cur = zero();
    for (const k of HISTORY_FIELDS) cur[k] = c[k];
    const prev = this.last ?? zero();
    const delta = zero();
    // Contador menor que o anterior: o motor reiniciou; conta o valor atual inteiro.
    for (const k of HISTORY_FIELDS) delta[k] = cur[k] >= prev[k] ? cur[k] - prev[k] : cur[k];
    this.last = cur;
    this.samples.push({ at: now, ...delta, ...state });
    const key = dayKey(now);
    let day = this.days.find(d => d.day === key);
    if (!day) { day = { day: key, ...zero() }; this.days.push(day); this.days.sort((a, b) => a.day.localeCompare(b.day)); }
    for (const k of HISTORY_FIELDS) day[k] += delta[k];
    this.trim();
    this.save();
  }

  private trim() {
    const since = this.now() - SAMPLE_WINDOW_MS;
    this.samples = this.samples.filter(s => s.at >= since).slice(-MAX_SAMPLES);
    this.days = this.days.slice(-MAX_DAYS);
  }

  private save() {
    if (!this.file) return;
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, JSON.stringify({ samples: this.samples, days: this.days }), { mode: 0o600 });
    renameSync(tmp, this.file);
    chmodSync(this.file, 0o600);
  }

  /** Para `GET /api/relay/history`: amostras das últimas 24 h e totais por dia (do mais antigo ao mais novo). */
  view(sampleMs: number) {
    return { sampleMs, samples: this.samples.map(s => ({ ...s })), days: this.days.map(d => ({ ...d })) };
  }
}
