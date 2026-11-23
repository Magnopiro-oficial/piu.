/**
 * Modem por TCP: o mesmo fluxo de bytes da porta serial, só que num soquete. Serve para o TNC por
 * software (Direwolf abre a porta KISS em `tcp://127.0.0.1:8001`). Se a conexão cai, tenta de novo
 * sozinho; o que for escrito enquanto ela está fora se perde (o roteador manda de novo depois).
 */
import { connect, type Socket } from 'node:net';
import type { Modem } from './serial.js';

const RETRY_MS = 5000;

export function openTcpModem(url: string): Promise<Modem> {
  const m = /^tcp:\/\/(\[[^\]]+\]|[^:/]+):(\d{1,5})$/.exec(url);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 65535) return Promise.reject(new Error(`Endereço do modem inválido: ${url} (use tcp://endereço:porta).`));
  const host = m[1]!.replace(/^\[|\]$/g, ''), port = Number(m[2]);
  let cb: ((b: Uint8Array) => void) | null = null;
  let sock: Socket | null = null, closed = false, everUp = false, retry: ReturnType<typeof setTimeout> | null = null;

  const dial = (first?: { ok: () => void; fail: (e: Error) => void }) => {
    const s = connect({ host, port });
    s.setNoDelay(true);
    s.on('data', d => cb?.(d));
    s.once('connect', () => { sock = s; first?.ok(); });
    s.once('error', e => { if (!everUp) first?.fail(e); });
    s.once('close', () => {
      if (sock === s) sock = null;
      // A primeira tentativa falha na hora (como porta serial ausente); depois de conectado, reconecta.
      if (closed || !everUp) return;
      retry = setTimeout(() => dial(), RETRY_MS);
      retry.unref();
    });
  };

  return new Promise((ok, fail) => {
    dial({
      ok: () => {
        everUp = true;
        ok({
          label: url,
          write: b => { sock?.write(b); },
          onData: f => { cb = f; },
          close: () => { closed = true; if (retry) clearTimeout(retry); sock?.destroy(); },
        });
      },
      fail,
    });
  });
}
