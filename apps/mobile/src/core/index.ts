/**
 * O núcleo real do processo (core/node.ts com as peças do app): transporte nativo, o que está salvo,
 * as chaves do cofre e as permissões já concedidas. `getCore` é o mesmo objeto para a tela e para a
 * tarefa sem tela; `bootCore` lê o salvo e liga, uma vez por processo.
 */
import { loadPersisted, persistNow, readPersisted } from '../lib/persist';
import { newNodeNameSecret } from '../lib/nodeName';
import { preloadedNodeKeyFor, preloadKeys } from '../state/keys';
import { checkTransportPermissions, getTransport, SERVICE_ID } from '../transport';
import { createCore, ensureNameSecret, persistedConfig, type Core, type PersistedBoot } from './node';

let core: Core | null = null;

async function load(): Promise<PersistedBoot> {
  await Promise.all([loadPersisted(), preloadKeys()]);
  const t = getTransport();
  const wifi = t.lan?.available ? await t.lan.networkInfo().catch(() => null) : null;
  const r = persistedConfig({ read: readPersisted, grants: await checkTransportPermissions(), nodeKeyFor: preloadedNodeKeyFor(), wifi, lanAvailable: !!t.lan?.available });
  // Sem segredo salvo, cria e grava um (o mesmo caminho da tela): o nome não muda ao abrir.
  if (!r.config.nameSecret && readPersisted<boolean>('onboarded') === true) r.config.nameSecret = await nodeNameSecret();
  return r;
}

/**
 * Único dono de `transport.nameSecret` (núcleo sem tela e TransportProvider, que chama ao terminar
 * o onboarding e a cada montagem): lê o salvo ou cria e grava um.
 */
export const nodeNameSecret = (): Promise<string> => ensureNameSecret({
  read: () => readPersisted('transport.nameSecret'),
  write: s => persistNow('transport.nameSecret', s),
  create: newNodeNameSecret,
});

export function getCore(): Core {
  return (core ??= createCore({ transport: getTransport(), serviceId: SERVICE_ID, load }));
}

export const bootCore = (): Promise<void> => getCore().boot();
