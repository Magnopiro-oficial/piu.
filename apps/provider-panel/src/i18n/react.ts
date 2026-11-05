import { useSyncExternalStore } from 'react';
import { getLang, subscribe, t, type Lang } from './index';

/** Idioma atual; o componente renderiza de novo quando ele muda. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang);
}

/** `t` para componentes: além de traduzir, assina a troca de idioma. */
export function useT(): typeof t {
  useLang();
  return t;
}
