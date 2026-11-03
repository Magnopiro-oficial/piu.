/**
 * Cliente da API local do piu-node (apps/piu-node).
 * - Sessão em cookie HttpOnly (o painel nunca vê o token).
 * - Toda mudança de estado leva o token CSRF da sessão (X-CSRF-Token).
 * - 401 → a sessão acabou: o painel volta para o pareamento.
 * - 403 com `reauth` → operação sensível: pedir um código novo do equipamento (step-up).
 * Nada de dado sensível em log: o painel não usa console.
 */
export interface Operator { id: string; name: string }
/** `self`: o nó que serve o painel (com estatísticas reais); os outros são registros do assistente. */
export interface ApiDevice { id: string; name: string; cls: string; status: 'active' | 'paused'; self: boolean; pub?: string }
/** `kind` ausente (versões antigas) = saída. Entrada (`in`) é liquidação recebida, com o lote em `from`. */
export interface ApiWalletTx { id: string; amount: number; at: number; to: string; kind?: 'in' | 'out'; from?: string }
export interface ApiWallet { balance: number; txs: ApiWalletTx[] }

/** Contadores do motor (os mesmos nomes de `GET /api/relay`). */
export interface ApiTotals { received: number; stored: number; forwarded: number; duplicates: number; rejected: number; relayOff: number; full: number; expired: number; receipts: number; receiptsReceived: number }
export interface ApiNeighbor { id: string; address: string; link: string; inbound: boolean; since: number; version: number; relay: boolean; mtu: number; media: string[] }
export interface ApiSerial { label: string; kind: 'lora' | 'usb'; packetsSent: number; packetsReceived: number; retries: number; lost: number; dutyPercent?: number; dutyUsedPercent?: number }
/** `GET /api/relay`. Com o motor desligado: `{ enabled: false }`. */
export type ApiRelay = { enabled: false } | {
  enabled: true; relayMode: boolean; relaying: boolean; paused?: boolean; startedAt?: number;
  lnnp: { version: number; minVersion: number }; node: string; neighbors: ApiNeighbor[];
  store: { envelopes: number; bytes: number; maxBytes: number; seen: number };
  counters: ApiTotals & { delivered: number; handshakesOk: number; handshakesFailed: number };
  limits: { bwMbps: number; stoGB: number; hours: string; media: boolean };
  lan?: { port: number; discoveryPort: number | null }; serial?: ApiSerial[];
};
export interface ApiSample extends ApiTotals { at: number; neighbors: number; storedBytes: number }
export interface ApiDay extends ApiTotals { day: string }
/** `GET /api/relay/history`: amostras de 24 h, totais por dia (hoje já em tempo real) e o que ainda não virou amostra. */
export type ApiHistory = { enabled: false } | { enabled: true; sampleMs: number; today: string; samples: ApiSample[]; days: ApiDay[]; unsampled: ApiTotals };
/** `GET /api/relay/receipts`: recibos guardados para o validador (só horário e se são deste nó). */
export type ApiReceipts = { enabled: false } | { enabled: true; kept: number; keptOwn: number; max: number; recent: { at: number; own: boolean }[] };
export interface ApiSession { id: string; label: string; createdAt: number; lastSeen: number; current: boolean }
export interface ApiSettings { limits: { bw: 20 | 50 | 100; sto: 4 | 8 | 16; hours: 'always' | 'night' | 'day' }; policies: { media: boolean; unknown: boolean; community: boolean } }
export interface ApiPending { id: string; request: string; code: string; phone: string; expiresAt: number }
export interface ApiPhone { id: string; name: string; addedAt: number; confirmed: boolean }
export interface ApiPackage { name: string; version: string; file: string; size: number; sha256: string }

export class AuthLost extends Error {}
export class NeedsReauth extends Error {}
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Mensagem do servidor (já genérica) ou uma neutra. */
async function errorOf(r: Response) {
  try { return ((await r.json()) as { error?: string }).error ?? 'Não foi possível concluir.'; } catch { return 'Não foi possível concluir.'; }
}

const isJson = (r: Response) => (r.headers.get('content-type') ?? '').includes('application/json');

/** O painel está sendo servido por um piu-node? `pair` = precisa parear; `demo` = estático (site, prévia). */
export async function detectNode(): Promise<{ kind: 'demo' } | { kind: 'pair' } | { kind: 'node'; operator: Operator; csrf: string }> {
  // Embutido no site (iframe): é sempre a demonstração; nem consulta a API.
  if (window.self !== window.top) return { kind: 'demo' };
  try {
    const r = await fetch('/api/session', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (r.status === 401 && isJson(r)) return { kind: 'pair' };
    if (r.ok && isJson(r)) {
      const s = (await r.json()) as { operator: Operator; csrf: string };
      return { kind: 'node', operator: s.operator, csrf: s.csrf };
    }
  } catch { /* sem servidor: versão estática */ }
  return { kind: 'demo' };
}

export async function pair(code: string, name: string): Promise<{ operator: Operator; csrf: string }> {
  const r = await fetch('/api/pair', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ code, name }),
  });
  if (!r.ok) throw new ApiError(r.status, await errorOf(r));
  return (await r.json()) as { operator: Operator; csrf: string };
}

export class NodeApi {
  constructor(private csrf: string) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const mutating = method !== 'GET';
    const r = await fetch(path, {
      method, credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(mutating ? { 'X-CSRF-Token': this.csrf } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (r.status === 401) throw new AuthLost();
    if (r.status === 403 && isJson(r)) {
      const j = (await r.json()) as { error?: string; reauth?: boolean };
      if (j.reauth) throw new NeedsReauth(j.error);
      throw new ApiError(403, j.error ?? 'Não permitido.');
    }
    if (!r.ok) throw new ApiError(r.status, await errorOf(r));
    return r.status === 204 ? (undefined as T) : ((await r.json()) as T);
  }

  devices = () => this.call<ApiDevice[]>('GET', '/api/devices');
  togglePause = (id: string) => this.call<{ id: string; status: 'active' | 'paused' }>('POST', `/api/devices/${encodeURIComponent(id)}/pause`);
  revoke = (id: string) => this.call<void>('DELETE', `/api/devices/${encodeURIComponent(id)}`);
  wallet = () => this.call<ApiWallet>('GET', '/api/wallet');
  /** `to`: 'personal' ou um endereço `lunes:…`. */
  /** Com celular pareado, devolve `pending` (aprovar no celular); sem celular, executa na hora. */
  transfer = (amount: number, to = 'personal') => this.call<{ id: string } | { pending: ApiPending }>('POST', '/api/wallet/transfer', { amount, to });
  approveTransfer = (id: string, approval: string) => this.call<{ id: string }>('POST', `/api/wallet/transfer/${encodeURIComponent(id)}/approve`, { approval });
  phones = () => this.call<ApiPhone[]>('GET', '/api/phones');
  startPhonePairing = (name: string) => this.call<{ id: string; qr: string; expiresAt: number }>('POST', '/api/phones', { name });
  confirmPhone = (id: string, code: string) => this.call<ApiPhone>('POST', `/api/phones/${encodeURIComponent(id)}/confirm`, { code });
  removePhone = (id: string) => this.call<void>('DELETE', `/api/phones/${encodeURIComponent(id)}`);
  createDevice = (d: { name: string; cls: string; family: string; pub?: string }) => this.call<ApiDevice>('POST', '/api/devices', d);
  settings = () => this.call<ApiSettings>('GET', '/api/settings');
  saveSettings = (s: ApiSettings) => this.call<ApiSettings>('PUT', '/api/settings', s);
  sessions = () => this.call<ApiSession[]>('GET', '/api/sessions');
  revokeOtherSessions = () => this.call<{ revoked: number }>('POST', '/api/sessions/revoke-others');
  reauth = (code: string) => this.call<{ ok: true }>('POST', '/api/reauth', { code });
  packages = () => this.call<ApiPackage[]>('GET', '/api/packages');
  relay = () => this.call<ApiRelay>('GET', '/api/relay');
  history = () => this.call<ApiHistory>('GET', '/api/relay/history');
  receipts = () => this.call<ApiReceipts>('GET', '/api/relay/receipts');
  logout = () => this.call<{ ok: true }>('POST', '/api/logout');
}
