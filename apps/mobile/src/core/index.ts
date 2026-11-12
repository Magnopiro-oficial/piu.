/**
 * O núcleo real do processo (core/node.ts com as peças do app): transporte nativo, o que está salvo,
 * as chaves do cofre e as permissões já concedidas. `getCore` é o mesmo objeto para a tela e para a
 * tarefa sem tela; `bootCore` lê o salvo e liga, uma vez por processo.
 * `getChatStore` (conversas) e `getMessengerRuntime` (mensageiro) também são um por processo.
 */
import { router, type Href } from 'expo-router';
import { AppState } from 'react-native';
import PiuVoice from '../../modules/piu-voice';
import { isAppLocked } from '../lib/appLockGate';
import { markRevocationsSent, pendingRevocations } from '../lib/devices';
import { applySessionRotation, deviceChangeOutbox, saveDeviceChangeOutbox, sessionRotationEpoch, takeDeviceChangeRequest, takeRestoredData } from '../lib/migrationState';
import { chirpInApp, notify } from '../lib/notifications';
import { forgetPersisted, loadPersisted, persistEpoch, persistNow, readPersisted, schedulePersisted } from '../lib/persist';
import { newNodeNameSecret } from '../lib/nodeName';
import { getPhoneNode, updatePhoneNode } from '../lib/phoneNodeStore';
import { pointBridge } from '../lib/pointBridge';
import { toHex } from '../protocol/bytes';
import { makePhoneCall } from '../state/calls';
import { preloadedKeys, preloadedNodeKeyFor, preloadKeys } from '../state/keys';
import { checkTransportPermissions, getTransport, SERVICE_ID } from '../transport';
import { createChatStore, type ChatStore } from './chatStore';
import { createMessengerRuntime, persistedPrefs, type MessengerRuntime } from './messengerRuntime';
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

let chatStore: ChatStore | null = null;
/** Conversas do processo (lidas do salvo na primeira chamada: depois de `loadPersisted`). */
export function getChatStore(): ChatStore {
  return (chatStore ??= createChatStore({
    read: readPersisted, schedule: schedulePersisted,
    notify: n => { void notify(n); }, chirp: chirpInApp,
    active: () => AppState.currentState === 'active', locked: isAppLocked,
    navigate: href => router.push(href as Href),
  }));
}

let runtime: MessengerRuntime | null = null;
/** Mensageiro do processo; os ajustes começam pelo salvo e a tela atualiza (`setPrefs`). */
export function getMessengerRuntime(): MessengerRuntime {
  const pn = getPhoneNode();
  return (runtime ??= createMessengerRuntime({
    transport: getTransport(), chats: getChatStore(),
    read: readPersisted, persistNow, schedule: schedulePersisted, forget: forgetPersisted, epoch: persistEpoch,
    prefs: persistedPrefs(readPersisted, { point: pointBridge.runtime, phoneNodeActive: pn.activeSince !== null && !pn.exit }),
    host: {
      takeRestoredData, applySessionRotation, takeDeviceChangeRequest, deviceChangeOutbox, saveDeviceChangeOutbox,
      pendingRevocations, markRevocationsSent, updatePhoneNode,
      // Chamada de voz só com o módulo de áudio nativo (Android com o app instalado).
      makeCall: d => (PiuVoice.isAvailable() ? makePhoneCall(d) : null),
    },
  }));
}

/** Mensageiro sem tela: com o cofre já lido e o onboarding feito, liga com as chaves do aparelho. */
function bootMessenger() {
  const k = preloadedKeys();
  if (!k || readPersisted<boolean>('onboarded') !== true) return;
  getMessengerRuntime().start({ identities: k.identities, node: k.node, nodeKeyFor: k.nodeKeyFor, phonePk: toHex(k.phoneOperator.pk), rotation: sessionRotationEpoch() });
}

export const bootCore = async (): Promise<void> => { await getCore().boot(); bootMessenger(); };

/**
 * "Apagar dados locais" (state/reset.tsx), logo depois de esvaziar a memória: o mensageiro para sem
 * regravar (a geração dos dados mudou) e as conversas voltam ao vazio.
 */
export function wipeMessaging() {
  void runtime?.shutdown();
  runtime?.reload();
  chatStore?.reload();
}
