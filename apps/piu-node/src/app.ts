import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config } from './config.js';
import { type Manifest, SAFE_FILE } from './packages.js';
import type { Pairing } from './security/pairing.js';
import { APPROVAL_TTL_MS, approvalMatches, checkCode, newSecret, PAIR_TTL_MS, pairCode, pairPayload, requestPayload } from './security/approval.js';
import { cookieOptions, createSession, csrfMatches, endSession, findSession, SESSION_COOKIE, sessionLabel, STEP_UP_MS } from './security/session.js';
import { readPanelFile } from './static.js';
import type { Device, Session, Settings, Store } from './store.js';

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
    stats(): object; applySettings(s: Settings): void;
    /** Pausar retransmissão do equipamento que serve o painel. */
    setPaused?(paused: boolean): void;
    /** Histórico das estatísticas (amostras de 24 h e totais por dia). */
    history?(): object;
    /** Recibos guardados para o validador (só horário e se são deste nó). */
    receipts?(): object;
  } | null;
  /** O próprio nó, registrado como equipamento do dono no primeiro pareamento. Ausente: não registra. */
  selfDevice?: { name: string; cls: string };
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
  const now = o.now ?? Date.now;
  const { store, pairing } = o;
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
  app.get('/api/settings', authed(), async req => store.settings(req.piuSession!.operatorId));
  app.put<{ Body: Settings }>('/api/settings', { ...mutate(), schema: { body: settingsSchema } }, async req => {
    const saved = store.setSettings(req.piuSession!.operatorId, req.body);
    // Os limites do dono do equipamento passam a valer no roteador na hora (banda, espaço, horário, mídia).
    o.relay?.applySettings(store.nodeSettings());
    return saved;
  });

  // ── retransmissão (LNNP) ──────────────────────────────
  /** Estatísticas reais do motor: vizinhos, envelopes guardados e encaminhados, duplicatas, recibos. */
  app.get('/api/relay', authed(), async () => (o.relay ? o.relay.stats() : { enabled: false }));
  /** Histórico para os gráficos: amostras das últimas 24 h e totais por dia (contagens, sem LUNES). */
  app.get('/api/relay/history', authed(), async () => (o.relay?.history ? { enabled: true, ...o.relay.history() } : { enabled: false }));
  /** Recibos de retransmissão guardados para o validador: quantos e os horários dos mais recentes. */
  app.get('/api/relay/receipts', authed(), async () => (o.relay?.receipts ? { enabled: true, ...o.relay.receipts() } : { enabled: false }));

  // ── equipamentos (posse checada em cada ação: anti-IDOR) ─
  /** Campos públicos do equipamento (o nome público `piu.…` só quando existe). */
  const deviceView = ({ id, name, cls, status, self, pub }: Device) => ({ id, name, cls, status, self: !!self, ...(pub ? { pub } : {}) });
  app.get('/api/devices', authed(), async req => store.devicesOf(req.piuSession!.operatorId).map(deviceView));

  /** Equipamento ativado pelo assistente "Adicionar equipamento". */
  app.post<{ Body: { name: string; cls: string; family: string; pub?: string } }>('/api/devices', {
    ...mutate(), config: strictLimit(20, '1 minute'),
    schema: { body: { type: 'object', required: ['name', 'cls', 'family'], additionalProperties: false, properties: {
      name: { type: 'string', minLength: 1, maxLength: 40 },
      cls: { type: 'string', enum: ['Home Node', 'Super Node', 'Gateway Local', 'Ponto de Acesso'] },
      family: { type: 'string', enum: ['router', 'linux', 'minipc', 'lora', 'ap', 'p2p'] },
      pub: { type: 'string', pattern: '^piu\\.[a-z0-9](?:[a-z0-9-]{0,26}[a-z0-9])?$' },
    } } },
  }, async (req, reply) => {
    const s = req.piuSession!;
    if (store.devicesOf(s.operatorId).length >= 100) return fail(reply, 400, 'Limite de equipamentos atingido.');
    const { name, cls, family, pub } = req.body;
    const d = store.addDevice({ ownerId: s.operatorId, name: name.trim(), cls, family, pub, createdAt: now() });
    return reply.code(201).send(deviceView(d));
  });

  app.post<{ Params: { id: string } }>('/api/devices/:id/pause', { ...mutate(), schema: { params: idParams } }, async (req, reply) => {
    const d = store.ownedDevice(req.piuSession!.operatorId, req.params.id);
    // 404 também para equipamento de outro operador: não revela que o id existe.
    if (!d) return fail(reply, 404, 'Não encontrado.');
    const u = store.setDeviceStatus(d.id, d.status === 'paused' ? 'active' : 'paused')!;
    // O equipamento que serve o painel: pausar vale no motor na hora (não guarda nem repassa terceiros).
    if (u.self) o.relay?.setPaused?.(u.status === 'paused');
    return { id: u.id, status: u.status };
  });

  app.delete<{ Params: { id: string } }>('/api/devices/:id', { ...mutate(), schema: { params: idParams } }, async (req, reply) => {
    const d = store.ownedDevice(req.piuSession!.operatorId, req.params.id);
    if (!d) return fail(reply, 404, 'Não encontrado.');
    if (d.self) return fail(reply, 409, 'Este é o equipamento que serve o painel. Para tirá-lo da malha, pause a retransmissão ou desinstale o Piu Node nele.');
    store.removeDevice(d.id);
    return reply.code(204).send();
  });

  // ── carteira ───────────────────────────────────────────
  app.get('/api/wallet', authed(), async req => store.wallet(req.piuSession!.operatorId));

  app.post<{ Body: { amount: number; to?: string } }>('/api/wallet/transfer', {
    ...mutate(), config: strictLimit(10, '1 minute'),
    schema: { body: { type: 'object', required: ['amount'], additionalProperties: false, properties: {
      amount: { type: 'number', exclusiveMinimum: 0, maximum: 1_000_000 },
      // Carteira pessoal do operador ou um endereço LUNES (base58, sem 0, O, I, l).
      to: { type: 'string', pattern: '^(personal|lunes:[1-9A-HJ-NP-Za-km-z]{26,44})$' },
    } } },
  }, async (req, reply) => {
    const s = req.piuSession!;
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
    return reply.code(201).send({ id: p.id, qr: pairPayload({ phoneId: p.id, secret, node: o.config.allowedHosts[0] ?? 'piu-node', operator: op?.name ?? '' }), expiresAt: now() + PAIR_TTL_MS });
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
