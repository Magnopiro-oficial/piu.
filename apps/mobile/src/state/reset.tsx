import { createContext, Fragment, useContext, useMemo, useState, type ReactNode } from 'react';
import { clearPersisted } from '../lib/persist';
import { wipeKeys } from './keys';

const Ctx = createContext<() => void>(() => {});

/**
 * "Apagar dados locais": remonta os provedores de estado (chaves, conversas, carteira, ajustes),
 * voltando tudo ao estado de primeira abertura, e apaga o que estava salvo no aparelho.
 */
export function ResetProvider({ children }: { children: ReactNode }) {
  const [epoch, setEpoch] = useState(0);
  // clearPersisted descarta as gravações pendentes na hora (parte síncrona) e apaga o armazenamento em seguida.
  const reset = useMemo(() => () => { void clearPersisted(); void wipeKeys(); setEpoch(e => e + 1); }, []);
  return <Ctx.Provider value={reset}><Fragment key={epoch}>{children}</Fragment></Ctx.Provider>;
}

export const useResetApp = () => useContext(Ctx);
