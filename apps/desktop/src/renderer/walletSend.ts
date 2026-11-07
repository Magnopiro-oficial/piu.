/**
 * Lógica pura dos painéis Enviar/Receber da Carteira (portada de design/handoff/docs/reference-code/desktop-wallet.js),
 * sem DOM nem React, para ser testada em Node. Diferenças de honestidade em relação ao protótipo:
 * - os destinatários vêm dos contatos reais que tenham endereço Lunes (não de uma lista fixa): até 3 deles
 *   e sempre um "Outro" que abre o campo de endereço, somando os 4 lugares do protótipo;
 * - a taxa é a estimativa real de `balances.transfer_keep_alive` na Lunes, não "0,01";
 * - o selo da linha de movimentação é o estado real do pedido no diário de pagamentos.
 */
import { decodeSs58 } from '../../../mobile/src/lib/ss58';
// `tr` (= t): aqui `t` já é o nome do endereço digitado em sendModel.
import { fmtNumber, type Key, t as tr } from '../shared/i18n';
import type { DesktopPaymentStatus } from '../shared/paymentTypes';
import type { ContactInfo } from '../shared/types';

/** Chips do protótipo, nesta ordem. */
export const QUICK_AMOUNTS = [1, 5, 10, 25] as const;
/**
 * Taxa de `balances.transfer_keep_alive` observada na Lunes Mainnet (~0,00144 LUNES). O Desktop não monta
 * a extrínseca (quem assina é o celular), então não há `payment_queryInfo` aqui; a taxa exata aparece no
 * celular na hora de autorizar.
 */
export const FEE_ESTIMATE_LUNES = 0.00144;
/** Id do avatar "Outro" (endereço digitado). */
export const OTHER_ID = 'other';

/** `fmt` do protótipo: duas casas, vírgula decimal, ponto de milhar (em pt-BR; segue idioma e região). */
export const fmtLunes = (n: number) => fmtNumber(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** planck (texto, vindo da ponte) → LUNES como número, só para exibir (1 LUNES = 10^8 planck). */
export const planckToNumber = (p: string | null) => (p ? Number(BigInt(p)) / 1e8 : 0);
/** `lunes:7f3a91c2…a912c19e` do protótipo: 8 iniciais, reticências, 8 finais. */
export const shortLunesAddr = (a: string) => `${a.slice(0, 8)}…${a.slice(-8)}`;
/** Endereço do topo da página, como no protótipo (`lunes:7f3a…c19e`): 4 iniciais, reticências, 4 finais. */
export const headerLunesAddr = (a: string) => `lunes:${a.slice(0, 4)}…${a.slice(-4)}`;
/** Endereço digitado/colado em "Outro": sem espaços e sem o prefixo `lunes:` (o mesmo que o QR do Receber mostra). */
export const cleanLunesAddr = (v: string) => v.trim().replace(/^lunes:/i, '').trim();

export const sanitizeAmount = (v: string) => v.replace(/[^0-9,.]/g, '');
export const parseAmount = (v: string) => parseFloat(String(v).replace(',', '.')) || 0;

export interface Recipient { id: string; ini: string; first: string; name: string; address: string | null }

const initials = (name: string) => {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  return words.map(w => w[0]!).slice(0, 2).join('').toUpperCase() || '?';
};

/** Contatos com endereço que cabem na linha de avatares: 3 + "Outro" = os 4 lugares do protótipo. */
export const MAX_CONTACT_RECIPIENTS = 3;

/**
 * Até 3 contatos diretos aceitos que tenham endereço Lunes conhecido (o que o contato compartilhou pela malha
 * ou o espelho do celular trouxe), mais "Outro" (sempre presente). Nada de nomes inventados: sem contato com
 * endereço, a lista é só "Outro". `prefer` (o contato da conversa que pediu o pagamento, ou o escolhido) entra
 * na frente se estiver além dos 3 primeiros, para nunca sumir da linha.
 */
export function recipientsFrom(contacts: ContactInfo[], prefer?: string | null): Recipient[] {
  let valid = contacts.filter(c => c.lunesAddress && !c.request && (c.kind ?? 'direct') === 'direct' && decodeSs58(c.lunesAddress).ok);
  const pi = prefer ? valid.findIndex(c => c.id === prefer) : -1;
  if (pi >= MAX_CONTACT_RECIPIENTS) valid = [valid[pi]!, ...valid.filter((_, i) => i !== pi)];
  const real = valid
    .slice(0, MAX_CONTACT_RECIPIENTS)
    .map(c => ({ id: c.id, ini: initials(c.name), first: c.name.trim().split(/\s+/)[0] || c.name, name: c.name, address: c.lunesAddress! }));
  return [...real, { id: OTHER_ID, ini: '…', first: tr('wallet.other.first'), name: tr('wallet.other.name'), address: null }];
}

/** `balance` null = saldo ainda não lido na Mainnet (não dá para comparar nem enviar). */
export interface SendInput { recipients: Recipient[]; to: string; other: string; amount: string; balance: number | null; hidden: boolean }

/** `sendModel` do protótipo com os dados reais. `dest` é o endereço que vai para o celular (ou null se inválido). */
export function sendModel(s: SendInput) {
  const amt = parseAmount(s.amount);
  const r = s.recipients.find(x => x.id === s.to) ?? s.recipients[0]!;
  let dest: string | null = r.address;
  let destError: string | null = null;
  if (r.id === OTHER_ID) {
    const t = cleanLunesAddr(s.other), valid = !!t && decodeSs58(t).ok;
    dest = valid ? t : null;
    if (t && !valid) destError = tr('wallet.err.badAddress');
  }
  const toLabel = r.id === OTHER_ID ? (dest ? shortLunesAddr(dest) : '—') : r.name;
  const over = s.balance != null && amt > s.balance;
  const ok = amt > 0 && s.balance != null && !over && !!dest;
  return {
    amt, dest, destError, toLabel, ok,
    quick: QUICK_AMOUNTS.map(n => ({ n, active: amt === n })),
    available: s.hidden ? '••••' : s.balance == null ? '—' : fmtLunes(s.balance),
    /** Linha "Disponível" do resumo: `{{ avail }} LUNES` do protótipo; sem leitura só "—" (nada de "— LUNES"). */
    availableText: s.hidden ? '•••• LUNES' : s.balance == null ? '—' : `${fmtLunes(s.balance)} LUNES`,
    fee: `≈ ${fmtNumber(FEE_ESTIMATE_LUNES, { maximumFractionDigits: 5 })} LUNES`,
    error: over ? tr('wallet.err.overBalance') : null,
    buttonOpacity: ok ? 1 : 0.35,
    sentLabel: tr('wallet.sentTo', { amount: fmtLunes(amt), name: toLabel }),
  };
}

/** As 14 partículas do sucesso: ângulo i/14·2π, raio 80+(i%3)·22, atraso (i%4)·0,03 s. */
export const burstParticles = () => Array.from({ length: 14 }, (_, i) => {
  const a = i / 14 * Math.PI * 2, r = 80 + (i % 3) * 22;
  return { x: `${Math.round(Math.cos(a) * r)}px`, y: `${Math.round(Math.sin(a) * r)}px`, delay: `${(i % 4) * 0.03}s` };
});

/** Selo da linha de movimentação: estado real do pedido (vazio quando finalizado, como o "na malha" que some no protótipo). */
export const statusBadge = (s: DesktopPaymentStatus): string => {
  const k = ({
    waiting: 'wallet.badge.waiting', review: 'wallet.badge.review', signed: 'wallet.badge.signed', submitted: 'wallet.badge.submitted', included: 'wallet.badge.included',
    finalized: null, failed: 'wallet.badge.failed', cancelled: 'wallet.badge.cancelled', unknown: 'wallet.badge.unknown',
  } satisfies Record<DesktopPaymentStatus, Key | null>)[s];
  return k ? tr(k) : '';
};

/** Título do estado do pedido para o painel. */
export const statusTitle = (s: DesktopPaymentStatus): string => tr(({
  waiting: 'wallet.state.waiting', review: 'wallet.state.review', signed: 'wallet.state.signed', submitted: 'wallet.state.submitted', included: 'wallet.state.included',
  finalized: 'wallet.state.finalized', failed: 'wallet.state.failed', cancelled: 'wallet.state.cancelled', unknown: 'wallet.state.unknown',
} satisfies Record<DesktopPaymentStatus, Key>)[s]);

/** O pedido já saiu de verdade (tem hash assinado pelo celular)? Só então o painel mostra o sucesso. */
export const paymentSent = (s: DesktopPaymentStatus) => ['signed', 'submitted', 'included', 'finalized'].includes(s);
