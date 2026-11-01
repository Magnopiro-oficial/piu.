import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config } from './config.js';
import { type Manifest, SAFE_FILE } from './packages.js';
import type { Pairing } from './security/pairing.js';
import { cookieOptions, createSession, csrfMatches, endSession, findSession, SESSION_COOKIE, STEP_UP_MS } from './security/session.js';
import { readPanelFile } from './static.js';
import type { Session, Store } from './store.js';

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
}

/** CSP igual à do painel (a mesma política vale para o HTML servido aqui). */
const CSP = {
  'default-src': ["'none'"], 'script-src': ["'self'"], 'style-src': ["'self'"], 'style-src-attr': ["'unsafe-inline'"],
  'img-src': ["'self'", 'data:'], 'font-src': ["'self'"], 'connect-src': ["'self'"], 'manifest-src': ["'self'"],
  'base-uri': ["'none'"], 'form-action': ["'none'"], 'frame-ancestors': ["'none'"], 'object-src': ["'none'"],
};
const PERMISSIONS = 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), interest-cohort=()';
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
    const op = store.addOperator(req.body.name.trim(), now());
    const { token, session } = createSession(store, op.id, now());
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

  // ── equipamentos (posse checada em cada ação: anti-IDOR) ─
  app.get('/api/devices', authed(), async req =>
    store.devicesOf(req.piuSession!.operatorId).map(({ id, name, cls, status, today }) => ({ id, name, cls, status, today })));

  app.post<{ Params: { id: string } }>('/api/devices/:id/pause', { ...mutate(), schema: { params: idParams } }, async (req, reply) => {
    const d = store.ownedDevice(req.piuSession!.operatorId, req.params.id);
    // 404 também para equipamento de outro operador: não revela que o id existe.
    if (!d) return fail(reply, 404, 'Não encontrado.');
    const u = store.setDeviceStatus(d.id, d.status === 'paused' ? 'active' : 'paused')!;
    return { id: u.id, status: u.status };
  });

  app.delete<{ Params: { id: string } }>('/api/devices/:id', { ...mutate(), schema: { params: idParams } }, async (req, reply) => {
    const d = store.ownedDevice(req.piuSession!.operatorId, req.params.id);
    if (!d) return fail(reply, 404, 'Não encontrado.');
    store.removeDevice(d.id);
    return reply.code(204).send();
  });

  // ── carteira ───────────────────────────────────────────
  app.get('/api/wallet', authed(), async req => store.wallet(req.piuSession!.operatorId));

  app.post<{ Body: { amount: number } }>('/api/wallet/transfer', {
    ...mutate(), config: strictLimit(10, '1 minute'),
    schema: { body: { type: 'object', required: ['amount'], additionalProperties: false, properties: { amount: { type: 'number', exclusiveMinimum: 0, maximum: 1_000_000 } } } },
  }, async (req, reply) => {
    const s = req.piuSession!;
    if (now() - s.authAt > STEP_UP_MS) return fail(reply, 403, 'Confirme com um código novo do equipamento.', { reauth: true });
    const amount = req.body.amount;
    if (Math.round(amount * 100) !== amount * 100) return fail(reply, 400, 'Valor com mais de 2 casas decimais.');
    if (amount > store.wallet(s.operatorId).balance) return fail(reply, 400, 'Saldo insuficiente.');
    return store.transfer(s.operatorId, amount, now());
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
