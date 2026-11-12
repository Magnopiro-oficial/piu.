/**
 * MessagingProvider e StoreProvider finos (plano "app fechado", fatias 4 e 5): o desmonte da tela
 * (deslizar o app dos recentes) não descarta o mensageiro nem a chamada. Os providers importam
 * react-native e não montam em node: o teste lê o código. O comportamento (mesma instância ao
 * remontar, só `shutdown` para) é testado com o núcleo em messengerRuntime.test.ts.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const read = (...p: string[]) => readFileSync(join(__dirname, '..', '..', ...p), 'utf8');
const messaging = read('state', 'messaging.tsx');
const store = read('state', 'store.tsx');

test('MessagingProvider não cria nem descarta o mensageiro: assina o do núcleo', () => {
  assert.doesNotMatch(messaging, /new Messenger\(|setMessenger\(|svc\.dispose\(|makePhoneCall\(|transport\.subscribe\(/);
  assert.match(messaging, /getMessengerRuntime/);
  assert.match(messaging, /useSyncExternalStore\(rt\.subscribe, rt\.getSnapshot/);
  // Nenhum caminho da tela para ou troca o mensageiro ao desmontar: só `shutdown` (núcleo) para.
  assert.doesNotMatch(messaging, /rt\.(shutdown|dispose)\(|rt\.start\(null/);
  // O efeito que liga (`rt.start`) não devolve cleanup.
  const starts = [...messaging.matchAll(/useEffect\(\(\) => \{([^]*?)\n {2}\}, \[/g)].map(m => m[1]!).filter(b => /rt\.start\(/.test(b));
  assert.equal(starts.length, 1);
  assert.doesNotMatch(starts[0]!, /return/);
});

test('desmontar a tela solta só o que depende dela: a retransmissão pausada pela bateria (rt.detach)', () => {
  assert.match(messaging, /useEffect\(\(\) => \(\) => rt\.detach\(/);
  // A chamada só segue sem tela onde o núcleo mostra o aviso com botão (core/callAlertRunner.ts).
  assert.match(messaging, /rt\.detach\(\{ relay: pointRelay\.current, keepCall: getCallAlerts\(\)\.keepCall \}\)/);
  assert.match(read('core', 'index.ts'), /notifyAllowed: async \(\) => \(await notificationPermission\(\)\) === 'granted'/);
  // Perfil e carteira voltam ao padrão sem tela (o perfil restaurado espera o próximo dono).
  assert.match(messaging, /rt\.setHost\(\{ importProfile: undefined, settleInvite: undefined \}\)/);
});

test('StoreProvider não faz a varredura das temporárias nem a troca de "criada" com timer da tela', () => {
  assert.doesNotMatch(store, /SWEEP_MS|dropExpired/);
  assert.match(store, /cs\.settleSent\(/);
});

test('StoreProvider lê as conversas do chatStore (sem usePersisted de chats/verified)', () => {
  assert.match(store, /useSyncExternalStore\(cs\.subscribe, cs\.getSnapshot/);
  assert.doesNotMatch(store, /usePersisted<[^>]*>\('(chats|verified)'/);
});

test('núcleo sem router: os toques levam href', () => {
  for (const f of ['chatStore.ts', 'messengerRuntime.ts']) assert.doesNotMatch(read('core', f), /router\.push|from 'expo-router'|from 'react-native'/, f);
  assert.match(read('ui', 'Toast.tsx'), /router\.push\(href/);
});
