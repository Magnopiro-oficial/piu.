/**
 * Estado do modo nó (lib/phoneNodeCore.ts) salvo no aparelho (`phone.node`, AsyncStorage cifrado),
 * com assinatura para a UI (`usePhoneNode`, state/phoneNode.tsx) e para os eventos do mensageiro
 * (pedidos de aval e avais chegam com o app em qualquer tela).
 */
import { persistNow, readPersisted } from './persist';
import { type PhoneNodeState, revivePhoneNode } from './phoneNodeCore';

export const PHONE_NODE_KEY = 'phone.node';
const subs = new Set<() => void>();
let cache: PhoneNodeState = revivePhoneNode(undefined);
let lastRaw: unknown = Symbol('nunca');

/** Estado atual (o mesmo objeto enquanto nada muda; "Apagar dados locais" volta ao vazio). */
export function getPhoneNode(): PhoneNodeState {
  const raw = readPersisted<PhoneNodeState>(PHONE_NODE_KEY);
  if (raw !== lastRaw) { lastRaw = raw; cache = raw === cache ? cache : revivePhoneNode(raw); }
  return cache;
}

/** Aplica a mudança e grava já (o registro e o pedido de saída não podem voltar atrás). */
export async function updatePhoneNode(fn: (s: PhoneNodeState) => PhoneNodeState): Promise<PhoneNodeState> {
  const cur = getPhoneNode();
  const next = fn(cur);
  if (next === cur) return cur;
  const done = persistNow(PHONE_NODE_KEY, next); // grava a memória na hora; o disco, a seguir
  cache = next; lastRaw = next;
  subs.forEach(f => f());
  await done;
  return next;
}

export function subscribePhoneNode(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }
/** Avisa a UI depois de "Apagar dados locais" (o próximo `getPhoneNode` já lê vazio). */
export function notifyPhoneNode() { subs.forEach(f => f()); }
