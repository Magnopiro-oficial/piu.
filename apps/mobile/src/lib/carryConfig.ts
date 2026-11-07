/**
 * Parâmetros da carga pela malha (docs/carteira/transacoes-pela-malha.md).
 *
 * `VALIDATOR_INBOX_URL`: caixa de entrada HTTPS do validador para os pacotes selados de evidências e
 * registro. `null` até quem opera o validador publicar o endereço (não invente um aqui): sem ela, os
 * gateways deste app não pegam pacotes (seguem na malha até um gateway que tenha) e o arquivo manual
 * continua sendo o caminho. A chave que sela os pacotes é a mesma das provas v2 (`VALIDATOR_PROOF_PK`).
 */
export const VALIDATOR_INBOX_URL: string | null = null;

/** Celular como gateway: desligado de fábrica (gasta dados e bateria; ver `net.gateway`). */
export const PHONE_GATEWAY_DEFAULT = false;
/** De quanto em quanto tempo o celular-gateway confere se tem rota até a Lunes (ms). */
export const GATEWAY_PROBE_MS = 60_000;
/** Rodada do gateway: novas tentativas e acompanhamento das enviadas (ms). */
export const GATEWAY_TICK_MS = 15_000;

/**
 * Entrega um pacote selado à caixa do validador: `POST <url>` com o corpo binário. Só HTTPS (o conteúdo
 * já vai cifrado, mas o endereço não deve ser trocado no caminho). Tempo limite de 15 s.
 */
export function bundlePoster(url: string | null, fetcher: typeof fetch = globalThis.fetch?.bind(globalThis)) {
  if (!url || !/^https:\/\/[^\s/]+/i.test(url)) return null;
  return async (sealed: Uint8Array): Promise<{ ok: boolean; error?: string }> => {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => ctl?.abort(), 15_000);
    try {
      const r = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: sealed as unknown as BodyInit, signal: ctl?.signal });
      return r.ok ? { ok: true } : { ok: false, error: `HTTP ${r.status}` };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
    finally { clearTimeout(timer); }
  };
}
