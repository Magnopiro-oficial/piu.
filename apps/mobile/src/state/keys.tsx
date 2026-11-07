import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { deriveIdentity, deriveNodeKey, type Identity, isValidPhrase, type KeyPair, newPhrase } from '../protocol';
import { derivePhoneOperatorKey } from '../protocol/phoneNode';
import { checkRestore } from '../lib/identityGuard';
import { readPersisted } from '../lib/persist';
import { bootVault, type DailyKeys, recoverPhrase, storePhrase, type Unlock, unlockPhrase, wipeVault } from '../lib/phraseVault';
import { fromHex, vaultDeps, vaultIsSecure } from '../lib/vault';
import { t } from '../i18n/core';

/** Impressão digital exibida: o id da identidade em 8 grupos de 4 (ex.: 7F3A 91C2 …). */
export const fingerprintOf = (i: Identity) => i.id.slice(4).toUpperCase().match(/.{4}/g)!;

interface Keys {
  /** Há identidade neste aparelho (as chaves do dia foram lidas). */
  hasKeys: boolean;
  identities: { public: Identity; anon: Identity } | null;
  nodePk: Uint8Array | null;
  /** Chave técnica do nó de hoje (assina recibos de retransmissão). */
  node: KeyPair | null;
  /**
   * Chave técnica do nó de um dia (dias UTC desde 1970). Gira por dia para não ligar anúncios e
   * recibos ao mesmo aparelho (LNNP §12.1). Sempre a mesma para o mesmo dia e a mesma frase.
   */
  nodeKeyFor: ((day: number) => KeyPair) | null;
  /**
   * Chave de operador do celular (modo nó, docs/economia/no-celular.md): rótulo próprio, sem ligação
   * com as identidades, o nó do dia ou a carteira. Sai da semente (sem biometria), para o segundo plano.
   */
  phoneOperator: KeyPair | null;
  /** Endereço da carteira própria (público, guardado com as chaves do dia). Null na web. */
  walletAddress: string | null;
  vaultIsSecure: boolean;
  /**
   * Frase de recuperação, lida do cofre só agora (B-01): revelar o backup, assinar na carteira ou
   * transferir para outro aparelho. Pede a biometria do sistema (ou o bloqueio do aparelho, enquanto a
   * frase não foi movida para o item com biometria). `recover`: abrir `/vault-recover`.
   * Nunca guarde o resultado no estado: use e descarte.
   */
  unlockPhrase: (prompt: string, o?: { allowWithoutLock?: boolean }) => Promise<Unlock>;
  /** A frase ficou ilegível (biometria trocada): aceita só a frase desta identidade. */
  recoverPhrase: (words: string[]) => Promise<boolean>;
  /** Gera uma frase nova e guarda no cofre. */
  create: () => Promise<void>;
  /**
   * Restaura pela frase (já validada). Nunca troca uma frase diferente que já está no cofre
   * (lança `PhraseExistsError`), a não ser com `replace`, posto só depois do diálogo de confirmação.
   * `known`: a pessoa digitou a frase ou abriu o arquivo de backup (tem cópia fora do aparelho).
   */
  restore: (words: string[], o?: { replace?: boolean; known?: boolean }) => Promise<void>;
}

const Ctx = createContext<Keys | null>(null);

let preloaded: DailyKeys | null = null;
/** Lido antes do splash sumir (junto com os outros dados salvos). Nunca pede biometria. */
export async function preloadKeys() { preloaded = await bootVault(vaultDeps).catch(() => null); }
/** "Apagar dados locais". */
export async function wipeKeys() { preloaded = null; await wipeVault(vaultDeps); }

/** Índice da chave do nó: o dia UTC. */
export const nodeDayOf = (ms: number) => Math.floor(ms / 86_400_000);

function derive(seedHex: string) {
  const seed = fromHex(seedHex);
  const cache = new Map<number, KeyPair>();
  const nodeKeyFor = (day: number) => {
    let k = cache.get(day);
    if (!k) { k = deriveNodeKey(seed, day); cache.set(day, k); while (cache.size > 4) cache.delete(cache.keys().next().value!); }
    return k;
  };
  const node = nodeKeyFor(nodeDayOf(Date.now()));
  return { identities: { public: deriveIdentity(seed, 'public'), anon: deriveIdentity(seed, 'anon') }, node, nodePk: node.pk, nodeKeyFor, phoneOperator: derivePhoneOperatorKey(seed) };
}

const validSeed = (k: DailyKeys | null) => (k && /^[0-9a-f]{64}$/.test(k.seed) ? k : null);

/**
 * Chaves reais do aparelho. Tudo deriva da frase de recuperação, mas o app só guarda na memória a
 * semente do Piu (identidades e nó) e o endereço da carteira; a frase é lida do cofre só na hora.
 */
export function KeysProvider({ children }: { children: ReactNode }) {
  const [keys, setKeys] = useState<DailyKeys | null>(() => validSeed(preloaded));
  const derived = useMemo(() => (keys ? derive(keys.seed) : null), [keys?.seed]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo<Keys>(() => {
    const save = async (w: string[], known: boolean) => { const k = await storePhrase(vaultDeps, w, { known }); preloaded = k; setKeys(k); };
    return {
      hasKeys: !!keys,
      identities: derived?.identities ?? null,
      nodePk: derived?.nodePk ?? null,
      node: derived?.node ?? null,
      nodeKeyFor: derived?.nodeKeyFor ?? null,
      phoneOperator: derived?.phoneOperator ?? null,
      walletAddress: keys?.wallet ?? null,
      vaultIsSecure,
      unlockPhrase: (prompt, o) => unlockPhrase(vaultDeps, {
        prompt, protectPrompt: t('vault.protectPrompt'),
        // Backup concluído = a frase existe fora do aparelho (papel conferido ou arquivo cifrado).
        backedUp: readPersisted<boolean>('set.backupDone') === true,
        allowWithoutLock: o?.allowWithoutLock,
      }),
      recoverPhrase: async words => {
        const ok = await recoverPhrase(vaultDeps, words.map(x => x.trim().toLowerCase()));
        if (ok) { preloaded = await bootVault(vaultDeps); if (preloaded) setKeys(preloaded); }
        return ok;
      },
      create: async () => { await save(newPhrase(), false); },
      restore: async (words, o) => {
        const w = words.map(x => x.trim().toLowerCase());
        if (!isValidPhrase(w)) throw new Error('Frase inválida.');
        // `preloaded` acompanha o cofre (lido na abertura, gravado a cada troca, zerado em "Apagar dados").
        // Compara pela semente: a frase em si não fica mais na memória.
        const cur = validSeed(preloaded);
        checkRestore(cur ? [cur.seed] : null, [vaultDeps.seedOf(w)], o);
        await save(w, !!o?.known);
      },
    };
  }, [keys, derived]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useKeys(): Keys {
  const k = useContext(Ctx);
  if (!k) throw new Error('useKeys fora de KeysProvider');
  return k;
}
