/**
 * Caixa de entrada do validador para os pacotes que chegam pela malha (docs/carteira/transacoes-pela-malha.md):
 * gateways (piu-node, celulares) entregam, por `POST`, pacotes selados para a chave das provas
 * (`validatorProofKey`, a mesma das provas v2). Aqui o pacote é aberto, conferido na forma e gravado em
 * `evidencias/` ou `registro/` como um arquivo comum; o `close` confere tudo (assinaturas, provas,
 * certificados, avais, cauções) EXATAMENTE como confere os arquivos compartilhados à mão. Nada aqui é
 * confiável por vir da caixa: quem mandou o pacote não importa.
 *
 * Deduplicação: o nome do arquivo é a referência do pacote (`bundleRef`); o mesmo pacote por outro
 * gateway não grava de novo. Recibo repetido em partes diferentes o próprio livro descarta.
 */
import { existsSync, readdirSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { join } from 'node:path';
import { writeFileAtomic } from './fsutil.js';
import { BundleKind, bundleRefHex, MAX_BUNDLE_BYTES, openBundle } from './protocol/carry.js';
import type { KeyPair } from './protocol/keys.js';
import { MAX_CERTS_PER_FILE } from './registry.js';
import { isU32 } from './hex.js';

export type InboxResult =
  | { ok: true; kind: 'evidencias' | 'registro'; file: string; duplicate: boolean }
  | { ok: false; reason: string };

const HEX = (n: number) => new RegExp(`^[0-9a-f]{${n}}$`);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = (v: unknown, max: number) => v === undefined || (Array.isArray(v) && v.length <= max && v.every(isObj));
/** Teto de itens por parte (uma parte tem no máximo 12 KB; isto só recusa lixo). */
const MAX_ITEMS = 2000;

/** Forma de um `EvidenceFile` (o conteúdo é conferido no close). */
function evidenceShape(j: unknown): string | null {
  if (!isObj(j) || (j.v !== 1 && j.v !== 2)) return 'arquivo de evidências sem versão 1/2';
  if (!arr(j.receipts, MAX_ITEMS) || !arr(j.proofs, MAX_ITEMS) || !arr(j.sealedProofs, MAX_ITEMS)) return 'listas de evidências inválidas';
  const id = HEX(32);
  for (const r of (j.receipts ?? []) as Record<string, unknown>[]) if (!id.test(String(r.envelopeId)) || !isU32(r.at)) return 'recibo malformado'; // u32: ver H-1
  for (const p of [...((j.proofs ?? []) as Record<string, unknown>[]), ...((j.sealedProofs ?? []) as Record<string, unknown>[])]) if (!id.test(String(p.envelopeId))) return 'prova malformada';
  const keys = Object.keys(j).filter(k => !['v', 'receipts', 'proofs', 'sealedProofs'].includes(k));
  return keys.length ? `campo desconhecido (${keys[0]})` : null;
}

/** Forma de um `RegistryFile` (certificados, revogações, celulares, avais, saídas). */
function registryShape(j: unknown): string | null {
  if (!isObj(j) || j.v !== 1) return 'arquivo de registro sem versão 1';
  for (const k of ['certs', 'revocations', 'phones', 'endorsements', 'exits', 'endorsementRevocations']) if (!arr(j[k], k === 'certs' ? MAX_CERTS_PER_FILE : MAX_ITEMS)) return `lista ${k} inválida`;
  const keys = Object.keys(j).filter(k => !['v', 'certs', 'revocations', 'phones', 'endorsements', 'exits', 'endorsementRevocations'].includes(k));
  return keys.length ? `campo desconhecido (${keys[0]})` : null;
}

/** Abre, confere a forma e grava em `<dir>/evidencias|registro/caixa-<ref>.json`. */
export function ingestBundle(sealed: Uint8Array, proofKey: KeyPair, dir: string, opts: { dryRun?: boolean } = {}): InboxResult {
  if (sealed.length < 1 || sealed.length > MAX_BUNDLE_BYTES) return { ok: false, reason: 'tamanho fora do limite' };
  const b = openBundle(sealed, proofKey);
  if (!b) return { ok: false, reason: 'não abre com a chave do validador (adulterado ou para outra chave)' };
  let j: unknown;
  try { j = JSON.parse(b.json); } catch { return { ok: false, reason: 'JSON inválido' }; }
  const kind = b.kind === BundleKind.Evidence ? 'evidencias' : 'registro';
  const err = b.kind === BundleKind.Evidence ? evidenceShape(j) : registryShape(j);
  if (err) return { ok: false, reason: err };
  const file = join(dir, kind, `caixa-${bundleRefHex(sealed).slice(0, 32)}.json`);
  if (existsSync(file)) return { ok: true, kind, file, duplicate: true };
  if (opts.dryRun) return { ok: true, kind, file, duplicate: false };
  writeFileAtomic(file, JSON.stringify(j, null, 2));
  return { ok: true, kind, file, duplicate: false };
}

/**
 * Servidor HTTP da caixa: `POST /caixa` com o pacote binário (até 12 KB). Responde 202 (gravado ou já
 * existia) ou 400 (recusado, com o motivo). Sem TLS aqui: ponha um proxy HTTPS na frente (os gateways só
 * entregam a `https://`). Limite simples por endereço: `perMinute` pacotes por minuto.
 */
export function inboxServer(o: {
  proofKey: KeyPair; dir: string; perMinute?: number; log?: (m: string) => void; now?: () => number;
  /**
   * Atrás de um proxy HTTPS neste computador: o limite usa o último endereço de `X-Forwarded-For`
   * (o que o proxy viu), só quando a conexão vem de 127.0.0.1/::1. Sem isso, todos os clientes
   * dividiriam a cota do proxy e um só atacante bloquearia todos (auditoria final, M-4).
   */
  trustProxy?: boolean;
  /** Teto de arquivos em `evidencias/` e em `registro/` (cada um). Acima: 507, nada gravado. */
  maxFiles?: number;
}): Server {
  const perMinute = o.perMinute ?? 120;
  const maxFiles = o.maxFiles ?? 200_000;
  const counts = new Map<string, number>();
  const countOf = (kind: string) => {
    if (!counts.has(kind)) { try { counts.set(kind, readdirSync(join(o.dir, kind)).length); } catch { counts.set(kind, 0); } }
    return counts.get(kind)!;
  };
  const clientIp = (req: IncomingMessage) => {
    const ra = req.socket.remoteAddress ?? '?';
    if (o.trustProxy && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ra)) {
      const xf = String(req.headers['x-forwarded-for'] ?? '').split(',').map(x => x.trim()).filter(Boolean).at(-1);
      if (xf) return xf.slice(0, 64);
    }
    return ra;
  };
  const now = o.now ?? Date.now;
  const windows = new Map<string, { start: number; n: number }>();
  const allowed = (ip: string) => {
    const t = now();
    let w = windows.get(ip);
    if (!w || t - w.start >= 60_000) { w = { start: t, n: 0 }; windows.set(ip, w); }
    if (windows.size > 10_000) windows.delete(windows.keys().next().value!);
    return ++w.n <= perMinute;
  };
  const body = (req: IncomingMessage) => new Promise<Uint8Array | null>(resolve => {
    const parts: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => { size += c.length; if (size > MAX_BUNDLE_BYTES) { resolve(null); req.destroy(); } else parts.push(c); });
    req.on('end', () => resolve(new Uint8Array(Buffer.concat(parts))));
    req.on('error', () => resolve(null));
  });
  return createServer(async (req, res) => {
    const reply = (code: number, j: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (req.method !== 'POST' || req.url !== '/caixa') return reply(404, { error: 'use POST /caixa' });
    if (!allowed(clientIp(req))) return reply(429, { error: 'muitos pacotes; tente depois' });
    const b = await body(req);
    if (!b) return reply(413, { error: 'pacote grande demais' });
    if (countOf('evidencias') >= maxFiles || countOf('registro') >= maxFiles) {
      // Cota cheia: confere só se é repetido (não grava nada novo).
      const r0 = ingestBundle(b, o.proofKey, o.dir, { dryRun: true });
      if (!r0.ok) return reply(400, { error: r0.reason });
      if (!r0.duplicate) { o.log?.('caixa: cota de arquivos cheia'); return reply(507, { error: 'caixa cheia; tente depois' }); }
      return reply(202, { ok: true, kind: r0.kind, duplicate: true });
    }
    const r = ingestBundle(b, o.proofKey, o.dir);
    if (r.ok && !r.duplicate) counts.set(r.kind, countOf(r.kind) + 1);
    if (!r.ok) { o.log?.(`caixa: recusado (${r.reason})`); return reply(400, { error: r.reason }); }
    o.log?.(`caixa: ${r.duplicate ? 'repetido' : 'gravado'} ${r.file}`);
    return reply(202, { ok: true, kind: r.kind, duplicate: r.duplicate });
  });
}
