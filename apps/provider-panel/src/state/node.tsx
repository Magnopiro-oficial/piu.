import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AuthLost, detectNode, NodeApi, type Operator } from '../lib/api';

type Mode =
  | { kind: 'loading' }
  | { kind: 'demo' }
  | { kind: 'pair'; reason?: string }
  | { kind: 'node'; operator: Operator; api: NodeApi };

interface NodeCtx {
  mode: Mode;
  /** Pareamento concluído (ou sessão retomada). */
  enter: (operator: Operator, csrf: string) => void;
  /** Sessão perdida (401) ou logout: volta para o pareamento. */
  lost: (reason?: string) => void;
  /** Envolve chamadas à API: AuthLost vira volta ao pareamento. */
  guard: <T>(p: Promise<T>) => Promise<T>;
}

const Ctx = createContext<NodeCtx | null>(null);

/** Decide se o painel fala com um piu-node de verdade (sessão) ou roda como demonstração estática. */
export function NodeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>({ kind: 'loading' });
  useEffect(() => {
    let alive = true;
    detectNode().then(m => {
      if (!alive) return;
      setMode(m.kind === 'node' ? { kind: 'node', operator: m.operator, api: new NodeApi(m.csrf) } : m);
    });
    return () => { alive = false; };
  }, []);

  const lost = useCallback((reason?: string) => setMode({ kind: 'pair', reason }), []);
  const value = useMemo<NodeCtx>(() => ({
    mode,
    enter: (operator, csrf) => setMode({ kind: 'node', operator, api: new NodeApi(csrf) }),
    lost,
    guard: async p => {
      try { return await p; } catch (e) {
        if (e instanceof AuthLost) lost('Sua sessão terminou. Pareie de novo com o código do equipamento.');
        throw e;
      }
    },
  }), [mode, lost]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNode(): NodeCtx {
  const n = useContext(Ctx);
  if (!n) throw new Error('useNode fora de NodeProvider');
  return n;
}
