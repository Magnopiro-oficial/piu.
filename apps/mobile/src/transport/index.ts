import { createNativeTransport } from './native';
import { createSimulatedTransport } from './simulated';
import type { Transport } from './types';

let instance: Transport | null = null;

/** Um transporte por app: o nativo quando o módulo existe (development build), senão o simulado. */
export function getTransport(): Transport {
  if (!instance) instance = createNativeTransport() ?? createSimulatedTransport();
  return instance;
}

export { requestTransportPermissions } from './permissions';
export { MEDIA, rankLinks, SMALL_ENVELOPE_BYTES } from './select';
export * from './types';
