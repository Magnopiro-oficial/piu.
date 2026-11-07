/**
 * Regras de tela do modo nó (M1…M6e, design/handoff/docs/TELAS-NOVAS.md): qual tela mostrar, o que
 * cada linha diz e para onde vai cada erro. Sem React e sem texto: as telas (src/app/provider/phone/*)
 * montam as frases pelo i18n. Testado no Node (__tests__/phoneNodeView.test.ts).
 */
import {
  type BondBlock, type BondPhase, CERT_STREAK_DAYS, ENDORSE_REQUEST_TTL_SEC, ENDORSEMENT_VALIDITY_DAYS, type EndorseBlock, PHONE_NODE_MAX_ENDORSEMENTS_PER_MONTH, PHONE_NODE_MIN_AGE_DAYS, REFUND_DELAY_DAYS,
  type PhoneNodePhase, type PhoneNodeState, type RequestState,
} from './phoneNodeCore';

const DAY = 86400;

/** "op:7F3A 91C2": os 8 primeiros dígitos da chave de operador, em dois grupos. */
export const shortOp = (pk: string | null | undefined) => (pk && pk.length >= 8 ? `op:${pk.slice(0, 4).toUpperCase()} ${pk.slice(4, 8).toUpperCase()}` : '—');
/** "5Gx…Y7kQ": endereço curto. */
export const shortAddr = (a: string | null | undefined) => (a ? (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a) : '—');

/**
 * Qual tela o fluxo "Do celular" mostra agora (Piu 11): desligado → N1 (entrada, em Conectar);
 * caução finalizada e ainda sem o vínculo da carteira → N4 (confirmar com biometria); o resto → painel
 * N2 (a trilha, com a fase atual e a ação dela; a folha da caução N3 abre por cima dele).
 * `bound`: o vínculo carteira → chave do celular já foi assinado (instalações antigas assinavam ao ativar).
 */
export type PhoneScreen = 'entry' | 'confirm' | 'panel';
export function phoneScreen(phase: PhoneNodePhase | null | undefined, bond: BondPhase, bound: boolean): PhoneScreen {
  if (!phase || phase === 'off') return 'entry';
  if (phase === 'bondPending' && bond === 'confirmed' && !bound) return 'confirm';
  return 'panel';
}

/** O que a tela faz com um `PhoneNodeError` (código estável) ou outro erro. */
export type ErrorAction =
  | { kind: 'requirements' } | { kind: 'insufficient' } | { kind: 'soon' } | { kind: 'silent' }
  | { kind: 'toast'; key: 'noKeys' | 'wrongWallet' | 'bond' | 'endorse' | 'notEligible' | 'generic' };
export function errorAction(e: unknown): ErrorAction {
  const code = e && typeof e === 'object' && 'code' in e ? (e as { code: unknown }).code : null;
  switch (code) {
    case 'requirements': return { kind: 'requirements' };
    case 'insufficient': return { kind: 'insufficient' };
    case 'soon': return { kind: 'soon' };
    case 'cancelled': case 'recover': return { kind: 'silent' }; // a pessoa desistiu da biometria / foi para recuperar a frase
    case 'noKeys': case 'wrongWallet': case 'bond': case 'endorse': case 'notEligible': return { kind: 'toast', key: code };
    default: return { kind: 'toast', key: 'generic' };
  }
}

/** Requisitos que a pessoa resolve antes de continuar (o `program` não depende dela: fica "em breve"). */
export const personalRequirementsOk = (r: readonly { key: string; ok: boolean }[]) => r.every(x => x.ok || x.key === 'program');

/** Dia mostrado no cartão do painel ("Dia 3 de 7"): hoje conta como em andamento até o certificado sair. */
export function certDayOf(bar: { streak: number; complete: boolean; dashes: readonly string[] }): number {
  if (bar.complete) return CERT_STREAK_DAYS;
  // certBar: com o certificado de hoje, os `streak` primeiros traços terminam hoje; sem ele, o traço seguinte é hoje.
  const next = bar.dashes[bar.streak];
  const todayPending = next === 'today' || next === 'error';
  return Math.max(1, Math.min(CERT_STREAK_DAYS, todayPending ? bar.streak + 1 : bar.streak));
}

/** Fim do dia UTC do certificado de hoje (ms): até quando ele vale, para mostrar no horário local. */
export const certValidUntilMs = (nowSec: number) => (Math.floor(nowSec / DAY) + 1) * DAY * 1000 - 60_000;

/** Dias inteiros que faltam até `at` (s), arredondando para cima; 0 se já passou. */
export const daysUntil = (at: number, now: number) => Math.max(0, Math.ceil((at - now) / DAY));

// ── M3: as vagas de aval ────────────────────────────────────

export interface Contact { contactId: string; chatId: string; name: string; verified: boolean }
export type Slot =
  | { kind: 'received'; contactId: string; name: string; at: number }
  | { kind: 'asked'; contactId: string; name: string; at: number; expired: boolean }
  | { kind: 'empty' };
/** `needed` vagas: avais recebidos (válidos), pedidos em aberto, depois vagas livres. */
export function endorseSlots(s: PhoneNodeState, contacts: readonly Contact[], myPk: string | null, needed: number, now: number): Slot[] {
  const name = (id: string) => contacts.find(c => c.contactId === id)?.name ?? '';
  const seen = new Set<string>();
  const out: Slot[] = [];
  for (const r of s.received) {
    if (myPk && r.e.phonePk !== myPk) continue;
    if (now - r.at > ENDORSEMENT_VALIDITY_DAYS * DAY || seen.has(r.contactId)) continue;
    seen.add(r.contactId);
    out.push({ kind: 'received', contactId: r.contactId, name: name(r.contactId), at: r.at });
  }
  for (const a of [...s.asked].sort((x, y) => y.at - x.at)) {
    if (a.cancelled || seen.has(a.contactId)) continue;
    seen.add(a.contactId);
    out.push({ kind: 'asked', contactId: a.contactId, name: name(a.contactId), at: a.at, expired: now - a.at > ENDORSE_REQUEST_TTL_SEC });
  }
  const shown = out.slice(0, Math.max(needed, out.filter(x => x.kind === 'received').length));
  while (shown.length < needed) shown.push({ kind: 'empty' });
  return shown;
}

// ── M4 / M4v: quem pode avalizar ────────────────────────────

export type AskRow = Contact & (
  | { kind: 'eligible'; nodeDays: number }
  | { kind: 'asked'; at: number }
  | { kind: 'received'; at: number }
  | { kind: 'tooNew'; nodeDays: number; daysLeft: number }
  | { kind: 'notVerified' }
  | { kind: 'noNode' }
);
const ORDER: AskRow['kind'][] = ['eligible', 'asked', 'received', 'tooNew', 'notVerified', 'noNode'];
/** Todos os contatos públicos, cada um com o motivo de poder ou não avalizar (o design apaga, não esconde). */
export function askRows(s: PhoneNodeState, contacts: readonly Contact[], now: number): AskRow[] {
  const rows = contacts.map((c): AskRow => {
    const got = s.received.find(r => r.contactId === c.contactId);
    if (got) return { ...c, kind: 'received', at: got.at };
    const a = s.asked.find(x => x.contactId === c.contactId && !x.cancelled && now - x.at <= ENDORSE_REQUEST_TTL_SEC);
    if (a) return { ...c, kind: 'asked', at: a.at };
    if (!c.verified) return { ...c, kind: 'notVerified' };
    const p = s.peers[c.contactId];
    if (!p || p.since <= 0) return { ...c, kind: 'noNode' };
    const nodeDays = Math.max(0, Math.floor((now - p.since) / DAY));
    const canAt = p.since + PHONE_NODE_MIN_AGE_DAYS * DAY;
    if (canAt > now) return { ...c, kind: 'tooNew', nodeDays, daysLeft: daysUntil(canAt, now) };
    return { ...c, kind: 'eligible', nodeDays };
  });
  return rows.sort((x, y) => ORDER.indexOf(x.kind) - ORDER.indexOf(y.kind) || x.name.localeCompare(y.name));
}

// ── M5 / M5e: pedido recebido ───────────────────────────────

export type RequestReason = Exclude<RequestState, 'ok'> | Exclude<EndorseBlock, RequestState> | 'missing';
/** M5 quando dá para avalizar; senão M5e com o motivo (o estado do pedido vem antes do bloqueio meu). */
export function requestView(r: { state: RequestState; block: EndorseBlock | null } | null | undefined): { screen: 'm5' } | { screen: 'm5e'; reason: RequestReason } {
  if (!r) return { screen: 'm5e', reason: 'missing' };
  if (r.state !== 'ok') return { screen: 'm5e', reason: r.state };
  if (r.block) return { screen: 'm5e', reason: r.block as RequestReason };
  return { screen: 'm5' };
}

/** Pedidos que merecem aviso (notificação/banner): válidos e ainda não avisados. */
export const requestNoticeKey = (r: { contactId: string; createdAt: number }) => `${r.contactId}:${r.createdAt}`;
export function newRequestNotices<R extends { contactId: string; createdAt: number; state: RequestState }>(requests: readonly R[], told: readonly string[]): R[] {
  const set = new Set(told);
  return requests.filter(r => r.state === 'ok' && !set.has(requestNoticeKey(r)));
}

// ── M6 / M6b / M6e ──────────────────────────────────────────

/** Sair sem caução confirmada perderia a referência à transferência: a tela bloqueia até confirmar. */
export function leaveMode(o: { registered: boolean; bond: BondPhase }): 'refund' | 'turnOff' | 'wait' {
  if (o.registered) return 'refund';
  return o.bond === 'none' || o.bond === 'failed' ? 'turnOff' : 'wait';
}

// ══ Piu 11 (N1…N10c) ════════════════════════════════════════

/** Parâmetros que as telas mostram (sempre os do programa; nada fixo na tela). */
export function nodeParamsOf(p: { bond: string; minEndorsements: number; dailyBytes: number; batteryPct: number; rewardsOn: boolean }) {
  return {
    bond: p.bond, minEndorsements: p.minEndorsements, days: CERT_STREAK_DAYS, batteryPct: p.batteryPct, dailyMb: Math.round(p.dailyBytes / (1024 * 1024)), rewardsOn: p.rewardsOn,
    refundDays: REFUND_DELAY_DAYS, endorseValidityDays: ENDORSEMENT_VALIDITY_DAYS, maxPerMonth: PHONE_NODE_MAX_ENDORSEMENTS_PER_MONTH,
  };
}

/** "8E41 … C07A": hash de transação curto (N4). */
export const shortHash = (h: string | null | undefined) => { const x = (h ?? '').replace(/^0x/i, ''); return x.length >= 8 ? `${x.slice(0, 4).toUpperCase()} … ${x.slice(-4).toUpperCase()}` : '—'; };
/** "3P8x Kd2Q … 9vLm": endereço em grupos (N3 "Para"). */
export const addrGroups = (a: string | null | undefined) => (a && a.length > 12 ? `${a.slice(0, 4)} ${a.slice(4, 8)} … ${a.slice(-4)}` : a || '—');

/** N5: quem já avalizou, a quem já pedi, quem pode; depois quem não pode (o design apaga, não esconde). */
const ASK_ORDER: AskRow['kind'][] = ['received', 'asked', 'eligible', 'notVerified', 'tooNew', 'noNode'];
export const sortAskRows = <R extends { kind: AskRow['kind']; name: string }>(rows: readonly R[]): R[] =>
  [...rows].sort((x, y) => ASK_ORDER.indexOf(x.kind) - ASK_ORDER.indexOf(y.kind) || x.name.localeCompare(y.name));

/** "7F3A 91C2 4D0E 18B5": os 16 primeiros dígitos da chave de operador do celular (a tela põe o prefixo "nó:"). */
export const keyGroups = (pk: string | null | undefined) => (pk && /^[0-9a-f]{16}/i.test(pk) ? pk.slice(0, 16).toUpperCase().match(/.{4}/g)!.join(' ') : '—');

// ── N2: a trilha ────────────────────────────────────────────

export type TrailKey = 'paid' | 'confirmed' | 'days' | 'endorse' | 'ready';
export type TrailState = 'done' | 'current' | 'pending';
/**
 * Cinco etapas: caução paga → confirmada na rede → 7 dias ligado e avais (andam juntos depois do registro)
 * → pronto (estimativa local; quem decide é o validador). Anteriores ✓, atuais pulsando, seguintes cinza.
 */
export function trailSteps(o: { bond: BondPhase; certComplete: boolean; endorsements: number; needed: number; ready: boolean }): { key: TrailKey; state: TrailState }[] {
  const sent = o.bond !== 'none' && o.bond !== 'failed';
  const reg = o.bond === 'registered';
  return [
    { key: 'paid', state: sent ? 'done' : 'current' },
    { key: 'confirmed', state: reg ? 'done' : sent ? 'current' : 'pending' },
    { key: 'days', state: !reg ? 'pending' : o.certComplete ? 'done' : 'current' },
    { key: 'endorse', state: !reg ? 'pending' : o.endorsements >= o.needed ? 'done' : 'current' },
    { key: 'ready', state: o.ready ? 'done' : 'pending' },
  ];
}

// ── N2b: a linha de cada fase ───────────────────────────────

export type PhaseCard = 'needsBond' | 'bondSent' | 'bondUnconfirmed' | 'bondFailed' | 'confirmBond' | 'days' | 'endorse' | 'ready' | 'left';
/** A linha da fase atual (N2b). `bondUnconfirmed`/`bondFailed`: estados reais da caução que o design não desenhou. */
export function phaseCardOf(o: { phase: PhoneNodePhase | null | undefined; bond: BondPhase; bound: boolean; certComplete: boolean; endorsements: number; needed: number }): PhaseCard | null {
  switch (o.phase) {
    case 'left': return 'left';
    case 'needsBond': return 'needsBond';
    case 'bondPending':
      if (o.bond === 'confirmed') return o.bound ? 'bondSent' : 'confirmBond';
      if (o.bond === 'unconfirmed') return 'bondUnconfirmed';
      if (o.bond === 'failed') return 'bondFailed';
      return 'bondSent';
    case 'certStreak': return 'days';
    case 'needsEndorsements': return 'endorse';
    case 'ready': return 'ready';
    default: return null;
  }
}
/** No topo do painel, só as fases que a trilha não mostra com a sua ação (7 dias, avais e pronto já estão nela). */
const TOP: readonly PhaseCard[] = ['needsBond', 'bondSent', 'bondUnconfirmed', 'bondFailed', 'confirmBond', 'left'];
export const topCardOf = (k: PhaseCard | null | undefined): PhaseCard | null => (k && TOP.includes(k) ? k : null);

// ── N3 / N3a–h: folha da caução ─────────────────────────────

/** O que aparece no lugar da folha: ela (`sheet`) ou o estado N3a–e. */
export type BondSheet = 'sheet' | 'soon' | 'noWallet' | 'sent' | 'registered' | 'inactive';
export function bondSheetOf(block: BondBlock | null): BondSheet {
  switch (block) {
    case null: return 'sheet';
    case 'soon': return 'soon';
    case 'noWallet': return 'noWallet';
    case 'pending': return 'sent';
    case 'done': return 'registered';
    case 'inactive': return 'inactive';
  }
}
const codeOf = (e: unknown) => (e && typeof e === 'object' && 'code' in e ? (e as { code: unknown }).code : null);
/** Erro depois de segurar (N3f saldo, N3g biometria, N3h carteira ocupada); `soon` volta ao N3a; o resto vira aviso. */
export type BondFail = 'insufficient' | 'cancelled' | 'busy' | 'soon' | 'toast';
export function bondFailOf(e: unknown): BondFail {
  switch (codeOf(e)) {
    case 'insufficient': case 'funds': return 'insufficient';
    case 'cancelled': case 'recover': return 'cancelled';
    case 'busy': return 'busy';
    case 'soon': return 'soon';
    default: return 'toast';
  }
}

// ── N4 / N4a–d ──────────────────────────────────────────────

/** Resultado de "Confirmar com biometria": `null` = deu certo (N4a). */
export type ConfirmOutcome = 'ok' | 'notFinal' | 'cancelled' | 'recover' | 'toast';
export function confirmOutcomeOf(e: unknown): ConfirmOutcome {
  if (!e) return 'ok';
  const c = codeOf(e);
  return c === 'notFinal' || c === 'cancelled' || c === 'recover' ? c : 'toast';
}

// ── N6: pedidos recebidos ───────────────────────────────────

/** Válidos primeiro, mais novos antes; abre expandido o da notificação (`focus`) ou o primeiro. */
export function requestList<R extends { contactId: string; createdAt: number; state: RequestState }>(rs: readonly R[], focus: string | null | undefined): (R & { expanded: boolean })[] {
  const sorted = [...rs].sort((a, b) => Number(b.state === 'ok') - Number(a.state === 'ok') || b.createdAt - a.createdAt);
  const open = focus && sorted.some(r => r.contactId === focus) ? focus : sorted[0]?.contactId;
  return sorted.map(r => ({ ...r, expanded: r.contactId === open }));
}
/** "2 de 5 avais este mês" e a barra. */
export const monthCounter = (n: number, max: number) => ({ n, max, pct: max > 0 ? Math.min(1, n / max) : 1, full: n >= max });
/**
 * Dia em que o limite mensal renova (o mês do aval é o UTC, como em `endorseBlock`): 1º do mês seguinte,
 * ao meio-dia UTC (ms) — à meia-noite UTC, no Brasil (UTC−3) a data local seria o dia 30/31 anterior.
 */
export function monthRenewalMs(nowSec: number): number {
  const d = new Date(nowSec * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 12);
}

// ── N7b / N10a–c ────────────────────────────────────────────

/** N7b fica no topo do painel até o arquivo de registro ser compartilhado depois da saída. */
export const exitShareNeeded = (exitAt: number | null | undefined, sharedAt: number | null | undefined) => !!exitAt && !(sharedAt && sharedAt >= exitAt);

/**
 * "Enviar evidências pela malha": sem chave do validador publicada (N10b), mensageiro ainda abrindo,
 * nada para enviar (N10c; `carried`: o que havia já foi solto na malha — soltar não é entregar) ou prontas (N10a).
 */
export type EvidenceRow = { kind: 'ready'; n: number } | { kind: 'noValidator' } | { kind: 'notReady' } | { kind: 'nothing'; carried: boolean };
export function evidenceRowOf(o: { validatorKey: boolean; messenger: boolean; items: number; carriedItems: number | null }): EvidenceRow {
  if (!o.validatorKey) return { kind: 'noValidator' };
  if (!o.messenger) return { kind: 'notReady' };
  if (o.items <= 0) return { kind: 'nothing', carried: false };
  if (o.carriedItems !== null && o.items <= o.carriedItems) return { kind: 'nothing', carried: true };
  return { kind: 'ready', n: o.items };
}
