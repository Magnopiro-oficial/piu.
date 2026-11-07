/**
 * Cliente da API local do piu-node (apps/piu-node).
 * - Sessão em cookie HttpOnly (o painel nunca vê o token).
 * - Toda mudança de estado leva o token CSRF da sessão (X-CSRF-Token).
 * - 401 → a sessão acabou: o painel volta para o pareamento.
 * - 403 com `reauth` → operação sensível: pedir um código novo do equipamento (step-up).
 * Nada de dado sensível em log: o painel não usa console.
 */
import { t } from '../i18n';

export interface Operator { id: string; name: string }
/** Regras do equipamento (assistente, passo "Regras"). */
export interface ApiDeviceLimits { bw: 5 | 20 | 50; sto: 1 | 4 | 8; hours: 'always' | 'night' | 'day' }
/**
 * `self`: o nó que serve o painel (com estatísticas reais); os outros são registros do assistente.
 * `nodeId`: identidade técnica (16 hex) quando o equipamento tem uma; `signed`: assinada pela chave de operador atual.
 */
export interface ApiDevice {
  id: string; name: string; cls: string; status: 'active' | 'paused'; self: boolean; pub?: string; nodeId?: string; signed?: boolean; limits?: ApiDeviceLimits;
  /** Enlace LNNP real com este equipamento (só com identidade técnica): conectado agora e última vez visto desde que o nó ligou. */
  link?: { online: boolean; lastSeen: number | null; address: string | null };
  /** Ponto de Acesso: id do nó pai (equipamento do mesmo operador). */
  parent?: string;
  /** Pausa e regras emitidas para ele pela chave de operador (número) e se o resumo dele diz que aplicou. */
  policy?: { seq: number; issuedAt: number; applied: boolean };
  /** Último resumo assinado pelo próprio equipamento (contadores desde que ele ligou). */
  report?: ApiDeviceReport;
}
/** Resumo que o equipamento manda pela malha (`DEVICE_REPORT`), assinado pela chave técnica dele. */
export interface ApiDeviceReport {
  at: number; receivedAt: number; startedAt: number; forwarded: number; stored: number; receipts: number; neighbors: number; paused: boolean; relaying: boolean;
}
/** `kind` ausente (versões antigas) = saída. Entrada (`in`) é liquidação recebida, com o lote em `from`. */
export interface ApiWalletTx { id: string; amount: number; at: number; to: string; kind?: 'in' | 'out'; from?: string }
export interface ApiWallet { balance: number; txs: ApiWalletTx[] }

/** Contadores do motor (os mesmos nomes de `GET /api/relay`). */
export interface ApiTotals { received: number; stored: number; forwarded: number; duplicates: number; rejected: number; relayOff: number; full: number; expired: number; receipts: number; receiptsReceived: number }
/** `confirmCode`: 6 dígitos derivados do handshake deste enlace, iguais no painel do outro nó. */
export interface ApiNeighbor { id: string; pk?: string; sameOperator?: boolean; address: string; link: string; inbound: boolean; since: number; version: number; relay: boolean; mtu: number; media: string[]; confirmCode?: string | null }
/** Vizinho fixo do enlace (`host:porta`): da configuração (PIU_LNNP_PEERS) ou adicionado pelo painel. */
export interface ApiPeer {
  address: string; source: 'config' | 'panel'; state: 'connecting' | 'connected' | 'failed';
  error: string | null; errorAt: number | null; nodeId: string | null; pk: string | null; since: number | null; attempts: number;
}
export interface ApiSerial { label: string; kind: 'lora' | 'usb'; packetsSent: number; packetsReceived: number; retries: number; lost: number; dutyPercent?: number; dutyUsedPercent?: number }
/** `GET /api/relay`. Com o motor desligado: `{ enabled: false }`. */
export type ApiRelay = { enabled: false } | {
  enabled: true; relayMode: boolean; relaying: boolean; startedAt?: number;
  /** `paused`: pausado aqui ou pelo operador em outro equipamento; `pausedHere`: só a pausa deste painel. */
  paused?: boolean; pausedHere?: boolean;
  /** Pausa e regras que a chave de operador mandou para este nó de outro equipamento. */
  operatorPolicy?: { seq: number; issuedAt: number; paused: boolean; limits: ApiDeviceLimits | null } | null;
  lnnp: { version: number; minVersion: number }; node: string; neighbors: ApiNeighbor[];
  /** `restored`: o que voltou do armazenamento local quando o nó subiu. */
  store: { envelopes: number; bytes: number; maxBytes: number; seen: number; restored?: { envelopes: number; seen: number; receipts: number } };
  counters: ApiTotals & { delivered: number; handshakesOk: number; handshakesFailed: number; revokedRefused?: number };
  limits: { bwMbps: number; stoGB: number; hours: string; media: boolean; device?: ApiDeviceLimits | null; operator?: ApiDeviceLimits | null; effective?: { bwMbps: number; stoGB: number; hours: string[] } };
  operator?: { signed: boolean; revoked: number; listSeq: number };
  lan?: { port: number; discoveryPort: number | null; peers?: ApiPeer[] }; serial?: ApiSerial[];
};
export interface ApiSample extends ApiTotals { at: number; neighbors: number; storedBytes: number }
export interface ApiDay extends ApiTotals { day: string }
/** `GET /api/relay/history`: amostras de 24 h, totais por dia (hoje já em tempo real) e o que ainda não virou amostra. */
export type ApiHistory = { enabled: false } | { enabled: true; sampleMs: number; today: string; samples: ApiSample[]; days: ApiDay[]; unsampled: ApiTotals };
/** `GET /api/relay/receipts`: recibos guardados para o validador (só horário e se são deste nó). */
export type ApiReceipts = { enabled: false } | { enabled: true; kept: number; keptOwn: number; max: number; recent: { at: number; own: boolean }[] };
/** Uma carga que passou pelo gateway: hash da transação (0x…) ou do pacote, estado e horário (s). */
export interface ApiGatewayItem { ref: string; kind: 'tx' | 'evidence'; status: 'queued' | 'pool' | 'included' | 'finalized' | 'invalid' | 'accepted' | 'error'; reason: string | null; at: number }
/**
 * `GET /api/gateway`: contadores reais desde que o nó subiu (`startedAt`, ms) e as últimas cargas.
 * `available: false`: motor LNNP desligado (`relay-off`) ou gateway desligado pela configuração (`config`).
 */
export type ApiGateway =
  | { available: false; reason: 'config' | 'relay-off'; enabled: false; inboxUrl: string | null; changedAt: number | null }
  | { available: true; enabled: boolean; online: boolean; inbox: boolean; inboxUrl: string | null; changedAt: number | null; startedAt: number | null;
      counters: { sent: number; finalized: number; refused: number; queued: number; forwarded: number; errors: number }; recent: ApiGatewayItem[] };
export interface ApiSession { id: string; label: string; createdAt: number; lastSeen: number; current: boolean }
export interface ApiSettings { limits: { bw: 20 | 50 | 100; sto: 4 | 8 | 16; hours: 'always' | 'night' | 'day' }; policies: { media: boolean; unknown: boolean; community: boolean } }
/** `GET /api/settings`: com `owner` (só os ajustes do dono deste equipamento valem no motor). */
export type ApiSettingsView = ApiSettings & { owner?: boolean };
export interface ApiPending { id: string; request: string; code: string; phone: string; expiresAt: number }
export interface ApiPhone { id: string; name: string; addedAt: number; confirmed: boolean }
export interface ApiPackage { name: string; version: string; file: string; size: number; sha256: string }
/** `GET /api/operator`: chave de operador (sem a parte secreta). */
export interface ApiOperatorKey {
  publicKey: string; fingerprint: string[]; createdAt: number; rotations: number; rotatedAt: number | null; lastBackupAt: number | null;
  owner?: boolean; revoked?: number; rotatedElsewhere?: boolean; signedDevices?: number;
}
/** `GET /api/payout-claims`: épocas que dá para declarar (esta semana e a próxima) e as já declaradas. */
export interface ApiClaims { enabled: boolean; epochs: string[]; claims: { epoch: string; address: string; at: number }[] }

/**
 * `GET /api/wallet/lunes`: carteira de provider na Lunes Mainnet (só leitura). `onchain` em planck
 * (texto; 1 LUNES = 10^8 planck), lido no último bloco finalizado; `error` quando a rede falhou
 * (com `onchain` sendo a última leitura, se houver).
 */
export interface ApiLunesReading { address: string; exists: boolean; free: string; reserved: string; frozen: string; block: number; blockHash: string; endpoint: string; at: number }
export interface ApiLunesWallet { address: string | null; setAt: number | null; explorer: string; endpoints: string[]; onchain: ApiLunesReading | null; error: string | null; cached: boolean }

export class AuthLost extends Error {}
export class NeedsReauth extends Error {}
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Mensagem do servidor (já genérica) ou uma neutra. */
async function errorOf(r: Response) {
  try { return ((await r.json()) as { error?: string }).error ?? t('common.couldNotFinish'); } catch { return t('common.couldNotFinish'); }
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
      throw new ApiError(403, j.error ?? t('common.notAllowed'));
    }
    if (!r.ok) throw new ApiError(r.status, await errorOf(r));
    return r.status === 204 ? (undefined as T) : ((await r.json()) as T);
  }

  devices = () => this.call<ApiDevice[]>('GET', '/api/devices');
  togglePause = (id: string) => this.call<{ id: string; status: 'active' | 'paused' }>('POST', `/api/devices/${encodeURIComponent(id)}/pause`);
  /** Sem identidade técnica: 204 (só sai do painel). Com: a chave entra na lista de revogação do operador. */
  revoke = (id: string) => this.call<{ revoked: boolean; appliedHere: boolean } | undefined>('DELETE', `/api/devices/${encodeURIComponent(id)}`);
  setDeviceLimits = (id: string, limits: ApiDeviceLimits | null) => this.call<ApiDevice>('PUT', `/api/devices/${encodeURIComponent(id)}/limits`, limits ?? { clear: true });
  wallet = () => this.call<ApiWallet>('GET', '/api/wallet');
  lunesWallet = () => this.call<ApiLunesWallet>('GET', '/api/wallet/lunes');
  /** Exige step-up (NeedsReauth); endereço inválido: ApiError 400 com o motivo. */
  setLunesAddress = (address: string) => this.call<{ address: string; setAt: number }>('PUT', '/api/wallet/lunes', { address });
  clearLunesAddress = () => this.call<void>('DELETE', '/api/wallet/lunes');
  /** `to`: 'personal' ou um endereço `lunes:…`. */
  /** Com celular pareado, devolve `pending` (aprovar no celular); sem celular, executa na hora. */
  transfer = (amount: number, to = 'personal') => this.call<{ id: string } | { pending: ApiPending }>('POST', '/api/wallet/transfer', { amount, to });
  approveTransfer = (id: string, approval: string) => this.call<{ id: string }>('POST', `/api/wallet/transfer/${encodeURIComponent(id)}/approve`, { approval });
  phones = () => this.call<ApiPhone[]>('GET', '/api/phones');
  startPhonePairing = (name: string) => this.call<{ id: string; qr: string; expiresAt: number }>('POST', '/api/phones', { name });
  confirmPhone = (id: string, code: string) => this.call<ApiPhone>('POST', `/api/phones/${encodeURIComponent(id)}/confirm`, { code });
  removePhone = (id: string) => this.call<void>('DELETE', `/api/phones/${encodeURIComponent(id)}`);
  createDevice = (d: { name: string; cls: string; family: string; pub?: string; nodePk?: string; limits?: ApiDeviceLimits; parent?: string }) => this.call<ApiDevice>('POST', '/api/devices', d);
  /** Só o nó que serve o painel, só o dono, com step-up (NeedsReauth). 202: o nó fecha limpo e o supervisor sobe de novo. */
  restartDevice = (id: string) => this.call<{ restarting: true }>('POST', `/api/devices/${encodeURIComponent(id)}/restart`);
  operatorKey = () => this.call<ApiOperatorKey>('GET', '/api/operator');
  backupOperatorKey = (password: string) => this.call<{ filename: string; backup: string }>('POST', '/api/operator/backup', { password });
  rotateOperatorKey = () => this.call<ApiOperatorKey>('POST', '/api/operator/rotate');
  /**
   * Restaura um backup da chave de operador (`backup`: o texto do arquivo `piu-operador.backup`, até
   * 256 KiB; `password`: a senha dele). Exige step-up (NeedsReauth). Senha errada ou arquivo adulterado:
   * ApiError 403 ("Senha errada ou arquivo adulterado."); arquivo que não é backup: ApiError 400.
   */
  restoreOperatorKey = (backup: string, password: string) => this.call<ApiOperatorKey>('POST', '/api/operator/restore', { backup, password });
  /** Arquivo de evidências (`EvidenceFile` do validador), como o nó devolveu. */
  evidence = () => this.call<{ v: 1; receipts: unknown[]; proofs: unknown[] }>('GET', '/api/relay/evidence');
  claims = () => this.call<ApiClaims>('GET', '/api/payout-claims');
  declareClaim = (epoch: string, address: string) => this.call<ApiClaims>('POST', '/api/payout-claims', { epoch, address });
  claimsFile = () => this.call<{ v: 1; claims: unknown[] }>('GET', '/api/payout-claims/file');
  settings = () => this.call<ApiSettingsView>('GET', '/api/settings');
  saveSettings = (s: ApiSettings) => this.call<ApiSettings>('PUT', '/api/settings', s);
  sessions = () => this.call<ApiSession[]>('GET', '/api/sessions');
  revokeOtherSessions = () => this.call<{ revoked: number }>('POST', '/api/sessions/revoke-others');
  reauth = (code: string) => this.call<{ ok: true }>('POST', '/api/reauth', { code });
  packages = () => this.call<ApiPackage[]>('GET', '/api/packages');
  relay = () => this.call<ApiRelay>('GET', '/api/relay');
  /** Adiciona um vizinho por endereço (`host:porta`); o nó espera o handshake (até ~6 s) e devolve o estado. */
  addRelayPeer = (address: string) => this.call<{ peer: ApiPeer | null }>('POST', '/api/relay/peers', { address });
  removeRelayPeer = (address: string) => this.call<void>('DELETE', `/api/relay/peers/${encodeURIComponent(address)}`);
  history = () => this.call<ApiHistory>('GET', '/api/relay/history');
  receipts = () => this.call<ApiReceipts>('GET', '/api/relay/receipts');
  gateway = () => this.call<ApiGateway>('GET', '/api/gateway');
  /** Só o dono, com step-up (NeedsReauth). Caixa só https:// (ApiError 400 com o motivo). */
  setGateway = (v: { enabled: boolean; inboxUrl: string | null }) => this.call<{ enabled: boolean; inboxUrl: string | null; changedAt: number }>('PUT', '/api/gateway', v);
  logout = () => this.call<{ ok: true }>('POST', '/api/logout');
}
