import { createContext, Fragment, useContext, useMemo, useState, type ReactNode } from 'react';
import { clearPersisted } from '../lib/persist';
import { clearPickerCache } from '../lib/pickFile';
import { wipeKeys } from './keys';

const Ctx = createContext<() => void>(() => {});

/**
 * "Apagar dados locais": remonta os provedores de estado (chaves, conversas, carteira, ajustes),
 * voltando tudo ao estado de primeira abertura, e apaga o que estava salvo no aparelho.
 */
export function ResetProvider({ children }: { children: ReactNode }) {
  const [epoch, setEpoch] = useState(0);
  // clearPersisted descarta as gravações pendentes na hora (parte síncrona) e apaga o armazenamento em seguida.
  // wipeKeys apaga todo o cofre do sistema (lib/phraseVault.ts); clearPickerCache, as cópias em claro de fotos e documentos.
  const reset = useMemo(() => () => { void clearPersisted(); void wipeKeys(); clearPickerCache(); setEpoch(e => e + 1); }, []);
  return <Ctx.Provider value={reset}><Fragment key={epoch}>{children}</Fragment></Ctx.Provider>;
}

export const useResetApp = () => useContext(Ctx);
