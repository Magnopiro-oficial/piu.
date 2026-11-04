/// <reference types="node" />
/**
 * Nó Substrate falso para os testes do cliente da Lunes: responde JSON-RPC no formato que um nó
 * Substrate devolve (cabeçalho com `number` em hex, `state_getStorage` em hex SCALE, erro com
 * `code`/`message`). Deste ambiente não há rota até a Mainnet, então nada aqui foi gravado dela: os
 * valores são de teste. A conta é a de desenvolvimento "Alice" do Substrate (chave pública
 * conhecida, sem valor em nenhuma rede de produção).
 */
import { blake2b } from '@noble/hashes/blake2.js';
import type { WsLike } from '../lunesRpc';

export const ALICE_PK = 'd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d';
/** Alice com prefixo 42 (genérico) e 57 (Lunes), conferidos com @polkadot/util-crypto `encodeAddress`. */
export const ALICE_42 = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
export const ALICE_57 = '6mfqoTMHrMeVMyKwjqomUjVomPMJ4AjdCm1VReFtk7Be8wqr';

export const hex = (b: Uint8Array) => '0x' + Buffer.from(b).toString('hex');
export const hashOf = (s: string) => hex(blake2b(new TextEncoder().encode(s), { dkLen: 32 }));
const le = (v: bigint, n: number) => { const o = new Uint8Array(n); for (let i = 0; i < n; i++) { o[i] = Number(v & 0xffn); v >>= 8n; } return o; };
const cat = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((a, x) => a + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };

/** AccountInfo atual (80 bytes, com `flags` e o bit IS_NEW_LOGIC). */
export function accountInfoHex(a: { nonce: number; free: bigint; reserved?: bigint; frozen?: bigint }) {
  return hex(cat(le(BigInt(a.nonce), 4), le(1n, 4), le(1n, 4), le(0n, 4), le(a.free, 16), le(a.reserved ?? 0n, 16), le(a.frozen ?? 0n, 16), le(1n << 127n, 16)));
}

export interface Chain {
  finalized: number; best: number;
  /** Conteúdo de `state_getStorage` por chave (hex). */
  storage: Record<string, string>;
  /** Extrínsecos por número de bloco (hex SCALE com prefixo de tamanho). */
  extrinsics?: Record<number, string[]>;
}

const header = (n: number) => ({
  parentHash: hashOf(`bloco ${n - 1}`), number: '0x' + n.toString(16),
  stateRoot: hashOf(`estado ${n}`), extrinsicsRoot: hashOf(`extr ${n}`), digest: { logs: [] },
});

/** Responde como um nó da cadeia `c`. */
export function substrateHandler(c: Chain) {
  // Blocos que este nó conhece pelo hash: gênese, finalizado, melhor e os que têm extrínsecos.
  const byHash = new Map<string, number>();
  for (const n of [0, c.finalized, c.best, ...Object.keys(c.extrinsics ?? {}).map(Number)]) byHash.set(hashOf(`bloco ${n}`), n);
  return (method: string, params: unknown[]): { result?: unknown; error?: { code: number; message: string } } => {
    switch (method) {
      case 'system_chain': return { result: 'Cadeia de teste' };
      case 'state_getRuntimeVersion': return { result: { specName: 'runtime-de-teste', implName: 'runtime-de-teste', authoringVersion: 1, specVersion: 107, implVersion: 1, transactionVersion: 1, stateVersion: 1, apis: [] } };
      case 'chain_getFinalizedHead': return { result: hashOf(`bloco ${c.finalized}`) };
      case 'chain_getBlockHash': {
        const n = params[0] as number | undefined;
        return { result: n === undefined ? hashOf(`bloco ${c.best}`) : n <= c.best ? hashOf(`bloco ${n}`) : null };
      }
      case 'chain_getHeader': {
        const h = params[0] as string | undefined;
        if (h === undefined) return { result: header(c.best) };
        const n = byHash.get(h);
        return { result: n === undefined ? null : header(n) };
      }
      case 'chain_getBlock': {
        const n = byHash.get(params[0] as string);
        return { result: n === undefined ? null : { block: { header: header(n), extrinsics: c.extrinsics?.[n] ?? [] }, justifications: null } };
      }
      case 'state_getStorage': return { result: c.storage[params[0] as string] ?? null };
      default: return { error: { code: -32601, message: 'Method not found' } };
    }
  };
}

export type Behavior = 'ok' | 'down' | 'silent' | 'drop-after-open';

/** Fábrica de WebSocket falso: cada endereço tem um comportamento; `log` guarda o que foi pedido. */
export function fakeSockets(behaviors: Record<string, Behavior>, handle: ReturnType<typeof substrateHandler>, o: { latencyMs?: (method: string) => number } = {}) {
  const log: { url: string; id: number; method: string; params: unknown[] }[] = [];
  const opened: string[] = [];
  const connect = (url: string): WsLike => {
    const b = behaviors[url] ?? 'down';
    const ws: WsLike & { readyState: number } = {
      readyState: 0,
      onopen: null, onmessage: null, onerror: null, onclose: null,
      send(data: string) {
        const m = JSON.parse(data) as { id: number; method: string; params: unknown[] };
        log.push({ url, id: m.id, method: m.method, params: m.params });
        if (b === 'drop-after-open') { setTimeout(() => { ws.readyState = 3; ws.onclose?.({}); }, 1); return; }
        const r = handle(m.method, m.params);
        setTimeout(() => ws.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id: m.id, ...r }) }), o.latencyMs?.(m.method) ?? 1);
      },
      close() { ws.readyState = 3; },
    };
    opened.push(url);
    setTimeout(() => {
      if (b === 'down') { ws.onerror?.({}); ws.readyState = 3; ws.onclose?.({}); }
      else if (b === 'ok' || b === 'drop-after-open') { ws.readyState = 1; ws.onopen?.({}); }
      // 'silent': nunca abre (o cliente desiste pelo tempo limite)
    }, 1);
    return ws;
  };
  return { connect, log, opened };
}
