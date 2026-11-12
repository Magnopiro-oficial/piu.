// Perfil, segurança e ajustes, notificações (design/PiuApp.dc.html): textos e opções.
// Aparelhos vêm do registro real (lib/devices.ts) e o armazenamento é medido (lib/storageUsage.ts).
import type { Key } from '../i18n/core';
import type { IconName } from '../ui/Icon';

// Textos do Perfil (notas das identidades) e da pré-visualização ficam no dicionário (src/i18n, `profile.note.*`, `notif.preview.hint.*`).

// ── backup ───────────────────────────────────────────────
export type SaveOpt = 'sd' | 'device' | 'paper';
/** Título e descrição são chaves do dicionário (`backup.save.*`). */
export const SAVE_OPTS: [SaveOpt, IconName, Key, Key][] = [
  ['sd', 'sd_card', 'backup.save.sd', 'backup.save.sd.desc'],
  ['device', 'devices', 'backup.save.device', 'backup.save.device.desc'],
  ['paper', 'edit_note', 'backup.save.paper', 'backup.save.paper.desc'],
];

// ── restaurar / migrar ───────────────────────────────────
export type RestoreMode = 'device' | 'phrase' | 'file';
/** Título e descrição são chaves do dicionário (`restore.opt.*`). */
export const RESTORE_OPTS: [RestoreMode, IconName, Key, Key][] = [
  ['device', 'phonelink_ring', 'restore.opt.device', 'restore.opt.device.desc'],
  ['phrase', 'password', 'restore.opt.phrase', 'restore.opt.phrase.desc'],
  ['file', 'sd_card', 'restore.opt.file', 'restore.opt.file.desc'],
];
/** Textos da migração por modo: chaves do dicionário (`migrate.<modo>.*`). */
export const MIG_META: Record<RestoreMode, { title: Key; sub: Key; icon: IconName; label: Key; done: Key }> = {
  device: { title: 'migrate.device.title', sub: 'migrate.device.sub', icon: 'phone_android', label: 'migrate.device.label', done: 'migrate.device.done' },
  phrase: { title: 'migrate.phrase.title', sub: 'migrate.phrase.sub', icon: 'password', label: 'migrate.phrase.label', done: 'migrate.phrase.done' },
  file: { title: 'migrate.file.title', sub: 'migrate.file.sub', icon: 'sd_card', label: 'migrate.file.label', done: 'migrate.file.done' },
};

// ── aparelhos ────────────────────────────────────────────
/**
 * @deprecated Compatibilidade com a aba Perfil (que ainda conta os aparelhos por aqui): só este
 * aparelho. A lista real é `useDevices()` de `lib/devices.ts` (ativos: `useActiveDeviceCount()`).
 */
export interface MyDevice { id: string; icon: IconName; name: string; desc: string; tag: string; current?: boolean; revoked?: boolean; canDrop?: boolean }
export const MY_DEVICES: MyDevice[] = [{ id: 'this', icon: 'smartphone', name: 'Este aparelho', desc: '', tag: 'atual', current: true }];

// ── notificações ─────────────────────────────────────────
// Nome e descrição de cada tipo ficam no dicionário (`notif.type.<chave>` e `.desc`); aqui, só a ordem e o ícone.
export type NotifKey = 'msg' | 'group' | 'channel' | 'nearby' | 'wallet' | 'network' | 'alert';
export const NOTIF_TYPES: [NotifKey, IconName, string, string][] = [
  ['msg', 'chat_bubble', 'Conversas', 'Mensagens diretas'], ['group', 'group', 'Grupos', 'Só menções acima de 20 mensagens/h'],
  ['channel', 'campaign', 'Canais', 'Publicações dos canais que você segue'], ['nearby', 'radar', 'Pedidos de conversa', 'Convites de Por perto'],
  ['wallet', 'account_balance_wallet', 'Carteira', 'LUNES recebidos e bônus liberados'], ['network', 'hub', 'Rede e nós', 'Novos nós, saída da malha, modo nó pausado'],
  ['alert', 'warning', 'Alertas da comunidade', 'Grave toca alto; Atenção avisa normal; Informativo só na lista'],
];
/** Tipos ligados de fábrica: todos menos Rede e nós (state/settings.tsx e o núcleo sem tela, core/toasts.ts). */
export const DEFAULT_NOTIFS = Object.fromEntries(NOTIF_TYPES.map(([k]) => [k, k !== 'network'])) as Record<NotifKey, boolean>;
export type Preview = 'always' | 'unlocked' | 'never';
