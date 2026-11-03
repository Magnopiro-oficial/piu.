import { useMemo } from 'react';
import { utf8 } from '../protocol/bytes';
import { hash } from '../protocol/suite';
import { fingerprintOf, useKeys } from '../state/keys';
import { useStore } from '../state/store';
import { codeWords } from './migration';

/**
 * Quem convida, para as telas do convite: o nome do perfil público (ou "Você", na identidade
 * anônima), a impressão digital da chave em uso e 4 palavras derivadas dela (o mesmo em qualquer
 * tela deste aparelho; muda se a chave mudar). Nada fixo de exemplo.
 */
export function useInviter(): { name: string; initial: string; words: string[]; fp: string[] | null } {
  const { profile, identity } = useStore();
  const me = useKeys().identities?.[identity];
  return useMemo(() => {
    const pub = identity === 'public' && profile.name.trim();
    const name = pub ? profile.name.trim() : 'Você';
    const fp = me ? fingerprintOf(me) : null;
    const words = me ? codeWords(hash(new Uint8Array([...utf8('piu/v0/invite-code'), ...me.signPk])).slice(0, 8)) : ['…', '…', '…', '…'];
    return { name, initial: name.slice(0, 1).toUpperCase(), words, fp };
  }, [identity, profile.name, me]);
}
