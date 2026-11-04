import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { randomUUID, timingSafeEqual, X509Certificate } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config } from './config.js';
import { type Manifest, SAFE_FILE } from './packages.js';
import type { Pairing } from './security/pairing.js';
import { APPROVAL_TTL_MS, approvalMatches, checkCode, newSecret, PAIR_TTL_MS, pairCode, pairPayload, requestPayload } from './security/approval.js';
import { cookieOptions, createSession, csrfMatches, endSession, findSession, SESSION_COOKIE, sessionLabel, STEP_UP_MS } from './security/session.js';
import { readPanelFile } from './static.js';
import { BACKUP_FILENAME, OperatorKeyError, OperatorVault } from './operator.js';
import { claimableEpochs, isLunesAddress } from './payout.js';
import { LUNES_EXPLORER } from './lunes/lunesRpc.js';
import { LunesReader } from './lunes/reader.js';
import { decodeSs58 } from './lunes/ss58.js';
import { toHex } from './protocol/bytes.js';
import type { KeyPair } from './protocol/keys.js';
import { makePayoutClaim, type RelayReceipt } from './protocol/receipts.js';
import {
  certFromJson, certToJson, type DevicePolicy, type DeviceReport, type OperatorCert, type RevocationList, samePolicyValue, unhex,
} from './relay/operator-frames.js';
import { MAX_RUNTIME_PEERS, parsePeerAddress, type PeerStatus } from './relay/lan.js';
import type { Device, DeviceLimits, Session, Settings, Store } from './store.js';

declare module 'fastify' {
  interface FastifyRequest { piuSession: Session | null }
}

export interface AppOptions {
  config: Config;
  store: Store;
  pairing: Pairing;
  packages: Manifest[];
  packagesDir: string;
  https?: { key: string; cert: string };
  logger?: boolean;
  now?: () => number;
  /** Código consumido ou bloqueado: o nó gera outro e mostra só no console local. */
  onCodeSpent?: (reason: 'used' | 'locked') => void;
  /** Motor de retransmissão LNNP (ausente: `GET /api/relay` responde `enabled: false`). */
  relay?: {
    stats(): object; applySettings(s: Settings, device?: DeviceLimits | null): void;
    /** Operador dono do nó: linhagem de chaves, certificados e lista de revogação. */
    setOperator?(t: { lineage?: string[]; cert?: OperatorCert | null; deviceCerts?: OperatorCert[]; list?: RevocationList | null; policies?: DevicePolicy[] }): void;
    /** Chave técnica do nó (assina a carteira do lote) e recibos guardados (evidências para o validador). */
    engine?: {
      node: KeyPair; receiptLog: RelayReceipt[]; lineage: string[]; peerSeen?(peerId: string): { online: boolean; lastSeen: number | null; address: string | null };
      /** Ajustes (pausa e regras) conhecidos para um equipamento e o último resumo assinado dele (chave do nó em hex). */
      policyFor?(nodePkHex: string): DevicePolicy | null;
      deviceReport?(nodePkHex: string): { report: DeviceReport; receivedAt: number } | null;
    };
    /** Vizinhos fixos do enlace (configuração e painel), adicionar e remover sem reiniciar. */
    peers?(): PeerStatus[];
    addPeer?(address: string): void;
    removePeer?(address: string): boolean;
    waitPeer?(address: string, ms: number, from?: number): Promise<PeerStatus | null>;
    isConfigPeer?(address: string): boolean;
    /** Pausar retransmissão do equipamento que serve o painel. */
    setPaused?(paused: boolean): void;
    /** Histórico das estatísticas (amostras de 24 h e totais por dia). */
    history?(): object;
    /** Recibos guardados para o validador (só horário e se são deste nó). */
    receipts?(): object;
  } | null;
  /** O próprio nó, registrado como equipamento do dono no primeiro pareamento. Ausente: não registra. */
  selfDevice?: { name: string; cls: string };
  /** Chaves de operador (`<data>/operator/keys.json`). Ausente: só em memória (testes). */
  vault?: OperatorVault;
  /** Custo do scrypt do backup de operador (só os testes baixam). */
  backupN?: number;
  /** Leitura do saldo na Lunes Mainnet. Ausente: um leitor com `config.lunesEndpoints` (ou os de produção). */
  lunes?: LunesReader;
  /**
   * Reinício pedido pelo painel (`POST /api/devices/:id/restart`): fecha o nó limpo e sai para o
   * supervisor (procd, systemd, app desktop) subir de novo. Ausente: a rota responde 409.
   */
  restart?: () => void;
}

/** CSP igual à do painel (a mesma política vale para o HTML servido aqui). */
const CSP = {
  'default-src': ["'none'"], 'script-src': ["'self'"], 'style-src': ["'self'"], 'style-src-attr': ["'unsafe-inline'"],
  'img-src': ["'self'", 'data:'], 'font-src': ["'self'"], 'connect-src': ["'self'"], 'manifest-src': ["'self'"],
  'base-uri': ["'none'"], 'form-action': ["'none'"], 'frame-ancestors': ["'none'"], 'object-src': ["'none'"],
};
const PERMISSIONS = 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()';
const UUID = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

const fail = (reply: FastifyReply, code: number, error: string, extra: Record<string, unknown> = {}) => reply.code(code).send({ error, ...extra });

export async function buildApp(o: AppOptions): Promise<FastifyInstance> {
  // Impressão digital SHA-256 do certificado TLS (a mesma do console), para o QR de pareamento do celular.
  const tlsFingerprint = o.https ? new X509Certificate(o.https.cert).fingerprint256 : undefined;
  const now = o.now ?? Date.now;
  const { store, pairing } = o;
  const vault = o.vault ?? new OperatorVault(null);
  const nodePk = o.relay?.engine ? toHex(o.relay.engine.node.pk) : null;
  const lunes = o.lunes ?? new LunesReader({ endpoints: o.config.lunesEndpoints });

  /**
   * Chave de operador → motor: o dono assina a identidade técnica do próprio nó e dos equipamentos
   * vinculados (de novo depois de uma rotação), e a lista de revogação dele passa a valer aqui e a
   * ir para os vizinhos do mesmo operador. Também aplica as regras do próprio equipamento.
   */
  const syncOperator = () => {
    const owner = store.owner();
    if (!owner) return;
    const op = vault.ensure(owner.id, now());
    const current = toHex(op.pk);
    const self = store.selfDevice();
    if (self && nodePk && self.nodePk !== nodePk) store.updateDevice(self.id, { nodePk });
    for (const d of store.devicesOf(owner.id)) {
      if (d.nodePk && d.cert?.operatorPk !== current) store.updateDevice(d.id, { cert: certToJson(vault.certify(owner.id, unhex(d.nodePk), now())) });
    }
    const devs = store.devicesOf(owner.id);
    const selfNow = devs.find(d => d.self);
    const certOf = (d: Device) => (d.cert ? certFromJson(d.cert) : null);
    // Pausa e regras dos outros equipamentos (com identidade técnica): assinadas pela chave de operador
    // e numeradas, só quando mudaram (ou a chave mudou). O motor manda aos vizinhos do mesmo operador,
    // e o equipamento aplica as dele quando recebe (relay/operator-frames.ts, DEVICE_POLICY).
    const policies: DevicePolicy[] = [];
    if (o.relay?.engine?.policyFor) {
      for (const d of devs) {
        if (d.self || !d.nodePk || !d.cert) continue;
        const want = { paused: d.status === 'paused', limits: d.limits ?? null };
        const cur = o.relay.engine.policyFor(d.nodePk);
        if (cur && toHex(cur.operatorPk) === current && samePolicyValue(cur, want)) continue;
        // Nunca emitido e sem nada a mandar (ativo, sem regras): o equipamento já está assim.
        if (!cur && !want.paused && !want.limits) continue;
        policies.push(vault.devicePolicy(owner.id, unhex(d.nodePk), want, now(), cur?.seq ?? 0));
      }
    }
    o.relay?.setOperator?.({
      lineage: vault.lineage(owner.id),
      cert: selfNow?.nodePk ? certOf(selfNow) : null,
      deviceCerts: devs.filter(d => !d.self && d.nodePk && d.cert).map(d => certOf(d)!),
      list: vault.revocation(owner.id),
      ...(policies.length ? { policies } : {}),
    });
    o.relay?.applySettings(store.nodeSettings(), selfNow?.limits ?? null);
  };
  if (o.selfDevice) store.ensureSelfDevice(o.selfDevice, now());
  syncOperator();
  // Vizinhos fixos adicionados pelo painel antes do reinício voltam a conectar (somados aos de PIU_LNNP_PEERS).
  for (const a of store.relayPeers()) {
    const p = parsePeerAddress(a);
    if (p && o.relay?.addPeer) { try { o.relay.addPeer(p); } catch { /* acima do limite: ignora o excesso */ } }
  }
  const app = Fastify({
    https: o.https ?? null,
    bodyLimit: 16 * 1024,
    trustProxy: false,
    // Validação estrita: sem conversão de tipos ("10" não vira 10) e campo extra é erro, não é ignorado.
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false, allErrors: false } },
    // Logs sem segredos: cookie, token CSRF e Set-Cookie nunca aparecem.
    logger: o.logger ? { level: 'info', redact: ['req.headers.cookie', 'req.headers["x-csrf-token"]', 'req.headers.authorization', 'res.headers["set-cookie"]'] } : false,
  } as Parameters<typeof Fastify>[0]) as unknown as FastifyInstance;
  app.decorateRequest('piuSession', null);

  // Headers de segurança (Helmet): CSP, HSTS, frameguard, nosniff, referrer, COOP/CORP.
  await app.register(helmet, {
    contentSecurityPolicy: { useDefaults: false, directives: CSP },
    hsts: { maxAge: 31536000, includeSubDomains: true },
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true, max: 300, timeWindow: '1 minute',
    errorResponseBuilder: () => ({ statusCode: 429, error: 'Muitas tentativas. Aguarde um pouco.' }),
  });

  // Anti DNS rebinding: só responde pelos nomes configurados (PIU_NODE_HOSTS).
  app.addHook('onRequest', async (req, reply) => {
    const host = (req.headers.host ?? '').toLowerCase();
    if (!o.config.allowedHosts.includes(host)) return fail(reply, 421, 'Host não permitido.');
  });
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('Permissions-Policy', PERMISSIONS);
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  /** Requisição vinda da própria origem (navegador): Origin igual ao host, ou Sec-Fetch-Site same-origin. */
  const sameOrigin = (req: FastifyRequest) => {
    const origin = req.headers.origin;
    if (origin) return origin === `https://${req.headers.host}`;
    return req.headers['sec-fetch-site'] === 'same-origin';
  };
  const requireSession = async (req: FastifyRequest, reply: FastifyReply) => {
    const s = findSession(store, req.cookies[SESSION_COOKIE], now());
    if (!s) return fail(reply, 401, 'Sessão necessária. Pareie este navegador com o código do equipamento.');
    req.piuSession = s;
  };
  /** Toda ação que muda estado: mesma origem + token CSRF da sessão (cabeçalho X-CSRF-Token). */
  const requireCsrf = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!sameOrigin(req)) return fail(reply, 403, 'Origem não permitida.');
    if (!req.piuSession || !csrfMatches(req.piuSession, req.headers['x-csrf-token'])) return fail(reply, 403, 'Token CSRF inválido.');
  };
  // Sessão e CSRF em onRequest: a requisição é recusada ANTES de o corpo ser lido ou validado.
  // Funções que devolvem arrays NOVOS: plugins (ex.: rate-limit) acrescentam hooks no array da rota,
  // e um array compartilhado faria o limite de uma rota valer em todas.
  const mutate = () => ({ onRequest: [requireSession, requireCsrf] });
  const authed = () => ({ onRequest: [requireSession] });
  const idParams = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string', pattern: UUID } } } as const;
  const strictLimit = (max: number, timeWindow: string) => ({ rateLimit: { max, timeWindow } });

  // ── pareamento e sessão ─────────────────────────────────
  app.post<{ Body: { code: string; name: string } }>('/api/pair', {
    config: strictLimit(5, '10 minutes'),
    schema: { body: { type: 'object', required: ['code', 'name'], additionalProperties: false, properties: { code: { type: 'string', pattern: '^[0-9]{8}$' }, name: { type: 'string', minLength: 1, maxLength: 40 } } } },
  }, async (req, reply) => {
    if (!sameOrigin(req)) return fail(reply, 403, 'Origem não permitida.');
    const r = pairing.verify(req.body.code, now());
    if (r === 'locked') { o.onCodeSpent?.('locked'); return fail(reply, 429, 'Código bloqueado depois de várias tentativas. Gere um novo no equipamento.'); }
    if (r !== 'ok') return fail(reply, 401, 'Código inválido ou expirado.');
    o.onCodeSpent?.('used');
    // O código prova acesso físico ao equipamento. Com um nome que já existe, a sessão é da mesma conta
    // (sessão expirada, outro navegador); com um nome novo, cria outro operador.
    const op = store.operatorByName(req.body.name) ?? store.addOperator(req.body.name.trim(), now());
    if (o.selfDevice) store.ensureSelfDevice(o.selfDevice, now());
    vault.ensure(op.id, now());
    syncOperator();
    const { token, session } = createSession(store, op.id, now(), sessionLabel(req.headers['user-agent']));
    reply.setCookie(SESSION_COOKIE, token, cookieOptions);
    return { operator: { id: op.id, name: op.name }, csrf: session.csrf };
  });

  /** Reautenticação (step-up) com um código novo do equipamento, para operações sensíveis. */
  app.post<{ Body: { code: string } }>('/api/reauth', {
    ...mutate(), config: strictLimit(5, '10 minutes'),
    schema: { body: { type: 'object', required: ['code'], additionalProperties: false, properties: { code: { type: 'string', pattern: '^[0-9]{8}$' } } } },
  }, async (req, reply) => {
    const r = pairing.verify(req.body.code, now());
    if (r === 'locked') { o.onCodeSpent?.('locked'); return fail(reply, 429, 'Código bloqueado. Gere um novo no equipamento.'); }
    if (r !== 'ok') return fail(reply, 401, 'Código inválido ou expirado.');
    o.onCodeSpent?.('used');
    req.piuSession!.authAt = now();
    return { ok: true };
  });

  app.get('/api/session', authed(), async req => {
    const s = req.piuSession!;
    const op = store.operator(s.operatorId);
    return { operator: op && { id: op.id, name: op.name }, csrf: s.csrf, stepUpValidMs: Math.max(0, STEP_UP_MS - (now() - s.authAt)) };
  });

  app.post('/api/logout', mutate(), async (req, reply) => {
    endSession(store, req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  /** Sessões abertas do operador (para reconhecer acessos e encerrar os outros). */
  app.get('/api/sessions', authed(), async req => {
    const me = req.piuSession!;
    return store.sessionsOf(me.operatorId)
      .map(x => ({ id: x.id ?? '', label: x.label ?? 'Navegador', createdAt: x.createdAt, lastSeen: x.lastSeen, current: x.tokenHash === me.tokenHash }))
      .sort((a, b) => Number(b.current) - Number(a.current) || b.lastSeen - a.lastSeen);
  });

  /** Encerra os outros acessos. Sensível: exige autenticação recente (step-up). */
  app.post('/api/sessions/revoke-others', mutate(), async (req, reply) => {
    const s = req.piuSession!;
    if (now() - s.authAt > STEP_UP_MS) return fail(reply, 403, 'Confirme com um código novo do equipamento.', { reauth: true });
    return { revoked: store.removeOtherSessions(s.operatorId, s.tokenHash) };
  });

  // ── ajustes do operador ───────────────────────────────
  const settingsSchema = {
    type: 'object', required: ['limits', 'policies'], additionalProperties: false,
    properties: {
      limits: { type: 'object', required: ['bw', 'sto', 'hours'], additionalProperties: false, properties: {
        bw: { type: 'integer', enum: [20, 50, 100] }, sto: { type: 'integer', enum: [4, 8, 16] }, hours: { type: 'string', enum: ['always', 'night', 'day'] } } },
      policies: { type: 'object', required: ['media', 'unknown', 'community'], additionalProperties: false, properties: {
        media: { type: 'boolean' }, unknown: { type: 'boolean' }, community: { type: 'boolean' } } },
    },
  } as const;
  /** `owner`: os ajustes valem neste equipamento (só os do dono, o primeiro operador pareado, valem no motor). */
  app.get('/api/settings', authed(), async req => ({ ...store.settings(req.piuSession!.operatorId), owner: store.isOwner(req.piuSession!.operatorId) }));
  app.put<{ Body: Settings }>('/api/settings', { ...mutate(), schema: { body: settingsSchema } }, async (req, reply) => {
    // Outro operador pode entrar no painel, mas não muda os limites do equipamento de outra pessoa:
    // recusado com o motivo, em vez de salvar um ajuste que o motor não usaria.
    if (!store.isOwner(req.piuSession!.operatorId)) return fail(reply, 403, 'Só o dono deste equipamento (o primeiro operador pareado) muda os limites e a política de tráfego dele.');
    const saved = store.setSettings(req.piuSession!.operatorId, req.body);
    // Os limites do dono do equipamento passam a valer no roteador na hora (banda, espaço, horário, mídia).
    o.relay?.applySettings(store.nodeSettings(), store.selfDevice()?.limits ?? null);
    return saved;
  });

  // ── retransmissão (LNNP) ──────────────────────────────
  /** Estatísticas reais do motor: vizinhos, envelopes guardados e encaminhados, duplicatas, recibos. */
  app.get('/api/relay', authed(), async () => (o.relay ? o.relay.stats() : { enabled: false }));
  /** Histórico para os gráficos: amostras das últimas 24 h e totais por dia (contagens, sem LUNES). */
  app.get('/api/relay/history', authed(), async () => (o.relay?.history ? { enabled: true, ...o.relay.history() } : { enabled: false }));
  /** Recibos de retransmissão guardados para o validador: quantos e os horários dos mais recentes. */
  app.get('/api/relay/receipts', authed(), async () => (o.relay?.receipts ? { enabled: true, ...o.relay.receipts() } : { enabled: false }));

  // ── vizinhos fixos do enlace (host:porta), sem reiniciar ─
  /** Vizinhos fixos: os de PIU_LNNP_PEERS e os adicionados aqui, com o estado de cada um. */
  app.get('/api/relay/peers', authed(), async () => (o.relay?.peers ? { enabled: true, max: MAX_RUNTIME_PEERS, peers: o.relay.peers() } : { enabled: false, peers: [] }));
  const addressSchema = { type: 'string', minLength: 3, maxLength: 262 } as const;
  /**
   * Adiciona um vizinho por endereço (só `host:porta`) e espera o handshake (até ~6 s). Só o dono do
   * equipamento: o enlace é do nó, não da sessão.
   */
  app.post<{ Body: { address: string } }>('/api/relay/peers', {
    ...mutate(), config: strictLimit(20, '1 minute'),
    schema: { body: { type: 'object', required: ['address'], additionalProperties: false, properties: { address: addressSchema } } },
  }, async (req, reply) => {
    if (!store.isOwner(req.piuSession!.operatorId)) return fail(reply, 403, 'Só o dono do equipamento muda os vizinhos dele.');
    if (!o.relay?.addPeer || !o.relay.waitPeer) return fail(reply, 409, 'A retransmissão LNNP está desligada neste nó.');
    const address = parsePeerAddress(req.body.address);
    if (!address) return fail(reply, 400, 'Endereço inválido. Use só host:porta (ex.: 192.168.0.12:8422), sem http:// nem caminho.');
    const from = now();
    try { o.relay.addPeer(address); } catch (e) { return fail(reply, 400, e instanceof Error ? e.message : 'Não foi possível adicionar.'); }
    if (!o.relay.isConfigPeer?.(address)) store.addRelayPeer(address);
    const peer = await o.relay.waitPeer(address, 6000, from);
    return reply.code(201).send({ peer });
  });
  app.delete<{ Params: { address: string } }>('/api/relay/peers/:address', {
    ...mutate(), schema: { params: { type: 'object', required: ['address'], additionalProperties: false, properties: { address: addressSchema } } },
  }, async (req, reply) => {
    if (!store.isOwner(req.piuSession!.operatorId)) return fail(reply, 403, 'Só o dono do equipamento muda os vizinhos dele.');
    const address = parsePeerAddress(req.params.address);
    if (!address) return fail(reply, 400, 'Endereço inválido.');
    if (o.relay?.isConfigPeer?.(address)) return fail(reply, 409, 'Este vizinho vem da configuração do nó (PIU_LNNP_PEERS): tire de lá e reinicie.');
    const fromLink = o.relay?.removePeer?.(address) ?? false;
    const fromStore = store.removeRelayPeer(address);
    if (!fromLink && !fromStore) return fail(reply, 404, 'Não encontrado.');
    return reply.code(204).send();
  });

  // ── equipamentos (posse checada em cada ação: anti-IDOR) ─
  /** Campos públicos do equipamento (o nome público `piu.…` só quando existe). */
  const deviceView = ({ id, ownerId, name, cls, status, self, pub, nodePk: pk, cert, limits, parent }: Device) => {
    const current = vault.keyPair(ownerId);
    const e = o.relay?.engine;
    const remote = !!pk && !self;
    const rep = remote ? e?.deviceReport?.(pk) ?? null : null;
    const pol = remote ? e?.policyFor?.(pk) ?? null : null;
    return {
      id, name, cls, status, self: !!self, ...(pub ? { pub } : {}),
      // Identidade técnica (os 16 primeiros hex, como no LNNP) e se está assinada pela chave de operador atual.
      ...(pk ? { nodeId: pk.slice(0, 16), signed: !!cert && !!current && cert.operatorPk === toHex(current.pk) } : {}),
      // Enlace real com este equipamento (outro piu-node): conectado agora e última vez visto desde que o motor subiu.
      ...(remote && e?.peerSeen ? { link: e.peerSeen(pk.slice(0, 16)) } : {}),
      ...(limits ? { limits } : {}),
      ...(parent ? { parent } : {}),
      // Pausa e regras emitidas para ele (número) e se o resumo dele já diz que aplicou.
      ...(pol ? { policy: { seq: pol.seq, issuedAt: pol.issuedAt * 1000, applied: !!rep && rep.report.policySeq >= pol.seq } } : {}),
      // Último resumo assinado pelo próprio equipamento (contadores desde que ele ligou).
      ...(rep ? { report: {
        at: rep.report.at * 1000, receivedAt: rep.receivedAt, startedAt: rep.report.startedAt * 1000,
        forwarded: rep.report.forwarded, stored: rep.report.stored, receipts: rep.report.receipts, neighbors: rep.report.neighbors,
        paused: rep.report.paused, relaying: rep.report.relaying,
      } } : {}),
    };
  };
  app.get('/api/devices', authed(), async req => store.devicesOf(req.piuSession!.operatorId).map(deviceView));

  /** Equipamento ativado pelo assistente "Adicionar equipamento". */
  /** Regras do assistente (passo "Regras"): os mesmos valores das opções do painel. */
  const limitsSchema = { type: 'object', required: ['bw', 'sto', 'hours'], additionalProperties: false, properties: {
    bw: { type: 'integer', enum: [5, 20, 50] }, sto: { type: 'integer', enum: [1, 4, 8] }, hours: { type: 'string', enum: ['always', 'night', 'day'] },
  } } as const;
  app.post<{ Body: { name: string; cls: string; family: string; pub?: string; nodePk?: string; limits?: DeviceLimits; parent?: string } }>('/api/devices', {
    ...mutate(), config: strictLimit(20, '1 minute'),
    schema: { body: { type: 'object', required: ['name', 'cls', 'family'], additionalProperties: false, properties: {
      name: { type: 'string', minLength: 1, maxLength: 40 },
      cls: { type: 'string', enum: ['Home Node', 'Super Node', 'Gateway Local', 'Ponto de Acesso'] },
      family: { type: 'string', enum: ['router', 'linux', 'minipc', 'lora', 'ap', 'p2p'] },
      pub: { type: 'string', pattern: '^piu\\.[a-z0-9](?:[a-z0-9-]{0,26}[a-z0-9])?$' },
      // Identidade técnica de um vizinho LNNP (chave do nó em hex), escolhida no assistente.
      nodePk: { type: 'string', pattern: '^[0-9a-f]{64}$' },
      limits: limitsSchema,
      // Ponto de Acesso: o equipamento seu (com o Piu Node) que leva o sinal dele à malha.
      parent: { type: 'string', pattern: UUID },
    } } },
  }, async (req, reply) => {
    const s = req.piuSession!;
    if (store.devicesOf(s.operatorId).length >= 100) return fail(reply, 400, 'Limite de equipamentos atingido.');
    const { name, cls, family, pub, nodePk: pk, limits, parent } = req.body;
    if (parent !== undefined) {
      if (cls !== 'Ponto de Acesso') return fail(reply, 400, 'Só um Ponto de Acesso tem nó pai.');
      // 404 também para id de outro operador: não revela que o id existe.
      const p = store.ownedDevice(s.operatorId, parent);
      if (!p) return fail(reply, 404, 'Nó pai não encontrado entre os seus equipamentos.');
      if (p.cls === 'Ponto de Acesso') return fail(reply, 400, 'O nó pai precisa ter o Piu Node (um Ponto de Acesso não serve de nó pai).');
    }
    if (pk) {
      if (pk === nodePk) return fail(reply, 409, 'Esta é a identidade técnica do nó que serve o painel, que já é um equipamento seu.');
      if (store.deviceByNodePk(pk)) return fail(reply, 409, 'Esta identidade técnica já pertence a um equipamento registrado.');
      if (vault.revocation(s.operatorId)?.revoked.some(x => toHex(x) === pk)) return fail(reply, 409, 'Esta identidade técnica foi revogada. Reinstale o Piu Node no equipamento para gerar outra.');
    }
    const d = store.addDevice({
      ownerId: s.operatorId, name: name.trim(), cls, family, pub, createdAt: now(),
      ...(pk ? { nodePk: pk, cert: certToJson(vault.certify(s.operatorId, unhex(pk), now())) } : {}),
      ...(limits ? { limits } : {}),
      ...(parent ? { parent } : {}),
    });
    if (store.isOwner(s.operatorId)) syncOperator();
    return reply.code(201).send(deviceView(d));
  });

  /**
   * Regras de um equipamento. No próprio nó, valem no motor na hora (junto com os limites globais).
   * Nos outros com identidade técnica (e sendo o dono deste nó), saem assinadas pela malha.
   */
  app.put<{ Params: { id: string }; Body: DeviceLimits | { clear: true } }>('/api/devices/:id/limits', {
    ...mutate(), schema: { params: idParams, body: { oneOf: [limitsSchema, { type: 'object', required: ['clear'], additionalProperties: false, properties: { clear: { const: true } } }] } },
  }, async (req, reply) => {
    const d = store.ownedDevice(req.piuSession!.operatorId, req.params.id);
    if (!d) return fail(reply, 404, 'Não encontrado.');
    const limits = 'clear' in req.body ? undefined : req.body;
    store.updateDevice(d.id, { limits });
    if (store.isOwner(req.piuSession!.operatorId)) {
      if (d.self) o.relay?.applySettings(store.nodeSettings(), limits ?? null);
      else syncOperator();
    }
    return deviceView(store.ownedDevice(req.piuSession!.operatorId, d.id)!);
  });

  app.post<{ Params: { id: string } }>('/api/devices/:id/pause', { ...mutate(), schema: { params: idParams } }, async (req, reply) => {
    const d = store.ownedDevice(req.piuSession!.operatorId, req.params.id);
    // 404 também para equipamento de outro operador: não revela que o id existe.
    if (!d) return fail(reply, 404, 'Não encontrado.');
    const u = store.setDeviceStatus(d.id, d.status === 'paused' ? 'active' : 'paused')!;
    // O equipamento que serve o painel: pausar vale no motor na hora (não guarda nem repassa terceiros).
    // Os outros (com identidade técnica): a pausa sai assinada pela chave de operador e vale quando chega.
    if (u.self) o.relay?.setPaused?.(u.status === 'paused');
    else if (store.isOwner(req.piuSession!.operatorId)) syncOperator();
    const v = deviceView(u);
    return { id: u.id, status: u.status, ...('policy' in v ? { policy: v.policy } : {}) };
  });

  /**
   * Reinicia o nó que serve o painel: só ele (os outros equipamentos se reiniciam pelo painel deles),
   * só o dono, com confirmação recente (step-up). Responde 202 e, depois da resposta sair, fecha limpo
   * (mensagens guardadas e histórico gravados) e sai para o supervisor subir de novo.
   */
  app.post<{ Params: { id: string } }>('/api/devices/:id/restart', { ...mutate(), config: strictLimit(5, '10 minutes'), schema: { params: idParams } }, async (req, reply) => {
    const s = req.piuSession!;
    const d = store.ownedDevice(s.operatorId, req.params.id);
    if (!d) return fail(reply, 404, 'Não encontrado.');
    if (!d.self) return fail(reply, 409, 'Pelo painel, só dá para reiniciar o equipamento que serve este painel. Reinicie o outro pelo painel dele ou no próprio equipamento.');
    if (!store.isOwner(s.operatorId)) return fail(reply, 403, 'Só o dono do equipamento pode reiniciá-lo.');
    if (!stepUpOk(req)) return fail(reply, 403, 'Confirme com um código novo do equipamento.', { reauth: true });
    const restart = o.restart;
    if (!restart) return fail(reply, 409, 'Este nó não foi iniciado com reinício pelo painel. Reinicie no próprio equipamento.');
    reply.raw.once('finish', () => setImmediate(restart));
    return reply.code(202).send({ restarting: true });
  });

  app.delete<{ Params: { id: string } }>('/api/devices/:id', { ...mutate(), schema: { params: idParams } }, async (req, reply) => {
    const d = store.ownedDevice(req.piuSession!.operatorId, req.params.id);
    if (!d) return fail(reply, 404, 'Não encontrado.');
    if (d.self) return fail(reply, 409, 'Este é o equipamento que serve o painel. Para tirá-lo da malha, pause a retransmissão ou desinstale o Piu Node nele.');
    const s = req.piuSession!;
    // Com identidade técnica: a chave do nó entra na lista de revogação assinada pela chave de operador.
    // No nó do dono, vale na hora (handshake recusado, enlace fechado) e vai para os vizinhos do mesmo operador.
    let revoked = false;
    if (d.nodePk) { vault.revoke(s.operatorId, [unhex(d.nodePk)], now()); revoked = true; }
    store.removeDevice(d.id);
    if (store.isOwner(s.operatorId)) syncOperator();
    // Sem identidade técnica (registro do assistente sem vizinho vinculado): só sai do painel.
    if (!revoked) return reply.code(204).send();
    return { revoked, appliedHere: store.isOwner(s.operatorId) };
  });

  // ── chave de operador ─────────────────────────────────
  /** Impressão digital, quando foi criada, rotações e último backup. Sem a chave secreta. */
  app.get('/api/operator', authed(), async req => {
    const id = req.piuSession!.operatorId;
    vault.ensure(id, now());
    const info = vault.info(id)!;
    const owner = store.isOwner(id);
    const head = o.relay?.engine?.lineage.at(-1);
    return {
      ...info, owner,
      revoked: vault.revocation(id)?.revoked.length ?? 0,
      // Outro equipamento do operador rotacionou a chave e este nó recebeu a nova na sincronização.
      rotatedElsewhere: owner && !!head && head !== info.publicKey,
      signedDevices: store.devicesOf(id).filter(d => d.cert?.operatorPk === info.publicKey).length,
    };
  });

  const stepUpOk = (req: FastifyRequest) => now() - req.piuSession!.authAt <= STEP_UP_MS;
  const keyError = (reply: FastifyReply, e: unknown) => {
    if (e instanceof OperatorKeyError) return fail(reply, e.code === 'AUTH' ? 403 : 400, e.message);
    throw e;
  };

  /** Backup cifrado com a senha escolhida. Sensível: exige confirmação recente (step-up). */
  app.post<{ Body: { password: string } }>('/api/operator/backup', {
    ...mutate(), config: strictLimit(5, '10 minutes'),
    schema: { body: { type: 'object', required: ['password'], additionalProperties: false, properties: { password: { type: 'string', minLength: 1, maxLength: 256 } } } },
  }, async (req, reply) => {
    if (!stepUpOk(req)) return fail(reply, 403, 'Confirme com um código novo do equipamento.', { reauth: true });
    const s = req.piuSession!;
    try {
      const text = await vault.backup(s.operatorId, store.operator(s.operatorId)?.name ?? '', req.body.password, now(), { N: o.backupN });
      return { filename: BACKUP_FILENAME, backup: text };
    } catch (e) { return keyError(reply, e); }
  });

  /** Rotação: chave nova assinada pela antiga; equipamentos recebem a nova na próxima sincronização. Exige step-up. */
  app.post('/api/operator/rotate', { ...mutate(), config: strictLimit(5, '10 minutes') }, async (req, reply) => {
    if (!stepUpOk(req)) return fail(reply, 403, 'Confirme com um código novo do equipamento.', { reauth: true });
    const id = req.piuSession!.operatorId;
    try { vault.rotate(id, now()); } catch (e) { return keyError(reply, e); }
    if (store.isOwner(id)) syncOperator();
    return vault.info(id);
  });

  /** Restaura um backup (por exemplo, num segundo nó do mesmo operador). Exige step-up. */
  app.post<{ Body: { backup: string; password: string } }>('/api/operator/restore', {
    ...mutate(), config: strictLimit(5, '10 minutes'), bodyLimit: 300 * 1024,
    schema: { body: { type: 'object', required: ['backup', 'password'], additionalProperties: false, properties: {
      backup: { type: 'string', minLength: 1, maxLength: 256 * 1024 }, password: { type: 'string', minLength: 1, maxLength: 256 } } } },
  }, async (req, reply) => {
    if (!stepUpOk(req)) return fail(reply, 403, 'Confirme com um código novo do equipamento.', { reauth: true });
    const id = req.piuSession!.operatorId;
    try { await vault.restore(id, req.body.backup, req.body.password); } catch (e) { return keyError(reply, e); }
    // Certificados assinados pela chave anterior deste nó deixam de valer: assina de novo com a restaurada.
    for (const d of store.devicesOf(id)) if (d.nodePk) store.updateDevice(d.id, { cert: certToJson(vault.certify(id, unhex(d.nodePk), now())) });
    if (store.isOwner(id)) syncOperator();
    return vault.info(id);
  });

  // ── evidências para o validador e carteira do lote ─────
  /** Recibos que o nó guardou, no formato `EvidenceFile` do validador (apps/settlement). Só o dono. */
  app.get('/api/relay/evidence', authed(), async (req, reply) => {
    if (!store.isOwner(req.piuSession!.operatorId)) return fail(reply, 403, 'Só o dono do equipamento exporta as evidências dele.');
    const e = o.relay?.engine;
    if (!e) return fail(reply, 409, 'Retransmissão LNNP desligada neste nó: não há recibos.');
    // Provas de entrega (`ackSecret`) só existem no destino; o piu-node não decifra nada, então não tem nenhuma.
    const file = { v: 1 as const, receipts: e.receiptLog.map(r => ({ envelopeId: r.envelopeId, ackHash: toHex(r.ackHash), nodePk: toHex(r.nodePk), at: r.at, sig: toHex(r.sig) })), proofs: [] as { envelopeId: string; ackSecret: string }[] };
    const day = new Date(now()).toISOString().slice(0, 10);
    return reply.header('Content-Disposition', `attachment; filename="piu-evidencias-${toHex(e.node.pk).slice(0, 8)}-${day}.json"`).send(file);
  });

  const claimView = () => {
    const e = o.relay?.engine;
    const epochs = claimableEpochs(now());
    return { enabled: !!e, epochs, claims: store.claims().filter(c => !e || c.nodePk === toHex(e.node.pk)).map(({ epoch, address, at }) => ({ epoch, address, at })) };
  };
  app.get('/api/payout-claims', authed(), async () => claimView());

  /** O nó assina a carteira que recebe o lote (`PayoutClaim`). Só o dono; exige step-up (decide para onde vai o dinheiro). */
  app.post<{ Body: { epoch: string; address: string } }>('/api/payout-claims', {
    ...mutate(), config: strictLimit(10, '10 minutes'),
    schema: { body: { type: 'object', required: ['epoch', 'address'], additionalProperties: false, properties: {
      epoch: { type: 'string', pattern: '^[0-9]{4}-S[0-9]{2}$' }, address: { type: 'string', minLength: 40, maxLength: 60 } } } },
  }, async (req, reply) => {
    const s = req.piuSession!;
    if (!store.isOwner(s.operatorId)) return fail(reply, 403, 'Só o dono do equipamento declara a carteira dele.');
    if (!stepUpOk(req)) return fail(reply, 403, 'Confirme com um código novo do equipamento.', { reauth: true });
    const e = o.relay?.engine;
    if (!e) return fail(reply, 409, 'Retransmissão LNNP desligada neste nó: não há chave de nó para assinar.');
    const address = req.body.address.trim();
    if (!isLunesAddress(address)) return fail(reply, 400, 'Endereço LUNES inválido. Confira se copiou inteiro (formato SS58).');
    if (!claimableEpochs(now()).includes(req.body.epoch)) return fail(reply, 400, 'Só dá para declarar a carteira do lote desta semana ou da próxima.');
    const c = makePayoutClaim(e.node, req.body.epoch, address);
    store.setClaim({ epoch: c.epoch, address: c.address, nodePk: toHex(c.nodePk), sig: toHex(c.sig), at: now() });
    return reply.code(201).send(claimView());
  });

  /** As declarações no formato `ClaimFile` do validador, para levar junto com as evidências. Só o dono. */
  app.get('/api/payout-claims/file', authed(), async (req, reply) => {
    if (!store.isOwner(req.piuSession!.operatorId)) return fail(reply, 403, 'Só o dono do equipamento exporta as declarações dele.');
    const e = o.relay?.engine;
    const claims = store.claims().filter(c => !e || c.nodePk === toHex(e.node.pk)).map(({ epoch, address, nodePk: pk, sig }) => ({ epoch, address, nodePk: pk, sig }));
    const tag = e ? toHex(e.node.pk).slice(0, 8) : 'no';
    return reply.header('Content-Disposition', `attachment; filename="piu-carteira-${tag}.json"`).send({ v: 1, claims });
  });

  // ── carteira ───────────────────────────────────────────
  app.get('/api/wallet', authed(), async req => store.wallet(req.piuSession!.operatorId));

  /**
   * Carteira de provider na Lunes Mainnet: o endereço que o operador configurou e o saldo lido nela
   * (último bloco finalizado, cache curto). Só leitura: o nó não tem a chave dessa carteira.
   */
  app.get('/api/wallet/lunes', authed(), async req => {
    const saved = store.lunesAddress(req.piuSession!.operatorId);
    const base = { address: saved?.address ?? null, setAt: saved?.at ?? null, explorer: LUNES_EXPLORER, endpoints: lunes.endpoints };
    if (!saved) return { ...base, onchain: null, error: null, cached: false };
    const b = await lunes.balance(saved.address);
    return { ...base, onchain: b.reading, error: b.error, cached: b.cached };
  });

  /** Configura o endereço (SS58 conferido aqui: base58, prefixo 57 ou 42, soma de verificação). Exige step-up. */
  app.put<{ Body: { address: string } }>('/api/wallet/lunes', {
    ...mutate(), config: strictLimit(10, '10 minutes'),
    schema: { body: { type: 'object', required: ['address'], additionalProperties: false, properties: { address: { type: 'string', minLength: 1, maxLength: 80 } } } },
  }, async (req, reply) => {
    if (!stepUpOk(req)) return fail(reply, 403, 'Confirme com um código novo do equipamento.', { reauth: true });
    const d = decodeSs58(req.body.address);
    if (!d.ok) return fail(reply, 400, d.error);
    const saved = store.setLunesAddress(req.piuSession!.operatorId, req.body.address.trim(), now())!;
    return { address: saved.address, setAt: saved.at };
  });

  /** Tira o endereço configurado. Exige step-up. */
  app.delete('/api/wallet/lunes', { ...mutate(), config: strictLimit(10, '10 minutes') }, async (req, reply) => {
    if (!stepUpOk(req)) return fail(reply, 403, 'Confirme com um código novo do equipamento.', { reauth: true });
    store.setLunesAddress(req.piuSession!.operatorId, null, now());
    return reply.code(204).send();
  });

  app.post<{ Body: { amount: number; to?: string } }>('/api/wallet/transfer', {
    ...mutate(), config: strictLimit(10, '1 minute'),
    schema: { body: { type: 'object', required: ['amount'], additionalProperties: false, properties: {
      amount: { type: 'number', exclusiveMinimum: 0, maximum: 1_000_000 },
      // Carteira pessoal do operador ou `lunes:` + endereço SS58 (conferido por inteiro abaixo).
      to: { type: 'string', minLength: 1, maxLength: 80 },
    } } },
  }, async (req, reply) => {
    const s = req.piuSession!;
    const rawTo = req.body.to;
    if (rawTo !== undefined && rawTo !== 'personal') {
      // A mesma conferência de PUT /api/wallet/lunes: base58, prefixo 57 ou 42, 32 bytes e soma de verificação.
      if (!rawTo.startsWith('lunes:')) return fail(reply, 400, 'Destino inválido. Use a carteira pessoal ou lunes: seguido do endereço Lunes (SS58).');
      const d = decodeSs58(rawTo.slice('lunes:'.length));
      if (!d.ok) return fail(reply, 400, d.error);
    }
    if (now() - s.authAt > STEP_UP_MS) return fail(reply, 403, 'Confirme com um código novo do equipamento.', { reauth: true });
    const amount = req.body.amount;
    if (Math.round(amount * 100) !== amount * 100) return fail(reply, 400, 'Valor com mais de 2 casas decimais.');
    if (amount > store.wallet(s.operatorId).balance) return fail(reply, 400, 'Saldo insuficiente.');
    const to = req.body.to ?? 'personal';
    // Com celular pareado, a transferência só sai depois da aprovação nele (design: "Assinar no celular").
    const phone = store.activePhone(s.operatorId);
    if (phone) {
      const txId = randomUUID();
      const expiresAt = now() + APPROVAL_TTL_MS;
      const request = requestPayload({ txId, amount, to, phoneId: phone.id, expiresAt, node: o.config.allowedHosts[0] ?? 'piu-node' });
      store.addPendingTx({ id: txId, operatorId: s.operatorId, phoneId: phone.id, amount, to, request, expiresAt }, now());
      return reply.code(202).send({ pending: { id: txId, request, code: checkCode(request), phone: phone.name, expiresAt } });
    }
    return store.transfer(s.operatorId, amount, now(), to);
  });

  /** Aprovação digitada (código que o celular mostrou). Uso único; 5 tentativas a cada 10 min. */
  app.post<{ Params: { id: string }; Body: { approval: string } }>('/api/wallet/transfer/:id/approve', {
    ...mutate(), config: strictLimit(5, '10 minutes'),
    schema: { params: idParams, body: { type: 'object', required: ['approval'], additionalProperties: false, properties: { approval: { type: 'string', minLength: 16, maxLength: 24 } } } },
  }, async (req, reply) => {
    const s = req.piuSession!;
    const t = store.pendingTx(req.params.id, now());
    if (!t || t.operatorId !== s.operatorId) return fail(reply, 404, 'Pedido não encontrado ou vencido. Faça a transferência de novo.');
    const phone = store.phonesOf(s.operatorId).find(p => p.id === t.phoneId && p.confirmed);
    if (!phone) return fail(reply, 404, 'Celular não está mais pareado.');
    if (!approvalMatches(Buffer.from(phone.secret, 'base64url'), t.request, req.body.approval)) return fail(reply, 403, 'Código de aprovação não confere.');
    store.removePendingTx(t.id);
    if (t.amount > store.wallet(s.operatorId).balance) return fail(reply, 400, 'Saldo insuficiente.');
    return store.transfer(s.operatorId, t.amount, now(), t.to);
  });

  // ── celulares que aprovam transferências ───────────────
  app.get('/api/phones', authed(), async req =>
    store.phonesOf(req.piuSession!.operatorId).map(({ id, name, addedAt, confirmed }) => ({ id, name, addedAt, confirmed })));

  /** Começa o pareamento (exige confirmação recente): devolve o QR com o segredo, mostrado só nesta tela. */
  app.post<{ Body: { name: string } }>('/api/phones', {
    ...mutate(), config: strictLimit(5, '10 minutes'),
    schema: { body: { type: 'object', required: ['name'], additionalProperties: false, properties: { name: { type: 'string', minLength: 1, maxLength: 40 } } } },
  }, async (req, reply) => {
    const s = req.piuSession!;
    if (now() - s.authAt > STEP_UP_MS) return fail(reply, 403, 'Confirme com um código novo do equipamento.', { reauth: true });
    const secret = newSecret();
    const p = store.addPhone({ id: randomUUID(), operatorId: s.operatorId, name: req.body.name.trim(), secret: secret.toString('base64url'), addedAt: now(), confirmed: false });
    const op = store.operator(s.operatorId);
    // O QR leva a impressão digital do certificado (o app só aceita este certificado) e o endereço
    // pelo qual o painel foi aberto (o Host já passou pela lista de nomes permitidos).
    const host = req.headers.host ?? '';
    const url = /^[A-Za-z0-9.\-]+(:\d{1,5})?$|^\[[0-9A-Fa-f:]+\](:\d{1,5})?$/.test(host) ? `https://${host}` : undefined;
    return reply.code(201).send({ id: p.id, qr: pairPayload({ phoneId: p.id, secret, node: o.config.allowedHosts[0] ?? 'piu-node', operator: op?.name ?? '', fingerprint: tlsFingerprint, url }), expiresAt: now() + PAIR_TTL_MS });
  });

  /** O operador digita o código de 6 dígitos que o celular mostrou ao ler o QR. */
  app.post<{ Params: { id: string }; Body: { code: string } }>('/api/phones/:id/confirm', {
    ...mutate(), config: strictLimit(5, '10 minutes'),
    schema: { params: idParams, body: { type: 'object', required: ['code'], additionalProperties: false, properties: { code: { type: 'string', pattern: '^[0-9]{6}$' } } } },
  }, async (req, reply) => {
    const p = store.phonesOf(req.piuSession!.operatorId).find(x => x.id === req.params.id);
    if (!p || p.confirmed || now() - p.addedAt > PAIR_TTL_MS) return fail(reply, 404, 'Pareamento não encontrado ou vencido.');
    const a = Buffer.from(req.body.code), b = Buffer.from(pairCode(Buffer.from(p.secret, 'base64url')));
    if (!timingSafeEqual(a, b)) return fail(reply, 403, 'Código não confere. Confira o número no celular.');
    store.confirmPhone(p.id);
    return { id: p.id, name: p.name, confirmed: true };
  });

  app.delete<{ Params: { id: string } }>('/api/phones/:id', { ...mutate(), schema: { params: idParams } }, async (req, reply) => {
    const p = store.phonesOf(req.piuSession!.operatorId).find(x => x.id === req.params.id);
    if (!p) return fail(reply, 404, 'Não encontrado.');
    store.removePhone(p.id);
    return reply.code(204).send();
  });

  // ── pacotes assinados do instalador ────────────────────
  app.get('/api/packages', authed(), async () => o.packages);

  /** Público (o equipamento novo baixa sem sessão); a integridade vem da assinatura, conferida no instalador. */
  app.get<{ Params: { file: string } }>('/pkg/:file', async (req, reply) => {
    const { file } = req.params;
    const m = SAFE_FILE.test(file) ? o.packages.find(p => p.file === file) : undefined;
    if (!m) return fail(reply, 404, 'Não encontrado.');
    const body = await readFile(join(o.packagesDir, m.file));
    return reply.type('application/octet-stream').header('Content-Disposition', `attachment; filename="${m.file}"`).header('X-Piu-Sha256', m.sha256).send(body);
  });

  // ── painel ─────────────────────────────────────────────
  app.get('/*', async (req, reply) => {
    const f = await readPanelFile(o.config.panelDir, req.url);
    if (!f) return fail(reply, 404, 'Não encontrado.');
    return reply.type(f.type).send(f.body);
  });

  // Erros sem detalhes internos nem stack trace; o detalhe fica só no log local.
  app.setErrorHandler((err: Error & { validation?: unknown; statusCode?: number }, req, reply) => {
    if (err.validation) return fail(reply, 400, 'Requisição inválida.');
    if (err.statusCode === 429) return fail(reply, 429, 'Muitas tentativas. Aguarde um pouco.');
    if (err.statusCode && err.statusCode < 500) return fail(reply, err.statusCode, 'Requisição inválida.');
    req.log.error(err);
    return fail(reply, 500, 'Erro interno.');
  });
  app.setNotFoundHandler((req, reply) => fail(reply, 404, 'Não encontrado.'));

  return app;
}
