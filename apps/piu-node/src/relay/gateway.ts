/**
 * piu-node como gateway principal da carga pela malha (docs/carteira/transacoes-pela-malha.md):
 * transações Lunes assinadas nos celulares chegam pelos enlaces LNNP, este nó envia à Mainnet e
 * devolve recibos pela malha; pacotes selados de evidências vão para a caixa do validador, se
 * configurada (`PIU_VALIDATOR_INBOX`). O nó não tem chave de carteira e não lê os pacotes.
 *
 * Só pega transações enquanto a Lunes responde (sonda de tempos em tempos): sem rota, as cargas seguem
 * pela malha como envelopes de terceiros para outro gateway.
 */
import { bundlePoster } from './gatewayPost.js';
import { CarryGateway, type GatewayLimits } from '../lunes/carryGateway.js';
import { extrinsicHash, finalizedHead, LunesRpc, toHex } from '../lunes/lunesRpc.js';
import { bundleRef, CarryKind, type CarryStatus, type OpenedCarry } from '../protocol/carry.js';
import type { RelayEngine } from './engine.js';

export interface GatewayOptions {
  /** Endereços WebSocket da Lunes (padrão: os de produção). */
  endpoints?: string[];
  /**
   * Caixa HTTPS do validador para os pacotes. `null`: este nó não pega pacotes. Função: lida a cada uso
   * (o painel muda a caixa sem reiniciar o nó).
   */
  inboxUrl: string | null | (() => string | null);
  /** Gateway ligado agora (ajuste do painel). Ausente: sempre ligado. Desligado, não pega nenhuma carga. */
  enabled?: () => boolean;
  /** Cliente da Lunes (testes). */
  rpc?: () => LunesRpc;
  fetch?: typeof fetch;
  now?: () => number;
  log?: (m: string) => void;
  probeMs?: number;
  tickMs?: number;
  limits?: Partial<GatewayLimits>;
}

export interface GatewayHandle {
  /** Papel em vigor agora (para o motor e o painel). */
  roles(): { tx: boolean; inbox: boolean };
  /** O motor chama com cada carga aberta. */
  onCarry(c: OpenedCarry): void;
  /** O motor já existe (o motor recebe o gateway na construção; o gateway responde por ele). */
  attach(engine: RelayEngine): void;
  /** Sonda a Lunes agora (também roda sozinho). */
  probe(): Promise<boolean>;
  tick(): Promise<void>;
  stats(): { online: boolean; inbox: boolean; tracked: number; queued: number } & CarryGateway['counters'];
  /** Últimas cargas tratadas (mais nova primeiro), para o painel: referência, tipo, estado e horário. */
  recent(limit?: number): GatewayRecent[];
  stop(): void;
}

/**
 * Uma carga que passou por este gateway, como o painel mostra. `ref`: hash da transação (0x…) ou do
 * pacote; `status`: o que a Lunes (ou a caixa) respondeu por último; `queued`: esperando nova tentativa.
 * Nada de quem mandou: a carga chega com uma identidade descartável, que não fica aqui.
 */
export interface GatewayRecent { ref: string; kind: 'tx' | 'evidence'; status: CarryStatus | 'queued'; reason: string | null; at: number }
const RECENT_MAX = 50;

export function createGateway(o: GatewayOptions): GatewayHandle {
  const rpc = o.rpc ?? (() => new LunesRpc(o.endpoints ? { endpoints: o.endpoints } : {}));
  const now = o.now ?? (() => Math.floor(Date.now() / 1000));
  // A caixa pode mudar pelo painel: o entregador é refeito quando o endereço muda.
  const inboxOf = typeof o.inboxUrl === 'function' ? o.inboxUrl : () => o.inboxUrl as string | null;
  let postFor: { url: string | null; post: ReturnType<typeof bundlePoster> } = { url: inboxOf(), post: bundlePoster(inboxOf(), o.fetch) };
  const poster = () => {
    const url = inboxOf();
    if (url !== postFor.url) postFor = { url, post: bundlePoster(url, o.fetch) };
    return postFor.post;
  };
  const enabled = o.enabled ?? (() => true);
  let engine: RelayEngine | null = null;
  let online = false;
  // As últimas cargas (só referência e horário); o estado vem do gateway na hora da leitura.
  const recentRefs: { ref: string; kind: 'tx' | 'evidence'; at: number }[] = [];
  const noteCarry = (c: OpenedCarry) => {
    let ref: string;
    try { ref = c.item.kind === CarryKind.Tx ? extrinsicHash(c.item.extrinsic) : toHex(bundleRef(c.item.sealed)); } catch { return; }
    const i = recentRefs.findIndex(x => x.ref === ref);
    if (i >= 0) recentRefs.splice(i, 1);
    recentRefs.unshift({ ref, kind: c.item.kind === CarryKind.Tx ? 'tx' : 'evidence', at: now() });
    recentRefs.length = Math.min(recentRefs.length, RECENT_MAX);
  };
  const gw = new CarryGateway({
    rpc, now, log: o.log,
    get postBundle() { return enabled() ? poster() : null; },
    reply: (to, rc) => { if (engine) engine.sendCarryReceipt(to, rc); },
  }, o.limits);
  const probe = async () => {
    // Desligado no painel: nem consulta a Lunes (e não pega carga nenhuma).
    if (!enabled()) { online = false; return false; }
    const c = rpc();
    try { await finalizedHead(c); if (!online) o.log?.('gateway: Lunes alcançável; aceitando transações da malha'); online = true; }
    catch { if (online) o.log?.('gateway: sem rota até a Lunes; as cargas seguem pela malha'); online = false; }
    finally { c.close(); }
    return online;
  };
  const timers = [setInterval(() => { void probe(); }, o.probeMs ?? 60_000), setInterval(() => { void gw.tick(); }, o.tickMs ?? 15_000)];
  for (const t of timers) t.unref();
  return {
    roles: () => (enabled() ? { tx: online, inbox: !!poster() } : { tx: false, inbox: false }),
    onCarry: c => {
      if (!enabled()) return;
      if (c.item.kind === CarryKind.Tx || c.item.kind === CarryKind.Evidence) noteCarry(c);
      void gw.handle(c).then(r => o.log?.(`gateway: carga ${c.id.slice(0, 8)}… → ${r}`));
    },
    attach: e => { engine = e; },
    probe, tick: () => gw.tick(),
    stats: () => ({ online: enabled() && online, inbox: enabled() && !!poster(), tracked: gw.trackedCount, queued: gw.queuedCount, ...gw.counters }),
    recent: (limit = 20) => recentRefs.slice(0, Math.max(0, Math.min(limit, RECENT_MAX))).flatMap(x => {
      const st = gw.statusOf(x.ref);
      // Esquecida pelo gateway (fila cheia, memória de duplicatas): some da lista também.
      if (!st) return [];
      // "error" sem motivo = ainda tentando (fila de nova tentativa), como o gateway trata.
      const status: GatewayRecent['status'] = st.status === 'error' && !st.reason ? 'queued' : st.status;
      return [{ ref: x.ref, kind: x.kind, status, reason: st.reason ?? null, at: x.at }];
    }),
    stop: () => { for (const t of timers) clearInterval(t); },
  };
}
