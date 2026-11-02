/**
 * Cliente da API local do piu-node (apps/piu-node).
 * - Sessão em cookie HttpOnly (o painel nunca vê o token).
 * - Toda mudança de estado leva o token CSRF da sessão (X-CSRF-Token).
 * - 401 → a sessão acabou: o painel volta para o pareamento.
 * - 403 com `reauth` → operação sensível: pedir um código novo do equipamento (step-up).
 * Nada de dado sensível em log: o painel não usa console.
 */
export interface Operator { id: string; name: string }
export interface ApiDevice { id: string; name: string; cls: string; status: 'active' | 'paused'; today: number }
export interface ApiWallet { balance: number; txs: { id: string; amount: number; at: number; to: 'personal' }[] }
export interface ApiSession { id: string; label: string; createdAt: number; lastSeen: number; current: boolean }
export interface ApiSettings { limits: { bw: 20 | 50 | 100; sto: 4 | 8 | 16; hours: 'always' | 'night' | 'day' }; policies: { media: boolean; unknown: boolean; community: boolean } }
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
  transfer = (amount: number, to = 'personal') => this.call<{ id: string }>('POST', '/api/wallet/transfer', { amount, to });
  createDevice = (d: { name: string; cls: string; family: string; pub?: string }) => this.call<ApiDevice>('POST', '/api/devices', d);
  settings = () => this.call<ApiSettings>('GET', '/api/settings');
  saveSettings = (s: ApiSettings) => this.call<ApiSettings>('PUT', '/api/settings', s);
  sessions = () => this.call<ApiSession[]>('GET', '/api/sessions');
  revokeOtherSessions = () => this.call<{ revoked: number }>('POST', '/api/sessions/revoke-others');
  reauth = (code: string) => this.call<{ ok: true }>('POST', '/api/reauth', { code });
  packages = () => this.call<ApiPackage[]>('GET', '/api/packages');
  logout = () => this.call<{ ok: true }>('POST', '/api/logout');
}
