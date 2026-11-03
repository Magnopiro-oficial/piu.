/**
 * Coletor de alertas oficiais em CAP 1.2: lê os feeds configurados (`PIU_ALERT_FEEDS`), segue os
 * links de cada item até o `<alert>` e guarda os vigentes em `<data>/alerts/alerts.json`.
 *
 * - Vigência: até o `expires` do alerta. Sem `expires` (o campo é opcional no CAP), vale por
 *   `NO_EXPIRES_MS` depois do `sent`, para não ficar para sempre.
 * - `Update` e `Cancel` tiram os alertas que eles referenciam (`references`); o `Cancel` não entra.
 * - Cada documento é lido com limite de tamanho e de tempo; links só `http(s)` e nunca para
 *   endereços locais (loopback, rede privada), mesmo que o feed mande.
 * - Origem explícita: cada alerta guarda o feed e o link de onde veio. Nada aqui confere assinatura
 *   do órgão; o app mostra que é retransmitido pelo nó.
 */
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { writeFileAtomic } from '../fsutil.js';
import { type CapAlert, feedLinks, parseFeed, readCap } from './cap.js';

export const DEFAULT_ALERT_FEEDS = ['http://alert-as.inmet.gov.br/cap_12/rss/alert-as.rss'];
export const DEFAULT_ALERT_POLL_MS = 10 * 60_000;
export const NO_EXPIRES_MS = 24 * 3600_000;
const MAX_FEED_BYTES = 2 * 1024 * 1024;
const MAX_CAP_BYTES = 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;
/** Itens lidos por feed a cada volta (os mais recentes vêm primeiro no RSS do INMET). */
const MAX_ITEMS_PER_FEED = 300;
const MAX_ALERTS = 1000;

export interface StoredAlert {
  /** Id estável no Piu: `sender` + `identifier`. */
  id: string;
  cap: CapAlert;
  source: { feed: string; url: string };
  receivedAt: number;
  /** Fim da vigência (ms). */
  until: number;
}
export interface FeedStatus { url: string; lastOkAt: number | null; lastError: string | null; items: number }

export interface AlertsView {
  enabled: boolean;
  feeds: FeedStatus[];
  alerts: (CapAlert & { id: string; source: { feed: string; url: string }; receivedAt: number })[];
}

type Fetch = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>;

export interface CollectorOptions {
  feeds: string[];
  pollMs?: number;
  /** `<data>/alerts/alerts.json`; `null` só em memória (testes). */
  file: string | null;
  fetch?: Fetch;
  now?: () => number;
  log?: (msg: string) => void;
}

export const alertId = (a: { sender: string; identifier: string }) => `${a.sender}|${a.identifier}`;

/** Endereço que um feed não pode mandar o nó buscar (a rede local dele). */
export function isLocalHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  const v = isIP(h);
  if (v === 4) {
    const [a = 0, b = 0] = h.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (v === 6) return h === '::' || h === '::1' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith('::ffff:');
  return false;
}

/** Link de item resolvido contra o feed; `null` se não for http(s) público. */
export function safeLink(link: string, base: string): string | null {
  try {
    const u = new URL(link, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password || isLocalHost(u.hostname)) return null;
    return u.toString();
  } catch { return null; }
}

/** Fim da vigência: o maior `expires`; sem nenhum, `sent` + 24 h. */
export function validUntil(a: CapAlert): number {
  const exp = Date.parse(a.info.expires);
  return Number.isFinite(exp) ? exp : Date.parse(a.sent) + NO_EXPIRES_MS;
}

/** Lê o corpo com teto de bytes (para no meio, sem carregar o resto). */
async function readLimited(r: Response, max: number): Promise<string> {
  const len = Number(r.headers.get('content-length') ?? 0);
  if (len > max) throw new Error('resposta grande demais');
  if (!r.body) return '';
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel().catch(() => {}); throw new Error('resposta grande demais'); }
    chunks.push(value);
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
}

export class AlertCollector {
  readonly feeds: string[];
  readonly pollMs: number;
  private alerts = new Map<string, StoredAlert>();
  /** Links já lidos (com o fim da vigência do que trouxeram), para não baixar de novo a cada volta. */
  private seen = new Map<string, number>();
  private status = new Map<string, FeedStatus>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;
  private fetch: Fetch;
  private now: () => number;

  constructor(private o: CollectorOptions) {
    this.feeds = o.feeds;
    this.pollMs = o.pollMs ?? DEFAULT_ALERT_POLL_MS;
    // Redirecionamentos seguidos à mão (cada destino passa por `safeLink`).
    this.fetch = o.fetch ?? ((url, init) => fetch(url, { ...init, redirect: 'manual' }));
    this.now = o.now ?? Date.now;
    for (const f of this.feeds) this.status.set(f, { url: f, lastOkAt: null, lastError: null, items: 0 });
    this.load();
  }

  private load() {
    if (!this.o.file) return;
    try {
      const j = JSON.parse(readFileSync(this.o.file, 'utf8')) as { alerts?: StoredAlert[]; seen?: [string, number][] };
      for (const a of j.alerts ?? []) if (a?.id && a.cap?.identifier && typeof a.until === 'number') this.alerts.set(a.id, a);
      for (const [k, v] of j.seen ?? []) if (typeof k === 'string' && typeof v === 'number') this.seen.set(k, v);
    } catch { /* primeira execução ou arquivo ilegível: começa vazio */ }
    this.prune();
  }

  private save() {
    if (!this.o.file) return;
    try {
      writeFileAtomic(this.o.file, JSON.stringify({ v: 1, alerts: [...this.alerts.values()], seen: [...this.seen] }));
    } catch (e) { this.o.log?.(`Alertas: não foi possível gravar (${(e as Error).message})`); }
  }

  /** Tira os vencidos (e os links lidos que já não trazem nada vigente). */
  private prune(): boolean {
    const t = this.now();
    let changed = false;
    for (const [k, a] of this.alerts) if (a.until <= t) { this.alerts.delete(k); changed = true; }
    for (const [k, until] of this.seen) if (until <= t) this.seen.delete(k);
    return changed;
  }

  private async get(url: string, max: number): Promise<string> {
    const headers = { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9', 'User-Agent': 'piu-node (alertas CAP)' };
    for (let hops = 0; hops <= 3; hops++) {
      const r = await this.fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers });
      const loc = r.status >= 300 && r.status < 400 ? r.headers.get('location') : null;
      if (loc) {
        const next = safeLink(loc, url);
        if (!next) throw new Error('redirecionamento recusado');
        url = next;
        continue;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return readLimited(r, max);
    }
    throw new Error('redirecionamentos demais');
  }

  /** Aplica um alerta lido: guarda, atualiza ou cancela. Devolve se mudou algo. */
  private apply(cap: CapAlert, source: StoredAlert['source']): boolean {
    let changed = false;
    if (cap.msgType !== 'Alert') {
      for (const ref of cap.references) if (this.alerts.delete(alertId(ref))) changed = true;
    }
    if (cap.msgType === 'Cancel') return changed;
    const until = validUntil(cap);
    if (!Number.isFinite(until) || until <= this.now()) return changed;
    const id = alertId(cap);
    const prev = this.alerts.get(id);
    this.alerts.set(id, { id, cap, source, receivedAt: prev?.receivedAt ?? this.now(), until });
    return true;
  }

  /** Uma volta por todos os feeds. Erros de um feed não param os outros. */
  async poll(): Promise<void> {
    this.running ??= this.doPoll().finally(() => { this.running = null; });
    return this.running;
  }

  private async doPoll() {
    let changed = this.prune();
    for (const feed of this.feeds) {
      const st = this.status.get(feed)!;
      try {
        const root = parseFeed(await this.get(feed, MAX_FEED_BYTES));
        // O próprio feed já é um alerta CAP (endpoint que devolve um `<alert>`).
        const direct = readCap(root);
        if (direct) changed = this.apply(direct, { feed, url: feed }) || changed;
        const links = feedLinks(root).slice(0, MAX_ITEMS_PER_FEED);
        let errors = 0;
        for (const raw of links) {
          const url = safeLink(raw, feed);
          if (!url || this.seen.has(url)) continue;
          try {
            const cap = readCap(parseFeed(await this.get(url, MAX_CAP_BYTES)));
            // Lido (mesmo que não seja alerta real): não baixa de novo até vencer.
            this.seen.set(url, cap ? Math.max(validUntil(cap), this.now() + this.pollMs) : this.now() + NO_EXPIRES_MS);
            if (cap) changed = this.apply(cap, { feed, url }) || changed;
          } catch { errors++; }
        }
        st.lastOkAt = this.now();
        st.lastError = errors ? `${errors} alerta(s) não puderam ser lidos` : null;
        st.items = links.length;
      } catch (e) {
        st.lastError = (e as Error).message || 'falha ao ler o feed';
        this.o.log?.(`Alertas: feed ${feed} falhou (${st.lastError})`);
      }
    }
    // Teto: ficam os que vencem por último.
    if (this.alerts.size > MAX_ALERTS) {
      const keep = [...this.alerts.values()].sort((a, b) => b.until - a.until).slice(0, MAX_ALERTS);
      this.alerts = new Map(keep.map(a => [a.id, a]));
    }
    if (this.seen.size > MAX_ALERTS * 4) this.seen = new Map([...this.seen].slice(-MAX_ALERTS * 4));
    if (changed) this.o.log?.(`Alertas: ${this.alerts.size} vigente(s)`);
    this.save();
  }

  /** Alertas vigentes agora, mais recentes primeiro, com a origem. */
  view(): AlertsView {
    const t = this.now();
    const alerts = [...this.alerts.values()].filter(a => a.until > t)
      .sort((a, b) => Date.parse(b.cap.sent) - Date.parse(a.cap.sent))
      .map(a => ({ ...a.cap, id: a.id, source: a.source, receivedAt: a.receivedAt }));
    return { enabled: true, feeds: [...this.status.values()].map(s => ({ ...s })), alerts };
  }

  start() {
    if (this.timer || !this.feeds.length) return;
    void this.poll().catch(() => {});
    this.timer = setInterval(() => { void this.poll().catch(() => {}); }, this.pollMs);
    this.timer.unref?.();
  }

  async close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running?.catch(() => {});
  }
}

export const alertsFile = (dataDir: string) => join(dataDir, 'alerts', 'alerts.json');
