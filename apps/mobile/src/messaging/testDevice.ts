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

export interface TestDevice { card: () => string; messenger: Messenger; setReply: (fn: (data: Uint8Array) => void) => void; stop: () => void }

/** `saved`/`save`: o aparelho de teste guarda chaves e sessões, para continuar depois de reabrir o app. */
export function createTestDevice(now: () => number, saved?: string, save?: (state: string) => void): TestDevice {
  const st = saved ? JSON.parse(saved) as { seed: string; m: string } : null;
  const seed = st ? Uint8Array.from(st.seed.match(/../g)!.map(x => parseInt(x, 16))) : newSeed();
  const ids = { public: deriveIdentity(seed, 'public'), anon: deriveIdentity(seed, 'anon') };
  let reply: (data: Uint8Array) => void = () => {};
  let hasReply = false;
  const m: Messenger = new Messenger({
    identities: ids, node: deriveNodeKey(seed), relay: false, now, state: st?.m,
    transmit: async (_peer, bytes) => reply(bytes),
    events: {
      changed: () => save?.(JSON.stringify({ seed: toHex(seed), m: m.export() })),
      newContact: (c, msg) => { m.addContact(c); answer(c.id, msg.msgId, msg.text); },
      message: (cid, msg) => answer(cid, msg.msgId, msg.text),
      // Grupo: responde no próprio grupo (quando pode publicar).
      groupMessage: (gid, _from, who, msg) => setTimeout(() => { try { m.sendGroupText(gid, `tg${Date.now()}-${n++}`, `${who}, recebi no grupo: “${msg.text.slice(0, 120)}”`); } catch { /* só admins publicam */ } }, 600),
      // Por perto: aceita convites pagos e convida o app uma vez (são regras reais do protocolo).
      nearRequest: r => setTimeout(() => {
        const ok = m.answerNear(r.id, 'accept');
        if (ok) setTimeout(() => m.sendText(ok.contact.id, `t${Date.now()}-${n++}`, `Aceitei seu convite: “${r.msg.slice(0, 120)}”`), 800);
      }, 1500),
      nearbyChanged: () => {
        for (const p of m.nearbyProfiles()) {
          if (invited.has(p.id) || m.getContact(p.id) || m.nearInviteBlockedUntil(p.id) != null) continue;
          invited.add(p.id);
          setTimeout(() => { try { m.sendNearInvite(p.id, 'Convite de teste por Por perto: aceite para ver a conversa abrir.'); } catch { /* saiu do alcance */ } }, 4000);
        }
      },
      fileReceived: (cid, f) => setTimeout(() => m.sendText(cid, `t${Date.now()}-${n++}`, `Recebi o arquivo “${f.name}” (${Math.round(f.size / 1024)} KB, ${f.blocks} blocos). SHA-256 conferido.`), 600),
    },
  });
  m.displayName = TEST_DEVICE_NAME;
  let n = 0;
  const invited = new Set<string>();
  // Sempre visível em Por perto (é um aparelho de teste, não uma pessoa), com a menor taxa.
  const visible = () => { m.setNearby({ until: now() + 3600, fee: 1, name: TEST_DEVICE_NAME }); m.tick(); };
  visible();
  const timer = setInterval(visible, 30_000);
  // Lê (confirmação de leitura), "digita" e responde, como uma pessoa com os ajustes padrão.
  const answer = (cid: string, msgId: string, text: string) => {
    setTimeout(() => { m.sendRead(cid, [msgId]); m.sendTyping(cid); }, 300);
    setTimeout(() => m.sendText(cid, `t${Date.now()}-${n++}`, `Recebi cifrado: “${text.slice(0, 200)}”`), 1800);
  };
  return {
    card: () => encodeCard(ids.public, TEST_DEVICE_NAME, m.issueInvite('public')),
    messenger: m,
    // Primeira resposta possível: anuncia a presença na hora (antes, não havia por onde mandar).
    setReply: fn => { const first = !hasReply; reply = fn; hasReply = true; if (first) m.peerConnected('app', 'ble'); },
    stop: () => clearInterval(timer),
  };
}
