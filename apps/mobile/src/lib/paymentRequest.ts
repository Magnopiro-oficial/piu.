/**
 * Pedido de pagamento pela malha (regra 7.3 do mapa de regras, adaptada à decisão de produto: o Piu
 * não guarda chave Lunes nem envia LUNES). Quem pede manda, cifrado na sessão, o endereço Lunes dele,
 * o valor (opcional) e uma descrição curta; quem recebe paga pela própria carteira Lunes. A conferência
 * é só leitura na Mainnet (lib/lunesRpc.ts): saldo que subiu ou transferência para o endereço do pedido
 * dentro de um bloco finalizado.
 *
 * TypeScript puro, testado no Node (`__tests__/paymentRequest.test.ts`).
 */
import { random } from '../protocol/suite';
import { toHex } from '../protocol/bytes';
import { stripBidi } from '../messaging/bidi';
import { decodeSignedTransfer } from './extrinsic';
import { checkSettlement, formatLunes, fromHex, isHash, LUNES_DECIMALS, type LunesRpc, type SettlementCheck } from './lunesRpc';
import { decodeSs58 } from './ss58';
import { t as tGlobal, type Key, type Vars } from '../i18n/core';
/** Tradutor opcional (padrão: idioma em uso no app; pt-BR nos testes). */
type Tr = (key: Key, vars?: Vars) => string;

/** Validade do pedido: 7 dias (como o convite de grupo). */
export const PAY_REQUEST_TTL_SEC = 7 * 86400;
/** Folga para relógios diferentes ao conferir a validade recebida. */
const CLOCK_SLACK_SEC = 3600;
/** Descrição curta: até 80 caracteres (contados por caractere, não por byte). */
export const MAX_PAY_DESC = 80;
/** Teto do valor: 1 bilhão de LUNES em planck (acima disso é erro de digitação). */
export const MAX_PAY_PLANCK = 1_000_000_000n * 10n ** BigInt(LUNES_DECIMALS);

export interface PaymentRequest {
  /** 16 hex, único; é também o id da mensagem na conversa. */
  id: string;
  /** Endereço Lunes (SS58) de quem pede. */
  address: string;
  /** Valor em planck (8 casas); `null` = pedido sem valor fixo. */
  planck: bigint | null;
  desc: string;
  /** Segundos. */
  createdAt: number;
  expiresAt: number;
}

/** Payload dentro da sessão: curto de propósito (cada byte conta em LoRa e Bluetooth). */
export interface WirePayRequest { t: 'pq'; i: string; a: string; v?: string; d: string; u: number }
/** "Já paguei": id do pedido e, se a pessoa informar, hash da transação e do bloco (0x + 64 hex). */
export interface WirePaidNotice { t: 'pd'; i: string; h?: string; b?: string }
export interface PaidNotice { id: string; txHash?: string; blockHash?: string }

const ID_RE = /^[0-9a-f]{16}$/;
const PLANCK_RE = /^[1-9][0-9]{0,26}$/;

/** Espaços e caracteres de controle viram um espaço só; controles bidi saem (B-07); corta nas pontas. */
const cleanDesc = (s: string) => stripBidi(s).replace(/[\s\p{Cc}]+/gu, ' ').trim();

/**
 * "1,5", "1.5", "1.234,5" ou "0,00000001" → planck. `null` quando vazio, zero, negativo, com mais de 8
 * casas ou acima do teto. Sem ponto flutuante: a conversão é por texto.
 */
export function parseLunesAmount(text: string): bigint | null {
  const s = text.replace(/\s/g, '');
  if (!s) return null;
  // Último separador é o decimal; os anteriores só podem ser de milhar (grupos de 3).
  const m = /^(\d[\d.]*|\d+)(?:[,.](\d{1,8}))?$/.exec(s);
  if (!m) return null;
  let int = m[1]!;
  const frac = m[2] ?? '';
  if (int.includes('.')) {
    // Ex.: "1.234" (milhar) ou "1.5" (decimal, quando não houve vírgula): só o segundo caso quando o
    // grupo final não tem 3 dígitos.
    const parts = int.split('.');
    const groupsOk = parts.slice(1).every(p => p.length === 3) && parts[0]!.length >= 1;
    if (!frac && parts.length === 2 && parts[1]!.length !== 3) return parseLunesAmount(`${parts[0]},${parts[1]}`);
    if (!groupsOk) return null;
    int = parts.join('');
  }
  if (!/^\d+$/.test(int)) return null;
  const planck = BigInt(int) * 10n ** BigInt(LUNES_DECIMALS) + BigInt(frac.padEnd(LUNES_DECIMALS, '0'));
  if (planck <= 0n || planck > MAX_PAY_PLANCK) return null;
  return planck;
}

/**
 * Monta um pedido a partir do que a pessoa digitou. Lança erro em português. `address`: o endereço
 * salvo na Carteira (sem ele, pede para salvar primeiro).
 */
export function newPayRequest(o: { address: string | null | undefined; amount: string; desc: string; now: number; id?: string }, t: Tr = tGlobal): PaymentRequest {
  if (!o.address) throw new Error(t('pay.err.noAddress'));
  const addr = decodeSs58(o.address);
  if (!addr.ok) throw new Error(addr.error);
  const amount = o.amount.trim();
  const planck = amount ? parseLunesAmount(amount) : null;
  if (amount && planck == null) throw new Error(t('pay.err.amount'));
  const desc = cleanDesc(o.desc);
  if ([...desc].length > MAX_PAY_DESC) throw new Error(t('pay.err.descLong', { max: MAX_PAY_DESC }));
  if (!planck && !desc) throw new Error(t('pay.err.empty'));
  const id = o.id ?? toHex(random(8));
  if (!ID_RE.test(id)) throw new Error(t('pay.err.id'));
  const now = Math.floor(o.now);
  return { id, address: o.address.trim(), planck, desc, createdAt: now, expiresAt: now + PAY_REQUEST_TTL_SEC };
}

/** Pedido → payload `pq`. O valor vai como texto decimal (JSON não guarda BigInt). */
export function wirePayRequest(r: PaymentRequest): WirePayRequest {
  const w: WirePayRequest = { t: 'pq', i: r.id, a: r.address, d: r.desc, u: r.expiresAt };
  if (r.planck != null) w.v = r.planck.toString();
  return w;
}

/**
 * Lê um payload `pq` recebido; `null` se algo não confere (versões antigas e lixo são descartados sem
 * erro). Descrição longa é recusada (não cortada): o remetente deste app nunca manda mais que 80.
 */
export function readPayRequest(v: unknown, now: number): PaymentRequest | null {
  if (!v || typeof v !== 'object') return null;
  const w = v as Partial<WirePayRequest>;
  if (w.t !== 'pq' || typeof w.i !== 'string' || !ID_RE.test(w.i)) return null;
  if (typeof w.a !== 'string' || !decodeSs58(w.a).ok) return null;
  let planck: bigint | null = null;
  if (w.v !== undefined) {
    if (typeof w.v !== 'string' || !PLANCK_RE.test(w.v)) return null;
    planck = BigInt(w.v);
    if (planck > MAX_PAY_PLANCK) return null;
  }
  if (typeof w.d !== 'string') return null;
  const desc = cleanDesc(w.d);
  if ([...desc].length > MAX_PAY_DESC) return null;
  if (!planck && !desc) return null;
  if (typeof w.u !== 'number' || !Number.isInteger(w.u)) return null;
  if (w.u <= now || w.u > now + PAY_REQUEST_TTL_SEC + CLOCK_SLACK_SEC) return null;
  return { id: w.i, address: w.a.trim(), planck, desc, createdAt: Math.floor(now), expiresAt: w.u };
}

/** Lê um aviso `pd`; hash torto derruba o aviso inteiro (melhor nada que um hash errado). */
export function readPaidNotice(v: unknown): PaidNotice | null {
  if (!v || typeof v !== 'object') return null;
  const w = v as Partial<WirePaidNotice>;
  if (w.t !== 'pd' || typeof w.i !== 'string' || !ID_RE.test(w.i)) return null;
  const out: PaidNotice = { id: w.i };
  if (w.h !== undefined) { if (typeof w.h !== 'string' || !isHash(w.h)) return null; out.txHash = w.h.toLowerCase(); }
  if (w.b !== undefined) { if (typeof w.b !== 'string' || !isHash(w.b)) return null; out.blockHash = w.b.toLowerCase(); }
  return out;
}

export function wirePaidNotice(n: PaidNotice): WirePaidNotice {
  const w: WirePaidNotice = { t: 'pd', i: n.id };
  if (n.txHash) w.h = n.txHash;
  if (n.blockHash) w.b = n.blockHash;
  return w;
}

/** "Pedido de pagamento · 1,50 LUNES · Almoço" (lista de conversas, banners, versões sem o balão). */
export function payRequestSummary(r: Pick<PaymentRequest, 'planck' | 'desc'>, t: Tr = tGlobal): string {
  return [t('chat.pay.request'), r.planck != null ? `${formatLunes(r.planck)} LUNES` : '', r.desc].filter(Boolean).join(' · ');
}

/**
 * Conferência da transação que o pagador informou. O hash sozinho não prova nada (qualquer transação
 * finalizada da rede tem um): `extrinsic` traz os bytes achados no bloco, para conferir destino e valor,
 * e `executed` diz se a execução deu certo (indexador, como `readWalletExecution`; `null` = não comprovada).
 */
export interface PaymentTxCheck extends SettlementCheck { extrinsic?: string | null; executed?: boolean | null }

/** `checkSettlement` mais os bytes do extrínseco encontrado (`null` se o bloco ou a transação não apareceram). */
export async function checkPaymentTx(rpc: LunesRpc, o: { blockHash: string; txHash?: string }): Promise<PaymentTxCheck> {
  const c = await checkSettlement(rpc, o);
  if (c.txIndex == null || c.txIndex < 0) return { ...c, extrinsic: null };
  const b = await rpc.call<{ block: { extrinsics: string[] } } | null>('chain_getBlock', [o.blockHash]);
  return { ...c, extrinsic: b?.block.extrinsics[c.txIndex] ?? null };
}

/** A transação achada é uma transferência executada para o endereço do pedido, de valor suficiente? */
function txPays(tx: PaymentTxCheck, address: string | undefined, planck: bigint | null): boolean {
  if (tx.txIndex == null || tx.txIndex < 0 || !tx.extrinsic || tx.executed !== true || !address) return false;
  const to = decodeSs58(address);
  if (!to.ok) return false;
  let transfer: ReturnType<typeof decodeSignedTransfer>;
  try { transfer = decodeSignedTransfer(fromHex(tx.extrinsic)); } catch { return false; }
  if (!transfer || transfer.dest.length !== to.publicKey.length || !transfer.dest.every((x, i) => x === to.publicKey[i])) return false;
  return transfer.value > 0n && (planck == null || transfer.value >= planck);
}

export type PaymentJudgement =
  /** Prova real: o saldo subiu o valor pedido (ou qualquer entrada, sem valor) ou há uma transferência para o endereço do pedido num bloco finalizado. */
  | { state: 'recebido'; via: 'saldo'; delta: bigint }
  | { state: 'recebido'; via: 'transacao'; block: number }
  /** Entrou menos que o pedido. */
  | { state: 'parcial'; delta: bigint }
  /** O saldo não subiu. */
  | { state: 'nada' }
  /** Não dá para concluir: sem leitura anterior do saldo, bloco desconhecido, transação fora do bloco (ou que não confere com o pedido) ou ainda não finalizada. */
  | { state: 'indeterminado'; reason: 'sem-base' | 'bloco-ausente' | 'transacao-ausente' | 'nao-finalizado' };

/**
 * Julga a conferência. `baseline`: saldo livre quando o pedido foi criado (null se nunca lido);
 * `free`: saldo livre agora; `address`: endereço do pedido; `tx`: resultado de `checkPaymentTx` quando a
 * pessoa informou os hashes. Nunca diz "recebido" sem prova: o saldo pode subir por outro motivo, mas
 * isso é dinheiro real na conta. Já a transação informada vem do pagador: só vale se for uma transferência
 * executada para `address`, de valor igual ou maior que o pedido (sem isso, fica o que o saldo disser).
 */
export function judgePayment(o: { planck: bigint | null; baseline: bigint | null; free: bigint; address?: string; tx?: PaymentTxCheck }): PaymentJudgement {
  if (o.baseline != null) {
    const delta = o.free - o.baseline;
    if (delta > 0n && (o.planck == null || delta >= o.planck)) return { state: 'recebido', via: 'saldo', delta };
    if (!o.tx) return delta > 0n ? { state: 'parcial', delta } : { state: 'nada' };
  }
  if (o.tx) {
    if (!o.tx.blockFound || o.tx.blockNumber == null) return { state: 'indeterminado', reason: 'bloco-ausente' };
    if (o.tx.txIndex != null && o.tx.txIndex < 0) return { state: 'indeterminado', reason: 'transacao-ausente' };
    if (!o.tx.finalized) return { state: 'indeterminado', reason: 'nao-finalizado' };
    if (txPays(o.tx, o.address, o.planck)) return { state: 'recebido', via: 'transacao', block: o.tx.blockNumber };
    // Existe, mas não é prova deste pedido (outro destino, valor menor, falhou ou não deu para conferir).
    if (o.baseline == null) return { state: 'indeterminado', reason: 'transacao-ausente' };
    const delta = o.free - o.baseline;
    return delta > 0n ? { state: 'parcial', delta } : { state: 'nada' };
  }
  return { state: 'indeterminado', reason: 'sem-base' };
}

/** Texto da conferência para o balão (honesto: "recebido" só com prova; o resto diz o que faltou). */
export function judgementText(j: PaymentJudgement, t: Tr = tGlobal): string {
  switch (j.state) {
    case 'recebido': return j.via === 'saldo' ? t('pay.judge.received', { amount: formatLunes(j.delta) }) : t('pay.judge.tx', { block: j.block });
    case 'parcial': return t('pay.judge.partial', { amount: formatLunes(j.delta) });
    case 'nada': return t('pay.judge.nothing');
    case 'indeterminado':
      switch (j.reason) {
        case 'sem-base': return t('pay.judge.noBase');
        case 'bloco-ausente': return t('pay.judge.noBlock');
        case 'transacao-ausente': return t('pay.judge.noTx');
        case 'nao-finalizado': return t('pay.judge.notFinal');
      }
  }
}
