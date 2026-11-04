/**
 * Nó Substrate de teste para a leitura da Lunes: responde JSON-RPC no formato de um nó Substrate.
 * Deste ambiente não há rota até a Mainnet, então nada aqui foi gravado dela: os valores são de
 * teste. A conta é a "Alice" de desenvolvimento do Substrate (chave pública conhecida, sem valor em
 * rede de produção). Dois jeitos de servir: WebSocket falso em memória (qualquer Node) e um servidor
 * WebSocket de verdade em 127.0.0.1 (para provar o WebSocket global do Node 22 com o cliente).
 */
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

export function substrate(c: { finalized: number; storage: Record<string, string> }) {
  const head = (n: number) => ({ parentHash: hashOf(`bloco ${n - 1}`), number: '0x' + n.toString(16), stateRoot: hashOf(`estado ${n}`), extrinsicsRoot: hashOf(`extr ${n}`), digest: { logs: [] } });
  const calls: string[] = [];
  const handle = (method: string, params: unknown[]): { result?: unknown; error?: { code: number; message: string } } => {
    calls.push(method);
    switch (method) {
      case 'chain_getFinalizedHead': return { result: hashOf(`bloco ${c.finalized}`) };
      case 'chain_getHeader': return { result: params[0] === hashOf(`bloco ${c.finalized}`) || params[0] === undefined ? head(c.finalized) : null };
      case 'state_getStorage': return { result: c.storage[params[0] as string] ?? null };
      case 'system_chain': return { result: 'Cadeia de teste' };
      default: return { error: { code: -32601, message: 'Method not found' } };
    }
  };
  return { handle, calls };
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
