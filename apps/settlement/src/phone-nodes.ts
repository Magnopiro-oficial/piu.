/**
 * Celulares como nó que rende (docs/economia/no-celular.md): quem fica habilitado e desde quando.
 *
 * Um celular (chave de operador de classe `phone`, registro autoverificado em `registro/*.json`)
 * fica habilitado quando:
 * 1. tem caução conferida na chain e não devolvida/confiscada (bond.ts);
 * 2. passaram `minAgeDays` (7) desde o bloco da caução;
 * 3. tem, ao mesmo tempo, avais VÁLIDOS de pelo menos `minEndorsements` (2) avalistas distintos,
 *    habilitados no momento do aval, e a linhagem dele chega a pelo menos `minRoots` (2) operadores
 *    admitidos (raízes do `operadores.json`) diferentes.
 *
 * Revisão independente (tabela em no-celular.md):
 * - O momento de um aval é o "visto pela primeira vez" pelo validador (`recordFirstSeen`, gravado no
 *   estado), nunca a data escolhida por quem assina: o dia declarado só é aceito numa janela curta
 *   (`endorsementBackdateDays` antes do início da época até agora), e o limite mensal usa o mês do visto.
 * - Chaves rotacionadas de um operador admitido contam como UM avalista (a raiz), com UMA cota mensal.
 * - Cada celular habilitado leva o conjunto de raízes da linhagem; uma raiz habilita no máximo
 *   `maxEnabledPerRootPerMonth` celulares por mês; raiz com `rootSuspendAfterSlashes` celulares
 *   confiscados na linhagem fica suspensa (os avais dela e por ela não contam).
 * - Aval vence `endorsementValidityDays` (90) depois de visto e pode ser retirado (assinado).
 * - A saída vale para a caução em que foi assinada; com registros diferentes da mesma chave, vale o de
 *   caução ativa (e, entre esses, o mais novo).
 *
 * A habilitação é um ponto fixo a partir dos operadores admitidos: um anel de celulares novos que só
 * avalizam uns aos outros nunca entra. "Contato público aceito" é regra do app; o validador só vê
 * chaves de operador.
 */
import { epochStart } from './epoch.js';
import {
  type EndorsementJson, type EndorsementRevocationJson, type PhoneExitJson, type PhoneRegistrationJson, verifyEndorsement, verifyEndorsementRevocation, verifyPhoneExit,
  verifyPhoneRegistration,
} from './protocol/phoneNode.js';
import { BOND_REASON, type BondCheck, type BondRecord, checkBonds, recordBonds, regKey } from './bond.js';
import type { ChainClient } from './chain.js';
import type { PhoneWindow, RegistryFile } from './registry.js';
import { lunesToPlanck } from './units.js';
import type { ValidatorState } from './validator.js';

export interface PhonePolicy {
  /** Endereço SS58 que recebe as cauções. `null`: nenhum celular é habilitado. */
  bondAddress: string | null;
  /** Caução mínima (planck). Padrão: 100 LUNES (parâmetro de produto, igual a PHONE_NODE_BOND no app). */
  minBondPlanck: bigint;
  minAgeDays: number;
  minEndorsements: number;
  /** Raízes (operadores admitidos) diferentes na linhagem de avais. */
  minRoots: number;
  /** Avais contados por avalista por mês (UTC, mês do "visto"). */
  maxEndorsementsPerMonth: number;
  /** Celulares habilitados por raiz por mês (UTC, mês da habilitação). */
  maxEnabledPerRootPerMonth: number;
  /** Celulares confiscados na linhagem de uma raiz até ela ser suspensa como avalista. */
  rootSuspendAfterSlashes: number;
  /** Validade de um aval depois de visto (dias). */
  endorsementValidityDays: number;
  /** Quanto antes do início da época o dia declarado num aval ainda é aceito (dias). */
  endorsementBackdateDays: number;
  /** Teto de um celular (por nó e por operador) como fração do teto de um operador de piu-node. */
  capFraction: number;
  /** Teto por época de um celular como fração da caução dele (0,25 = um quarto da caução). */
  maxPayoutBondRatio: number;
  /** Dias entre a saída assinada e a devolução devida da caução (operação manual). */
  refundDelayDays: number;
}
export const DEFAULT_PHONE_POLICY: PhonePolicy = {
  bondAddress: null, minBondPlanck: lunesToPlanck('100'), minAgeDays: 7, minEndorsements: 3, minRoots: 2, maxEndorsementsPerMonth: 5,
  maxEnabledPerRootPerMonth: 10, rootSuspendAfterSlashes: 3, endorsementValidityDays: 90, endorsementBackdateDays: 7, capFraction: 0.5, maxPayoutBondRatio: 0.25,
  refundDelayDays: 7,
};

/** Limites por arquivo de registro (não confiável): o resto é ignorado, antes de conferir assinaturas. */
export const PHONE_FILE_LIMITS = { phones: 8, exits: 8, endorsements: 500, endorsementRevocations: 500 } as const;
/** Avais e retiradas guardados no estado do validador, no máximo (os mais antigos saem primeiro). */
export const MAX_SEEN = 100_000;

export const PHONE_REASON = {
  bad: 'registro do celular inválido',
  admitted: 'chave já é de operador admitido (classe node)',
  young: 'menos dias de caução que o mínimo',
  endorsements: 'avais insuficientes',
  roots: 'linhagem com poucas raízes diferentes',
  rootCap: 'teto mensal de habilitações de uma raiz',
  exited: 'celular saiu do programa',
} as const;
export const ENDORSE_REASON = {
  sig: 'assinatura inválida',
  window: 'data do aval fora da janela',
  repeated: 'mesmo avalista repetido',
  monthly: 'acima do limite mensal do avalista',
  ineligible: 'avalista não habilitado no momento do aval',
  suspended: 'avalista suspenso (celulares confiscados na linhagem)',
  revoked: 'aval retirado',
  expired: 'aval vencido',
  notInPerson: 'aval de celular sem verificação pessoal',
} as const;

export interface PhoneReport {
  operator: string; wallet: string; eligible: boolean; reason?: string;
  /** Habilitado desde (s) e até (s, saída ou fim dos avais), quando há. */
  from?: number; until?: number;
  /** Raízes diferentes na linhagem (só o número; as chaves vão no estado). */
  roots?: number;
  endorsements: { counted: number; ignored: { endorser: string; reason: string }[] };
}

// ── avais vistos pelo validador (estado) ────────────────────

export interface PhoneSeenState {
  endorsements: Record<string, { e: EndorsementJson; seen: number }>;
  revocations: Record<string, { r: EndorsementRevocationJson; seen: number }>;
}
const emptySeen = (): PhoneSeenState => ({ endorsements: {}, revocations: {} });

/**
 * Ponto de entrada de TODO caminho de ingestão (arquivo compartilhado hoje; caixa de entrada pela
 * malha depois): grava o "visto pela primeira vez" de avais e retiradas de aval no estado do
 * validador. Puro: devolve o estado novo (quem chama grava, de forma atômica).
 *
 * - `at`: quando chegou (s). `epoch`: a época sendo fechada, quando a ingestão é a do `close`.
 * - Aval: assinatura confere e o dia declarado cai em [início da época (ou `at`) − backdate, `at`];
 *   o visto = max(início do dia declarado, início da janela). Já conhecido (mesma assinatura): nada muda.
 * - Retirada: assinatura confere; vale a partir de `at` (nunca do `at` que quem assina escolheu).
 * - Repetidos pela assinatura saem antes de conferir; no máximo `PHONE_FILE_LIMITS` por chamada.
 */
export function recordFirstSeen(
  state: ValidatorState,
  items: { endorsements?: readonly unknown[]; endorsementRevocations?: readonly unknown[] },
  o: { at: number; epoch?: string; policy?: Partial<PhonePolicy>; accept?: (e: { endorserPk: string; phonePk: string }) => boolean },
): { state: ValidatorState; added: number; rejected: { sig: string; reason: string }[] } {
  const P = { ...DEFAULT_PHONE_POLICY, ...o.policy };
  const seen: PhoneSeenState = { endorsements: { ...(state.phoneSeen?.endorsements ?? {}) }, revocations: { ...(state.phoneSeen?.revocations ?? {}) } };
  const lo = (o.epoch ? epochStart(o.epoch) : o.at) - P.endorsementBackdateDays * 86400;
  const rejected: { sig: string; reason: string }[] = [];
  let added = 0;
  const sigOf = (x: unknown) => (x && typeof (x as { sig?: unknown }).sig === 'string' ? (x as { sig: string }).sig : '');
  for (const x of (Array.isArray(items.endorsements) ? items.endorsements : []).slice(0, PHONE_FILE_LIMITS.endorsements)) {
    const sig = sigOf(x);
    if (!sig || seen.endorsements[sig]) continue;
    const e = x as EndorsementJson;
    // Antes da assinatura (barato): só aval para celular registrado, de operador admitido ou celular
    // registrado. Chaves geradas na hora não enchem o estado nem expulsam avais legítimos (auditoria final, M-4).
    // Sai no relatório como "avalista não habilitado", sem ocupar o estado.
    if (o.accept && !o.accept({ endorserPk: String(e.endorserPk).toLowerCase(), phonePk: String(e.phonePk).toLowerCase() })) { rejected.push({ sig, reason: ENDORSE_REASON.ineligible }); continue; }
    if (!verifyEndorsement(e)) { rejected.push({ sig, reason: ENDORSE_REASON.sig }); continue; }
    const start = e.day * 86400;
    if (start > o.at || start + 86400 <= lo) { rejected.push({ sig, reason: ENDORSE_REASON.window }); continue; }
    seen.endorsements[sig] = { e: { endorserPk: e.endorserPk, phonePk: e.phonePk, day: e.day, inPerson: e.inPerson, sig }, seen: Math.max(start, lo) };
    added++;
  }
  for (const x of (Array.isArray(items.endorsementRevocations) ? items.endorsementRevocations : []).slice(0, PHONE_FILE_LIMITS.endorsementRevocations)) {
    const sig = sigOf(x);
    if (!sig || seen.revocations[sig]) continue;
    const r = x as EndorsementRevocationJson;
    if (!verifyEndorsementRevocation(r)) { rejected.push({ sig, reason: ENDORSE_REASON.sig }); continue; }
    seen.revocations[sig] = { r: { endorserPk: r.endorserPk, phonePk: r.phonePk, at: r.at, sig }, seen: o.at };
    added++;
  }
  const trim = <T extends { seen: number }>(rec: Record<string, T>) => {
    const ks = Object.keys(rec);
    if (ks.length <= MAX_SEEN) return rec;
    return Object.fromEntries(ks.map(k => [k, rec[k]!] as const).sort((a, b) => b[1].seen - a[1].seen).slice(0, MAX_SEEN));
  };
  return { state: { ...state, phoneSeen: { endorsements: trim(seen.endorsements), revocations: trim(seen.revocations) } }, added, rejected };
}

// ── leitura dos arquivos ────────────────────────────────────

/** Registros (por operador, sem repetição pela assinatura), saídas (por `regKey`), avais e retiradas, com limites por arquivo. */
export function collectPhones(files: readonly RegistryFile[]) {
  const regs = new Map<string, PhoneRegistrationJson[]>();
  const regSigs = new Set<string>();
  const bad = new Set<string>();
  /** Evento mais novo (por `at`) de saída/volta de cada caução. */
  const exitEvents = new Map<string, { kind: 'exit' | 'cancel'; at: number }>();
  const exitSigs = new Set<string>();
  const endorsements: unknown[] = [], endorsementRevocations: unknown[] = [];
  for (const f of files) {
    for (const r of Array.isArray(f?.phones) ? f.phones.slice(0, PHONE_FILE_LIMITS.phones) : []) {
      if (typeof r?.sig !== 'string' || regSigs.has(r.sig)) continue;
      regSigs.add(r.sig);
      if (!verifyPhoneRegistration(r)) { bad.add(typeof r.operatorPk === 'string' ? r.operatorPk : '?'); continue; }
      const list = regs.get(r.operatorPk);
      if (list) list.push(r); else regs.set(r.operatorPk, [r]);
    }
    for (const x of Array.isArray(f?.exits) ? f.exits.slice(0, PHONE_FILE_LIMITS.exits) : []) {
      if (typeof x?.sig !== 'string' || exitSigs.has(x.sig)) continue;
      exitSigs.add(x.sig);
      if (!verifyPhoneExit(x)) continue;
      const k = regKey({ operatorPk: x.operatorPk, bond: { txHash: x.txHash } });
      const cur = exitEvents.get(k);
      if (!cur || x.at > cur.at || (x.at === cur.at && x.kind === 'exit')) exitEvents.set(k, { kind: x.kind, at: x.at });
    }
    for (const e of Array.isArray(f?.endorsements) ? f.endorsements.slice(0, PHONE_FILE_LIMITS.endorsements) : []) endorsements.push(e);
    for (const r of Array.isArray(f?.endorsementRevocations) ? f.endorsementRevocations.slice(0, PHONE_FILE_LIMITS.endorsementRevocations) : []) endorsementRevocations.push(r);
  }
  // Saídas vigentes (o último evento é saída): a janela de habilitação acaba nelas.
  const exits = new Map([...exitEvents].filter(([, e]) => e.kind === 'exit').map(([k, e]) => [k, e.at] as [string, number]));
  return { regs, bad: [...bad], exits, exitEvents, endorsements, endorsementRevocations };
}

// ── intervalos ──────────────────────────────────────────────

type Iv = [number, number];
/** Instantes cobertos por pelo menos `k` dos grupos (cada grupo: intervalos [a, b), unidos). */
function coverage(groups: Iv[][], k: number): Iv[] {
  const ev: [number, number][] = [];
  for (const g of groups) for (const [a, b] of merge(g)) { ev.push([a, 1]); ev.push([b, -1]); }
  ev.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const out: Iv[] = [];
  let n = 0, start = 0;
  for (const [t, d] of ev) {
    const was = n;
    n += d;
    if (was < k && n >= k) start = t;
    else if (was >= k && n < k && t > start) out.push([start, t]);
  }
  return merge(out);
}
function merge(ivs: Iv[]): Iv[] {
  const s = ivs.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Iv[] = [];
  for (const [a, b] of s) { const last = out[out.length - 1]; if (last && a <= last[1]) last[1] = Math.max(last[1], b); else out.push([a, b]); }
  return out;
}
const monthOfSec = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 7);

// ── habilitação ─────────────────────────────────────────────

interface Cand { op: string; reg: PhoneRegistrationJson; key: string; bondAt: number; amount: bigint; exit?: number; sticky?: { from: number; roots: string[] } }
interface Elig { from: number; until: number; roots: Set<string> }

/**
 * Habilitação (pura, reprodutível): registros, cauções conferidas, avais vistos, raízes admitidas e
 * o estado das cauções (linhagem gravada e confiscos). Devolve as janelas para o `NodeRegistry`.
 */
export function evaluatePhones(o: {
  regs: ReadonlyMap<string, readonly PhoneRegistrationJson[]>; exits: ReadonlyMap<string, number>; bonds: ReadonlyMap<string, BondCheck>;
  seen: PhoneSeenState | undefined;
  /** Chave de operador admitido (inclusive rotacionada) → raiz no `operadores.json`. */
  roots: ReadonlyMap<string, string>;
  records?: readonly BondRecord[]; now: number; policy?: Partial<PhonePolicy>;
}): { eligible: Map<string, PhoneWindow>; report: PhoneReport[]; lineage: Map<string, { roots: string[]; from: number }>; suspendedRoots: string[] } {
  const P = { ...DEFAULT_PHONE_POLICY, ...o.policy };
  const seen = o.seen ?? emptySeen();
  const records = o.records ?? [];
  const isRoot = (k: string) => o.roots.has(k);

  // Confisco em cascata: celulares confiscados contam contra as raízes da linhagem deles.
  const slashes = new Map<string, number>();
  for (const b of records) if (b.state === 'confiscada') for (const r of b.roots ?? []) slashes.set(r, (slashes.get(r) ?? 0) + 1);
  const suspended = new Set([...slashes].filter(([, n]) => n >= P.rootSuspendAfterSlashes).map(([r]) => r));

  // Registro que vale por chave: caução ok; prefere sem saída vigente, depois o bloco mais novo.
  const report = new Map<string, PhoneReport>();
  const cands = new Map<string, Cand>();
  const sticky = new Map<string, { from: number; roots: string[] }>(records.filter(b => b.enabledFrom !== undefined).map(b => [`${b.operatorPk}:${b.txHash}`, { from: b.enabledFrom!, roots: b.roots ?? [] }]));
  for (const [op, list] of [...o.regs].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = [...list].sort((a, b) => b.bond.block - a.bond.block || a.sig.localeCompare(b.sig));
    const base: PhoneReport = { operator: op, wallet: sorted[0]?.wallet ?? '', eligible: false, endorsements: { counted: 0, ignored: [] } };
    report.set(op, base);
    if (isRoot(op)) { base.reason = PHONE_REASON.admitted; continue; }
    const ok = sorted.filter(r => o.bonds.get(regKey(r))?.ok);
    const live = ok.filter(r => { const x = o.exits.get(regKey(r)); return x === undefined || x > o.now; });
    const reg = live[0] ?? ok[0];
    if (!reg) { const b = o.bonds.get(regKey(sorted[0]!)); base.reason = b && !b.ok ? b.reason : BOND_REASON.notFound; continue; }
    const b = o.bonds.get(regKey(reg)) as Extract<BondCheck, { ok: true }>;
    base.wallet = reg.wallet;
    const exit = o.exits.get(regKey(reg));
    if (exit !== undefined && exit <= b.at) { base.reason = PHONE_REASON.exited; continue; }
    if (o.now < b.at + P.minAgeDays * 86400) { base.reason = PHONE_REASON.young; continue; }
    const k = regKey(reg);
    cands.set(op, { op, reg, key: k, bondAt: b.at, amount: b.amount, ...(exit !== undefined ? { exit } : {}), ...(sticky.has(k) ? { sticky: sticky.get(k)! } : {}) });
  }

  // Avais: identidade do avalista (raiz para chaves admitidas), retiradas, validade, cota mensal.
  const ignored = new Map<string, { endorser: string; reason: string }[]>();
  const ignore = (phone: string, endorser: string, reason: string) => { const l = ignored.get(phone); if (l) l.push({ endorser, reason }); else ignored.set(phone, [{ endorser, reason }]); };
  const idOf = (endorserPk: string) => o.roots.get(endorserPk) ?? endorserPk;
  const revokedAt = new Map<string, number>();
  for (const { r, seen: t } of Object.values(seen.revocations)) {
    const k = `${r.endorserPk}:${r.phonePk}`;
    revokedAt.set(k, Math.min(revokedAt.get(k) ?? Infinity, t));
  }
  interface E { e: EndorsementJson; id: string; t: number; end: number }
  const all: E[] = [];
  for (const { e, seen: t } of Object.values(seen.endorsements)) {
    if (!o.regs.has(e.phonePk)) continue; // só interessa a quem tem registro
    const id = idOf(e.endorserPk);
    if (id === e.phonePk) continue;
    if (isRoot(e.endorserPk) && suspended.has(id)) { ignore(e.phonePk, e.endorserPk, ENDORSE_REASON.suspended); continue; }
    const end = Math.min(t + P.endorsementValidityDays * 86400, revokedAt.get(`${e.endorserPk}:${e.phonePk}`) ?? Infinity);
    if (end <= t) { ignore(e.phonePk, e.endorserPk, ENDORSE_REASON.revoked); continue; }
    // Avalista celular precisa afirmar a verificação pessoal (o validador não confere; o app só deixa
    // avalizar contato verificado). Operador admitido de piu-node (semente) não precisa.
    if (!isRoot(e.endorserPk) && e.inPerson !== true) { ignore(e.phonePk, e.endorserPk, ENDORSE_REASON.notInPerson); continue; }
    all.push({ e, id, t, end });
  }
  // Um por (avalista, celular, mês): o mais antigo. Depois, a cota mensal do avalista.
  all.sort((a, b) => a.t - b.t || a.e.phonePk.localeCompare(b.e.phonePk) || a.e.sig.localeCompare(b.e.sig));
  const perMonth = new Map<string, number>();
  const once = new Set<string>();
  const counted = new Map<string, E[]>();
  for (const x of all) {
    const m = monthOfSec(x.t);
    const k1 = `${x.id}|${x.e.phonePk}|${m}`;
    if (once.has(k1)) { ignore(x.e.phonePk, x.e.endorserPk, ENDORSE_REASON.repeated); continue; }
    once.add(k1);
    const k2 = `${x.id}|${m}`;
    const n = perMonth.get(k2) ?? 0;
    if (n >= P.maxEndorsementsPerMonth) { ignore(x.e.phonePk, x.e.endorserPk, ENDORSE_REASON.monthly); continue; }
    perMonth.set(k2, n + 1);
    const l = counted.get(x.e.phonePk);
    if (l) l.push(x); else counted.set(x.e.phonePk, [x]);
  }

  // Ponto fixo a partir das raízes admitidas (não suspensas).
  const eligible = new Map<string, Elig>();
  const rootMonth = new Map<string, number>(); // `${raiz}|${mês}` → celulares habilitados
  const capBlocked = new Set<string>();
  const usableAt = (endorserPk: string, t: number): Set<string> | null => {
    const root = o.roots.get(endorserPk);
    if (root !== undefined) return suspended.has(root) ? null : new Set([root]);
    const q = eligible.get(endorserPk);
    return q && q.from <= t && t < q.until ? new Set([...q.roots].filter(r => !suspended.has(r))) : null;
  };
  const windowOf = (c: Cand): Elig | null => {
    const byId = new Map<string, Iv[]>();
    const rootsOf: { iv: Iv; roots: Set<string> }[] = [];
    for (const x of counted.get(c.op) ?? []) {
      const roots = usableAt(x.e.endorserPk, x.t);
      if (!roots || !roots.size) continue;
      const l = byId.get(x.id); if (l) l.push([x.t, x.end]); else byId.set(x.id, [[x.t, x.end]]);
      rootsOf.push({ iv: [x.t, x.end], roots });
    }
    const lo = c.bondAt + P.minAgeDays * 86400, hi = c.exit ?? Infinity;
    const ivs = coverage([...byId.values()], P.minEndorsements).map(([a, b]) => [Math.max(a, lo), Math.min(b, hi)] as Iv).filter(([a, b]) => b > a && a <= o.now);
    const w = ivs[ivs.length - 1];
    if (!w) return null;
    const roots = new Set<string>();
    for (const r of rootsOf) if (r.iv[0] < w[1] && w[0] < r.iv[1]) for (const x of r.roots) roots.add(x);
    return roots.size >= P.minRoots ? { from: w[0], until: w[1], roots } : null;
  };
  const order = [...cands.values()].sort((a, b) => (a.sticky ? 0 : 1) - (b.sticky ? 0 : 1) || a.op.localeCompare(b.op));
  for (let guard = 0, changed = true; changed && guard <= cands.size + 2; guard++) {
    changed = false;
    const fresh: { c: Cand; w: Elig }[] = [];
    for (const c of order) {
      if (capBlocked.has(c.op)) continue;
      const w = windowOf(c);
      const cur = eligible.get(c.op);
      if (!w) continue;
      if (cur) { if (w.from < cur.from || w.until !== cur.until || w.roots.size !== cur.roots.size) { eligible.set(c.op, { ...w, roots: new Set([...cur.roots, ...w.roots]) }); changed = true; } continue; }
      fresh.push({ c, w });
    }
    // Teto por raiz por mês: quem já foi habilitado antes (gravado) conta primeiro, sem passar pelo teto.
    fresh.sort((a, b) => (a.c.sticky ? 0 : 1) - (b.c.sticky ? 0 : 1) || (a.c.sticky?.from ?? a.w.from) - (b.c.sticky?.from ?? b.w.from) || a.c.op.localeCompare(b.c.op));
    for (const { c, w } of fresh) {
      const roots = c.sticky ? new Set(c.sticky.roots) : w.roots;
      const m = monthOfSec(c.sticky?.from ?? w.from);
      if (!c.sticky && [...roots].some(r => (rootMonth.get(`${r}|${m}`) ?? 0) >= P.maxEnabledPerRootPerMonth)) { capBlocked.add(c.op); continue; }
      for (const r of roots) rootMonth.set(`${r}|${m}`, (rootMonth.get(`${r}|${m}`) ?? 0) + 1);
      eligible.set(c.op, w);
      changed = true;
    }
  }

  const lineage = new Map<string, { roots: string[]; from: number }>();
  const windows = new Map<string, PhoneWindow>();
  for (const [op, rep] of report) {
    const list = counted.get(op) ?? [];
    let usable = 0;
    for (const x of list) {
      if (usableAt(x.e.endorserPk, x.t)) usable++;
      else ignore(op, x.e.endorserPk, ENDORSE_REASON.ineligible);
      if (x.end <= o.now && x.end - x.t >= P.endorsementValidityDays * 86400) ignore(op, x.e.endorserPk, ENDORSE_REASON.expired);
    }
    rep.endorsements = { counted: usable, ignored: (ignored.get(op) ?? []).map(x => ({ endorser: x.endorser.slice(0, 16), reason: x.reason })) };
    const w = eligible.get(op), c = cands.get(op);
    if (w && c) {
      rep.eligible = true; rep.from = w.from; rep.roots = w.roots.size; delete rep.reason;
      if (Number.isFinite(w.until)) rep.until = w.until;
      windows.set(op, { from: w.from, until: w.until, wallet: c.reg.wallet, bond: c.amount });
      lineage.set(c.key, { roots: [...w.roots], from: w.from });
    } else if (!rep.reason) {
      if (capBlocked.has(op)) rep.reason = PHONE_REASON.rootCap;
      else if (c && usable >= P.minEndorsements) rep.reason = PHONE_REASON.roots;
      else rep.reason = `${PHONE_REASON.endorsements} (${usable} de ${P.minEndorsements})`;
    }
  }
  return { eligible: windows, report: [...report.values()], lineage, suspendedRoots: [...suspended].sort() };
}

/**
 * Tudo junto (o que `validator:close` usa): grava os avais vistos (`recordFirstSeen`), confere as
 * cauções na chain, avalia, e devolve as janelas para o `NodeRegistry` e o estado novo (cauções,
 * linhagem, avais vistos) para gravar.
 */
export async function phoneEligibility(o: {
  files: readonly RegistryFile[]; roots: ReadonlyMap<string, string>; chain: Pick<ChainClient, 'transferOf'> | null;
  state: ValidatorState; now: number; epoch?: string; policy?: Partial<PhonePolicy>;
}): Promise<{ eligible: Map<string, PhoneWindow>; report: PhoneReport[]; state: ValidatorState; suspendedRoots: string[] }> {
  const P = { ...DEFAULT_PHONE_POLICY, ...o.policy };
  const c = collectPhones(o.files);
  const phoneKeys = new Set([...c.regs.keys()].map(k => k.toLowerCase()));
  const accept = (e: { endorserPk: string; phonePk: string }) => phoneKeys.has(e.phonePk) && (o.roots.has(e.endorserPk) || phoneKeys.has(e.endorserPk));
  const ing = recordFirstSeen(o.state, { endorsements: c.endorsements, endorsementRevocations: c.endorsementRevocations }, { at: o.now, ...(o.epoch ? { epoch: o.epoch } : {}), policy: P, accept });
  const st = ing.state;
  const regs = [...c.regs.values()].flat().filter(r => !o.roots.has(r.operatorPk));
  const records = st.bonds ?? [];
  const bonds = regs.length ? await checkBonds(regs, o.chain, { bondAddress: P.bondAddress, minBondPlanck: P.minBondPlanck, records }) : new Map<string, BondCheck>();
  const r = evaluatePhones({ regs: c.regs, exits: c.exits, bonds, seen: st.phoneSeen, roots: o.roots, records, now: o.now, policy: P });
  // Avais recusados na ingestão (assinatura, data fora da janela) também aparecem no relatório.
  const bySig = new Map<string, { phonePk?: unknown; endorserPk?: unknown }>();
  for (const e of c.endorsements) if (e && typeof (e as { sig?: unknown }).sig === 'string') bySig.set((e as { sig: string }).sig, e as { phonePk?: unknown; endorserPk?: unknown });
  for (const x of ing.rejected) {
    const e = bySig.get(x.sig);
    const rep = typeof e?.phonePk === 'string' ? r.report.find(y => y.operator === e.phonePk) : undefined;
    if (rep) rep.endorsements.ignored.push({ endorser: String(e!.endorserPk ?? '?').slice(0, 16), reason: x.reason });
  }
  const bad = c.bad.filter(op => !c.regs.has(op)).map(op => ({ operator: op, wallet: '', eligible: false, reason: PHONE_REASON.bad, endorsements: { counted: 0, ignored: [] } }));
  return { eligible: r.eligible, report: [...r.report, ...bad], suspendedRoots: r.suspendedRoots, state: { ...st, bonds: recordBonds(records, regs, bonds, c.exitEvents, r.lineage, P.refundDelayDays) } };
}

/** Chaves (hex) do `operadores.json`, cada uma raiz de si mesma (sem rotação; o close usa `NodeRegistry.operatorRoots()`). */
export const admittedSet = (ops: readonly { operators?: { pk: string }[] }[]) =>
  new Set(ops.flatMap(f => (f?.operators ?? []).map(o => (typeof o.pk === 'string' ? o.pk.toLowerCase() : ''))).filter(Boolean));

/** Parâmetros dos celulares: `config.json` sobre os padrões (DEFAULT_PHONE_POLICY). */
export function phonePolicyFrom(cfg: { phone?: Partial<Omit<PhonePolicy, 'minBondPlanck'>> & { minBondLunes?: string } } | null): PhonePolicy {
  const p = cfg?.phone ?? {};
  const D = DEFAULT_PHONE_POLICY;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d);
  return {
    bondAddress: typeof p.bondAddress === 'string' && p.bondAddress.trim() ? p.bondAddress.trim() : null,
    minBondPlanck: typeof p.minBondLunes === 'string' ? lunesToPlanck(p.minBondLunes) : D.minBondPlanck,
    minAgeDays: num(p.minAgeDays, D.minAgeDays),
    minEndorsements: Math.max(1, num(p.minEndorsements, D.minEndorsements)),
    minRoots: Math.max(1, num(p.minRoots, D.minRoots)),
    maxEndorsementsPerMonth: num(p.maxEndorsementsPerMonth, D.maxEndorsementsPerMonth),
    maxEnabledPerRootPerMonth: num(p.maxEnabledPerRootPerMonth, D.maxEnabledPerRootPerMonth),
    rootSuspendAfterSlashes: Math.max(1, num(p.rootSuspendAfterSlashes, D.rootSuspendAfterSlashes)),
    endorsementValidityDays: Math.max(1, num(p.endorsementValidityDays, D.endorsementValidityDays)),
    endorsementBackdateDays: num(p.endorsementBackdateDays, D.endorsementBackdateDays),
    capFraction: Math.min(1, num(p.capFraction, D.capFraction)),
    maxPayoutBondRatio: num(p.maxPayoutBondRatio, D.maxPayoutBondRatio),
    refundDelayDays: num(p.refundDelayDays, D.refundDelayDays),
  };
}
