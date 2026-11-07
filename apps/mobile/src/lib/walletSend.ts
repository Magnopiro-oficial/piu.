/**
 * Folha Enviar da Carteira (design: `docs/APP-CARTEIRA-ENVIAR-RECEBER.md` §2 e `reference-code/app-wallet.js`),
 * só a lógica pura, sem React, para testar em Node (`__tests__/walletSend.test.ts`).
 *
 * Diferenças de honestidade em relação ao protótipo (produção na Lunes Mainnet):
 * - os destinatários são contatos reais que já mandaram um pedido de pagamento com o endereço Lunes
 *   deles (único caminho pelo qual o app conhece a carteira de um contato), nunca Marina/Ana/Pedro/João;
 *   há sempre um "Outro" que abre o campo de endereço e o leitor de QR;
 * - a taxa vem de `quoteTransfer` (payment_queryInfo na Lunes), não de um "0,01" fixo;
 * - o valor é conferido contra o saldo lido na Mainnet; sem leitura, o botão fica apagado.
 */
import type { Chat } from '../data/types';
import type { IconName } from '../ui/Icon';
import type { LunesMove } from './lunesHistory';
import type { WalletTransferRecord } from './walletTransfer';
import { t as tGlobal, type Key, type Vars } from '../i18n/core';
import { formatLunes } from './lunesRpc';
import { parseLunesAmount, readPayRequest } from './paymentRequest';
import { decodeSs58, encodeSs58, LUNES_SS58_PREFIX } from './ss58';

type Tr = (key: Key, vars?: Vars) => string;

/** Chips do design, nesta ordem (rótulo `${n} LUNES`). */
export const QUICK_AMOUNTS = [1, 5, 10] as const;
/** O campo nasce com "5", como no protótipo. */
export const DEFAULT_AMOUNT = '5';
/** Id do círculo "Outro" (endereço digitado ou lido pelo QR). */
export const OTHER_ID = 'other';
/** Espera depois da última tecla antes de pedir a cotação à Mainnet (resumo e botão ficam na própria folha). */
export const QUOTE_DEBOUNCE_MS = 350;
/** Esquema usado no rodapé do cartão e aceito pelo leitor de QR: `lunes:<endereço SS58>`. */
export const LUNES_URI_SCHEME = 'lunes:';
export const lunesUri = (address: string) => `${LUNES_URI_SCHEME}${address}`;

/** O campo de valor aceita só `[0-9,.]` (`inputMode="decimal"` do design). */
export const sanitizeAmount = (v: string) => v.replace(/[^0-9,.]/g, '').slice(0, 24);

export interface Recipient {
  id: string; name: string; first: string; initials: string;
  /** `null` só em "Outro". */
  address: string | null;
  photo?: string; inv?: boolean;
}

/** Registro de pedido de pagamento (o suficiente para achar o endereço do contato; o tipo completo está em state/messaging). */
export interface PayLike { chatId: string; dir: 'in' | 'out'; address: string; createdAt: number }

/**
 * Endereço Lunes conhecido de cada conversa: o do pedido de pagamento mais recente que o contato mandou
 * (`dir === 'in'`; os `out` levam o meu endereço). Só endereços que passam no validador SS58.
 */
export function contactAddresses(chats: readonly Chat[], pays: readonly PayLike[]): Map<string, string> {
  const ids = new Set(chats.map(ch => ch.id));
  const latest = new Map<string, PayLike>();
  for (const p of pays) {
    if (p.dir !== 'in' || !ids.has(p.chatId) || !decodeSs58(p.address).ok) continue;
    const cur = latest.get(p.chatId);
    if (!cur || p.createdAt > cur.createdAt) latest.set(p.chatId, p);
  }
  return new Map([...latest].map(([id, p]) => [id, p.address.trim()]));
}

/** Contatos na folha: o design tem 4 círculos; com "Outro" sempre no fim, sobram 3 para contatos reais. */
export const MAX_RECIPIENTS = 3;

/**
 * Até 3 conversas diretas aceitas (com `peer`, não `request`) que tenham endereço conhecido, na ordem da
 * lista de conversas, mais "Outro" sempre no fim (4 círculos, como no design). `first`: a conversa de origem
 * (botão de pagar numa conversa) entra primeiro, se for elegível. Sem contato com endereço, a lista é só "Outro".
 */
export function recipientsFrom(chats: readonly Chat[], addresses: ReadonlyMap<string, string>, first?: string): Recipient[] {
  const toRecipient = (ch: Chat): Recipient | null => {
    const address = addresses.get(ch.id);
    if (!address || !ch.peer || ch.request || ch.kind !== 'direct') return null;
    const r: Recipient = { id: ch.id, name: ch.name, first: ch.name.trim().split(/\s+/)[0] || ch.name, initials: ch.initials, address };
    if (ch.photo) r.photo = ch.photo;
    if (ch.inv) r.inv = true;
    return r;
  };
  const preferred = first ? chats.find(ch => ch.id === first) : undefined;
  const ordered = preferred ? [preferred, ...chats.filter(ch => ch !== preferred)] : chats;
  const real: Recipient[] = [];
  for (const ch of ordered) {
    const r = toRecipient(ch);
    if (!r) continue;
    real.push(r);
    if (real.length === MAX_RECIPIENTS) break;
  }
  return [...real, { id: OTHER_ID, name: '', first: '', initials: '', address: null }];
}

/** Valor digitado contra o saldo disponível (LUNES): `ok` quando 0 < valor ≤ saldo; `over` quando passa (ou sem leitura do saldo). */
export function amountState(text: string, availableLunes: number | null): { planck: bigint | null; over: boolean; ok: boolean } {
  const planck = text.trim() ? parseLunesAmount(text) : null;
  if (planck === null || planck <= 0n) return { planck: null, over: false, ok: false };
  const over = availableLunes === null || Number(planck) / 1e8 > availableLunes + 1e-9;
  return { planck, over, ok: !over };
}

/** Botão "Segure para assinar e enviar": opacidade 1 se o valor vale, senão .35 (design). */
export const holdOpacity = (ok: boolean) => (ok ? 1 : 0.35);

export type WalletQr = { ok: true; address: string; amount: string | null } | { ok: false; error: string };

/**
 * Lê o QR de outra carteira: endereço SS58 puro, `lunes:<endereço>` ou o payload `pq` de pedido de
 * pagamento que o app gera (então o valor também vem). O endereço sai normalizado no prefixo 57 da Lunes.
 * Qualquer outra coisa devolve um erro claro com o motivo do validador.
 */
export function parseWalletQr(text: string, nowSec: number, t: Tr = tGlobal): WalletQr {
  const raw = text.trim();
  if (raw.startsWith('{')) {
    let parsed: unknown = null;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
    const isPq = !!parsed && typeof parsed === 'object' && (parsed as { t?: unknown }).t === 'pq';
    if (isPq) {
      const r = readPayRequest(parsed, nowSec);
      if (!r) return { ok: false, error: t('wallet.scan.badRequest') };
      return { ok: true, address: normalize(r.address), amount: r.planck != null ? amountText(r.planck) : null };
    }
    return { ok: false, error: t('wallet.scan.notWallet', { reason: t('wallet.scan.reason.format') }) };
  }
  const body = raw.slice(0, LUNES_URI_SCHEME.length).toLowerCase() === LUNES_URI_SCHEME ? raw.slice(LUNES_URI_SCHEME.length).trim() : raw;
  const d = decodeSs58(body);
  if (!d.ok) return { ok: false, error: t('wallet.scan.notWallet', { reason: d.error }) };
  return { ok: true, address: encodeSs58(d.publicKey, LUNES_SS58_PREFIX), amount: null };
}

/** planck → texto do campo de valor, sem zeros à direita ("5", "1,5"), como o usuário digitaria. */
export const amountText = (planck: bigint) => formatLunes(planck).replace(/(,\d*?)0+$/, '$1').replace(/,$/, '').replace(/\./g, '');

const normalize = (address: string) => {
  const d = decodeSs58(address);
  return d.ok ? encodeSs58(d.publicKey, LUNES_SS58_PREFIX) : address.trim();
};

/** Endereço na folha Receber, numa linha só como no design (`lunes:3P8xK2mVt9…dE4hQ7nM`). O completo vai no QR e no copiar. */
export const receiveAddressLabel = (address: string) => lunesUri(address.length > 20 ? `${address.slice(0, 10)}…${address.slice(-8)}` : address);

export interface TransferRow { icon: IconName; title: string; detail: string; value: string }

/**
 * Transferência deste aparelho como a primeira linha da atividade (design: a linha nova entra no topo do
 * histórico depois de Concluir). Título e status reais do registro; valor com "−" (sem sinal se falhou, nada saiu).
 * Some quando já está confirmada e o indexador já devolveu a mesma saída (mesmo bloco e valor), ou quando é mais
 * antiga que tudo o que o histórico listou: fica só a do histórico.
 */
export function transferRow(record: WalletTransferRecord, moves: readonly LunesMove[], t: Tr = tGlobal): TransferRow | null {
  const value = BigInt(record.value);
  if (record.status === 'finalized' && record.block) {
    const n = record.block.number;
    // Já listada pelo indexador, ou mais antiga que todas as linhas lidas (está nas páginas antigas do histórico).
    if (moves.some(m => m.direction === 'out' && m.block === n && m.amount === value)) return null;
    if (moves.length && n < Math.min(...moves.map(m => m.block))) return null;
  }
  const to = record.dest.length > 12 ? `${record.dest.slice(0, 6)}…${record.dest.slice(-4)}` : record.dest;
  const failed = record.status === 'failed';
  return {
    icon: failed ? 'error' : 'arrow_upward',
    title: t('wallet.sentTo', { to }),
    detail: t(`ownWallet.status.${record.status}` as Key),
    value: `${failed ? '' : '−'}${formatLunes(value)}`,
  };
}
