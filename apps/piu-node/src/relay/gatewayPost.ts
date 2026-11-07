/**
 * Entrega de um pacote selado à caixa do validador: `POST <url>` com o corpo binário, só HTTPS, tempo
 * limite de 15 s (o mesmo contrato de apps/mobile/src/lib/carryConfig.ts). `null` sem caixa configurada
 * (ou com endereço que não serve: ver inboxUrl.ts).
 */
import { inboxUrlProblem } from './inboxUrl.js';

export function bundlePoster(url: string | null, fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {
  if (!url || inboxUrlProblem(url)) return null;
  return async (sealed: Uint8Array): Promise<{ ok: boolean; error?: string }> => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15_000);
    try {
      // Sem seguir redirecionamento: uma caixa comprometida não reenvia o corpo (escolhido por qualquer
      // remetente da malha) para dentro da rede deste nó (auditoria final, B-N1).
      const r = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: sealed as unknown as BodyInit, signal: ctl.signal, redirect: 'error' });
      return r.ok ? { ok: true } : { ok: false, error: `HTTP ${r.status}` };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
    finally { clearTimeout(timer); }
  };
}
