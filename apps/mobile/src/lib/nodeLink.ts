/**
 * Liga o cliente da API local (lib/nodeApi.ts) ao equipamento pareado: HTTPS com o certificado fixado
 * pelo módulo nativo `piu-node-link` e a sessão guardada cifrada (lib/persist.ts), uma por equipamento.
 */
import { PiuNodeLink } from '../../modules/piu-node-link';
import type { PairedNode } from './approvals';
import { NodeApi, nodeBaseUrl, type NodeSend, type NodeSession } from './nodeApi';
import { forgetPersisted, persistNow, readPersisted } from './persist';

const key = (phoneId: string) => `prov.session.${phoneId}`;

/** HTTPS com pino, ou `null` sem o módulo nativo (navegador, Expo Go). */
export const pinnedSend: NodeSend | null = PiuNodeLink
  ? async r => PiuNodeLink!.request(r.url, r.method, r.headers, r.body ?? null, r.pin)
  : null;

/** Por que o app ainda não conversa com este equipamento (ou `null` se pode). */
export function linkBlocker(n: Pick<PairedNode, 'pin' | 'url' | 'node'>): string | null {
  if (!n.pin) return 'O QR deste painel não traz a impressão digital do certificado do equipamento. Sem ela, o celular não tem como confiar na conexão. Atualize o Piu Node e pareie de novo.';
  if (!nodeBaseUrl(n)) return 'O endereço do equipamento no QR não é válido.';
  if (!pinnedSend) return 'A conexão com o equipamento precisa do app instalado no celular (não funciona no navegador nem no Expo Go).';
  return null;
}

export function nodeApiFor(n: Pick<PairedNode, 'pin' | 'url' | 'node' | 'operator' | 'phoneId'>): NodeApi | null {
  const base = nodeBaseUrl(n);
  if (linkBlocker(n) || !base) return null;
  return new NodeApi({ base, pin: n.pin!, operator: n.operator, send: pinnedSend!, session: readPersisted<NodeSession>(key(n.phoneId)) ?? null });
}

export const saveNodeSession = (phoneId: string, s: NodeSession | null) => (s ? persistNow(key(phoneId), s) : forgetPersisted(key(phoneId)));
