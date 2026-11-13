/**
 * Mensageiro do núcleo: um por processo, fora da árvore React. Antes vivia no MessagingProvider e o
 * desmonte da tela (deslizar o app dos recentes) salvava, descartava o Messenger e o serviço de
 * chamada: com o processo vivo, nada mais decifrava o que chegava. Agora:
 * - `start(chaves)` cria o mensageiro uma vez; chamar de novo com as mesmas chaves (a tela remontou)
 *   devolve o mesmo. Chaves novas ou rotação de sessões trocam, salvando o anterior.
 * - Os eventos gravam no `chatStore` (core/chatStore.ts) e os banners viram notificação sem tela;
 *   os toques levam `href` (sem router: lib/notifications.ts e o <Toast/> abrem a rota).
 * - Política do roteador, bloqueados, descoberta, retransmissão, gateway e a chamada de voz são
 *   aplicados aqui (`setPrefs`); transporte → mensageiro e o `tick` também.
 * - Nada é descartado ao desmontar: só `shutdown()` para e salva.
 * Sem react-native: roda no app (core/index.ts liga as peças reais) e nos testes.
 */
import type { Chat, TempMode } from '../data/types';
import { cleanBlocked, cleanChats, cleanVerified } from '../lib/demoCleanup';
import { finalizedHead, LunesRpc } from '../lib/lunesRpc';
import { carryBridge } from '../lib/carryBridge';
import { bundlePoster, GATEWAY_PROBE_MS, GATEWAY_TICK_MS, PHONE_GATEWAY_DEFAULT, VALIDATOR_INBOX_URL } from '../lib/carryConfig';
import { CarryGateway } from '../lib/carryGateway';
import { payRequestSummary, type PaymentJudgement } from '../lib/paymentRequest';
import { addRoute, cleanBook, makeRoute, patchRoute, pruneRoutes, type RouteBook, trimBook } from '../lib/routeCore';
import { placeFromText } from '../lib/locationCore';
import { initialsOf, nowHM } from '../lib/text';
import { STORED, nearAcceptedText } from '../lib/storedText';
import { fmtLunes } from '../data/wallet';
import { type Contact, type IncomingFile, Messenger, type RouteInfo } from '../messaging/messenger';
import { canPost, type GroupState, memberCount } from '../messaging/groups';
import { type HoursPolicy, policyHours } from '../messaging/hours';
import type { AlertNotice, AlertView } from '../messaging/communityAlerts';
import { t } from '../i18n/core';
import { mergePolicy, NO_POINT, type PointRuntime } from '../lib/pointCore';
import { alertCategoryName, alertSeverityName, alertStatusName, officialNote } from '../i18n/alerts';
import { GroupRate, groupShouldNotify } from '../messaging/mentions';
import { nodeModeLimits, notePeer, type PhoneNodeState, receiveEndorsement, receiveRequest } from '../lib/phoneNodeCore';
import { createDeviceChange, decodeNotice, type DeviceChangeOutbox, type DeviceChangeReason, encodeDeviceChange, encodeRevocation, isNewDeviceChange, type RevocationNotice, verifyDeviceChange, verifyRevocation } from '../lib/devicesCore';
import { toHex } from '../protocol/bytes';
import { unb64url } from '../messaging/card';
import type { Identity, IdentityKind, KeyPair } from '../protocol';
import { toBase64 } from '../transport/base64';
import { type AutoDownload, PREVIEW_MAX_BYTES } from '../lib/mediaCore';
import { isLora } from '../transport/select';
import type { Medium, Transport } from '../transport/types';
import type { Privacy } from '../state/settings';
import type { PhoneCall, PhoneCallDeps } from '../state/calls';
import { SWEEP_MS, type ChatStore } from './chatStore';

const STATE_KEY = 'msg.state';
/** Último aviso de troca de aparelho aceito de cada contato (contra repetição). */
const CHANGES_SEEN = 'dev.changeSeen';
/** Rotas das conversas (lib/routeCore.ts); só gravadas com "Não guardar rotas no aparelho" desligado. */
const ROUTES_KEY = 'routes';
const PAYS_KEY = 'pay.requests';
const MAX_PAYS = 200;
/** Chaves salvas cujo dono é este arquivo (core/__tests__/keyOwners.test.ts). */
export const RUNTIME_KEYS = [STATE_KEY, PAYS_KEY, ROUTES_KEY, CHANGES_SEEN] as const;

const SAVE_DELAY = 300;
const nowSec = () => Math.floor(Date.now() / 1000);
/** Intervalo do tick do mensageiro (e do pulso nativo do PiuRelayService). */
const TICK_MS = 5000;

/** Id da conversa de um contato real (curto e seguro para a URL). */
export const chatIdFor = (contactId: string) => 'p' + contactId.replace(/^piu:/, '').slice(0, 20);
/** Prefixo do link de convite de grupo, canal ou comunidade. */
export const GROUP_LINK = 'piug:';
export const chatIdForGroup = (gid: string) => 'g' + gid.slice(0, 20);

/** Mensagem de sistema do contato que trocou de aparelho. A identidade é a mesma: o código de segurança não muda. */
export const deviceChangeText = (who: string, reason: 'phrase' | 'file') =>
  `${who} trocou de aparelho (restaurou ${reason === 'phrase' ? 'pela frase' : 'de um arquivo de backup'}). Aviso assinado pela chave da identidade: as chaves de sessão foram renovadas e o código de segurança continua o mesmo. Se você não esperava, confirme com a pessoa.`;

/** Arquivos recebidos nesta execução do app (o conteúdo não vai para o armazenamento). */
export const receivedFiles = new Map<string, IncomingFile>();
/** Teto do que fica na memória: passando, sai o arquivo mais antigo (abrir fica indisponível nele). */
const RECEIVED_MAX_BYTES = 128 * 1024 * 1024;
const RECEIVED_MAX_FILES = 64;
function keepReceived(key: string, f: IncomingFile) {
  receivedFiles.delete(key);
  receivedFiles.set(key, f);
  let total = 0;
  for (const x of receivedFiles.values()) total += x.data.length;
  while (receivedFiles.size > 1 && (receivedFiles.size > RECEIVED_MAX_FILES || total > RECEIVED_MAX_BYTES)) {
    const [k, old] = receivedFiles.entries().next().value as [string, IncomingFile];
    receivedFiles.delete(k);
    total -= old.data.length;
  }
}

/** Pedido de pagamento salvo no aparelho (planck como texto: JSON não guarda BigInt). */
export interface PayRecord {
  id: string; chatId: string; dir: 'out' | 'in';
  address: string; planck: string | null; desc: string;
  /** Segundos. */
  createdAt: number; expiresAt: number;
  /** Só `out`: saldo livre (planck) quando o pedido foi criado; null = nunca lido (a conferência pelo saldo não dá). */
  baseline?: string | null;
  /** "Já paguei": `in` = eu avisei; `out` = o contato avisou (sem valer como pago). */
  paid?: { txHash?: string; blockHash?: string; at: number };
  /** Só `out`: última conferência na Mainnet. */
  check?: PayCheck;
}
export interface PayCheck { at: number; block: number; state: PaymentJudgement['state']; text: string }

/** Chaves do aparelho para o mensageiro (KeysProvider ou o cofre já lido, sem tela). */
export interface RuntimeKeys {
  identities: { public: Identity; anon: Identity };
  node: KeyPair;
  /** Chave técnica do nó por dia (LNNP §12.1). */
  nodeKeyFor: ((day: number) => KeyPair) | null;
  /** Chave de operador do modo nó (hex), para conferir os avais recebidos. */
  phonePk: string | null;
  /** Época da rotação de sessões (lib/migrationState.ts): mudou = mensageiro novo. */
  rotation: number;
}

/** Limites do nó aplicados no roteador (Rede e Ajustes → Armazenamento / Bateria e limites). */
export interface Policy { maxBytes: number; retentionSec: number; dailyBytes: number; bytesPerSec: number; hours: HoursPolicy }
export type RuntimePriv = Pick<Privacy, 'find' | 'read' | 'typing' | 'temp' | 'delay' | 'pad' | 'noRoutes'>;
export interface RuntimePrefs {
  /** Modo nó ligado e não pausado, ou o Ponto Piu guardando para terceiros. */
  relay: boolean;
  /** Celular como gateway (`net.gateway`) ou o Ponto no nível gateway. */
  gateway: boolean;
  priv: RuntimePriv;
  policy: Policy;
  /** Ids dos bloqueados (só contatos reais `piu:…`). */
  blocked: string[];
  /** Armazenamento → "Baixar mídia automaticamente". */
  autoDownload: AutoDownload;
  /** Nome do perfil público anunciado nos grupos (`''` com a identidade anônima). */
  displayName: string;
}

/** Política do roteador a partir dos ajustes (o mesmo cálculo de antes no MessagingProvider). */
export function policyOf(i: { storageMb: number; retentionH: number; trafficMb: number; bw: string; hours: unknown; custom: unknown; phoneNodeActive: boolean; point: PointRuntime }): Policy {
  const lim = mergePolicy({ maxBytes: i.storageMb * 1024 * 1024, retentionSec: i.retentionH * 3600 }, i.point);
  return {
    maxBytes: lim.maxBytes,
    retentionSec: lim.retentionSec,
    // Modo nó do celular: no máximo 200 MB/dia de terceiros (docs/economia/no-celular.md).
    dailyBytes: nodeModeLimits({ dailyBytes: i.trafficMb * 1024 * 1024, batteryPct: 0 }, i.phoneNodeActive).dailyBytes,
    bytesPerSec: i.bw === 'max' ? Infinity : (Number(i.bw) * 1_000_000) / 8,
    // Sempre, 22h–7h ou a faixa Personalizada (reavaliada a cada `tick`, como as outras).
    hours: policyHours(i.hours, i.custom),
  };
}

/** Padrões de state/settings.tsx (`set.priv`, `set.sto`, `set.bat`) e state/network.tsx. */
const PRIV_DEFAULT: RuntimePriv = { find: 'all', read: true, typing: true, temp: 'off', delay: false, pad: true, noRoutes: true };

/**
 * Ajustes a partir do que está salvo, para o mensageiro sem tela (sem `useSettings` nem `useNetwork`).
 * A pausa por bateria e "Só retransmitir carregando" são da tela (state/phoneNodeEffects.ts): sem ela,
 * só o Ponto Piu retransmite para terceiros, o mesmo do `detach`.
 */
export function persistedPrefs(read: <T>(key: string) => T | undefined, o: { point?: PointRuntime; phoneNodeActive?: boolean } = {}): RuntimePrefs {
  const point = o.point ?? NO_POINT;
  const priv = { ...PRIV_DEFAULT, ...read<Partial<RuntimePriv>>('set.priv') };
  const sto = { retention: '48', ...read<{ retention?: string }>('set.sto') };
  const bat = { hours: 'always', traffic: 200, bw: '5', ...read<{ hours?: string; custom?: unknown; traffic?: number; bw?: string }>('set.bat') };
  return {
    relay: point.relay,
    gateway: (read<boolean>('net.gateway') ?? PHONE_GATEWAY_DEFAULT) || point.gateway,
    priv,
    policy: policyOf({ storageMb: read<number>('net.storage') ?? 512, retentionH: Number(sto.retention), trafficMb: bat.traffic, bw: bat.bw, hours: bat.hours, custom: bat.custom, phoneNodeActive: !!o.phoneNodeActive, point }),
    blocked: cleanBlocked<{ id: string }>(read('blocked')).map(b => b.id),
    autoDownload: read<{ auto?: AutoDownload }>('set.sto')?.auto ?? 'wifi',
    displayName: profileName(read('profile')),
  };
}

/** Nome do perfil público (`profile` do StoreProvider) que o mensageiro anuncia; anônimo, nenhum. */
export function profileName(p: unknown): string {
  const v = p as { idType?: unknown; name?: unknown } | null | undefined;
  return v?.idType === 'public' && typeof v.name === 'string' ? v.name.trim() : '';
}

/** Peças do app que o mensageiro usa (core/index.ts liga as reais; sem elas, nada acontece). */
export interface RuntimeHost {
  /** Backup restaurado por arquivo (lib/migrationState.ts), uma vez. */
  takeRestoredData(): Record<string, unknown> | null;
  /** Rotação pendente (migração/revogação) descarta as sessões. */
  applySessionRotation(state: string | undefined): string | undefined;
  takeDeviceChangeRequest(): { at: number; reason: DeviceChangeReason } | null;
  deviceChangeOutbox(now: number): DeviceChangeOutbox[];
  saveDeviceChangeOutbox(list: DeviceChangeOutbox[]): Promise<void>;
  pendingRevocations(): RevocationNotice[];
  markRevocationsSent(sigs: string[]): unknown;
  /** Modo nó (lib/phoneNodeStore.ts). */
  updatePhoneNode(fn: (s: PhoneNodeState) => PhoneNodeState): Promise<unknown>;
  /** Perfil do backup restaurado (o perfil é da tela: StoreProvider). */
  importProfile(p: unknown): void;
  /** Convite pago aceito por Por perto (carteira: WalletProvider). */
  settleInvite(contactId: string): void;
  /** Serviço de chamada de voz (state/calls.tsx); `null` sem o módulo de áudio nativo. */
  makeCall(d: PhoneCallDeps): PhoneCall | null;
}
const NO_HOST: RuntimeHost = {
  takeRestoredData: () => null, applySessionRotation: s => s, takeDeviceChangeRequest: () => null,
  deviceChangeOutbox: () => [], saveDeviceChangeOutbox: async () => {}, pendingRevocations: () => [], markRevocationsSent: () => {},
  updatePhoneNode: async () => {}, importProfile: () => {}, settleInvite: () => {}, makeCall: () => null,
};

export interface RuntimeDeps {
  transport: Transport;
  chats: ChatStore;
  read: <T>(key: string) => T | undefined;
  /** Grava já (sessões: antes de qualquer envio). */
  persistNow: (key: string, value: unknown) => Promise<void>;
  /** Grava com atraso (pedidos de pagamento, como o `usePersisted` de antes); sem ele, `persistNow`. */
  schedule?: (key: string, value: unknown) => void;
  forget: (key: string) => Promise<void>;
  /** Geração dos dados (lib/persist.ts): mudou = "Apagar dados locais", não regrava o apagado. */
  epoch: () => number;
  prefs: RuntimePrefs;
  host?: Partial<RuntimeHost>;
  /** Segundos. */
  now?: () => number;
}

export interface RuntimeState {
  messenger: Messenger | null;
  call: PhoneCall | null;
  inviteEpoch: number; groupEpoch: number; nearEpoch: number; alertEpoch: number; payEpoch: number;
  pays: Record<string, PayRecord>;
  routes: RouteBook;
  /** Meios dos vizinhos de agora (lib/loraChat.ts). */
  linkMedia: Medium[];
}
type Epoch = 'invite' | 'group' | 'near' | 'alert' | 'pay';

export type MessengerRuntime = ReturnType<typeof createMessengerRuntime>;

export function createMessengerRuntime(deps: RuntimeDeps) {
  const { transport, chats: store } = deps;
  const now = deps.now ?? nowSec;
  const schedule = deps.schedule ?? ((k: string, v: unknown) => { void deps.persistNow(k, v).catch(() => {}); });
  let host: RuntimeHost = { ...NO_HOST, ...deps.host };
  let prefs = deps.prefs;
  const list = () => store.getSnapshot().chats;

  let st: RuntimeState = {
    messenger: null, call: null, inviteEpoch: 0, groupEpoch: 0, nearEpoch: 0, alertEpoch: 0, payEpoch: 0,
    pays: deps.read<Record<string, PayRecord>>(PAYS_KEY) ?? {},
    // Rotas reais: com "Não guardar rotas no aparelho" ligado, só a última de cada conversa, na memória.
    routes: prefs.priv.noRoutes ? {} : cleanBook(deps.read(ROUTES_KEY)),
    linkMedia: [],
  };
  const subs = new Set<() => void>();
  const set = (p: Partial<RuntimeState>) => { st = { ...st, ...p }; subs.forEach(fn => { try { fn(); } catch { /* ouvinte */ } }); };
  const bump = (k: Epoch) => set({ [`${k}Epoch`]: st[`${k}Epoch`] + 1 } as Partial<RuntimeState>);

  // Referências que os eventos do mensageiro usam.
  const msgToChat = new Map<string, string>();
  const groupRate = new GroupRate();
  /** Meio de cada vizinho, como o transporte informa (`via` nos eventos). */
  const peerMedium = new Map<string, Medium>();
  const syncMedia = () => { const n = [...peerMedium.values()], m = st.linkMedia; if (!(n.length === m.length && n.every((x, i) => x === m[i]))) set({ linkMedia: n }); };

  // ── Rotas ──
  let routesTimer: ReturnType<typeof setTimeout> | undefined;
  const setRoutes = (f: (b: RouteBook) => RouteBook) => {
    const routes = f(st.routes);
    if (routes === st.routes) return;
    set({ routes });
    if (prefs.priv.noRoutes) return;
    clearTimeout(routesTimer);
    routesTimer = setTimeout(() => { void deps.persistNow(ROUTES_KEY, st.routes).catch(() => {}); }, 400);
  };
  const recordRoute = (chatId: string, msgId: string, dir: 'out' | 'in', r: RouteInfo) => {
    const medium = peerMedium.get(r.peer) ?? (r.via === 'direct' ? 'nearby' : transport.kind === 'sim' ? 'sim' : 'ble');
    const rec = makeRoute({ msgId, dir, medium, bytes: r.bytes, hops: r.hops, priority: r.priority, at: Date.now() });
    setRoutes(b => addRoute(b, chatId, rec, !prefs.priv.noRoutes));
  };

  // ── Pedidos de pagamento (os mais antigos saem quando passam de MAX_PAYS) ──
  const putPay = (rec: PayRecord) => {
    const next = { ...st.pays, [rec.id]: rec };
    const ids = Object.keys(next);
    if (ids.length > MAX_PAYS) for (const id of ids.sort((a, b) => next[a]!.createdAt - next[b]!.createdAt).slice(0, ids.length - MAX_PAYS)) delete next[id];
    schedule(PAYS_KEY, next);
    set({ pays: next, payEpoch: st.payEpoch + 1 });
  };

  // Conversas mudaram: arquivo recebido de mensagem que sumiu (temporária) sai da memória, e as rotas
  // de mensagens que sumiram (temporárias, conversa apagada) também; fica a última de cada conversa.
  // Agrupado (como o useEffect([chats]) de antes): um arquivo grande chama patchFile por bloco.
  let lastChats: Chat[] | null = null;
  let chatsTimer: ReturnType<typeof setTimeout> | undefined;
  const onChats = () => { if (chatsTimer === undefined) chatsTimer = setTimeout(pruneChats, 0); };
  const pruneChats = () => {
    chatsTimer = undefined;
    const cs = list();
    if (cs === lastChats) return;
    lastChats = cs;
    const alive = new Set(cs.flatMap(c => (c.msgs ?? []).map(m => m.id)));
    if (receivedFiles.size) for (const k of [...receivedFiles.keys()]) if (!alive.has(k)) receivedFiles.delete(k);
    setRoutes(b => pruneRoutes(b, alive, new Set(cs.map(c => c.id))));
  };
  const offChats = store.subscribe(onChats);
  onChats();
  const dropChats = () => { clearTimeout(chatsTimer); chatsTimer = undefined; offChats(); };

  // Perfil do backup restaurado é da tela (StoreProvider): sem ela montada, espera o próximo `setHost`.
  let pendingProfile: unknown = null;
  const importProfile = (p: unknown) => { if (host.importProfile === NO_HOST.importProfile) pendingProfile = p; else host.importProfile(p); };
  // Convite pago aceito com o app fechado: a reserva é da carteira (WalletProvider) e passa a "pago" quando
  // a tela volta (sem isso, a devolução local de 24 h valeria com a conversa já aberta).
  const pendingSettles = new Set<string>();
  const settleInvite = (id: string) => { if (host.settleInvite === NO_HOST.settleInvite) pendingSettles.add(id); else host.settleInvite(id); };

  // ── Mensageiro ──
  let m: Messenger | null = null;
  let keys: RuntimeKeys | null = null;
  let running: string | null = null; // chaves + época com que o mensageiro atual nasceu
  let teardown: (() => Promise<void>) | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const saveNow = async () => {
    clearTimeout(saveTimer);
    if (m) await deps.persistNow(STATE_KEY, m.export());
  };
  const saveSoon = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { void saveNow().catch(() => {}); }, SAVE_DELAY);
  };

  // Celular como gateway (ajuste `net.gateway`, desligado de fábrica): só pega cargas enquanto a Lunes
  // responde; sem rota, elas seguem pela malha como envelopes de terceiros. Pacotes para o validador só
  // com a caixa configurada (VALIDATOR_INBOX_URL).
  let gw: CarryGateway | null = null;
  let gwStop: (() => void) | null = null;
  const setGateway = (on: boolean) => {
    gwStop?.(); gwStop = null;
    const messenger = m;
    if (!messenger || !on) { messenger?.setGateway({}); gw = null; return; }
    const post = bundlePoster(VALIDATOR_INBOX_URL);
    const g = new CarryGateway({ rpc: () => new LunesRpc(), now, reply: (to, rc) => messenger.sendCarryReceipt(to, rc), postBundle: post });
    gw = g;
    let alive = true;
    const probe = async () => {
      const rpc = new LunesRpc();
      try { await finalizedHead(rpc); if (alive) messenger.setGateway({ tx: true, inbox: !!post }); }
      catch { if (alive) messenger.setGateway({}); }
      finally { rpc.close(); }
    };
    void probe();
    const p = setInterval(() => { void probe(); }, GATEWAY_PROBE_MS);
    const tk = setInterval(() => { void g.tick(); }, GATEWAY_TICK_MS);
    gwStop = () => { alive = false; clearInterval(p); clearInterval(tk); messenger.setGateway({}); if (gw === g) gw = null; };
  };

  /** Ajustes → mensageiro; com `prev`, só o que mudou. */
  const applyPrefs = (prev: RuntimePrefs | null) => {
    const messenger = m;
    if (!messenger) return;
    const p = prefs;
    if (!prev || prev.relay !== p.relay) messenger.relay = p.relay;
    if (!prev || prev.gateway !== p.gateway) setGateway(p.gateway);
    // Privacidade → "Quem pode me encontrar" (identidade pública): Por perto e pedidos pelo código.
    if (!prev || prev.priv.find !== p.priv.find) { messenger.setDiscovery(p.priv.find); bump('near'); }
    // Bloqueados (só contatos reais `piu:…`): o mensageiro descarta o que eles mandam.
    if (!prev || prev.blocked.join('|') !== p.blocked.join('|')) messenger.setBlocked(p.blocked.filter(id => id.startsWith('piu:')));
    // Limites do nó aplicados no roteador.
    if (!prev || JSON.stringify(prev.policy) !== JSON.stringify(p.policy)) messenger.setPolicy(p.policy);
    if (!prev || prev.autoDownload !== p.autoDownload) messenger.setAutoDownload(p.autoDownload);
    if (!prev || prev.displayName !== p.displayName) messenger.displayName = p.displayName;
  };

  const create = (k: RuntimeKeys) => {
    const { identities, node, nodeKeyFor } = k;
    let saving: Promise<void> | null = null;
    /** Mensagem de sistema na conversa do grupo cuja chave foi trocada. */
    const rotatedNote = (g: GroupState, text: string) => {
      const cid = chatIdForGroup(g.id);
      if (list().some(x => x.id === cid)) store.push(cid, { id: `sys-rk-${g.id.slice(0, 6)}-${g.keyV}`, from: 'sys', time: nowHM(), text });
    };
    // Backup restaurado por arquivo: importa perfil, conversas e verificações uma vez.
    const restored = host.takeRestoredData();
    const restoredState = typeof restored?.['msg.state'] === 'string' ? (restored['msg.state'] as string) : undefined;
    if (restored) {
      if (restored.profile && typeof restored.profile === 'object') importProfile(restored.profile);
      // Backups antigos podem trazer as conversas de exemplo: só as reais entram.
      for (const ch of cleanChats(restored.chats)) store.addChat(ch);
      for (const id of Object.keys(cleanVerified(restored.verified, cleanChats(restored.chats)))) store.setVerified(id, true);
    }
    const msg = new Messenger({
      // Rotação pendente (migração/revogação) descarta as sessões; dados de um backup restaurado entram aqui.
      // Chave técnica do nó gira por dia (LNNP §12.1); recibos já emitidos guardam a chave deles.
      identities, node, nodeKeyFor: nodeKeyFor ?? undefined, relay: prefs.relay, now, state: host.applySessionRotation(deps.read<string>(STATE_KEY) ?? restoredState),
      randomDelay: () => prefs.priv.delay,
      pad: () => prefs.priv.pad,
      transmit: async (peerId, bytes) => {
        // Grava as sessões antes de os bytes saírem do aparelho (uma gravação por lote).
        saving ??= Promise.resolve().then(saveNow).finally(() => { saving = null; });
        await saving;
        return transport.send(peerId, bytes);
      },
      events: {
        changed: saveSoon,
        // Chamada de voz: sinais dentro da sessão cifrada (bloqueados já são descartados pelo mensageiro).
        callSignal: (contactId, payload) => st.call?.svc.onSignal(contactId, payload),
        // Carga pela malha (docs/carteira/transacoes-pela-malha.md): recibos vão para a carteira; como gateway, entrega.
        carryReceipt: (id, rc) => carryBridge.receipt(id, rc),
        gatewayCarry: c => { void gw?.handle(c); },
        inviteUsed: () => bump('invite'),
        notice: (contactId, text, pub) => {
          try {
            const got = decodeNotice(text);
            const c = m?.getContact(contactId);
            if (got.kind === 'change') {
              // Troca de aparelho: só de contato, conferida com a chave que já conhecíamos dele.
              const ch = got.n;
              if (!c || !verifyDeviceChange(ch, c.pub.signPk)) return;
              const seen = deps.read<Record<string, { at: number; sig: string }>>(CHANGES_SEEN) ?? {};
              if (!isNewDeviceChange(ch, seen[contactId])) return;
              void deps.persistNow(CHANGES_SEEN, { ...seen, [contactId]: { at: ch.at, sig: ch.sig } }).catch(() => {});
              const cid = chatIdFor(contactId);
              if (!list().some(x => x.id === cid)) return;
              const who = c.name || 'Este contato';
              store.push(cid, { id: 'sys-dc-' + ch.sig.slice(0, 12), from: 'sys', time: nowHM(), text: deviceChangeText(who, ch.reason) });
              return;
            }
            const n = got.n;
            if (!verifyRevocation(n, (c?.pub ?? pub).signPk)) return;
            // Grupos em que sou admin e o contato participa trocam de chave (o aparelho perdido tinha a antiga).
            for (const g of m?.rotateForRevocation(contactId, n.sig) ?? []) {
              const who = c?.name || g.members.find(x => x.id === contactId)?.name || 'um membro';
              rotatedNote(g, `${who} revogou um aparelho. A chave do grupo foi trocada.`);
            }
            const cid = chatIdFor(contactId);
            if (!c || !list().some(x => x.id === cid)) return;
            // Uma nota por contato a cada 10 min (pelo meu relógio): avisos em sequência não enchem a conversa.
            const rvId = `sys-rv-${contactId.slice(-12)}-${Math.floor(now() / 600)}`;
            if (list().find(x => x.id === cid)?.msgs?.some(x => x.id === rvId)) return;
            store.push(cid, { id: rvId, from: 'sys', time: nowHM(), text: STORED.sysRevoked });
          } catch { /* aviso inválido: ignora */ }
        },
        // Endereço Lunes que um contato público compartilhou (já conferido no Messenger).
        peerWallet: (contactId, address) => {
          const cid = chatIdFor(contactId);
          if (list().some(c => c.id === cid)) store.patchChat(cid, { lunes: address ?? undefined });
        },
        // Modo nó (docs/economia/no-celular.md): já conferido que é contato público aceito.
        endorseRequest: (contactId, r) => { void host.updatePhoneNode(s => receiveRequest(s, contactId, r, now())).catch(() => {}); },
        nodeStatus: (contactId, since) => { void host.updatePhoneNode(s => notePeer(s, contactId, since, now())).catch(() => {}); },
        endorsement: (contactId, e) => {
          const mine = keys?.phonePk;
          if (mine) void host.updatePhoneNode(s => receiveEndorsement(s, contactId, e, mine, now())).catch(() => {});
        },
        // Foto do perfil público de um contato (já conferida: JPEG pequeno, só de contato público).
        peerPhoto: (contactId, b64) => {
          const cid = chatIdFor(contactId);
          if (list().some(c => c.id === cid)) store.patchChat(cid, { photo: b64 ? `data:image/jpeg;base64,${b64}` : undefined });
        },
        // Banners com tipo também viram notificação do sistema (chatStore → notify), com a rota em `href`.
        lotClosed: lot => store.showToast({ kind: 'wallet', href: '/(tabs)/wallet', icon: 'toll', coin: true, title: `Lote fechado · ${lot.lunes.toFixed(2).replace('.', ',')} LUNES em lote`, body: `${lot.count} entregas comprovadas · aguardando liquidação (nada foi pago ainda)` }),
        // Por perto: perfis, pedidos recebidos e convite meu aceito.
        nearbyChanged: () => bump('near'),
        nearRequest: r => store.showToast({ kind: 'nearby', href: '/nearby/requests', icon: 'waving_hand', title: `${r.name} quer conversar`, body: `+${fmtLunes(r.fee)} LUNES se você aceitar · expira em 24 h`, action: 'Ver',
          hidden: { title: 'Pedido de conversa', body: 'Abra Por perto para ver.' } }),
        nearAccepted: (c, fee) => {
          settleInvite(c.id);
          const cid = chatIdFor(c.id);
          if (!list().some(x => x.id === cid)) store.addChat(nearChat(c, prefs.priv.temp, nearAcceptedText(c.name)));
          store.showToast({ kind: 'nearby', href: `/chat/${cid}`, icon: 'waving_hand', title: `${c.name || 'Alguém'} aceitou seu convite`, body: `A conversa abriu. ${fmtLunes(fee)} LUNES saem da reserva (registro local, sem Mainnet).`, action: 'Abrir',
            hidden: { title: 'Convite aceito', body: 'Abra Por perto para ver.' } });
        },
        // Alertas da comunidade: a lista atualiza; Grave notifica (crítica), Atenção notifica normal.
        communityAlert: (v, notice) => {
          bump('alert');
          if (!notice) return;
          const ch = list().find(c => c.id === chatIdForGroup(v.community));
          if (ch?.muted) return; // comunidade silenciada
          store.showToast(alertToast(v, notice));
        },
        // Grupos: entrar, mudanças, remoção e mensagens.
        groupUpdated: (g, change) => {
          bump('group');
          const cid = chatIdForGroup(g.id);
          const exists = list().some(c => c.id === cid);
          if (change === 'removed') {
            if (exists) store.push(cid, { id: 'sys-rm-' + Date.now(), from: 'sys', time: nowHM(), text: g.kind === 'channel' ? STORED.sysLeftChannel : STORED.sysRemoved });
            return;
          }
          const myId = identities[g.via].id;
          if (!exists) store.addChat(chatForGroup(g, myId));
          else store.patchChat(cid, { name: g.name, initials: initialsOf(g.name), sub: groupSub(g), owner: canPost(g, myId) || undefined });
        },
        groupMessage: (gid, _fromId, fromName, x) => {
          const cid = chatIdForGroup(gid);
          if (!list().some(c => c.id === cid)) return;
          // Grupos: "Só menções acima de 20 mensagens/h" (conta por grupo, na última hora).
          const perHour = groupRate.hit(gid, now());
          const quiet = m?.getGroup(gid)?.kind === 'group' && !groupShouldNotify(perHour, !!x.mentioned);
          const id = 'in-' + gid.slice(0, 6) + '-' + x.msgId;
          if (x.route) recordRoute(cid, id, 'in', x.route);
          store.push(cid, { id, from: 'them', sender: fromName, ...textOf(x), time: nowHM() }, { quiet });
        },
        joinRequest: (gid, who) => {
          bump('group');
          store.showToast({ kind: 'group', href: `/group/${chatIdForGroup(gid)}`, icon: 'person_add', title: `${who.name || 'Alguém'} quer entrar`, body: 'Abra os dados do grupo para aprovar ou recusar.', action: 'Ver',
            hidden: { title: 'Pedido para entrar', body: 'Abra os dados do grupo para aprovar ou recusar.' } });
        },
        // Arquivos: progresso por bloco, entrega conferida e recebimento.
        fileProgress: (msgId, done, total, dir) => {
          const cid = dir === 'out' ? msgToChat.get(msgId) : msgToChat.get('in-' + msgId);
          if (cid) store.patchFile(cid, dir === 'out' ? msgId : 'in-' + msgId, { done: Math.min(done, total), blocks: total });
        },
        fileDelivered: msgId => {
          const cid = msgToChat.get(msgId);
          if (!cid) return;
          store.patchFile(cid, msgId, { state: 'verified' });
          store.setMsgStatus(cid, msgId, 'entregue');
        },
        fileOffered: (contactId, f) => {
          const cid = chatIdFor(contactId);
          if (!list().some(c => c.id === cid)) return;
          msgToChat.set('in-' + f.msgId, cid);
          if (f.route) recordRoute(cid, 'in-' + f.msgId, 'in', f.route);
          const expiresAt = expiryOf({ sentAt: f.sentAt ?? now(), expireSec: f.expireSec });
          store.push(cid, { id: 'in-' + f.msgId, from: 'them', text: '', time: nowHM(), ...(expiresAt ? { expiresAt } : {}),
            file: { name: f.name, mb: Math.max(0.1, Math.round((f.size / 1048576) * 10) / 10), blocks: f.blocks, icon: f.mime.startsWith('image/') ? 'image' : 'description', done: 0, state: 'sending', real: true, incoming: true, ...(f.held ? { held: true } : {}) } });
        },
        fileReceived: (_contactId, f) => {
          // Só guarda o que tem mensagem na conversa (a oferta sem conversa não aparece: nada a abrir).
          const cid = msgToChat.get('in-' + f.msgId);
          if (!cid || !list().some(c => c.id === cid)) return;
          const preview = f.mime.startsWith('image/') && f.data.length <= PREVIEW_MAX_BYTES ? `data:${f.mime};base64,${toBase64(f.data)}` : undefined;
          keepReceived('in-' + f.msgId, f);
          store.patchFile(cid, 'in-' + f.msgId, { state: 'verified', done: f.blocks, preview });
        },
        // Confirmação de leitura do contato: só mensagens minhas daquela conversa.
        read: (contactId, ids) => {
          const cid = chatIdFor(contactId);
          const chat = list().find(c => c.id === cid);
          for (const id of ids) if (chat?.msgs?.some(x => x.id === id && x.from === 'me')) store.setMsgStatus(cid, id, 'lida');
        },
        typing: contactId => {
          const cid = chatIdFor(contactId);
          if (list().some(c => c.id === cid)) store.setTyping(cid);
        },
        // O transporte confirmou o meio: a rota da mensagem passa a mostrar o rádio de verdade (e o porquê da troca).
        routed: (msgId, via) => {
          const cid = msgToChat.get(msgId);
          if (cid) setRoutes(b => patchRoute(b, cid, msgId, via));
        },
        status: (msgId, s, route) => {
          const cid = msgToChat.get(msgId) ?? list().find(c => (c.peer || c.group) && c.msgs?.some(x => x.id === msgId))?.id;
          if (!cid) return;
          if (route) recordRoute(cid, msgId, 'out', route);
          store.setMsgStatus(cid, msgId, s);
        },
        message: (contactId, x) => {
          const cid = chatIdFor(contactId);
          if (!list().some(c => c.id === cid)) return;
          const expiresAt = expiryOf(x);
          if (expiresAt && expiresAt <= Date.now()) return; // temporária que já venceu no caminho
          if (x.route) recordRoute(cid, 'in-' + x.msgId, 'in', x.route);
          store.push(cid, { id: 'in-' + x.msgId, from: 'them', ...textOf(x), time: nowHM(), ...(expiresAt ? { expiresAt } : {}) });
        },
        newContact: (c, x) => {
          const cid = chatIdFor(c.id);
          store.addChat(chatFor(c, true, prefs.priv.temp));
          const expiresAt = expiryOf(x);
          if (expiresAt && expiresAt <= Date.now()) return;
          if (x.route) recordRoute(cid, 'in-' + x.msgId, 'in', x.route);
          // Pedido de conversa (ainda não aceito): entra não lido, sem banner nem notificação, como antes.
          store.push(cid, { id: 'in-' + x.msgId, from: 'them', ...textOf(x), time: nowHM(), ...(expiresAt ? { expiresAt } : {}) }, { quiet: true });
        },
        // Pedido de pagamento de um contato aceito: vira registro + balão na conversa dele.
        paymentRequest: (contactId, r, _sentAt, route) => {
          const cid = chatIdFor(contactId);
          if (!list().some(c => c.id === cid) || st.pays[r.id]) return;
          putPay({ id: r.id, chatId: cid, dir: 'in', address: r.address, planck: r.planck?.toString() ?? null, desc: r.desc, createdAt: r.createdAt, expiresAt: r.expiresAt });
          if (route) recordRoute(cid, 'in-' + r.id, 'in', route);
          store.push(cid, { id: 'in-' + r.id, from: 'them', text: payRequestSummary(r), time: nowHM() });
        },
        // O contato avisou que pagou um pedido MEU: só registra e avisa; "recebido" exige conferir na Mainnet.
        paymentPaid: (contactId, n) => {
          const rec = st.pays[n.id];
          if (!rec || rec.dir !== 'out' || rec.chatId !== chatIdFor(contactId) || rec.paid) return;
          putPay({ ...rec, paid: { ...(n.txHash ? { txHash: n.txHash } : {}), ...(n.blockHash ? { blockHash: n.blockHash } : {}), at: Date.now() } });
          const chat = list().find(c => c.id === rec.chatId);
          store.showToast({ kind: 'wallet', icon: 'account_balance_wallet', title: `${chat?.name ?? 'Contato'} avisou que pagou`, body: 'Confira na Mainnet antes de considerar recebido.', href: `/chat/${rec.chatId}`,
            hidden: { title: 'Pedido de pagamento', body: 'Abra o Piu para conferir.' } });
        },
      },
    });
    // Restaurou as chaves (frase ou arquivo): assina o aviso de troca de aparelho, um por identidade.
    const change = host.takeDeviceChangeRequest();
    if (change) {
      const fresh: DeviceChangeOutbox[] = (['public', 'anon'] as const).map(via => ({ via, at: change.at, sentTo: [], text: encodeDeviceChange(createDeviceChange(identities[via], change.reason, change.at)) }));
      void host.saveDeviceChangeOutbox([...host.deviceChangeOutbox(now()), ...fresh]).catch(() => {});
    }
    m = msg;
    const dataEpoch = deps.epoch();
    carryBridge.setCarrier((item, ref) => msg.carry(item, ref));

    // Avisos de aparelho revogado: envia os pendentes aos contatos (pública e anônima, cada um pela sua).
    const flush = () => {
      const pending = host.pendingRevocations();
      if (!pending.length) return;
      for (const n of pending) {
        const via: IdentityKind = toHex(identities.public.signPk) === toHex(unb64url(n.by)) ? 'public' : 'anon';
        // Contatos e admins dos meus grupos recebem o aviso; nos grupos em que sou admin, a chave troca aqui.
        msg.broadcastNotice(via, encodeRevocation(n));
        for (const g of msg.rotateForRevocation(identities[via].id, n.sig, via)) {
          const cid = chatIdForGroup(g.id);
          if (list().some(x => x.id === cid)) store.push(cid, { id: `sys-rk-${g.id.slice(0, 6)}-${g.keyV}`, from: 'sys', time: nowHM(), text: STORED.sysGroupRevoked });
        }
      }
      void host.markRevocationsSent(pending.map(n => n.sig));
    };
    // Avisos de troca de aparelho: aos contatos de cada identidade, inclusive os que aparecerem
    // depois (dentro da janela de 7 dias), uma vez por contato.
    const flushChanges = () => {
      const out = host.deviceChangeOutbox(now());
      if (!out.length) return;
      let changed = false;
      const next = out.map(o => {
        const sent = msg.broadcastNotice(o.via, o.text, o.sentTo);
        if (!sent.length) return o;
        changed = true;
        return { ...o, sentTo: [...o.sentTo, ...sent] };
      });
      if (changed) void host.saveDeviceChangeOutbox(next).catch(() => {});
    };
    flush(); flushChanges();
    const notices = setInterval(() => { flush(); flushChanges(); }, 30_000);

    // Transporte → mensageiro.
    const off = transport.subscribe(e => {
      // Classe do enlace pelo meio real do vizinho (Nearby/Wi-Fi Direct ou BLE).
      if (e.type === 'connected') {
        const md = e.via ?? transport.kind;
        peerMedium.set(e.id, md);
        // Rede local = classe Ethernet/LAN do roteador; LoRa = classe própria (o roteador nunca manda mídia por ela).
        msg.peerConnected(e.id, md === 'nearby' ? 'direct' : md === 'lan' ? 'eth' : isLora(md) ? 'lora' : 'ble');
        st.call?.svc.tryWaiting();
        syncMedia();
      } else if (e.type === 'disconnected' || e.type === 'peerLost') { msg.peerDisconnected(e.id); peerMedium.delete(e.id); syncMedia(); }
      else if (e.type === 'envelope') {
        // Meio por onde este envelope chegou (pode ser outro enlace do mesmo vizinho).
        if (e.via) peerMedium.set(e.from, e.via);
        // Voz da chamada: quadros 'V' vão direto para a chamada, nunca para o roteador.
        if (st.call?.svc.onFrame(e.from, e.via ?? transport.kind, e.data)) return;
        // Dado de par não confiável: um envelope malformado não pode derrubar o ouvinte do transporte.
        try { msg.receive(e.from, e.data); } catch { /* descartado */ }
      }
      else if (e.type === 'state' && e.state === 'off') { msg.clearPeers(); peerMedium.clear(); syncMedia(); } // vizinhos somem com o transporte
    });
    // Pulso nativo do serviço: reserva para quando o timer JS atrasa (CPU acordada, sem tela). Com o
    // timer em dia (app aberto) não repete o tick: flushAll e créditos rodariam em dobro.
    let lastTickAt = 0;
    const doTick = () => { lastTickAt = Date.now(); msg.tick(); };
    const tick = setInterval(doTick, TICK_MS);
    const beat = transport.onHeartbeat?.(() => { if (Date.now() - lastTickAt >= TICK_MS) doTick(); });
    // Temporárias vencidas somem no prazo também com o app fechado (antes era um efeito do StoreProvider).
    store.sweepExpired();
    const sweep = setInterval(() => store.sweepExpired(), SWEEP_MS);

    // Chamada de voz: um serviço por mensageiro; registros e pedidos viram cartões na conversa.
    const call = host.makeCall({
      messenger: msg, send: async (peerId, bytes) => { await transport.send(peerId, bytes); }, media: peerMedium, chatIdFor,
      receive: (cid, x, o) => store.push(cid, x, o),
      patchMsg: (cid, mid, p) => store.patchMsg(cid, mid, () => p),
      nameOf: id => list().find(c => c.peer === id)?.name ?? '',
    });
    set({ messenger: msg, call });
    applyPrefs(null);

    teardown = () => {
      call?.svc.dispose();
      off(); beat?.(); clearInterval(tick); clearInterval(sweep); clearInterval(notices);
      gwStop?.(); gwStop = null; gw = null;
      carryBridge.setCarrier(null);
      clearTimeout(saveTimer);
      // "Apagar dados locais" no meio (a geração dos dados mudou): não regrava o estado apagado.
      const saved = deps.epoch() === dataEpoch ? deps.persistNow(STATE_KEY, msg.export()).catch(() => {}) : Promise.resolve();
      m = null;
      set({ messenger: null, call: null });
      return saved;
    };
  };

  const stop = () => { const td = teardown; teardown = null; running = null; return td ? td() : Promise.resolve(); };

  return {
    /**
     * Cria o mensageiro quando as chaves existem (`null`: sem chaves ou sem onboarding, para). As
     * mesmas identidades e a mesma época de rotação mantêm o mensageiro que já está rodando.
     */
    start: (k: RuntimeKeys | null) => {
      // A chave do nó sai da mesma semente (e gira sozinha por dia): o que identifica são as identidades.
      const id = k ? `${k.identities.public.id}|${k.identities.anon.id}|${k.rotation}` : null;
      if (k) keys = k;
      if (id === running) return;
      void stop();
      if (!k) return;
      running = id;
      create(k);
    },
    setPrefs: (p: Partial<RuntimePrefs>) => {
      const prev = prefs;
      prefs = { ...prefs, ...p };
      applyPrefs(prev);
      if (prev.priv.noRoutes === prefs.priv.noRoutes) return;
      if (prefs.priv.noRoutes) {
        // Ligou "Não guardar rotas": o histórico sai do disco e da memória (fica a última, só na memória).
        clearTimeout(routesTimer);
        set({ routes: trimBook(st.routes, false) });
        void deps.forget(ROUTES_KEY);
      } else setRoutes(b => ({ ...b }));
    },
    /**
     * Peças que só a tela tem (perfil, carteira): sem elas, o mensageiro segue sem esses efeitos.
     * `undefined` volta ao padrão sem tela (a tela desmontou).
     */
    setHost: (h: Partial<RuntimeHost>) => {
      const next = { ...host };
      for (const k of Object.keys(h) as (keyof RuntimeHost)[]) (next as Record<string, unknown>)[k] = h[k] ?? NO_HOST[k];
      host = next;
      if (pendingProfile !== null && host.importProfile !== NO_HOST.importProfile) { const p = pendingProfile; pendingProfile = null; host.importProfile(p); }
      if (pendingSettles.size && host.settleInvite !== NO_HOST.settleInvite) { const ids = [...pendingSettles]; pendingSettles.clear(); ids.forEach(id => host.settleInvite(id)); }
    },
    /**
     * A tela desmontou (deslizar o app dos recentes). A chamada segue onde o núcleo mostra um aviso
     * com botão (`keepCall`, de core/callAlertRunner.ts: tocando e em curso, com a notificação
     * permitida); sem ele a chamada não fica sem tela nem botão de desligar: chamando ou em curso,
     * desliga; tocando, recusa. A pausa da retransmissão pela bateria é da tela (SystemPrompts) e não é
     * salva: sem ela, só o Ponto Piu (`relay`) mantém a retransmissão para terceiros. A tela de volta
     * reaplica os ajustes (`setPrefs`).
     */
    detach: (o: { relay: boolean; keepCall?: (phase: string) => boolean }) => {
      const svc = st.call?.svc;
      const ph = svc?.state.phase;
      if (svc && ph && !o.keepCall?.(ph)) {
        try { if (ph === 'ringing') svc.controller.decline(); else if (ph === 'active' || ph === 'calling') svc.controller.hangup(); } catch { /* chamada */ }
      }
      const prev = prefs;
      prefs = { ...prefs, relay: o.relay };
      applyPrefs(prev);
    },
    getSnapshot: (): RuntimeState => st,
    subscribe: (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn); }; },
    messenger: () => m,
    bump,
    msgToChat,
    peerMedium,
    putPay,
    setRoutes,
    saveNow,
    /** Para e salva ("Apagar dados locais", fim do processo). Único caminho que descarta o mensageiro. */
    shutdown: async () => {
      clearTimeout(routesTimer);
      await stop();
    },
    /** Relê pedidos e rotas do salvo ("Apagar dados locais" esvaziou a memória), sem regravar. */
    reload: () => {
      clearTimeout(routesTimer);
      msgToChat.clear();
      set({ pays: deps.read<Record<string, PayRecord>>(PAYS_KEY) ?? {}, routes: prefs.priv.noRoutes ? {} : cleanBook(deps.read(ROUTES_KEY)) });
    },
    /** Desliga também o ouvinte das conversas (fim definitivo, testes). */
    dispose: () => { clearTimeout(routesTimer); dropChats(); return stop(); },
  };
}

/** Banner e notificação de um alerta da comunidade (com a rota para a tela do alerta). */
function alertToast(v: AlertView, n: AlertNotice) {
  const title = n.update ? `${alertStatusName('confirmed')} · ${v.title}` : `${alertSeverityName(v.sev)} · ${v.title}`;
  const body = `${v.communityName || t('alert.row.community')} · ${v.area || alertCategoryName(v.cat)}. ${officialNote()}`;
  return { kind: 'alert' as const, critical: n.level === 'critical', icon: 'warning', title, body, action: t('alertToast.see'), href: `/alert?id=${encodeURIComponent(v.id)}`,
    hidden: { title: t('notify.hidden.alert'), body: t('alertToast.openToSee') } };
}

export function groupSub(g: GroupState) {
  const n = memberCount(g);
  if (g.kind === 'channel') return `canal ${g.visibility === 'public' ? 'público' : g.visibility === 'secret' ? 'secreto' : 'privado'} · ${n} ${n === 1 ? 'inscrito' : 'inscritos'}`;
  if (g.kind === 'community') return `comunidade · ${(g.children ?? []).length} grupos e canais`;
  return `${n} ${n === 1 ? 'membro' : 'membros'} · chave v${g.keyV}`;
}
export function chatForGroup(g: GroupState, myId: string): Chat {
  return {
    id: chatIdForGroup(g.id), group: g.id, ident: g.via, kind: g.kind === 'community' ? 'community' : g.kind, name: g.name, initials: initialsOf(g.name),
    time: nowHM(), unread: 0, owner: canPost(g, myId) || undefined,
    sub: groupSub(g),
    msgs: [{ id: 'sys-g-' + g.id.slice(0, 8), from: 'sys', time: nowHM(), text: g.kind === 'community' ? STORED.sysCommunity : g.kind === 'channel' ? STORED.sysChannel : STORED.sysGroup }],
  };
}

/** Texto e localização de uma mensagem recebida (com localização, `text` é o nome do lugar). */
const textOf = (x: { text: string; loc?: { lat: number; lon: number } }) => (x.loc ? { text: placeFromText(x.loc, x.text), loc: x.loc } : { text: x.text });

/** Fim de uma mensagem temporária recebida (ms): prazo contado do envio (sem passar de agora). */
const expiryOf = (x: { sentAt: number; expireSec?: number }) => (x.expireSec ? (Math.min(x.sentAt, nowSec()) + x.expireSec) * 1000 : undefined);

/** Conversa nova com um contato. `temp`: padrão de Privacidade para novas conversas. */
export function chatFor(c: Contact, request: boolean, temp: TempMode): Chat {
  const name = c.name || (c.via === 'anon' ? 'Anônimo · ' + c.id.slice(4, 8).toUpperCase() : 'Contato · ' + c.id.slice(4, 8).toUpperCase());
  return {
    id: chatIdFor(c.id), peer: c.id, request, ident: c.via, kind: 'direct', name, initials: initialsOf(name), time: nowHM(), unread: 0, temp,
    sub: request ? STORED.subRequest : STORED.subE2e,
    msgs: [{ id: 'sys-' + c.id.slice(4, 12), from: 'sys', time: nowHM(), text: request
      ? STORED.sysRequest
      : STORED.sysKeys }],
  };
}

/** Conversa aberta por Por perto (sempre pela identidade pública). `first`: o texto do convite. */
export function nearChat(c: Contact, temp: TempMode, note: string, first?: string): Chat {
  const base = chatFor(c, false, temp);
  return {
    ...base, sub: STORED.subNearby,
    msgs: [{ id: 'sys-near-' + c.id.slice(4, 12), from: 'sys', time: nowHM(), text: note },
      ...(first ? [{ id: 'in-near-' + c.id.slice(4, 12), from: 'them' as const, time: nowHM(), text: first }] : [])],
  };
}
