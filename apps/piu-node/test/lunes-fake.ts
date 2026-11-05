/**
 * Nó Substrate de teste para a leitura da Lunes: responde JSON-RPC no formato de um nó Substrate.
 * Deste ambiente não há rota até a Mainnet, então nada aqui foi gravado dela: os valores são de
 * teste. A conta é a "Alice" de desenvolvimento do Substrate (chave pública conhecida, sem valor em
 * rede de produção). Dois jeitos de servir: WebSocket falso em memória (qualquer Node) e um servidor
 * WebSocket de verdade em 127.0.0.1 (para provar o WebSocket global do Node 22 com o cliente).
 */
import { twox128 } from '../src/lunes/xxhash.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import type { WsLike } from '../src/lunes/lunesRpc.js';

export const ALICE_PK = 'd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d';
export const ALICE_42 = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
export const ALICE_57 = '6mfqoTMHrMeVMyKwjqomUjVomPMJ4AjdCm1VReFtk7Be8wqr';

const hex = (b: Uint8Array) => '0x' + Buffer.from(b).toString('hex');
export const hashOf = (s: string) => hex(blake2b(new TextEncoder().encode(s), { dkLen: 32 }));
const le = (v: bigint, n: number) => { const o = Buffer.alloc(n); for (let i = 0; i < n; i++) { o[i] = Number(v & 0xffn); v >>= 8n; } return o; };
export const accountInfoHex = (nonce: number, free: bigint) =>
  hex(Buffer.concat([le(BigInt(nonce), 4), le(1n, 4), le(1n, 4), le(0n, 4), le(free, 16), le(0n, 16), le(0n, 16), le(1n << 127n, 16)]));

export interface FakeChain {
  finalized: number;
  storage: Record<string, string>;
  /** `state_getRuntimeVersion` (padrão: o da Mainnet conferido em 2026-11-04, 107/2). */
  runtime?: { specVersion: number; transactionVersion: number };
  /** `system_accountNextIndex` por endereço (prefixo 57). Ausente: 0. */
  nonce?: Record<string, number>;
  /** Resposta de `TaggedTransactionQueue_validate_transaction` (hex SCALE). Padrão: Ok. */
  validity?: string | ((extrinsic: string) => string);
  /** Extrínsecos por número de bloco (hex com prefixo de tamanho); blocos ≤ finalized existem mesmo vazios. */
  extrinsics?: Record<number, string[]>;
  /** `author_submitExtrinsic` recusa com erro 1010 (ex.: sem saldo para a taxa). */
  submitError?: string | (() => string | undefined);
  submitErrorCode?: number;
  /** Simula envio aceito cuja resposta se perde. */
  dropSubmitResponses?: boolean | number;
  metadata?: string;
  events?: Record<number, string>;
}

/** `Ok(ValidTransaction{priority 0, requires [], provides [], longevity 64, propagate true})` em SCALE. */
export const VALID_OK = '0x00' + '0000000000000000' + '00' + '00' + '4000000000000000' + '01';
/** `Err(Invalid(Payment))` e `Err(Invalid(BadProof))`, como a Mainnet devolveu ao spike. */
export const INVALID_PAYMENT = '0x010001';
export const INVALID_BAD_PROOF = '0x010004';

/** Hash de um extrinsic (com o prefixo de tamanho), como o nó devolve em `author_submitExtrinsic`. */
export const extrinsicHashOf = (hexXt: string) => hex(blake2b(Buffer.from(hexXt.slice(2), 'hex'), { dkLen: 32 }));

/**
 * Nó falso da cadeia `c` (mutável: os testes avançam `finalized` e põem extrínsecos em blocos). Responde
 * leitura (saldo) e escrita (nonce, taxa, validação sem enviar, envio, blocos) no formato de um nó Substrate.
 */
export function substrate(c: FakeChain) {
  const head = (n: number) => ({ parentHash: hashOf(`bloco ${n - 1}`), number: '0x' + n.toString(16), stateRoot: hashOf(`estado ${n}`), extrinsicsRoot: hashOf(`extr ${n}`), digest: { logs: [] } });
  const calls: string[] = [];
  const submitted: string[] = [];
  /** Melhor bloco: o finalizado ou o bloco mais alto que recebeu extrínsecos (ainda não finalizado). */
  const best = () => Math.max(c.finalized, ...Object.keys(c.extrinsics ?? {}).map(Number));
  // Hash → número: a gênese, o finalizado, o melhor, os blocos com extrínsecos e todo hash que este nó já
  // entregou em `chain_getBlockHash` (como um nó de verdade, só conhece hashes que existem).
  const byHash = new Map<string, number>();
  const remember = (n: number) => { const h = hashOf(`bloco ${n}`); byHash.set(h, n); return h; };
  const known = (h: unknown): number | null => {
    for (const n of [0, c.finalized, best(), ...Object.keys(c.extrinsics ?? {}).map(Number)]) remember(n);
    return byHash.get(h as string) ?? null;
  };
  const eventsKey = hex(Uint8Array.from([...twox128("System"), ...twox128("Events")]));
  const handle = (method: string, params: unknown[]): { result?: unknown; drop?: boolean; error?: { code: number; message: string } } => {
    calls.push(method);
    switch (method) {
      case 'chain_getFinalizedHead': return { result: hashOf(`bloco ${c.finalized}`) };
      case 'chain_getHeader': {
        if (params[0] === undefined) return { result: head(best()) };
        const n = known(params[0]);
        return { result: n === null ? null : head(n) };
      }
      case 'chain_getBlockHash': {
        const n = params[0] as number | undefined;
        if (n === undefined) return { result: remember(best()) };
        return { result: n <= best() ? remember(n) : null };
      }
      case 'chain_getBlock': {
        const n = known(params[0]);
        return { result: n === null ? null : { block: { header: head(n), extrinsics: c.extrinsics?.[n] ?? [] }, justifications: null } };
      }
      case 'state_getRuntimeVersion': {
        const rv = c.runtime ?? { specVersion: 107, transactionVersion: 2 };
        return { result: { specName: 'lunes-nightly', implName: 'lunes-nightly', authoringVersion: 1, implVersion: 1, stateVersion: 2, apis: [], ...rv } };
      }
      case 'state_getMetadata': return c.metadata ? { result: c.metadata } : { error: { code: -32601, message: 'No metadata fixture' } };
      case 'state_getStorage': {
        if (params[0] === eventsKey) { const n = known(params[1]); return { result: n === null ? null : c.events?.[n] ?? null }; }
        return { result: c.storage[params[0] as string] ?? null };
      }
      case 'system_chain': return { result: 'Cadeia de teste' };
      case 'system_accountNextIndex': return { result: c.nonce?.[params[0] as string] ?? 0 };
      // Lunes: só a parte por byte (1 000 planck/byte), como `payment_queryFeeDetails` mostrou no spike.
      case 'payment_queryInfo': return { result: { weight: { refTime: 157_000_000, proofSize: 3593 }, class: 'Normal', partialFee: String(((params[0] as string).length - 2) / 2 * 1000) } };
      case 'state_call': {
        if (params[0] !== 'TaggedTransactionQueue_validate_transaction') return { error: { code: -32601, message: 'Method not found' } };
        const v = c.validity ?? VALID_OK;
        // dados = 0x01 (Local) ‖ extrinsic ‖ hash do bloco (32 bytes)
        const xt = '0x' + (params[1] as string).slice(4, -64);
        return { result: typeof v === 'function' ? v(xt) : v };
      }
      case 'author_submitExtrinsic': {
        const submitError = typeof c.submitError === 'function' ? c.submitError() : c.submitError;
        if (submitError) return { error: { code: c.submitErrorCode ?? 1010, message: submitError } };
        submitted.push(params[0] as string);
        if (c.dropSubmitResponses) {
          if (typeof c.dropSubmitResponses === 'number') c.dropSubmitResponses--;
          return { drop: true };
        }
        return { result: extrinsicHashOf(params[0] as string) };
      }
      default: return { error: { code: -32601, message: 'Method not found' } };
    }
  };
  return { handle, calls, submitted };
}

/** WebSocket falso: endereços em `down` falham ao conectar, os outros respondem com `handle`. */
export function fakeConnect(handle: ReturnType<typeof substrate>['handle'], down: string[] = []) {
  const opened: string[] = [];
  const connect = (url: string): WsLike => {
    opened.push(url);
    const ws: WsLike & { readyState: number } = {
      readyState: 0, onopen: null, onmessage: null, onerror: null, onclose: null,
      send(data: string) {
        const m = JSON.parse(data) as { id: number; method: string; params: unknown[] };
        const r = handle(m.method, m.params);
        if (r.drop) return;
        setTimeout(() => ws.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id: m.id, ...r }) }), 1);
      },
      close() { ws.readyState = 3; },
    };
    setTimeout(() => {
      if (down.includes(url)) { ws.readyState = 3; ws.onerror?.({}); ws.onclose?.({}); }
      else { ws.readyState = 1; ws.onopen?.({}); }
    }, 1);
    return ws;
  };
  return { connect, opened };
}

/** Servidor WebSocket mínimo (RFC 6455: handshake, quadros de texto) em 127.0.0.1 que responde JSON-RPC. */
export async function wsServer(handle: ReturnType<typeof substrate>['handle']): Promise<{ url: string; close: () => Promise<void> }> {
  const sockets = new Set<Socket>();
  const server: Server = createServer((_, res) => { res.writeHead(426).end(); });
  server.on('upgrade', (req, socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    let buf = Buffer.alloc(0);
    const send = (text: string) => {
      const p = Buffer.from(text);
      const h = p.length < 126 ? Buffer.from([0x81, p.length]) : p.length < 65536 ? Buffer.from([0x81, 126, p.length >> 8, p.length & 255]) : (() => { const b = Buffer.alloc(10); b[0] = 0x81; b[1] = 127; b.writeBigUInt64BE(BigInt(p.length), 2); return b; })();
      socket.write(Buffer.concat([h, p]));
    };
    socket.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        if (buf.length < 2) return;
        const op = buf[0]! & 0x0f;
        let len = buf[1]! & 0x7f, o = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); o = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); o = 10; }
        if (buf.length < o + 4 + len) return;
        const mask = buf.subarray(o, o + 4);
        const data = Buffer.from(buf.subarray(o + 4, o + 4 + len).map((x, i) => x ^ mask[i % 4]!));
        buf = buf.subarray(o + 4 + len);
        if (op === 0x8) { socket.end(Buffer.from([0x88, 0])); return; }
        if (op !== 0x1) continue;
        const m = JSON.parse(data.toString()) as { id: number; method: string; params: unknown[] };
        send(JSON.stringify({ jsonrpc: '2.0', id: m.id, ...handle(m.method, m.params) }));
      }
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `ws://127.0.0.1:${port}`,
    close: () => new Promise<void>(r => { for (const s of sockets) s.destroy(); server.close(() => r()); }),
  };
}
