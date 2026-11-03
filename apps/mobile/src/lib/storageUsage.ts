import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { receivedFiles } from '../state/messaging';
import { readPersisted } from './persist';
import { type StorageUse, storageBreakdown } from './storageCore';

/** Mesmo prefixo de `persist.ts` (VERSION = 1). */
const PREFIX = 'piu:v1:';

/** Mede o que o Piu guarda no aparelho (AsyncStorage, cifrado): só tamanhos, nada é exibido nem registrado. */
export async function measureStorage(o: { thirdPartyBytes?: number; creditsBytes?: number } = {}): Promise<StorageUse> {
  const keys = (await AsyncStorage.getAllKeys()).filter(k => k.startsWith(PREFIX));
  const pairs = await AsyncStorage.multiGet(keys);
  const entries = pairs.filter(([, v]) => v != null).map(([k, v]) => {
    const key = k.slice(PREFIX.length);
    return { key, diskBytes: k.length + v!.length, value: readPersisted<unknown>(key) ?? null };
  });
  return storageBreakdown(entries, o);
}

/** Arquivos recebidos que estão só na memória nesta execução (somem ao fechar o app). */
export function receivedCacheBytes(): number {
  let n = 0;
  for (const f of receivedFiles.values()) n += f.data.length;
  return n;
}

/** Libera os arquivos recebidos guardados na memória (o mesmo que acontece ao fechar o app). */
export function clearReceivedCache(): number {
  const n = receivedCacheBytes();
  receivedFiles.clear();
  return n;
}

/** Uso atual (mede ao abrir a tela e quando `refresh` é chamado). `null` enquanto mede. */
export function useStorageUsage(o: { thirdPartyBytes?: number; creditsBytes?: number } = {}): [StorageUse | null, () => void] {
  const [use, setUse] = useState<StorageUse | null>(null);
  const [tick, setTick] = useState(0);
  const { thirdPartyBytes, creditsBytes } = o;
  useEffect(() => {
    let alive = true;
    measureStorage({ thirdPartyBytes, creditsBytes })
      .then(u => { if (alive) setUse(u); })
      .catch(() => { if (alive) setUse({ total: 0, parts: [] }); });
    return () => { alive = false; };
  }, [tick, thirdPartyBytes, creditsBytes]);
  return [use, useCallback(() => setTick(t => t + 1), [])];
}
