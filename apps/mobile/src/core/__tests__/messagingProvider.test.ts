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
  // `start` sem cleanup: desmontar não para nada.
  assert.match(messaging, /useEffect\(\(\) => \{\n\s+rt\.start\([^\n]*\n\s+\}, \[/);
});

test('StoreProvider lê as conversas do chatStore (sem usePersisted de chats/verified)', () => {
  assert.match(store, /useSyncExternalStore\(cs\.subscribe, cs\.getSnapshot/);
  assert.doesNotMatch(store, /usePersisted<[^>]*>\('(chats|verified)'/);
});

test('núcleo sem router: os toques levam href', () => {
  for (const f of ['chatStore.ts', 'messengerRuntime.ts']) assert.doesNotMatch(read('core', f), /router\.push|from 'expo-router'|from 'react-native'/, f);
  assert.match(read('ui', 'Toast.tsx'), /router\.push\(href/);
});
