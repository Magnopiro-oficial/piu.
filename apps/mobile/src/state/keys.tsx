import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { deriveIdentity, deriveNodeKey, type Identity, isValidPhrase, newPhrase, seedFromPhrase } from '../protocol';
import { clearPhrase, loadPhrase, savePhrase, vaultIsSecure } from '../lib/vault';

/** Impressão digital exibida: o id da identidade em 8 grupos de 4 (ex.: 7F3A 91C2 …). */
export const fingerprintOf = (i: Identity) => i.id.slice(4).toUpperCase().match(/.{4}/g)!;

interface Keys {
  /** Frase de recuperação (null antes do onboarding). Sensível: mostrar só no backup. */
  phrase: string[] | null;
  identities: { public: Identity; anon: Identity } | null;
  nodePk: Uint8Array | null;
  vaultIsSecure: boolean;
  /** Gera uma frase nova e guarda no cofre. */
  create: () => Promise<void>;
  /** Restaura pela frase (já validada). */
  restore: (words: string[]) => Promise<void>;
}

const Ctx = createContext<Keys | null>(null);

let preloaded: string[] | null = null;
/** Lido antes do splash sumir (junto com os outros dados salvos). */
export async function preloadKeys() { preloaded = await loadPhrase(); }
/** "Apagar dados locais". */
export async function wipeKeys() { preloaded = null; await clearPhrase(); }

function derive(words: string[]) {
  const seed = seedFromPhrase(words);
  return { identities: { public: deriveIdentity(seed, 'public'), anon: deriveIdentity(seed, 'anon') }, nodePk: deriveNodeKey(seed).pk };
}

/** Chaves reais do aparelho: tudo deriva da frase de recuperação guardada no cofre do sistema. */
export function KeysProvider({ children }: { children: ReactNode }) {
  const [phrase, setPhrase] = useState<string[] | null>(() => (preloaded && isValidPhrase(preloaded) ? preloaded : null));
  const derived = useMemo(() => (phrase ? derive(phrase) : null), [phrase]);

  const value = useMemo<Keys>(() => ({
    phrase,
    identities: derived?.identities ?? null,
    nodePk: derived?.nodePk ?? null,
    vaultIsSecure,
    create: async () => { const w = newPhrase(); await savePhrase(w); preloaded = w; setPhrase(w); },
    restore: async words => {
      const w = words.map(x => x.trim().toLowerCase());
      if (!isValidPhrase(w)) throw new Error('Frase inválida.');
      await savePhrase(w); preloaded = w; setPhrase(w);
    },
  }), [phrase, derived]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useKeys(): Keys {
  const k = useContext(Ctx);
  if (!k) throw new Error('useKeys fora de KeysProvider');
  return k;
}
