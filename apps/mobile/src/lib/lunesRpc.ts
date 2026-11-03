/**
 * Cliente leve de LEITURA da Lunes Mainnet (Substrate), por JSON-RPC sobre WebSocket.
 *
 * Por que não @polkadot/api: é pesado para o React Native e aqui só lemos meia dúzia de coisas.
 * Este módulo não assina nem envia nada: o pagamento dos lotes (liquidação) é outra etapa
 * (apps/settlement) e continua fora do app.
 *
 * - Endereços de produção na ordem confirmada pela Lunes; quando um falha (não conecta, cai ou
 *   demora), passa ao seguinte. Erro devolvido pelo próprio nó (JSON-RPC `error`) não troca de endereço.
 * - Cada requisição tem id próprio e tempo limite.
 * - Saldo: `state_getStorage` da chave System.Account = twox128("System") ‖ twox128("Account") ‖
 *   blake2_128(conta) ‖ conta, lido no último bloco finalizado, e o AccountInfo decodificado aqui.
 * Sem react-native: roda no app (WebSocket do RN), no piu-node (cópia gerada; WebSocket do Node 22)
 * e nos testes (WebSocket falso que responde com JSON-RPC gravado).
 */
import { blake2b } from '@noble/hashes/blake2.js';
import { decodeSs58 } from './ss58';
import { twox128 } from './xxhash';

/** Endereços de produção da Lunes Mainnet, nesta ordem (o de arquivo por último). */
export const LUNES_ENDPOINTS: readonly string[] = [
  'wss://ws.lunes.io',
  'wss://ws-lunes-main-01.lunes.io',
  'wss://ws-lunes-main-02.lunes.io',
  'wss://ws-archive.lunes.io',
];
/** Explorador de blocos da Lunes. */
export const LUNES_EXPLORER = 'https://blockexplorer.lunes.io/';
/** 1 LUNES = 10^8 planck. */
export const LUNES_DECIMALS = 8;
/** Tempo de bloco (Aura). */
export const LUNES_BLOCK_MS = 6000;
/** Depósito existencial: abaixo disso a conta deixa de existir. */
export const LUNES_EXISTENTIAL_DEPOSIT = 500n;

/** O mínimo de WebSocket que usamos (o do navegador, do React Native e do Node 22 servem). */
export interface WsLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
}
export type WsFactory = (url: string) => WsLike;

/** Erro devolvido pelo nó (método inexistente, parâmetro inválido): não adianta trocar de endereço. */
export class RpcError extends Error {
  constructor(readonly code: number, message: string) { super(message); }
}
/** Nenhum endereço respondeu (sem rede, bloqueado, fora do ar). */
export class LunesOffline extends Error {}

export interface LunesRpcOptions {
  endpoints?: readonly string[];
  /** Tempo limite para conectar e para cada resposta, por endereço (padrão: 8 s). */
  timeoutMs?: number;
  /** Cria o WebSocket (padrão: o global). */
  connect?: WsFactory;
}

const hostOf = (url: string) => url.replace(/^wss?:\/\//, '').replace(/\/.*$/, '');
const why = (e: unknown) => (e instanceof Error ? e.message : 'falha de conexão');

function defaultConnect(): WsFactory {
  const W = (globalThis as { WebSocket?: new (url: string) => WsLike }).WebSocket;
  if (!W) throw new LunesOffline('Este ambiente não tem WebSocket (no Node, use a versão 22 ou rode com --experimental-websocket).');
  return url => new W(url);
}

async function textOf(data: unknown): Promise<string | null> {
  if (typeof data === 'string') return data;
  if (data instanceof Uint8Array) return new TextDecoder().decode(data);
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(data));
  const blob = data as { text?: () => Promise<string> } | null;
  if (blob && typeof blob.text === 'function') return blob.text();
  return null;
}

interface Pending { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }

export class LunesRpc {
  readonly endpoints: readonly string[];
  private readonly timeoutMs: number;
  private readonly factory: WsFactory | undefined;
  private ws: WsLike | null = null;
  private wsUrl: string | null = null;
  private opening: Promise<void> | null = null;
  private idx = 0;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  /** Endereço que respondeu por último (null antes da primeira resposta). */
  endpoint: string | null = null;

  constructor(o: LunesRpcOptions = {}) {
    this.endpoints = o.endpoints?.length ? [...o.endpoints] : LUNES_ENDPOINTS;
    this.timeoutMs = o.timeoutMs ?? 8000;
    this.factory = o.connect;
  }

  /** Chama um método; em falha de transporte, tenta os outros endereços (cada um uma vez). */
  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const errors: string[] = [];
    for (let attempt = 0; attempt < this.endpoints.length; attempt++) {
      const url = this.endpoints[this.idx]!;
      try {
        await this.ensure(url);
        const r = await this.request<T>(method, params);
        this.endpoint = url;
        return r;
      } catch (e) {
        if (e instanceof RpcError) throw e;
        errors.push(`${hostOf(url)}: ${why(e)}`);
        this.drop(new LunesOffline('conexão trocada'));
        this.idx = (this.idx + 1) % this.endpoints.length;
      }
    }
    throw new LunesOffline(`Nenhum endereço da Lunes respondeu (${errors.join('; ')}).`);
  }

  /** Fecha a conexão (as requisições em andamento falham). */
  close() { this.drop(new LunesOffline('conexão fechada')); }

  private ensure(url: string): Promise<void> {
    if (this.ws && this.wsUrl === url && this.ws.readyState === 1) return Promise.resolve();
    if (this.opening && this.wsUrl === url) return this.opening;
    this.drop(new LunesOffline('conexão trocada'));
    const factory = this.factory ?? defaultConnect();
    const ws = factory(url);
    this.ws = ws; this.wsUrl = url;
    this.opening = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { fail(new Error('tempo esgotado ao conectar')); }, this.timeoutMs);
      const fail = (e: Error) => { clearTimeout(timer); if (this.ws === ws) this.drop(e); reject(e); };
      ws.onopen = () => { clearTimeout(timer); resolve(); };
      ws.onerror = () => fail(new Error('não conectou'));
      ws.onclose = () => fail(new Error('conexão fechada pelo servidor'));
    }).finally(() => { if (this.ws === ws) this.opening = null; });
    // Depois de aberta: respostas e queda.
    ws.onmessage = ev => { void this.onMessage(ev.data); };
    return this.opening.then(() => {
      ws.onerror = () => { if (this.ws === ws) this.drop(new Error('erro na conexão')); };
      ws.onclose = () => { if (this.ws === ws) this.drop(new Error('conexão caiu')); };
    });
  }

  private async onMessage(data: unknown) {
    const text = await textOf(data);
    if (text == null) return;
    let msg: { id?: unknown; result?: unknown; error?: { code?: number; message?: string } };
    try { msg = JSON.parse(text); } catch { return; }
    if (typeof msg.id !== 'number') return; // notificações de assinatura: não usamos
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new RpcError(msg.error.code ?? 0, msg.error.message ?? 'erro do nó'));
    else p.resolve(msg.result ?? null);
  }

  private request<T>(method: string, params: unknown[]): Promise<T> {
    const ws = this.ws;
    if (!ws) return Promise.reject(new Error('sem conexão'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`tempo esgotado em ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve: v => resolve(v as T), reject, timer });
      try { ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params })); } catch (e) {
        clearTimeout(timer); this.pending.delete(id); reject(e instanceof Error ? e : new Error('falha ao enviar'));
      }
    });
  }

  private drop(e: Error) {
    const ws = this.ws;
    this.ws = null; this.wsUrl = null; this.opening = null;
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(e); }
    this.pending.clear();
    if (ws) {
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      try { ws.close(); } catch { /* já fechado */ }
    }
  }
}

// ── bytes ─────────────────────────────────────────────────
export const toHex = (b: Uint8Array) => '0x' + Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
export function fromHex(h: string): Uint8Array {
  const s = h.startsWith('0x') ? h.slice(2) : h;
  if (s.length % 2 || /[^0-9a-fA-F]/.test(s)) throw new Error('Hex inválido.');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}
const leUint = (b: Uint8Array, o: number, n: number) => {
  let x = 0n;
  for (let i = n - 1; i >= 0; i--) x = (x << 8n) | BigInt(b[o + i]!);
  return x;
};
const HASH = /^0x[0-9a-fA-F]{64}$/;
export const isHash = (h: string) => HASH.test(h);

// ── leitura ───────────────────────────────────────────────
export interface ChainHead { number: number; hash: string }
export interface ChainInfo { chain: string; specName: string; specVersion: number; genesisHash: string; best: number; finalized: number }

interface Header { number: string; parentHash: string }
const blockNumber = (h: Header) => parseInt(h.number, 16);

/** Último bloco finalizado (GRANDPA): número e hash. */
export async function finalizedHead(rpc: LunesRpc): Promise<ChainHead> {
  const hash = await rpc.call<string>('chain_getFinalizedHead');
  const header = await rpc.call<Header | null>('chain_getHeader', [hash]);
  if (!header) throw new Error('O nó não devolveu o cabeçalho do bloco finalizado.');
  return { number: blockNumber(header), hash };
}

/** Nome da cadeia, runtime, gênese e alturas (melhor e finalizado). */
export async function chainInfo(rpc: LunesRpc): Promise<ChainInfo> {
  const chain = await rpc.call<string>('system_chain');
  const rv = await rpc.call<{ specName: string; specVersion: number }>('state_getRuntimeVersion');
  const genesisHash = await rpc.call<string>('chain_getBlockHash', [0]);
  const best = await rpc.call<Header>('chain_getHeader');
  const fin = await finalizedHead(rpc);
  return { chain, specName: rv.specName, specVersion: rv.specVersion, genesisHash, best: blockNumber(best), finalized: fin.number };
}

/** Chave de armazenamento System.Account(conta): twox128 ‖ twox128 ‖ blake2_128(conta) ‖ conta. */
export function systemAccountKey(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) throw new Error('A conta precisa ter 32 bytes.');
  const parts = [twox128('System'), twox128('Account'), blake2b(publicKey, { dkLen: 16 }), publicKey];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return toHex(out);
}

/**
 * AccountInfo decodificado (SCALE, little endian). Formatos aceitos, pelo tamanho:
 * - 80 bytes: nonce, consumers, providers, sufficients (u32) + free, reserved, frozen, flags (u128).
 *   Runtimes anteriores à mudança de 2023 usavam misc_frozen e fee_frozen nos dois últimos campos
 *   (mesmo tamanho). O bit mais alto de `flags` (IS_NEW_LOGIC) diz qual é: sem ele, `frozen` é o
 *   maior entre misc_frozen e fee_frozen.
 * - 76 bytes: sem `sufficients`. 72 bytes: um único contador de referências (u32).
 */
export interface AccountInfo {
  nonce: number; consumers: number; providers: number; sufficients: number;
  free: bigint; reserved: bigint; frozen: bigint;
  /** `frozen`: formato atual (com flags); `misc_fee`: misc_frozen/fee_frozen. */
  layout: 'frozen' | 'misc_fee';
}
const IS_NEW_LOGIC = 1n << 127n;

export function decodeAccountInfo(raw: Uint8Array): AccountInfo {
  const u32 = (o: number) => Number(leUint(raw, o, 4));
  let head: Pick<AccountInfo, 'nonce' | 'consumers' | 'providers' | 'sufficients'>;
  let o: number;
  if (raw.length === 80) { head = { nonce: u32(0), consumers: u32(4), providers: u32(8), sufficients: u32(12) }; o = 16; }
  else if (raw.length === 76) { head = { nonce: u32(0), consumers: u32(4), providers: u32(8), sufficients: 0 }; o = 12; }
  else if (raw.length === 72) { head = { nonce: u32(0), consumers: u32(4), providers: 0, sufficients: 0 }; o = 8; }
  else throw new Error(`Formato de conta desconhecido (${raw.length} bytes). O runtime da Lunes pode ter mudado.`);
  const free = leUint(raw, o, 16), reserved = leUint(raw, o + 16, 16);
  const third = leUint(raw, o + 32, 16), fourth = leUint(raw, o + 48, 16);
  if (fourth & IS_NEW_LOGIC) return { ...head, free, reserved, frozen: third, layout: 'frozen' };
  return { ...head, free, reserved, frozen: third > fourth ? third : fourth, layout: 'misc_fee' };
}

export interface AccountBalance {
  /** Endereço como foi informado. */
  address: string;
  /** Conta existe no estado (sem ela, tudo é 0). */
  exists: boolean;
  free: bigint; reserved: bigint; frozen: bigint; nonce: number;
  /** Bloco finalizado em que o saldo foi lido. */
  block: number; blockHash: string;
  /** Endereço WebSocket que respondeu. */
  endpoint: string;
}

/** Saldo da conta no último bloco finalizado. Lança erro se o endereço não for SS58 da Lunes. */
export async function accountBalance(rpc: LunesRpc, address: string): Promise<AccountBalance> {
  const d = decodeSs58(address);
  if (!d.ok) throw new Error(d.error);
  const head = await finalizedHead(rpc);
  const raw = await rpc.call<string | null>('state_getStorage', [systemAccountKey(d.publicKey), head.hash]);
  const info = raw ? decodeAccountInfo(fromHex(raw)) : null;
  return {
    address: address.trim(), exists: !!info,
    free: info?.free ?? 0n, reserved: info?.reserved ?? 0n, frozen: info?.frozen ?? 0n, nonce: info?.nonce ?? 0,
    block: head.number, blockHash: head.hash, endpoint: rpc.endpoint ?? '',
  };
}

/** Número do bloco com este hash, ou null se o nó não conhece (hash errado ou de outra cadeia). */
export async function blockNumberOf(rpc: LunesRpc, blockHash: string): Promise<number | null> {
  if (!isHash(blockHash)) throw new Error('Hash de bloco inválido (0x + 64 hex).');
  const h = await rpc.call<Header | null>('chain_getHeader', [blockHash]);
  return h ? blockNumber(h) : null;
}

/** Hash de um extrínseco: BLAKE2b-256 dos bytes codificados (com o prefixo de tamanho), como no Substrate. */
export const extrinsicHash = (encoded: Uint8Array) => toHex(blake2b(encoded, { dkLen: 32 }));

export interface SettlementCheck {
  /** O bloco existe neste nó. */
  blockFound: boolean;
  blockNumber: number | null;
  /** O bloco está na cadeia canônica e já foi finalizado (não volta atrás). */
  finalized: boolean;
  /** Com `txHash`: o extrínseco está no bloco (posição) ou não (-1). Sem `txHash`: null. */
  txIndex: number | null;
  endpoint: string;
}

/**
 * Confere um lote pago: o bloco existe, é canônico e finalizado, e (com o hash da transação) a
 * transação está dentro dele. Só leitura: não diz se a transação deu certo (isso fica nos eventos,
 * que o apps/settlement confere com os metadados).
 */
export async function checkSettlement(rpc: LunesRpc, o: { blockHash: string; txHash?: string }): Promise<SettlementCheck> {
  if (o.txHash !== undefined && !isHash(o.txHash)) throw new Error('Hash de transação inválido (0x + 64 hex).');
  const n = await blockNumberOf(rpc, o.blockHash);
  if (n == null) return { blockFound: false, blockNumber: null, finalized: false, txIndex: o.txHash ? -1 : null, endpoint: rpc.endpoint ?? '' };
  const fin = await finalizedHead(rpc);
  const canonical = (await rpc.call<string | null>('chain_getBlockHash', [n]))?.toLowerCase() === o.blockHash.toLowerCase();
  let txIndex: number | null = null;
  if (o.txHash) {
    const b = await rpc.call<{ block: { extrinsics: string[] } } | null>('chain_getBlock', [o.blockHash]);
    const want = o.txHash.toLowerCase();
    txIndex = (b?.block.extrinsics ?? []).findIndex(x => extrinsicHash(fromHex(x)) === want);
  }
  return { blockFound: true, blockNumber: n, finalized: canonical && n <= fin.number, txIndex, endpoint: rpc.endpoint ?? '' };
}

// ── valores ───────────────────────────────────────────────
/** planck → número em LUNES (para somas de tela; para mostrar o valor exato use `formatLunes`). */
export const planckToLunes = (p: bigint) => Number(p / 10n ** BigInt(LUNES_DECIMALS)) + Number(p % 10n ** BigInt(LUNES_DECIMALS)) / 10 ** LUNES_DECIMALS;

/** "1.234,5" com no mínimo 2 e no máximo `max` casas (padrão: as 8 da Lunes), sem arredondar para cima. */
export function formatLunes(p: bigint, max = LUNES_DECIMALS): string {
  const neg = p < 0n;
  const a = neg ? -p : p;
  const base = 10n ** BigInt(LUNES_DECIMALS);
  const int = (a / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  let frac = (a % base).toString().padStart(LUNES_DECIMALS, '0').slice(0, Math.max(2, Math.min(LUNES_DECIMALS, max)));
  while (frac.length > 2 && frac.endsWith('0')) frac = frac.slice(0, -1);
  return `${neg ? '−' : ''}${int},${frac}`;
}

export const hostOfEndpoint = hostOf;
