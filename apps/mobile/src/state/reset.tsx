import { createContext, Fragment, useContext, useMemo, useState, type ReactNode } from 'react';

const Ctx = createContext<() => void>(() => {});

/**
 * "Apagar dados locais": remonta os provedores de estado (chaves, conversas, carteira, ajustes),
 * voltando tudo ao estado de primeira abertura.
 */
export function ResetProvider({ children }: { children: ReactNode }) {
  const [epoch, setEpoch] = useState(0);
  const reset = useMemo(() => () => setEpoch(e => e + 1), []);
  return <Ctx.Provider value={reset}><Fragment key={epoch}>{children}</Fragment></Ctx.Provider>;
}

export const useResetApp = () => useContext(Ctx);
