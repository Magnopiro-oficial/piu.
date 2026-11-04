/**
 * Convite por link (TypeScript puro, testado no Node).
 *
 * O link leva o MESMO cartão de contato do QR de "Meu código" (messaging/card.ts: `piu1:…`, chaves
 * públicas e nome assinados pela chave de quem convida, uso único, 24 h), dentro de
 * `piu://invite/accept?c=<cartão>`. O scheme `piu` está em app.json; quem tem o Piu instalado abre o
 * link direto na tela de aceitar. O cartão também é aceito colado em "Adicionar contato".
 *
 * Links das lojas: `expo.extra.storeLinks.ios` / `.android` em app.json. Vazios até o app ser
 * publicado: o texto de compartilhamento leva só o convite.
 */
import { CARD_PREFIX } from '../messaging/card';
import { utf8 } from '../protocol/bytes';
import { hash } from '../protocol/suite';
import { codeWords } from './migration';

export const INVITE_SCHEME = 'piu';
export const INVITE_PATH = 'invite/accept';

export interface StoreLinks { ios: string; android: string }

/** `piu://invite/accept?c=piu1%3A…` */
export const inviteLink = (card: string, scheme = INVITE_SCHEME) => `${scheme}://${INVITE_PATH}?c=${encodeURIComponent(card)}`;

/**
 * O cartão `piu1:…` de um texto: o próprio cartão, o link de convite (de qualquer scheme, como o
 * `exp://` do ambiente de desenvolvimento) ou uma mensagem que contenha o link. `null` se não houver.
 */
export function cardFromText(text: string): string | null {
  const t = text.trim();
  if (t.startsWith(CARD_PREFIX)) return t.split(/\s/)[0]!;
  const m = t.match(/[?&]c=([^&#\s]+)/);
  if (!m) return null;
  let v: string;
  try { v = decodeURIComponent(m[1]!); } catch { return null; }
  return v.startsWith(CARD_PREFIX) ? v : null;
}

/** Só `https://` vira link de loja; o resto (vazio, outro protocolo) é tratado como ausente. */
export function storeLinksFrom(extra: unknown): StoreLinks {
  const s = (extra && typeof extra === 'object' ? (extra as { storeLinks?: unknown }).storeLinks : null) as Record<string, unknown> | null;
  const ok = (v: unknown) => (typeof v === 'string' && /^https:\/\/\S+$/.test(v.trim()) ? v.trim() : '');
  return { ios: ok(s?.ios), android: ok(s?.android) };
}

export const hasStoreLinks = (l: StoreLinks) => !!(l.ios || l.android);

/** Texto para o Share do sistema: quem convida, o link e, se houver, onde baixar o app. */
export function inviteShareText(o: { name: string; link: string; store: StoreLinks }): string {
  const who = o.name && o.name !== 'Você' ? `${o.name} convidou você para conversar no Piu.` : 'Você foi convidado para conversar no Piu.';
  const lines = [who, '', `Com o Piu instalado, abra este convite (vale uma vez, por 24 h):`, o.link];
  if (hasStoreLinks(o.store)) {
    lines.push('', 'Ainda não tem o Piu?');
    if (o.store.android) lines.push(`Android: ${o.store.android}`);
    if (o.store.ios) lines.push(`iPhone: ${o.store.ios}`);
  }
  return lines.join('\n');
}

/** 4 palavras da chave de assinatura de quem convida (iguais nas telas dos dois lados). */
export const inviteWords = (signPk: Uint8Array) => codeWords(hash(new Uint8Array([...utf8('piu/v0/invite-code'), ...signPk])).slice(0, 8));

/** Impressão digital em blocos de 4, como em `fingerprintOf` (state/keys.tsx), a partir do id `piu:…`. */
export const fingerprintOfId = (id: string) => id.slice(4).toUpperCase().match(/.{4}/g) ?? [];
