// Perfil, segurança e ajustes, notificações (design/PiuApp.dc.html): textos e opções.
// Aparelhos vêm do registro real (lib/devices.ts) e o armazenamento é medido (lib/storageUsage.ts).
import type { IconName } from '../ui/Icon';

export const PROFILE_NOTES = {
  public: 'Perfil público. Quem tem o seu código, ou vê você em Por perto, vê este nome.',
  anon: 'Chaves e contatos separados. Sem vínculo público com seu perfil.',
};

// ── backup ───────────────────────────────────────────────
export type SaveOpt = 'sd' | 'device' | 'paper';
export const SAVE_OPTS: [SaveOpt, IconName, string, string][] = [
  ['sd', 'sd_card', 'Arquivo cifrado no cartão SD ou pendrive', 'Sem nuvem · protegido pela frase'],
  ['device', 'devices', 'Outro aparelho seu, por perto', 'Cópia direta, cifrada'],
  ['paper', 'edit_note', 'Só a frase, no papel', 'Recupera chaves, não o histórico'],
];

// ── restaurar / migrar ───────────────────────────────────
export type RestoreMode = 'device' | 'phrase' | 'file';
export const RESTORE_OPTS: [RestoreMode, IconName, string, string][] = [
  ['device', 'phonelink_ring', 'De outro aparelho seu, por perto', 'O celular antigo ainda liga. Transferência direta, cifrada.'],
  ['phrase', 'password', 'Com a frase de 12 palavras', 'Recupera chaves e carteira. O histórico não vem.'],
  ['file', 'sd_card', 'De um arquivo de backup', 'Cartão SD, pendrive ou outro aparelho.'],
];
export const MIG_META: Record<RestoreMode, { title: string; sub: string; icon: IconName; label: string; done: string }> = {
  device: { title: 'Transferindo do aparelho antigo', sub: 'Direto entre os dois aparelhos, cifrado. Nada passa por servidor.', icon: 'phone_android', label: 'aparelho antigo', done: 'O aparelho antigo foi desconectado e as chaves de sessão foram trocadas.' },
  phrase: { title: 'Recuperando pela frase', sub: 'As chaves são recriadas a partir das 12 palavras, neste aparelho.', icon: 'password', label: 'frase', done: 'Os contatos não vêm com a frase. Quem você adicionar de novo nos próximos 7 dias recebe um aviso assinado de troca de aparelho.' },
  file: { title: 'Restaurando do arquivo', sub: 'Arquivo .piu cifrado com a sua senha.', icon: 'sd_card', label: 'arquivo', done: 'Os contatos do arquivo recebem um aviso assinado de troca de aparelho quando houver rota. O código de segurança de vocês não muda.' },
};

// ── aparelhos ────────────────────────────────────────────
/**
 * @deprecated Compatibilidade com a aba Perfil (que ainda conta os aparelhos por aqui): só este
 * aparelho. A lista real é `useDevices()` de `lib/devices.ts` (ativos: `useActiveDeviceCount()`).
 */
export interface MyDevice { id: string; icon: IconName; name: string; desc: string; tag: string; current?: boolean; revoked?: boolean; canDrop?: boolean }
export const MY_DEVICES: MyDevice[] = [{ id: 'this', icon: 'smartphone', name: 'Este aparelho', desc: '', tag: 'atual', current: true }];

// ── notificações ─────────────────────────────────────────
export type NotifKey = 'msg' | 'group' | 'channel' | 'nearby' | 'wallet' | 'network';
export const NOTIF_TYPES: [NotifKey, IconName, string, string][] = [
  ['msg', 'chat_bubble', 'Conversas', 'Mensagens diretas'], ['group', 'group', 'Grupos', 'Só menções acima de 20 mensagens/h'],
  ['channel', 'campaign', 'Canais', 'Publicações dos canais que você segue'], ['nearby', 'radar', 'Pedidos de conversa', 'Convites de Por perto'],
  ['wallet', 'account_balance_wallet', 'Carteira', 'LUNES recebidos e bônus liberados'], ['network', 'hub', 'Rede e nós', 'Novos nós, saída da malha, modo nó pausado'],
];
export type Preview = 'always' | 'unlocked' | 'never';
export const PREVIEW_HINT: Record<Preview, string> = {
  always: 'Nome e mensagem aparecem também na tela bloqueada.',
  unlocked: 'Na tela bloqueada aparece só “Piu · Nova mensagem”.',
  never: 'Nunca mostra remetente nem conteúdo, nem com o aparelho desbloqueado.',
};
