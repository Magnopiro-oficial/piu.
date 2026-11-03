/**
 * Cliente da API local do piu-node pareado (apps/piu-node/src/app.ts), em TypeScript puro e testado.
 *
 * - Transporte: HTTPS com o certificado autoassinado do nó FIXADO pela impressão digital SHA-256
 *   (a mesma que o console e o painel mostram). Quem faz a conexão é o módulo nativo
 *   `piu-node-link` (lib/nodeLink.ts); aqui só entra a função `send`, injetável nos testes.
 * - Sessão: a mesma do navegador. O operador digita no celular o código de 8 dígitos do
 *   equipamento (`POST /api/pair`, prova de acesso físico), com o nome do operador que veio no QR,
 *   e a sessão fica com a mesma conta. O cookie `__Host-piu_session` e o token CSRF ficam
 *   guardados cifrados (lib/persist.ts).
 * - Mesma origem: o nó recusa mudanças sem `Origin` igual ao endereço dele; o app manda o cabeçalho
 *   como o navegador faria.
 */
export const SESSION_COOKIE = '__Host-piu_session';
/** Porta padrão do piu-node (PIU_NODE_PORT), quando o QR não traz o endereço completo. */
export const DEFAULT_NODE_PORT = 8420;

export interface NodeRequest { method: 'GET' | 'POST'; url: string; headers: Record<string, string>; body?: string; pin: string }
export interface NodeResponse { status: number; headers: Record<string, string>; body: string }
export type NodeSend = (r: NodeRequest) => Promise<NodeResponse>;
export interface NodeSession { token: string; csrf: string; at: number }

/** Impressão digital como o Node mostra (`AA:BB:…`, 32 bytes) ou em hex corrido. Devolve `AA:BB:…` ou null. */
export function normalizePin(f: unknown): string | null {
  if (typeof f !== 'string') return null;
  const hex = f.replace(/[:\s]/g, '').toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(hex)) return null;
  return hex.match(/../g)!.join(':');
}

/** Endereço base do nó: `u` do QR (https://host:porta) ou o nome `n` com a porta padrão. */
export function nodeBaseUrl(o: { url?: string; node: string }): string | null {
  const raw = o.url ?? `https://${o.node.includes(':') ? o.node : `${o.node}:${DEFAULT_NODE_PORT}`}`;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.pathname !== '/' || u.search || u.hash || u.username || u.password) return null;
    return `https://${u.host}`;
  } catch { return null; }
}

/** Erro com a mensagem que o nó mandou (já em português) e o código HTTP. */
export class NodeApiError extends Error {
  constructor(readonly status: number, message: string, readonly reauth = false) { super(message); }
}

/** Estatísticas do motor (`GET /api/relay`), só os campos que o app mostra. */
export interface RelayView {
  enabled: boolean; relaying?: boolean; paused?: boolean; relayMode?: boolean;
  neighbors?: { id: string; link: string }[];
  store?: { envelopes: number; bytes: number; maxBytes: number };
  counters?: { received: number; stored: number; forwarded: number; delivered: number; duplicates: number; rejected: number; receipts: number };
}
export interface ReceiptsView { enabled: boolean; kept?: number; keptOwn?: number; recent?: { at: number; own: boolean }[] }
export interface DeviceView { id: string; name: string; cls: string; status: 'active' | 'paused' | string; self: boolean }

export class NodeApi {
  constructor(private o: { base: string; pin: string; operator: string; send: NodeSend; session?: NodeSession | null }) {}

  get session() { return this.o.session ?? null; }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown, mutating = method !== 'GET'): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    // Mesma origem (o nó confere o Origin em toda mudança e no pareamento).
    if (mutating) headers.Origin = this.o.base;
    const s = this.o.session;
    if (s) headers.Cookie = `${SESSION_COOKIE}=${s.token}`;
    if (s && mutating) headers['X-CSRF-Token'] = s.csrf;
    const r = await this.o.send({ method, url: this.o.base + path, headers, body: body === undefined ? undefined : JSON.stringify(body), pin: this.o.pin });
    let j: Record<string, unknown> = {};
    try { j = r.body ? JSON.parse(r.body) : {}; } catch { /* corpo vazio ou não-JSON */ }
    if (r.status === 401) this.o.session = null;
    if (r.status >= 400) throw new NodeApiError(r.status, typeof j.error === 'string' ? j.error : `O equipamento respondeu ${r.status}.`, j.reauth === true);
    return j as T;
  }

  /** Sessão nova com o código de 8 dígitos do equipamento. Devolve a sessão para guardar. */
  async pair(code: string): Promise<NodeSession> {
    if (!/^[0-9]{8}$/.test(code)) throw new NodeApiError(400, 'O código do equipamento tem 8 dígitos.');
    this.o.session = null;
    const name = this.o.operator.trim().slice(0, 40) || 'Celular';
    const body = JSON.stringify({ code, name });
    const r = await this.o.send({ method: 'POST', url: this.o.base + '/api/pair', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: this.o.base }, body, pin: this.o.pin });
    let j: { csrf?: unknown; error?: unknown } = {};
    try { j = JSON.parse(r.body); } catch { /* */ }
    if (r.status >= 400) throw new NodeApiError(r.status, typeof j.error === 'string' ? j.error : 'Não foi possível parear.');
    const token = cookieValue(r.headers, SESSION_COOKIE);
    if (!token || typeof j.csrf !== 'string') throw new NodeApiError(502, 'O equipamento não abriu a sessão.');
    this.o.session = { token, csrf: j.csrf, at: Date.now() };
    return this.o.session;
  }

  relay() { return this.call<RelayView>('GET', '/api/relay'); }
  receipts() { return this.call<ReceiptsView>('GET', '/api/relay/receipts'); }
  devices() { return this.call<DeviceView[]>('GET', '/api/devices'); }
  /** Pausa ou retoma a retransmissão do equipamento (o nó alterna). */
  togglePause(deviceId: string) { return this.call<{ id: string; status: string }>('POST', `/api/devices/${encodeURIComponent(deviceId)}/pause`, {}); }
  async logout() { try { await this.call('POST', '/api/logout', {}); } finally { this.o.session = null; } }
}

/** Valor de um cookie no `Set-Cookie` (os nomes de cabeçalho chegam em qualquer caixa). */
export function cookieValue(headers: Record<string, string>, name: string): string | null {
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() !== 'set-cookie') continue;
    for (const part of v.split(/,(?=\s*[^;,=\s]+=)/)) {
      const m = part.trim().match(/^([^=;\s]+)=([^;]*)/);
      if (m && m[1] === name && m[2]) return m[2];
    }
  }
  return null;
}
