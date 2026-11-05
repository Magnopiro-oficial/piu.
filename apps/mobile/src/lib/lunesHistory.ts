/**
 * Histórico de movimentações (entradas e saídas de LUNES) de um endereço, lido do indexador público
 * da Lunes, sem chave: o Piu continua só lendo.
 *
 * FONTE: o indexador SubQuery que o próprio explorador (https://blockexplorer.lunes.io/) usa,
 * GraphQL por POST em `https://lunes-squid.lunes.io` (constante `g2` no bundle do explorador; a
 * consulta `GetAccountTransfers` daqui é a dele). Confirmado em 2026-11-04: `_metadata` saudável,
 * indexado do bloco 1 até a ponta (13,3 M), 2.913 transfers no total.
 *
 * O que o indexador devolve e os limites que isso impõe:
 * - Entidade `Transfer` = evento `balances.Transfer`: `id` "bloco-índiceDoEvento", `fromId`/`toId`,
 *   `amount` em planck (texto), `blockNumber`. Só transferências diretas de LUNES: taxas, staking,
 *   recompensas, tokens PSP22 e chamadas de contrato não aparecem aqui.
 * - As contas estão no SS58 de prefixo 42 (5…), não no 57 (6…) da Lunes: convertemos o endereço da
 *   pessoa para consultar e a contraparte de volta para o prefixo que ela usa.
 * - `timestamp`/`date` dos transfers vêm sempre null: o horário é lido da entidade `Block`
 *   (`timestamp` em ms) numa segunda consulta, pelos números de bloco. Bloco sem resposta → sem horário.
 * - Sem paginação por cursor aqui: pedimos os `first` mais recentes enviados e os `first` mais recentes
 *   recebidos (padrão 50 + 50) e avisamos (`truncated`) quando a conta tem mais do que isso.
 * - O explorador aceita `/block/<número>` e `/account/<conta no prefixo 42>`; `/tx/<id>` espera
 *   "bloco-índiceDoExtrínseco", que o indexador não dá (dá o índice do evento), então o link da
 *   movimentação vai para o bloco.
 * - Indexador é um serviço fora da cadeia: se cair, o saldo (RPC) continua funcionando e o histórico
 *   mostra erro com "tentar de novo". A última leitura fica guardada no aparelho (snapshot).
 *
 * Alternativas descartadas: `api-exp.lunes.io/api` (REST do explorador) só tem comentários/projetos/
 * social; ler `balances.Transfer` por RPC exigiria varrer blocos (6 s cada, 13 M deles) ou os
 * metadados para decodificar eventos, caro demais para o celular.
 *
 * Sem react-native: roda no app (fetch do RN), no Node e nos testes (fetch falso com resposta gravada).
 */
import { formatLunes, LUNES_EXPLORER } from './lunesRpc';
import { decodeSs58, encodeSs58 } from './ss58';
import { dayLabel } from './walletCore';
import type { IconName } from '../ui/Icon';

/** Indexador SubQuery da Lunes (o mesmo do explorador). */
export const LUNES_INDEXER = 'https://lunes-squid.lunes.io';
/** Prefixo SS58 em que o indexador guarda as contas. */
export const INDEXER_SS58_PREFIX = 42;
/** Quantos enviados + quantos recebidos pedimos por leitura. */
export const HISTORY_PAGE = 50;

/** Falha ao ler o histórico (rede, HTTP, GraphQL ou resposta fora do formato). */
export class LunesHistoryError extends Error {}

/** Uma transferência de LUNES vista pela conta consultada. */
export interface LunesMove {
  /** "bloco-índiceDoEvento", único no indexador. */
  id: string;
  /** Entrada, saída ou para a própria conta. */
  direction: 'in' | 'out' | 'self';
  /** Em planck (1 LUNES = 10^8). */
  amount: bigint;
  /** A outra conta, no prefixo SS58 do endereço informado (para mostrar). */
  counterparty: string;
  /** A outra conta como o indexador/explorador a escrevem (prefixo 42), para links. */
  counterpartyId: string;
  block: number;
  eventIndex: number;
  /** Horário do bloco (ms), ou null quando o indexador não devolveu o bloco. */
  at: number | null;
}

export interface LunesHistory {
  /** Endereço como foi informado. */
  address: string;
  /** Da mais recente para a mais antiga. */
  moves: LunesMove[];
  /** Quantas transferências a conta tem no indexador (enviadas + recebidas). */
  total: number;
  /** A conta tem mais do que foi pedido: a lista mostra só as mais recentes. */
  truncated: boolean;
  /** Quando foi lido (ms). */
  at: number;
}

// ── consultas (as do explorador, com só os campos que usamos) ──────────────
export const ACCOUNT_TRANSFERS_QUERY = `query AccountTransfers($id: String!, $first: Int!) {
  sent: transfers(filter: { fromId: { equalTo: $id } }, first: $first, orderBy: BLOCK_NUMBER_DESC) { nodes { id fromId toId amount blockNumber eventIndex } totalCount }
  received: transfers(filter: { toId: { equalTo: $id } }, first: $first, orderBy: BLOCK_NUMBER_DESC) { nodes { id fromId toId amount blockNumber eventIndex } totalCount }
}`;
export const BLOCK_TIMES_QUERY = `query BlockTimes($ids: [String!]!) {
  blocks(filter: { id: { in: $ids } }) { nodes { id timestamp } }
}`;

interface TransferNode { id: string; fromId: string; toId: string; amount: string; blockNumber: string; eventIndex: number }
interface TransfersData { sent: { nodes: TransferNode[]; totalCount: number }; received: { nodes: TransferNode[]; totalCount: number } }
interface BlocksData { blocks: { nodes: { id: string; timestamp: string | null }[] } }
interface GraphQlResponse<T> { data?: T | null; errors?: { message?: string }[] }

const publicKeyOf = (address: string) => {
  const d = decodeSs58(address);
  if (!d.ok) throw new LunesHistoryError(d.error);
  return d;
};

/** Conta como o indexador a guarda (prefixo 42). Lança LunesHistoryError se o endereço não for SS58 da Lunes. */
export function indexerAccountId(address: string): string {
  return encodeSs58(publicKeyOf(address).publicKey, INDEXER_SS58_PREFIX);
}

/** Reescreve uma conta do indexador (42) no prefixo que a pessoa usa; se não decodificar, devolve como veio. */
function toPrefix(id: string, prefix: number): string {
  const d = decodeSs58(id, [INDEXER_SS58_PREFIX, prefix]);
  return d.ok ? encodeSs58(d.publicKey, prefix) : id;
}

function dataOf<T>(json: unknown, what: string): T {
  const r = json as GraphQlResponse<T> | null;
  if (r?.errors?.length) throw new LunesHistoryError(`O indexador da Lunes recusou a consulta: ${r.errors.map(e => e.message ?? 'erro').join('; ')}`);
  if (!r?.data) throw new LunesHistoryError(`O indexador da Lunes não devolveu ${what}.`);
  return r.data;
}

/**
 * Transfers → movimentações da conta `accountId` (prefixo 42), sem repetição, da mais recente para
 * a mais antiga (bloco, depois índice do evento). `prefix`: SS58 para mostrar a contraparte.
 */
export function parseTransfers(json: unknown, accountId: string, prefix: number): LunesMove[] {
  const d = dataOf<TransfersData>(json, 'as transferências');
  const nodes = [...(d.sent?.nodes ?? []), ...(d.received?.nodes ?? [])];
  const seen = new Set<string>();
  const moves: LunesMove[] = [];
  for (const n of nodes) {
    if (!n || typeof n.id !== 'string' || seen.has(n.id)) continue;
    seen.add(n.id);
    const out = n.fromId === accountId, into = n.toId === accountId;
    if (!out && !into) continue; // não é desta conta: resposta estranha, ignora
    const otherId = out ? n.toId : n.fromId;
    let amount: bigint;
    try { amount = BigInt(n.amount); } catch { continue; }
    moves.push({
      id: n.id, direction: out && into ? 'self' : out ? 'out' : 'in', amount,
      counterparty: toPrefix(otherId, prefix), counterpartyId: otherId,
      block: Number(n.blockNumber), eventIndex: Number(n.eventIndex ?? n.id.split('-').pop()), at: null,
    });
  }
  return moves.sort((a, b) => b.block - a.block || b.eventIndex - a.eventIndex);
}

/** Blocos → horário (ms) por número de bloco. Blocos sem `timestamp` ficam de fora. */
export function parseBlockTimes(json: unknown): Map<number, number> {
  const d = dataOf<BlocksData>(json, 'os blocos');
  const out = new Map<number, number>();
  for (const b of d.blocks?.nodes ?? []) {
    const t = Number(b?.timestamp);
    if (b && Number.isFinite(t) && t > 0) out.set(Number(b.id), t);
  }
  return out;
}

/** Preenche `at` com o horário do bloco de cada movimentação. */
export const withBlockTimes = (moves: LunesMove[], times: Map<number, number>): LunesMove[] =>
  moves.map(m => ({ ...m, at: times.get(m.block) ?? null }));

export interface LunesHistoryOptions {
  /** `fetch` a usar (padrão: o global). */
  fetch?: typeof fetch;
  /** Quantos enviados e quantos recebidos pedir (padrão: HISTORY_PAGE). */
  first?: number;
  indexer?: string;
  /** Tempo limite por consulta (padrão: 12 s). */
  timeoutMs?: number;
  now?: () => number;
}

async function graphql<T>(o: Required<Pick<LunesHistoryOptions, 'fetch' | 'indexer' | 'timeoutMs'>>, query: string, variables: Record<string, unknown>, what: string): Promise<T> {
  // Tempo limite com AbortController (o React Native não tem `AbortSignal.timeout`).
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => ctl?.abort(), o.timeoutMs);
  let res: Response;
  try {
    res = await o.fetch(o.indexer, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }), signal: ctl?.signal,
    });
  } catch (e) {
    throw new LunesHistoryError(`Sem conexão com o indexador da Lunes (${e instanceof Error ? e.message : 'falha de rede'}).`);
  } finally { clearTimeout(timer); }
  let json: unknown = null;
  try { json = await res.json(); } catch { /* corpo vazio ou não JSON: tratado abaixo */ }
  const errors = (json as GraphQlResponse<unknown> | null)?.errors;
  if (!res.ok && !errors?.length) throw new LunesHistoryError(`O indexador da Lunes respondeu HTTP ${res.status}.`);
  return dataOf<T>(json, what);
}

/** Lê o histórico do endereço no indexador: transfers mais recentes (enviados e recebidos) e o horário dos blocos. */
export async function fetchLunesHistory(address: string, opts: LunesHistoryOptions = {}): Promise<LunesHistory> {
  const d = publicKeyOf(address);
  const id = encodeSs58(d.publicKey, INDEXER_SS58_PREFIX);
  const first = opts.first ?? HISTORY_PAGE;
  const o = { fetch: opts.fetch ?? fetch, indexer: opts.indexer ?? LUNES_INDEXER, timeoutMs: opts.timeoutMs ?? 12_000 };
  const transfers = await graphql<TransfersData>(o, ACCOUNT_TRANSFERS_QUERY, { id, first }, 'as transferências');
  let moves = parseTransfers({ data: transfers }, id, d.prefix);
  if (moves.length) {
    const ids = [...new Set(moves.map(m => String(m.block)))];
    const blocks = await graphql<BlocksData>(o, BLOCK_TIMES_QUERY, { ids }, 'os blocos');
    moves = withBlockTimes(moves, parseBlockTimes({ data: blocks }));
  }
  const total = (transfers.sent?.totalCount ?? 0) + (transfers.received?.totalCount ?? 0);
  return { address: address.trim(), moves, total, truncated: total > moves.length, at: (opts.now ?? Date.now)() };
}

// ── tela ───────────────────────────────────────────────────
/** "5CNUWeLm…yFds". */
export const shortAddress = (a: string) => (a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-4)}` : a);
export const explorerBlockUrl = (block: number) => `${LUNES_EXPLORER}block/${block}`;
export const explorerAccountUrl = (accountId: string) => `${LUNES_EXPLORER}account/${accountId}`;

export const blockNumberLabel = (n: number) => `#${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
const pad2 = (n: number) => String(n).padStart(2, '0');
/** Máscara dos valores do histórico quando o saldo está escondido (igual a lib/balanceMask AMOUNT_MASK). */
const HISTORY_MASK = '••••';

export interface MoveRow { icon: IconName; title: string; detail: string; value: string; url: string }

/** Linha pronta para a lista de atividade. `hidden`: "esconder saldo" ligado → só o valor é mascarado. */
export function moveRow(m: LunesMove, now: number, hidden: boolean): MoveRow {
  const title = m.direction === 'self' ? 'Para a própria conta' : m.direction === 'in' ? `Recebido de ${shortAddress(m.counterparty)}` : `Enviado para ${shortAddress(m.counterparty)}`;
  const sign = m.direction === 'in' ? '+' : m.direction === 'out' ? '−' : '';
  const when = m.at == null ? null : `${dayLabel(m.at, now)} · ${pad2(new Date(m.at).getHours())}:${pad2(new Date(m.at).getMinutes())}`;
  return {
    icon: m.direction === 'in' ? 'arrow_downward' : m.direction === 'out' ? 'arrow_upward' : 'swap_vert',
    title,
    detail: when ? `${when} · bloco ${blockNumberLabel(m.block)}` : `bloco ${blockNumberLabel(m.block)} · horário não indexado`,
    value: hidden ? HISTORY_MASK : `${sign}${formatLunes(m.amount)}`,
    url: explorerBlockUrl(m.block),
  };
}

// ── disco ──────────────────────────────────────────────────
/** Como fica guardado no aparelho (JSON): `amount` em texto. */
export type StoredMove = Omit<LunesMove, 'amount'> & { amount: string };
export interface HistorySnapshot extends Omit<LunesHistory, 'moves'> { moves: StoredMove[] }

export const toHistorySnapshot = (h: LunesHistory): HistorySnapshot => ({ ...h, moves: h.moves.map(m => ({ ...m, amount: m.amount.toString() })) });
export const fromHistorySnapshot = (s: HistorySnapshot): LunesHistory => ({ ...s, moves: s.moves.map(m => ({ ...m, amount: BigInt(m.amount) })) });
