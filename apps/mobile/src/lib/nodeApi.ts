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

/** Métodos que a API do nó usa (o módulo nativo aceita qualquer um). */
export type NodeMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
export interface NodeRequest { method: NodeMethod; url: string; headers: Record<string, string>; body?: string; pin: string }
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
  /** `confirmCode`: 6 dígitos derivados do handshake do enlace, iguais no painel do outro nó. */
  neighbors?: { id: string; pk?: string; link: string; address?: string; confirmCode?: string | null }[];
  store?: { envelopes: number; bytes: number; maxBytes: number };
  counters?: { received: number; stored: number; forwarded: number; delivered: number; duplicates: number; rejected: number; receipts: number };
}
export interface ReceiptsView { enabled: boolean; kept?: number; keptOwn?: number; recent?: { at: number; own: boolean }[] }
/** Alerta oficial CAP 1.2 como o nó devolve em `GET /api/alerts` (apps/piu-node/src/alerts). */
export interface NodeAlert {
  id: string; identifier: string; sender: string; sent: string; msgType: 'Alert' | 'Update' | 'Cancel';
  info: {
    language: string; senderName: string; event: string; severity: 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
    urgency: string; certainty: string; headline: string; description: string; instruction: string; web: string;
    effective: string; onset: string; expires: string;
    areas: { areaDesc: string; geocodes: { valueName: string; value: string }[] }[];
  };
  /** De onde o nó leu: o feed configurado e o link do documento CAP. */
  source: { feed: string; url: string };
  receivedAt: number;
}
export interface AlertsResponse { enabled: boolean; feeds?: { url: string; lastOkAt: number | null; lastError: string | null }[]; alerts?: NodeAlert[] }
/** Regras do equipamento (as mesmas opções do assistente do painel): banda, armazenamento e horário. */
export interface DeviceLimits { bw: 5 | 20 | 50; sto: 1 | 4 | 8; hours: 'always' | 'night' | 'day' }
/**
 * `self`: o nó que responde. `nodeId`: identidade técnica (16 hex) quando o equipamento tem uma;
 * `link`: enlace LNNP real com ele, visto deste nó.
 */
export interface DeviceView {
  id: string; name: string; cls: string; status: 'active' | 'paused' | string; self: boolean;
  pub?: string; nodeId?: string; signed?: boolean; limits?: DeviceLimits;
  link?: { online: boolean; lastSeen: number | null; address: string | null };
}
/** Resultado de `DELETE /api/devices/:id`: com identidade técnica, a chave entra na lista de revogação. */
export interface RevokeResult { revoked: boolean; appliedHere: boolean }
/** Vizinho fixo do enlace (`host:porta`), da configuração do nó (PIU_LNNP_PEERS) ou adicionado pelo painel/celular. */
export interface PeerView {
  address: string; source: 'config' | 'panel'; state: 'connecting' | 'connected' | 'failed';
  error: string | null; errorAt: number | null; nodeId: string | null; pk: string | null; since: number | null; attempts: number;
}
export interface PeersView { enabled: boolean; max?: number; peers: PeerView[] }
/** `GET /api/payout-claims`: épocas que dá para declarar (esta semana e a próxima) e as já declaradas. */
export interface ClaimsView { enabled: boolean; epochs: string[]; claims: { epoch: string; address: string; at: number }[] }
/** `GET /api/wallet`: saldo do nó (créditos de liquidação recebidos menos transferências). `kind: 'in'` = lote liquidado. */
export interface NodeWalletTx { id: string; amount: number; at: number; to: string; kind?: 'in' | 'out'; from?: string }
export interface NodeWalletView { balance: number; txs: NodeWalletTx[] }
/** Leitura on-chain que o nó fez (planck em texto; 1 LUNES = 10^8 planck). */
export interface LunesReading { address: string; exists: boolean; free: string; reserved: string; frozen: string; block: number; blockHash: string; endpoint: string; at: number }
/** `GET /api/wallet/lunes`: carteira de provider na Lunes Mainnet (o nó só lê; não tem a chave). */
export interface LunesWalletView { address: string | null; setAt: number | null; explorer: string; endpoints: string[]; onchain: LunesReading | null; error: string | null; cached: boolean }

export class NodeApi {
  constructor(private o: { base: string; pin: string; operator: string; send: NodeSend; session?: NodeSession | null }) {}

  get session() { return this.o.session ?? null; }

  private async call<T>(method: NodeMethod, path: string, body?: unknown, mutating = method !== 'GET', keepOn401 = false): Promise<T> {
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
    if (r.status === 401 && !keepOn401) this.o.session = null;
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
  /** Alertas oficiais vigentes que o nó leu dos feeds CAP (retransmitidos, sem assinatura do órgão). */
  alerts() { return this.call<AlertsResponse>('GET', '/api/alerts'); }
  /** Pausa ou retoma a retransmissão do equipamento (o nó alterna). */
  togglePause(deviceId: string) { return this.call<{ id: string; status: string }>('POST', `/api/devices/${encodeURIComponent(deviceId)}/pause`, {}); }
  /**
   * Step-up: confirma a sessão com um código NOVO do equipamento (`POST /api/reauth`). Vale por alguns
   * minutos para as operações sensíveis (carteira de provider, declaração do lote), que respondem 403
   * com `reauth` sem ele.
   */
  async reauth(code: string): Promise<void> {
    if (!/^[0-9]{8}$/.test(code)) throw new NodeApiError(400, 'O código do equipamento tem 8 dígitos.');
    // 401 aqui é, em geral, código errado ou vencido: a sessão continua (se tiver acabado, a próxima chamada diz).
    await this.call<{ ok: true }>('POST', '/api/reauth', { code }, true, true);
  }
  /** Regras do equipamento; `null` limpa. No próprio nó valem no motor na hora; nos outros ficam registradas. */
  setLimits(deviceId: string, limits: DeviceLimits | null) { return this.call<DeviceView>('PUT', `/api/devices/${encodeURIComponent(deviceId)}/limits`, limits ?? { clear: true }); }
  /** Revoga um equipamento (não o próprio nó: o nó recusa com 409). Sem identidade técnica (204): só sai da lista. */
  async revoke(deviceId: string): Promise<RevokeResult> {
    const j = await this.call<Partial<RevokeResult>>('DELETE', `/api/devices/${encodeURIComponent(deviceId)}`);
    return { revoked: j.revoked === true, appliedHere: j.appliedHere === true };
  }
  /** Vizinhos por endereço (`host:porta`) com o estado de cada um. */
  peers() { return this.call<PeersView>('GET', '/api/relay/peers'); }
  /** Adiciona um vizinho por endereço; o nó espera o handshake (até ~6 s) e devolve o estado. */
  addPeer(address: string) { return this.call<{ peer: PeerView | null }>('POST', '/api/relay/peers', { address: address.trim() }); }
  removePeer(address: string) { return this.call<Record<string, never>>('DELETE', `/api/relay/peers/${encodeURIComponent(address)}`); }
  /** Saldo do nó (liquidações recebidas) e movimentações. */
  wallet() { return this.call<NodeWalletView>('GET', '/api/wallet'); }
  lunesWallet() { return this.call<LunesWalletView>('GET', '/api/wallet/lunes'); }
  /** Exige step-up; endereço inválido: 400 com o motivo (o nó confere o SS58). */
  setLunesAddress(address: string) { return this.call<{ address: string; setAt: number }>('PUT', '/api/wallet/lunes', { address: address.trim() }); }
  clearLunesAddress() { return this.call<Record<string, never>>('DELETE', '/api/wallet/lunes'); }
  claims() { return this.call<ClaimsView>('GET', '/api/payout-claims'); }
  /** O nó assina a carteira que recebe o lote (`PayoutClaim`). Só o dono; exige step-up. */
  declareClaim(epoch: string, address: string) { return this.call<ClaimsView>('POST', '/api/payout-claims', { epoch, address: address.trim() }); }
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
