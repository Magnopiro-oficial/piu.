/**
 * Saldo on-chain da carteira de provider, lido na Lunes Mainnet com o mesmo cliente leve do app
 * (src/lunes/lunesRpc.ts, cópia gerada de apps/mobile/src/lib). Só leitura: nada é assinado.
 *
 * - Cache curto por endereço (30 s): o painel lê a cada poucos segundos, e o nó da Lunes não precisa
 *   de uma consulta por tela aberta. Consultas simultâneas do mesmo endereço viram uma só.
 * - Sem rede: devolve a última leitura (com o horário dela) e o motivo; depois de uma falha, espera
 *   10 s antes de tentar de novo.
 * - WebSocket: o global do Node 22. No Node 20 ele só existe com `--experimental-websocket`
 *   (NODE_OPTIONS); sem ele, a leitura diz isso em vez de falhar calada.
 */
import { accountBalance, LUNES_ENDPOINTS, LunesRpc, type WsFactory } from './lunesRpc.js';

export interface LunesReading {
  address: string; exists: boolean;
  /** planck, em texto (u128 não cabe em number). 1 LUNES = 10^8 planck. */
  free: string; reserved: string; frozen: string;
  block: number; blockHash: string; endpoint: string;
  /** Quando foi lido (ms). */
  at: number;
}
export interface LunesBalance { reading: LunesReading | null; error: string | null; cached: boolean }

export interface LunesReaderOptions {
  endpoints?: readonly string[];
  ttlMs?: number;
  retryMs?: number;
  timeoutMs?: number;
  connect?: WsFactory;
  now?: () => number;
}

export class LunesReader {
  readonly endpoints: readonly string[];
  private readonly ttl: number;
  private readonly retry: number;
  private readonly timeoutMs: number;
  private readonly connect: WsFactory | undefined;
  private readonly now: () => number;
  private last = new Map<string, LunesReading>();
  private failed = new Map<string, { at: number; error: string }>();
  private inflight = new Map<string, Promise<LunesBalance>>();

  constructor(o: LunesReaderOptions = {}) {
    this.endpoints = o.endpoints?.length ? [...o.endpoints] : LUNES_ENDPOINTS;
    this.ttl = o.ttlMs ?? 30_000;
    this.retry = o.retryMs ?? 10_000;
    this.timeoutMs = o.timeoutMs ?? 5000;
    this.connect = o.connect;
    this.now = o.now ?? Date.now;
  }

  async balance(address: string): Promise<LunesBalance> {
    const t = this.now();
    const last = this.last.get(address) ?? null;
    if (last && t - last.at < this.ttl) return { reading: last, error: null, cached: true };
    const f = this.failed.get(address);
    if (f && t - f.at < this.retry) return { reading: last, error: f.error, cached: true };
    const running = this.inflight.get(address);
    if (running) return running;
    const p = this.read(address).finally(() => this.inflight.delete(address));
    this.inflight.set(address, p);
    return p;
  }

  private async read(address: string): Promise<LunesBalance> {
    const rpc = new LunesRpc({ endpoints: this.endpoints, timeoutMs: this.timeoutMs, ...(this.connect ? { connect: this.connect } : {}) });
    try {
      const b = await accountBalance(rpc, address);
      const reading: LunesReading = {
        address, exists: b.exists, free: b.free.toString(), reserved: b.reserved.toString(), frozen: b.frozen.toString(),
        block: b.block, blockHash: b.blockHash, endpoint: b.endpoint, at: this.now(),
      };
      this.last.set(address, reading);
      this.failed.delete(address);
      return { reading, error: null, cached: false };
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Falha na consulta à Lunes Mainnet.';
      this.failed.set(address, { at: this.now(), error });
      return { reading: this.last.get(address) ?? null, error, cached: false };
    } finally {
      rpc.close();
    }
  }
}

/** `PIU_LUNES_ENDPOINTS` (separados por vírgula, `wss://` ou `ws://`); vazio = os de produção. */
export function parseLunesEndpoints(v: string | undefined): string[] {
  const list = (v ?? '').split(',').map(x => x.trim()).filter(Boolean);
  for (const u of list) {
    let ok = false;
    try { const x = new URL(u); ok = (x.protocol === 'wss:' || x.protocol === 'ws:') && !!x.hostname; } catch { /* inválido */ }
    if (!ok) throw new Error(`PIU_LUNES_ENDPOINTS: endereço inválido (${u}). Use wss://… separados por vírgula.`);
  }
  return list.length ? list : [...LUNES_ENDPOINTS];
}
