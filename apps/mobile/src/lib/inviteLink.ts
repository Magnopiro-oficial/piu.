/**
 * Convite por link (TypeScript puro, testado no Node).
 *
 * O link leva o MESMO cartão de contato do QR de "Meu código" (messaging/card.ts: `piu1:…`, chaves
 * públicas e nome assinados pela chave de quem convida, uso único, 24 h), dentro de
 * `piu://invite/accept?c=<cartão>`. O scheme `piu` está em app.json; quem tem o Piu instalado abre o
 * link direto na tela de aceitar. O cartão também é aceito colado em "Adicionar contato".
 *
 * Links das lojas: `expo.extra.storeLinks.ios` / `.android` em app.json. Vazios até o app ser
 * publicado: o texto pede o instalador a quem convidou e explica como colar o convite se o link não abrir.
 */
import { CARD_PREFIX } from '../messaging/card';
import { tIn, type Key, type Lang } from '../i18n/core';
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
/**
 * Texto do convite compartilhado. Viaja para outra pessoa, então sai no idioma de quem envia (`lang`;
 * padrão pt-BR). Os textos ficam no dicionário (src/i18n, chaves `inviteText.*`).
 */
export function inviteShareText(o: { name: string; link: string; store: StoreLinks }, lang: Lang = 'pt-BR'): string {
  const t = (k: Key, vars?: Record<string, string | number>) => tIn(lang, k, vars);
  const named = !!o.name && o.name !== 'Você' && o.name !== tIn(lang, 'common.you');
  const who = named ? t('inviteText.who', { name: o.name }) : t('inviteText.anonWho');
  const lines = [who, '', t('inviteText.open'), o.link,
    // Muitos apps não tornam `piu://` clicável e o navegador faz uma busca com ele.
    '', t('inviteText.fallback')];
  lines.push('', t('inviteText.noApp'));
  if (hasStoreLinks(o.store)) {
    if (o.store.android) lines.push(`Android: ${o.store.android}`);
    if (o.store.ios) lines.push(`iPhone: ${o.store.ios}`);
  } else {
    // Antes das lojas, o instalador só vem de quem já tem o app.
    const from = named ? o.name : t('inviteText.inviter');
    lines.push(t('inviteText.notInStores', { from }));
  }
  return lines.join('\n');
}

/** 4 palavras da chave de assinatura de quem convida (iguais nas telas dos dois lados). */
export const inviteWords = (signPk: Uint8Array) => codeWords(hash(new Uint8Array([...utf8('piu/v0/invite-code'), ...signPk])).slice(0, 8));

/** Impressão digital em blocos de 4, como em `fingerprintOf` (state/keys.tsx), a partir do id `piu:…`. */
export const fingerprintOfId = (id: string) => id.slice(4).toUpperCase().match(/.{4}/g) ?? [];
