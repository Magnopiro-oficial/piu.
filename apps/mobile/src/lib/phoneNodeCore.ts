/**
 * Celular como nó ("modo nó", docs/economia/no-celular.md): regras puras do lado do app, sem React,
 * testadas no Node (__tests__/phoneNodeCore.test.ts). Quem decide se rende é o validador
 * (apps/settlement/src/phone-nodes.ts); aqui montamos o registro e mostramos o estado com honestidade.
 * As telas (M1…M6e, design/handoff/docs/TELAS-NOVAS.md) usam `usePhoneNode` (state/phoneNode.tsx).
 *
 * - Ativação (M1/M1e): requisitos (`requirementsOf`); a carteira assina o vínculo com a chave de
 *   operador do celular (`bondOwnerMessage`) ANTES de pagar, então o registro fecha depois sozinho.
 * - Caução (M2…M2e2): `PHONE_NODE_BOND` (100) LUNES + taxa para `BOND_ADDRESS`, pela transferência
 *   normal da carteira. Sem endereço configurado, fica "em breve". Sem validador ao vivo: a caução é
 *   conferida pelo próprio aparelho (rede) ou por recibo de gateway; depois de 2 min sem confirmação,
 *   "ainda não confirmada" (não é falha) e `retry` reenviando os MESMOS bytes assinados.
 * - Certificado do dia (M3/M3e): o aparelho emite sozinho, sem validador; 7 dias SEGUIDOS completam
 *   o ciclo; um dia sem certificado zera a contagem.
 * - Avais (M4…M5e): só contato verificado pessoalmente (código de segurança) que está no modo nó há
 *   mais de 7 dias avaliza; o pedido vale 3 dias; o aval vale 90 dias depois de visto pelo validador.
 * - Saída (M6…M6e): pedido assinado; a caução volta 7 dias depois (operação manual de quem tem a
 *   chave do endereço da caução). "Voltar a ser nó" cancela a saída e zera os 7 dias.
 * - Limites no modo nó: só Bluetooth/Wi-Fi local (o transporte do app não usa dados móveis), até
 *   200 MB/dia de terceiros, pausa com bateria em 30% ou menos.
 * - Privacidade: o registro liga a chave do celular à carteira da caução, e os avais mostram ao
 *   validador quem avalizou quem (entre chaves de operador). Recomende uma carteira só para a caução.
 * - Recompensas: hoje DESLIGADAS (o validador ainda não tem orçamento nem chave publicada).
 */
import { toHex } from '../protocol/bytes';
import type { KeyPair } from '../protocol/keys';
import {
  type BondRef, dayOfSec, type CertJson, type EndorsementJson, type EndorsementRevocationJson, makeEndorsementRevocation, makeOperatorCert, makePhoneExit,
  makePhoneRegistration, type PhoneExitJson, type PhoneRegistrationJson, verifyEndorsement,
} from '../protocol/phoneNode';
import { parseLunesAmount } from './paymentRequest';
import { decodeSs58 } from './ss58';
import type { WalletQuote, WalletTransferRecord } from './walletTransfer';

// ── parâmetros de produto (o validador tem os mesmos em `dados/config.json`) ──

/** Caução do modo nó, em LUNES (mais a taxa da rede). */
export const PHONE_NODE_BOND = '100';
export const PHONE_NODE_BOND_PLANCK = parseLunesAmount(PHONE_NODE_BOND)!;
/**
 * Endereço que recebe as cauções. `null` até quem opera o validador definir: o botão da caução fica
 * desligado ("em breve"). Não invente um endereço aqui.
 */
export const BOND_ADDRESS: string | null = null;
/** Idade mínima da caução e do avalista no modo nó (dias). */
export const PHONE_NODE_MIN_AGE_DAYS = 7;
export const PHONE_NODE_MIN_ENDORSEMENTS = 3;
export const PHONE_NODE_MAX_ENDORSEMENTS_PER_MONTH = 5;
/** Validade de um aval (dias, contados de quando o validador o vê). */
export const ENDORSEMENT_VALIDITY_DAYS = 90;
/** Um pedido de aval vale 3 dias. */
export const ENDORSE_REQUEST_TTL_SEC = 3 * 86400;
/** Dias seguidos com certificado para completar o ciclo (barra de 7 traços). */
export const CERT_STREAK_DAYS = 7;
/** A caução volta este número de dias depois da saída assinada. */
export const REFUND_DELAY_DAYS = 7;
/** Sem confirmação da caução na rede depois disto (s): "ainda não confirmada" (M2e2). */
export const BOND_CONFIRM_TIMEOUT_SEC = 120;
/** Limites no modo nó. */
export const NODE_MODE_LIMITS = { dailyBytes: 200 * 1024 * 1024, batteryPct: 30, media: ['ble', 'nearby'] as const };
/** Espaço livre mínimo para ativar (M1e). */
export const PHONE_NODE_MIN_FREE_BYTES = 1024 * 1024 * 1024;
/** As recompensas do programa estão ligadas? Hoje não (honestidade na tela). */
export const PHONE_NODE_REWARDS_ON = false;
/** Certificados de chave do dia à frente (o segundo plano segue assinando recibos até o próximo envio). */
export const CERT_DAYS_AHEAD = 7;
/** Certificados para trás, no máximo. */
export const CERT_DAYS_BACK = 60;

// ── estado ──────────────────────────────────────────────────

export interface ReceivedEndorsement { contactId: string; e: EndorsementJson; at: number }
/** Pedido de aval recebido de um contato. `createdAt` (s) é de quem pediu; vale 3 dias. */
export interface EndorseRequest { contactId: string; phonePk: string; createdAt: number; at: number; bondOk: boolean; cancelled?: boolean }
export interface GivenEndorsement { contactId: string; phonePk: string; day: number }

/** Estado salvo do modo nó (persist `phone.node`). */
export interface PhoneNodeState {
  v: 1;
  /** Quando a pessoa ligou o modo (s); `null`: desligado. */
  activeSince: number | null;
  /** Vínculo assinado pela carteira (sr25519, hex) para esta chave e este endereço de caução. */
  binding?: { wallet: string; bondAddress: string; sig: string };
  /** Caução: transferência enviada pela carteira (hash; bloco quando finalizar); `at` = quando enviou. */
  bond?: { txHash: string; block?: number; wallet: string; value: string; at: number };
  /** Registro assinado (caução finalizada + vínculo da carteira). */
  registration?: PhoneRegistrationJson;
  /** Quando o registro fechou (s): "Confirmada na rede" na trilha (N2) e "desde" (N3d). Ausente em registros antigos. */
  registeredAt?: number;
  /** Saída vigente (pedido assinado); "voltar a ser nó" a apaga. */
  exit?: PhoneExitJson;
  /** Todos os eventos de saída/volta assinados (vão no arquivo de registro; vale o mais novo). */
  exitEvents: PhoneExitJson[];
  /** Devolução vista na carteira (s), depois da saída. */
  refundSeenAt?: number;
  /** Dias (UTC) com certificado da chave do dia emitido por este aparelho. */
  certDays: number[];
  /** Falha ao emitir o certificado de hoje (M3e). */
  certError?: { day: number; message: string };
  received: ReceivedEndorsement[];
  /** Pedidos de aval que chegaram de contatos. */
  requests: EndorseRequest[];
  /** Avais que eu dei (limite mensal e um por contato). */
  given: GivenEndorsement[];
  /** Pedidos que fiz: contato e `createdAt` (s). */
  asked: { contactId: string; at: number; cancelled?: boolean }[];
  /** Avais que retirei (assinados; vão no arquivo de registro). */
  revoked: EndorsementRevocationJson[];
  /** Desde quando cada contato está no modo nó (s; 0 = saiu), como ele avisou (`ns`). */
  peers: Record<string, { since: number; at: number }>;
}

export const emptyPhoneNode = (): PhoneNodeState => ({ v: 1, activeSince: null, exitEvents: [], certDays: [], received: [], requests: [], given: [], asked: [], revoked: [], peers: {} });

/** Lê o estado salvo com tolerância (campos ausentes viram vazios). */
export function revivePhoneNode(s: unknown): PhoneNodeState {
  const x = (s && typeof s === 'object' ? s : {}) as Partial<PhoneNodeState>;
  const arr = <T,>(a: unknown): T[] => (Array.isArray(a) ? (a as T[]) : []);
  return {
    ...emptyPhoneNode(), ...x, v: 1, activeSince: typeof x.activeSince === 'number' ? x.activeSince : null,
    exitEvents: arr(x.exitEvents), certDays: arr<number>(x.certDays).filter(Number.isInteger), received: arr(x.received), requests: arr(x.requests),
    given: arr(x.given), asked: arr(x.asked), revoked: arr(x.revoked), peers: x.peers && typeof x.peers === 'object' ? x.peers : {},
  };
}

// ── M1 / M1e: ativação e requisitos ─────────────────────────

export type RequirementKey = 'program' | 'wallet' | 'backup' | 'freeSpace' | 'batterySaver';
export interface Requirement { key: RequirementKey; ok: boolean; /** Ação que resolve (a tela mapeia para um botão); `null` = nada a fazer pela pessoa. */ action: RequirementKey | null }
/**
 * Requisitos para ativar (M1e). `null` em uma leitura = desconhecido (não bloqueia, exceto a carteira).
 * - program: o endereço da caução está configurado (senão, "em breve");
 * - wallet: carteira própria neste aparelho;
 * - backup: a frase tem cópia fora do aparelho (`set.backupDone`);
 * - freeSpace: pelo menos `PHONE_NODE_MIN_FREE_BYTES` livres;
 * - batterySaver: economia de bateria desligada (o sistema mata o segundo plano).
 */
export function requirementsOf(i: { bondAddress: string | null; walletAddress: string | null; backupDone: boolean; freeBytes: number | null; batterySaver: boolean | null }): Requirement[] {
  return [
    { key: 'program', ok: !!i.bondAddress, action: null },
    { key: 'wallet', ok: !!i.walletAddress, action: 'wallet' },
    { key: 'backup', ok: i.backupDone, action: 'backup' },
    { key: 'freeSpace', ok: i.freeBytes === null || i.freeBytes >= PHONE_NODE_MIN_FREE_BYTES, action: 'freeSpace' },
    { key: 'batterySaver', ok: i.batterySaver !== true, action: 'batterySaver' },
  ];
}
export const requirementsOk = (r: readonly Requirement[]) => r.every(x => x.ok);

/** Liga o modo. Depois de uma saída com caução já devolvida, volta do zero (caução nova). */
export function activate(s: PhoneNodeState, now: number): PhoneNodeState {
  if (s.activeSince !== null && !s.exit) return s;
  if (s.exit && !s.refundSeenAt) return s; // saída em andamento: use `cancelExit` ("voltar a ser nó")
  const fresh = s.exit ? { bond: undefined, registration: undefined, registeredAt: undefined, exit: undefined, refundSeenAt: undefined, binding: undefined } : {};
  return { ...s, ...fresh, activeSince: now };
}

/** Grava o vínculo assinado pela carteira (a assinatura é feita no hook, com a frase lida na hora). */
export const bind = (s: PhoneNodeState, wallet: string, bondAddress: string, sig: Uint8Array): PhoneNodeState => ({ ...s, binding: { wallet, bondAddress, sig: toHex(sig) } });

// ── M2 … M2e2: caução ───────────────────────────────────────

/** Por que a caução não pode ser paga agora (`null`: pode). */
export type BondBlock = 'soon' | 'inactive' | 'done' | 'pending' | 'noWallet';
export function bondBlock(s: PhoneNodeState, o: { bondAddress: string | null; walletAddress: string | null }): BondBlock | null {
  if (!o.bondAddress) return 'soon';
  if (s.activeSince === null || s.exit) return 'inactive';
  if (s.registration) return 'done';
  if (s.bond) return 'pending';
  if (!o.walletAddress) return 'noWallet';
  return null;
}

/** Saldo dá para a caução + taxa? (M2e1). Valores em planck. */
export function bondAffordable(q: Pick<WalletQuote, 'value' | 'fee' | 'available'>): { ok: boolean; needed: bigint; available: bigint; missing: bigint } {
  const needed = BigInt(q.value) + BigInt(q.fee), available = BigInt(q.available);
  return { ok: needed <= available, needed, available, missing: needed > available ? needed - available : 0n };
}

/**
 * Situação da caução para as telas:
 * - `none`: sem caução (M2);
 * - `confirming`: assinada, aguardando a caução finalizar na rede (M2b);
 * - `unconfirmed`: 2 min sem confirmação: "ainda não confirmada", NÃO é falha (M2e2; `retry` reenvia os mesmos bytes);
 * - `failed`: a rede recusou ou a transferência falhou (volta a M2);
 * - `confirmed`: finalizada, registro sendo fechado;
 * - `registered`: registro assinado (M3/M3v).
 */
export type BondPhase = 'none' | 'confirming' | 'unconfirmed' | 'failed' | 'confirmed' | 'registered';
export function bondPhase(s: PhoneNodeState, record: WalletTransferRecord | null | undefined, now: number): BondPhase {
  if (s.registration) return 'registered';
  if (!s.bond) return 'none';
  const r = record && record.hash === s.bond.txHash ? record : null;
  if (r?.status === 'finalized') return 'confirmed';
  if (r?.status === 'failed') return 'failed';
  return now - s.bond.at >= BOND_CONFIRM_TIMEOUT_SEC ? 'unconfirmed' : 'confirming';
}

/**
 * Transferência da carteira que vale como caução: para `bondAddress`, de pelo menos a caução,
 * finalizada e com bloco. `null` se não serve (ainda).
 */
export function bondFromTransfer(r: WalletTransferRecord | null | undefined, bondAddress: string | null): (BondRef & { wallet: string }) | null {
  if (!r || !bondAddress || r.status !== 'finalized' || !r.block) return null;
  if (!sameAccount(r.dest, bondAddress)) return null;
  if (BigInt(r.value) < PHONE_NODE_BOND_PLANCK) return null;
  return { txHash: r.hash, block: r.block.number, wallet: r.from };
}
function sameAccount(a: string, b: string) {
  const x = decodeSs58(a), y = decodeSs58(b);
  return x.ok && y.ok && toHex(x.publicKey) === toHex(y.publicKey);
}

/** Caução enviada pela carteira (ainda sem bloco). */
export function bondSent(s: PhoneNodeState, r: Pick<WalletTransferRecord, 'hash' | 'from' | 'value'>, now: number): PhoneNodeState {
  return s.registration ? s : { ...s, bond: { txHash: r.hash, wallet: r.from, value: r.value, at: now } };
}
/** Esquece uma caução que falhou (a pessoa pode pagar de novo). */
export const dropFailedBond = (s: PhoneNodeState): PhoneNodeState => (s.registration ? s : { ...s, bond: undefined });

/** Fecha o registro com a caução finalizada e o vínculo já assinado pela carteira (sem biometria). */
export function register(s: PhoneNodeState, op: KeyPair, bond: BondRef & { wallet: string }, now: number): PhoneNodeState {
  if (s.registration) return s;
  if (!s.binding || s.binding.wallet !== bond.wallet) throw new Error('Falta o vínculo da carteira com esta chave.');
  const sig = Uint8Array.from(s.binding.sig.match(/../g) ?? [], x => parseInt(x, 16));
  return {
    ...s, bond: { txHash: bond.txHash, block: bond.block, wallet: bond.wallet, value: s.bond?.value ?? PHONE_NODE_BOND_PLANCK.toString(), at: s.bond?.at ?? now },
    registration: makePhoneRegistration(op, bond.wallet, bond, sig), registeredAt: now,
  };
}

// ── M3 / M3v / M3e: certificado do dia (offline) ─────────────

/** Marca que o certificado da chave de hoje foi emitido (o aparelho assina sozinho). */
export function issueDailyCert(s: PhoneNodeState, now: number): PhoneNodeState {
  if (s.activeSince === null || s.exit) return s;
  const today = dayOfSec(now);
  if (s.certDays.includes(today) && !s.certError) return s;
  const days = [...new Set([...s.certDays, today])].sort((a, b) => a - b).slice(-CERT_DAYS_BACK);
  const { certError: _e, ...rest } = s;
  return { ...rest, certDays: days };
}
export const certFailed = (s: PhoneNodeState, now: number, message: string): PhoneNodeState => ({ ...s, certError: { day: dayOfSec(now), message: message.slice(0, 200) } });

export type CertDash = 'done' | 'today' | 'future' | 'error';
/**
 * Barra de 7 dias (M3): sequência de dias seguidos com certificado terminando hoje (ou ontem, se hoje
 * ainda não saiu). Um dia sem certificado zera. `complete`: 7 dias seguidos.
 */
export function certBar(s: PhoneNodeState, now: number): { dashes: CertDash[]; streak: number; complete: boolean } {
  const today = dayOfSec(now);
  const set = new Set(s.certDays);
  const end = set.has(today) ? today : today - 1;
  let streak = 0;
  while (set.has(end - streak)) streak++;
  if (!set.has(today) && !set.has(today - 1)) streak = 0;
  const complete = streak >= CERT_STREAK_DAYS;
  const start = complete ? end - (CERT_STREAK_DAYS - 1) : set.has(today) ? today - (streak - 1) : today - streak;
  const dashes: CertDash[] = [];
  for (let i = 0; i < CERT_STREAK_DAYS; i++) {
    const d = start + i;
    if (d < today) dashes.push(set.has(d) ? 'done' : 'error');
    else if (d === today) dashes.push(set.has(today) && !(s.certError?.day === today) ? 'done' : s.certError?.day === today ? 'error' : 'today');
    else dashes.push('future');
  }
  return { dashes, streak: Math.min(streak, CERT_STREAK_DAYS), complete };
}

// ── M4 / M4v: pedir aval ────────────────────────────────────

/** Um contato avisou desde quando está no modo nó (`ns`). */
export const notePeer = (s: PhoneNodeState, contactId: string, since: number, now: number): PhoneNodeState => ({ ...s, peers: { ...s.peers, [contactId]: { since, at: now } } });

/** Contato pode avalizar: verificado pessoalmente e no modo nó há mais de 7 dias. */
export function canEndorseMe(s: PhoneNodeState, c: { contactId: string; verified: boolean }, now: number): boolean {
  const p = s.peers[c.contactId];
  return c.verified && !!p && p.since > 0 && p.since + PHONE_NODE_MIN_AGE_DAYS * 86400 <= now;
}
/** Contatos que podem avalizar (M4); lista vazia = M4v. */
export const eligibleEndorsers = <C extends { contactId: string; verified: boolean }>(s: PhoneNodeState, contacts: readonly C[], now: number): C[] =>
  contacts.filter(c => canEndorseMe(s, c, now) && !s.received.some(r => r.contactId === c.contactId));

export const recordAsked = (s: PhoneNodeState, contactId: string, at: number, cancelled = false): PhoneNodeState =>
  ({ ...s, asked: [...s.asked.filter(a => a.contactId !== contactId), { contactId, at, ...(cancelled ? { cancelled } : {}) }].slice(-100) });

/** O que este aparelho anuncia aos contatos verificados (`ns`): desde quando está no modo nó, ou 0. */
export const nodeSince = (s: PhoneNodeState) => (s.activeSince !== null && !s.exit && s.registration ? s.activeSince : 0);

// ── M5 / M5e: pedido recebido ───────────────────────────────

/** Aval que chegou de um contato: confere e guarda (repetido do mesmo avalista não soma). */
export function receiveEndorsement(s: PhoneNodeState, contactId: string, e: EndorsementJson, myPhonePk: string, now: number): PhoneNodeState {
  if (e?.phonePk !== myPhonePk || !verifyEndorsement(e)) return s;
  if (s.received.some(r => r.e.endorserPk === e.endorserPk || r.contactId === contactId)) return s;
  return { ...s, received: [...s.received, { contactId, e, at: now }].slice(-50) };
}

/** Pedido de aval de um contato (o mensageiro conferiu: contato público aceito). Cancelamento marca o existente. */
export function receiveRequest(s: PhoneNodeState, contactId: string, r: { phonePk: string; createdAt: number; bondOk: boolean; cancel?: boolean }, now: number): PhoneNodeState {
  if (!/^[0-9a-f]{64}$/.test(r.phonePk)) return s;
  const createdAt = Math.min(r.createdAt, now); // "do futuro" conta como agora
  if (r.cancel) return { ...s, requests: s.requests.map(x => (x.contactId === contactId && x.phonePk === r.phonePk ? { ...x, cancelled: true } : x)) };
  const rest = s.requests.filter(x => x.contactId !== contactId);
  return { ...s, requests: [...rest, { contactId, phonePk: r.phonePk, createdAt, at: now, bondOk: r.bondOk }].slice(-50) };
}

/** Situação de um pedido recebido: `ok`, ou o motivo de M5e. */
export type RequestState = 'ok' | 'expired' | 'cancelled' | 'noBond';
export function requestState(r: EndorseRequest, now: number): RequestState {
  if (r.cancelled) return 'cancelled';
  if (now - r.createdAt > ENDORSE_REQUEST_TTL_SEC) return 'expired';
  if (!r.bondOk) return 'noBond';
  return 'ok';
}

export const dismissRequest = (s: PhoneNodeState, contactId: string): PhoneNodeState => ({ ...s, requests: s.requests.filter(r => r.contactId !== contactId) });

const monthOf = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 7);

/** Posso avalizar este pedido agora? `null` = sim. */
export type EndorseBlock = 'inactive' | 'tooNew' | 'notVerified' | 'self' | 'already' | 'monthly' | Exclude<RequestState, 'ok'>;
export function endorseBlock(s: PhoneNodeState, o: { contactId: string; phonePk: string; verified: boolean; request?: EndorseRequest }, myPhonePk: string, now: number): EndorseBlock | null {
  if (s.activeSince === null || s.exit || !s.registration) return 'inactive';
  if (s.activeSince + PHONE_NODE_MIN_AGE_DAYS * 86400 > now) return 'tooNew';
  if (!o.verified) return 'notVerified';
  if (o.phonePk === myPhonePk) return 'self';
  if (o.request) { const st = requestState(o.request, now); if (st !== 'ok') return st; }
  if (s.given.some(g => g.contactId === o.contactId || g.phonePk === o.phonePk)) return 'already';
  const month = monthOf(dayOfSec(now));
  if (s.given.filter(g => monthOf(g.day) === month).length >= PHONE_NODE_MAX_ENDORSEMENTS_PER_MONTH) return 'monthly';
  return null;
}
export const givenThisMonth = (s: PhoneNodeState, now: number) => s.given.filter(g => monthOf(g.day) === monthOf(dayOfSec(now))).length;

export function recordGiven(s: PhoneNodeState, contactId: string, e: EndorsementJson): PhoneNodeState {
  return { ...dismissRequest(s, contactId), given: [...s.given, { contactId, phonePk: e.phonePk, day: e.day }].slice(-200) };
}

/** Retira um aval que dei (vai no meu arquivo de registro; vale quando o validador vê). */
export function revokeGiven(s: PhoneNodeState, op: KeyPair, contactId: string, now: number): PhoneNodeState {
  const g = s.given.find(x => x.contactId === contactId);
  if (!g || s.revoked.some(r => r.phonePk === g.phonePk)) return s;
  const pk = Uint8Array.from(g.phonePk.match(/../g) ?? [], x => parseInt(x, 16));
  return { ...s, revoked: [...s.revoked, makeEndorsementRevocation(op, pk, now)].slice(-200) };
}

/** Avais distintos que recebi (um por avalista), dentro da validade estimada (90 dias de quando chegaram). */
export function distinctEndorsements(s: PhoneNodeState, myPhonePk: string, now = Infinity): EndorsementJson[] {
  const by = new Map<string, EndorsementJson>();
  for (const r of s.received) {
    if (r.e.phonePk !== myPhonePk || !verifyEndorsement(r.e) || by.has(r.e.endorserPk)) continue;
    if (Number.isFinite(now) && now - r.at > ENDORSEMENT_VALIDITY_DAYS * 86400) continue;
    by.set(r.e.endorserPk, r.e);
  }
  return [...by.values()];
}

// ── M6 / M6b / M6e: sair e a devolução ──────────────────────

/** Pedido de saída, amarrado à caução registrada. Sem caução registrada, só desliga o modo. */
export function leave(s: PhoneNodeState, op: KeyPair, now: number): PhoneNodeState {
  if (s.exit) return s;
  if (!s.registration) return { ...s, activeSince: null, bond: undefined };
  const x = makePhoneExit(op, s.registration.bond.txHash, now);
  return { ...s, exit: x, exitEvents: [...s.exitEvents, x].slice(-20) };
}
/** "Voltar a ser nó" (M6b): cancela a saída assinada; os 7 dias da devolução zeram. */
export function cancelExit(s: PhoneNodeState, op: KeyPair, now: number): PhoneNodeState {
  if (!s.exit || !s.registration || s.refundSeenAt) return s;
  const x = makePhoneExit(op, s.registration.bond.txHash, Math.max(now, s.exit.at + 1), 'cancel');
  return { ...s, exit: undefined, exitEvents: [...s.exitEvents, x].slice(-20) };
}

/**
 * Devolução vista no histórico da carteira: entrada vinda do endereço da caução depois da saída
 * (`moves` como em lib/lunesHistory.ts; `at` em ms). Devolve o horário (s) ou `null`.
 */
export function refundFromMoves(moves: readonly { direction: string; counterparty: string; amount: bigint; at: number | null }[], bondAddress: string | null, exitAt: number): number | null {
  if (!bondAddress) return null;
  const m = moves.find(x => x.direction === 'in' && x.at !== null && x.at / 1000 >= exitAt && sameAccount(x.counterparty, bondAddress));
  return m ? Math.floor(m.at! / 1000) : null;
}
export const markRefund = (s: PhoneNodeState, at: number): PhoneNodeState => (s.exit && !s.refundSeenAt ? { ...s, refundSeenAt: at } : s);

/**
 * Devolução (M6b/M6e): `waiting` com `progress` = dias desde a saída ÷ 7; `overdue` = passou do prazo
 * sem a devolução aparecer na carteira (M6e); `returned` = voltou.
 */
export function refundStatus(s: PhoneNodeState, now: number): { phase: 'none' | 'waiting' | 'overdue' | 'returned'; dueAt: number | null; progress: number; daysLeft: number } {
  if (!s.exit) return { phase: 'none', dueAt: null, progress: 0, daysLeft: 0 };
  const dueAt = s.exit.at + REFUND_DELAY_DAYS * 86400;
  const progress = Math.max(0, Math.min(1, (now - s.exit.at) / (REFUND_DELAY_DAYS * 86400)));
  if (s.refundSeenAt) return { phase: 'returned', dueAt, progress: 1, daysLeft: 0 };
  return { phase: now >= dueAt ? 'overdue' : 'waiting', dueAt, progress, daysLeft: Math.max(0, Math.ceil((dueAt - now) / 86400)) };
}

// ── painel (M3) ─────────────────────────────────────────────

/** Fase do painel (estimativa local; o validador é quem decide). */
export type PhoneNodePhase = 'off' | 'left' | 'needsBond' | 'bondPending' | 'certStreak' | 'needsEndorsements' | 'ready';
export interface PhoneNodeStatus {
  phase: PhoneNodePhase;
  /** Dias que faltam para 7 dias seguidos de certificado. */
  daysLeft: number;
  endorsements: number;
  needed: number;
  rewardsOn: boolean;
}
export function phoneNodeStatus(s: PhoneNodeState, myPhonePk: string, now: number): PhoneNodeStatus {
  const endorsements = distinctEndorsements(s, myPhonePk, now).length;
  const base = { daysLeft: 0, endorsements, needed: PHONE_NODE_MIN_ENDORSEMENTS, rewardsOn: PHONE_NODE_REWARDS_ON };
  if (s.exit) return { ...base, phase: 'left' };
  if (s.activeSince === null) return { ...base, phase: 'off' };
  if (!s.bond) return { ...base, phase: 'needsBond' };
  if (!s.registration) return { ...base, phase: 'bondPending' };
  const bar = certBar(s, now);
  if (!bar.complete) return { ...base, phase: 'certStreak', daysLeft: CERT_STREAK_DAYS - bar.streak };
  if (endorsements < PHONE_NODE_MIN_ENDORSEMENTS) return { ...base, phase: 'needsEndorsements' };
  return { ...base, phase: 'ready' };
}

/**
 * Estimativa de créditos do modo nó: recibos que este aparelho assinou desde a ativação e que não
 * foram rejeitados aqui. Não é dinheiro: com recompensas desligadas, rende zero LUNES.
 */
export function estimateCredits(credits: readonly { at: number; credits: number; state: string }[], s: PhoneNodeState): { receipts: number; credits: number } {
  if (s.activeSince === null) return { receipts: 0, credits: 0 };
  const list = credits.filter(c => c.at >= s.activeSince! - 3600 && c.state !== 'rejeitado' && (!s.exit || c.at < s.exit.at));
  return { receipts: list.length, credits: list.reduce((a, c) => a + c.credits, 0) };
}

// ── limites de recursos no modo nó ──────────────────────────

/** Tráfego diário de terceiros e bateria mínima com o modo nó ligado (o mais restritivo vence). */
export function nodeModeLimits(user: { dailyBytes: number; batteryPct: number }, active: boolean) {
  if (!active) return user;
  return { dailyBytes: Math.min(user.dailyBytes, NODE_MODE_LIMITS.dailyBytes), batteryPct: Math.max(user.batteryPct, NODE_MODE_LIMITS.batteryPct) };
}
/** Por que a retransmissão está parada (para o painel); `null` = repassando. */
export type PauseReason = 'off' | 'battery' | 'charging' | 'dailyLimit' | 'hours' | 'noPeers';
export function pauseReason(i: { relayOn: boolean; batteryLevel: number; charging: boolean | null; batteryPct: number; chargingOnly: boolean; dailyExhausted: boolean; outOfHours: boolean; peers: number }): PauseReason | null {
  if (!i.relayOn) return 'off';
  const known = i.batteryLevel >= 0 && i.charging !== null;
  if (known && !i.charging && i.batteryLevel * 100 <= i.batteryPct) return 'battery';
  if (known && i.chargingOnly && !i.charging) return 'charging';
  if (i.dailyExhausted) return 'dailyLimit';
  if (i.outOfHours) return 'hours';
  if (i.peers === 0) return 'noPeers';
  return null;
}

// ── arquivo para o validador ────────────────────────────────

/** Arquivo de registro para o validador (`RegistryFile` de apps/settlement). */
export interface PhoneRegistryFile {
  v: 1; certs: CertJson[]; revocations: []; phones: PhoneRegistrationJson[]; endorsements: EndorsementJson[]; exits: PhoneExitJson[];
  endorsementRevocations: EndorsementRevocationJson[];
}
export function registryFileOf(s: PhoneNodeState, op: KeyPair, nodeKeyFor: (day: number) => KeyPair, now: number): PhoneRegistryFile | null {
  if (!s.registration || s.activeSince === null) return null;
  const today = dayOfSec(now);
  const first = Math.max(dayOfSec(s.activeSince), today - CERT_DAYS_BACK);
  const last = s.exit ? Math.min(dayOfSec(s.exit.at), today) : today + CERT_DAYS_AHEAD;
  const certs: CertJson[] = [];
  for (let d = first; d <= last; d++) certs.push(makeOperatorCert(op, nodeKeyFor(d).pk, d * 86400));
  return { v: 1, certs, revocations: [], phones: [s.registration], endorsements: distinctEndorsements(s, toHex(op.pk)), exits: s.exitEvents, endorsementRevocations: s.revoked };
}

/** Nome do arquivo: `piu-registro-celular-AAAA-MM-DD.json` (dia local), como o de evidências. */
export function registryFileName(nowMs: number): string {
  const d = new Date(nowMs);
  const p = (n: number) => String(n).padStart(2, '0');
  return `piu-registro-celular-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
}
