/**
 * Núcleo do nó: um por processo, fora da árvore React. Deslizar o app dos recentes destrói a Activity e
 * desmonta os providers, mas o processo, o runtime JS e o PiuRelayService seguem vivos; quem liga e
 * desliga BLE/Nearby e a rede local agora é este núcleo, e o desmonte da tela não para nada.
 * - `configure` recebe os ajustes (da tela ou do que está salvo) e só religa o que mudou de verdade.
 * - `shutdown` é o único caminho que para tudo ("Apagar dados locais"); `untilStopped` espera por ele
 *   (a tarefa sem tela, core/coreTask.ts, fica viva até lá).
 * - `claimRuntime`: um dono só configura o núcleo (uma segunda árvore viva é erro, não um segundo nó).
 * Sem react-native: roda no app (core/index.ts liga as peças reais) e nos testes.
 */
import { dailyNodeName } from '../lib/nodeName';
import { loraMedia, type LoraMode } from '../lib/piuLora';
import { createStopGate } from '../lib/stopGate';
import type { KeyPair } from '../protocol/keys';
import type { MediaGrants } from '../transport/grants';
import { lanWanted } from '../transport/lan/policy';
import type { WifiInfo } from '../transport/lan/types';
import type { Medium, Peer, Transport, TransportState } from '../transport/types';

export interface CoreConfig {
  /** Segredo do nome do nó (lib/nodeName.ts): o núcleo calcula o nome do dia e religa na virada. */
  nameSecret: string | null;
  /** BLE/Nearby: onboarding feito, um dos dois ligado na aba Rede e com permissão. */
  p2p: boolean;
  /** Rede local (Wi-Fi): `null` = desligada. `relay` só vale na partida (depois, `lan.setRelay`). */
  lan: { nodeKeyFor: (day: number) => KeyPair; wifiIp: string | null; relay: boolean } | null;
}

export interface CoreStatus {
  state: TransportState;
  reason?: string;
  peers: Record<string, Peer>;
  /** Nome anunciado hoje (`''` enquanto não há segredo). */
  nodeName: string;
}

/** Configuração lida do que está salvo (sem tela): `media` vai para `setMediaEnabled` antes de ligar. */
export interface PersistedBoot { config: CoreConfig; media?: Partial<Record<Medium, boolean>> }

export interface CoreDeps {
  transport: Transport;
  serviceId: string;
  /** Lê o que está salvo (chamado uma vez, no `boot`). */
  load?: () => Promise<PersistedBoot | null>;
  now?: () => number;
  log?: (msg: string) => void;
}

export interface Core {
  readonly transport: Transport;
  /** Idempotente: a segunda chamada espera a mesma partida. */
  boot(): Promise<void>;
  configure(c: Partial<CoreConfig>, o?: { restartP2p?: boolean }): void;
  status(): CoreStatus;
  subscribe(fn: () => void): () => void;
  /** Permissões negadas (a tela pede; o núcleo só mostra o motivo). */
  markUnavailable(reason: string): void;
  /** Posse do núcleo para quem configura; `null` (e erro no log) se outro dono está vivo. */
  claimRuntime(owner: string): (() => void) | null;
  /** Para P2P e LAN. Único caminho de parada; configurar de novo religa. */
  shutdown(): Promise<void>;
  /** Resolve na próxima `shutdown` (depois de parado). */
  untilStopped(): Promise<void>;
}

/** O mesmo índice de `nodeDayOf` (state/keys.tsx): o dia UTC. */
const dayOf = (ms: number) => Math.floor(ms / 86_400_000);
const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
const validSecret = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);

export function createCore(deps: CoreDeps): Core {
  const { transport } = deps;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (m => console.error(m));
  const lan = transport.lan ?? null;
  // Religar (nome novo, outro Wi-Fi): o start espera o stop anterior terminar (lib/stopGate.ts).
  const stops = createStopGate();
  const lanStops = createStopGate();
  let cfg: CoreConfig = { nameSecret: null, p2p: false, lan: null };
  let configured = false;
  let owner: string | null = null;

  // ── Estado e vizinhos (antes no TransportProvider): ficam aqui, a tela só lê ──
  let st: CoreStatus = { state: 'off', peers: {}, nodeName: '' };
  const subs = new Set<() => void>();
  const set = (next: CoreStatus) => { st = next; subs.forEach(fn => { try { fn(); } catch { /* ouvinte */ } }); };
  const setPeers = (f: (p: Record<string, Peer>) => Record<string, Peer>) => { const p = f(st.peers); if (p !== st.peers) set({ ...st, peers: p }); };
  transport.subscribe(e => {
    switch (e.type) {
      case 'state': set({ ...st, state: e.state, reason: e.reason, peers: e.state === 'off' ? {} : st.peers }); break;
      case 'peerFound': setPeers(p => ({ ...p, [e.peer.id]: { ...e.peer, connected: p[e.peer.id]?.connected ?? false } })); break;
      case 'peerLost': setPeers(p => { if (!p[e.id]) return p; const { [e.id]: _gone, ...rest } = p; return rest; }); break;
      case 'connected': setPeers(p => ({ ...p, [e.id]: { ...p[e.id], id: e.id, name: e.name ?? p[e.id]?.name ?? e.id, via: p[e.id]?.via ?? transport.kind, connected: true } })); break;
      case 'disconnected': setPeers(p => (p[e.id] ? { ...p, [e.id]: { ...p[e.id], connected: false } } : p)); break;
      case 'envelope': break; // a camada de mensagens (LNNP) consome isto
    }
  });

  // ── Liga/desliga: compara o que está rodando com o que foi pedido ──
  let p2pOn: string | null = null; // nome com que o P2P foi ligado
  let p2pGen = 0;
  let lanOn: string | null = null; // chave do dia + nome + IP com que a LAN foi ligada
  let lanGen = 0;
  let hourly: ReturnType<typeof setInterval> | null = null;
  let daily: ReturnType<typeof setInterval> | null = null;

  const apply = (restartP2p = false) => {
    const day = dayOf(now());
    const name = cfg.nameSecret ? dailyNodeName(cfg.nameSecret, day) : '';
    if (name !== st.nodeName) set({ ...st, nodeName: name });

    const wantP2p = cfg.p2p && name ? name : null;
    if (wantP2p !== p2pOn || (restartP2p && wantP2p)) {
      const gen = ++p2pGen;
      if (p2pOn !== null) stops.stop(() => transport.stop());
      p2pOn = wantP2p;
      if (wantP2p) {
        void stops.idle().then(() => {
          if (gen !== p2pGen) return;
          return transport.start(wantP2p, deps.serviceId).catch((err: unknown) => {
            // Não ficou ligado: a próxima `configure` (ex.: reabrir o app) tenta de novo.
            if (gen === p2pGen) p2pOn = null;
            set({ ...st, state: 'unavailable', reason: String((err as Error)?.message ?? err) });
          });
        });
      }
    }

    const l = lan && cfg.lan && name ? cfg.lan : null;
    const wantLan = l ? `${hex(l.nodeKeyFor(day).pk)}|${name}|${l.wifiIp ?? ''}` : null;
    if (wantLan !== lanOn) {
      const gen = ++lanGen;
      if (hourly) { clearInterval(hourly); hourly = null; }
      if (lanOn !== null) lanStops.stop(() => lan!.stop());
      lanOn = wantLan;
      if (l && lan) {
        // Chave técnica do nó do dia (gira à meia-noite UTC, como a do mensageiro): conferida de hora em hora.
        void lanStops.idle().then(() => { if (gen === lanGen) return lan.start({ node: l.nodeKeyFor(dayOf(now())), name, relay: l.relay }); })
          .catch(() => { if (gen === lanGen) lanOn = null; }); // falhou ao ligar: a próxima `configure` tenta de novo
        hourly = setInterval(() => lan.setNode(l.nodeKeyFor(dayOf(now()))), 3_600_000);
      }
    }

    // Virou o dia UTC: nome novo, o transporte religa (antes era o `nameDay` do TransportProvider).
    const anyOn = p2pOn !== null || lanOn !== null;
    if (anyOn && !daily) daily = setInterval(() => { if (dayOf(now()) !== day0) { day0 = dayOf(now()); apply(); } }, 60_000);
    else if (!anyOn && daily) { clearInterval(daily); daily = null; }
  };
  let day0 = dayOf(now());

  const configure = (c: Partial<CoreConfig>, o?: { restartP2p?: boolean }) => {
    configured = true;
    cfg = { ...cfg, ...c };
    day0 = dayOf(now());
    apply(!!o?.restartP2p);
  };

  let booting: Promise<void> | null = null;
  const stopped = new Set<() => void>();
  return {
    transport,
    boot: () => (booting ??= (async () => {
      const r = await deps.load?.().catch(() => null);
      // A tela chegou antes (já configurou com o que tem de mais novo): o salvo não passa por cima.
      if (!r || configured) return;
      if (r.media) transport.setMediaEnabled?.(r.media);
      configure(r.config);
    })()),
    configure,
    status: () => st,
    subscribe: fn => { subs.add(fn); return () => { subs.delete(fn); }; },
    markUnavailable: reason => set({ ...st, state: 'unavailable', reason }),
    claimRuntime: who => {
      if (owner !== null) { log(`Piu: núcleo já tem dono (${owner}); ${who} não configura nada.`); return null; }
      owner = who;
      let held = true;
      return () => { if (held) { held = false; owner = null; } };
    },
    shutdown: async () => {
      cfg = { ...cfg, p2p: false, lan: null };
      apply();
      await Promise.all([stops.idle(), lanStops.idle()]);
      const waiting = [...stopped];
      stopped.clear();
      waiting.forEach(fn => fn());
    },
    untilStopped: () => new Promise<void>(r => { stopped.add(r); }),
  };
}

/**
 * Rede local pedida pela tela (TransportProvider). `undefined` = sem opinião: o Wi-Fi ainda não foi
 * lido ao montar, e mandar `null` derrubaria a LAN que o núcleo mantinha ligada sem a tela.
 */
export function screenLan(i: { hasLan: boolean; want: boolean; wifi: WifiInfo | null; nodeKeyFor: ((day: number) => KeyPair) | null; relay: boolean }): CoreConfig['lan'] | undefined {
  if (i.hasLan && i.wifi === null) return undefined;
  return i.hasLan && i.want && i.nodeKeyFor ? { nodeKeyFor: i.nodeKeyFor, wifiIp: i.wifi?.ip ?? null, relay: i.relay } : null;
}

/**
 * Segredo do nome do nó (`transport.nameSecret`), com um dono só (core/index.ts): lê o salvo ou cria
 * e grava um. `write` muda a memória na hora (persistNow), então quem chega junto lê o mesmo. Sem
 * conseguir gravar (ex.: "Apagar dados locais" em andamento), segue com o novo só em memória.
 */
export async function ensureNameSecret(io: { read: () => unknown; write: (s: string) => Promise<void>; create: () => string }): Promise<string> {
  const saved = io.read();
  if (validSecret(saved)) return saved;
  const s = io.create();
  await io.write(s).catch(() => {});
  return s;
}

/** Padrões de state/network.tsx (`net.tx`, `net.lan`, `net.relay`, `net.loraMode`). */
const TX_DEFAULT = { ble: true, direct: true, mesh: false, lora: false, eth: false };

/**
 * Configuração inicial a partir do que está salvo, para ligar sem tela (sem `useNetwork` nem
 * `useSettings`). Mesmas regras do TransportProvider; as permissões são as já concedidas.
 */
export function persistedConfig(i: {
  read: <T>(key: string) => T | undefined;
  grants: MediaGrants;
  nodeKeyFor: ((day: number) => KeyPair) | null;
  wifi: WifiInfo | null;
  lanAvailable: boolean;
}): PersistedBoot {
  const onboarded = i.read<boolean>('onboarded') === true;
  const tx = { ...TX_DEFAULT, ...i.read<Partial<typeof TX_DEFAULT>>('net.tx') };
  const secret = i.read<string>('transport.nameSecret');
  const media = { ble: tx.ble && i.grants.ble, nearby: tx.direct && i.grants.nearby, ...loraMedia(i.read<LoraMode>('net.loraMode') ?? 'auto', tx.lora) };
  const lanOn = lanWanted({ available: i.lanAvailable, onboarded, hasNode: !!i.nodeKeyFor, pref: i.read<boolean>('net.lan') ?? true, wifi: i.wifi }).on;
  return {
    media,
    config: {
      nameSecret: validSecret(secret) ? secret : null,
      p2p: onboarded && (media.ble || media.nearby),
      lan: lanOn && i.nodeKeyFor ? { nodeKeyFor: i.nodeKeyFor, wifiIp: i.wifi?.ip ?? null, relay: i.read<boolean>('net.relay') ?? true } : null,
    },
  };
}
