import Constants from 'expo-constants';
import { useMemo } from 'react';
import { fingerprintOf, useKeys } from '../state/keys';
import { useStore } from '../state/store';
import { inviteWords, type StoreLinks, storeLinksFrom } from './inviteLink';

/**
 * Quem convida, para as telas do convite: o nome do perfil público (ou "Você", na identidade
 * anônima), a impressão digital da chave em uso e 4 palavras derivadas dela (lib/inviteLink.ts; a
 * pessoa convidada vê as mesmas, calculadas do cartão recebido). Nada fixo de exemplo.
 */
export function useInviter(): { name: string; initial: string; words: string[]; fp: string[] | null } {
  const { profile, identity } = useStore();
  const me = useKeys().identities?.[identity];
  return useMemo(() => {
    const pub = identity === 'public' && profile.name.trim();
    const name = pub ? profile.name.trim() : 'Você';
    const fp = me ? fingerprintOf(me) : null;
    const words = me ? inviteWords(me.signPk) : ['…', '…', '…', '…'];
    return { name, initial: name.slice(0, 1).toUpperCase(), words, fp };
  }, [identity, profile.name, me]);
}

/** Links das lojas (`expo.extra.storeLinks` em app.json). Vazios até o app ser publicado. */
export const STORE_LINKS: StoreLinks = storeLinksFrom(Constants.expoConfig?.extra);

/** Scheme do app (`expo.scheme` em app.json), para o link do convite. */
export const APP_SCHEME = (() => {
  const s: unknown = Constants.expoConfig?.scheme;
  const v = Array.isArray(s) ? s[0] : s;
  return typeof v === 'string' && /^[a-z][a-z0-9+.-]*$/.test(v) ? v : 'piu';
})();
