/**
 * Aparelho de teste (só no transporte simulado: navegador e Expo Go). É um segundo Piu completo,
 * com chaves próprias e o mesmo Messenger, rodando dentro do app: responde cada mensagem com um eco.
 * Serve para ver o caminho real (cartão → sessão cifrada → roteador → transporte → recibo) sem
 * precisar de dois celulares.
 */
import { toHex } from '../protocol/bytes';
import { deriveIdentity, deriveNodeKey, newSeed } from '../protocol/keys';
import { encodeCard } from './card';
import { Messenger } from './messenger';

export const TEST_DEVICE_PEER = 'sim-test-device';
export const TEST_DEVICE_NAME = 'Aparelho de teste';

export interface TestDevice { card: () => string; messenger: Messenger; setReply: (fn: (data: Uint8Array) => void) => void }

/** `saved`/`save`: o aparelho de teste guarda chaves e sessões, para continuar depois de reabrir o app. */
export function createTestDevice(now: () => number, saved?: string, save?: (state: string) => void): TestDevice {
  const st = saved ? JSON.parse(saved) as { seed: string; m: string } : null;
  const seed = st ? Uint8Array.from(st.seed.match(/../g)!.map(x => parseInt(x, 16))) : newSeed();
  const ids = { public: deriveIdentity(seed, 'public'), anon: deriveIdentity(seed, 'anon') };
  let reply: (data: Uint8Array) => void = () => {};
  const m: Messenger = new Messenger({
    identities: ids, node: deriveNodeKey(seed), relay: false, now, state: st?.m,
    transmit: async (_peer, bytes) => reply(bytes),
    events: {
      changed: () => save?.(JSON.stringify({ seed: toHex(seed), m: m.export() })),
      newContact: (c, msg) => { m.addContact(c); answer(c.id, msg.text); },
      message: (cid, msg) => answer(cid, msg.text),
    },
  });
  m.displayName = TEST_DEVICE_NAME;
  let n = 0;
  const answer = (cid: string, text: string) => setTimeout(() => m.sendText(cid, `t${Date.now()}-${n++}`, `Recebi cifrado: “${text.slice(0, 200)}”`), 600);
  return {
    card: () => encodeCard(ids.public, TEST_DEVICE_NAME, now()),
    messenger: m,
    setReply: fn => { reply = fn; },
  };
}
