// Perfil, segurança e ajustes, notificações (design/PiuApp.dc.html): textos e opções.
// Aparelhos vêm do registro real (lib/devices.ts) e o armazenamento é medido (lib/storageUsage.ts).
import type { IconName } from '../ui/Icon';

export const PROFILE_NOTES = {
  public: 'Perfil público. Pessoas podem encontrar você por nome ou código.',
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
  phrase: { title: 'Recuperando pela frase', sub: 'As chaves são recriadas a partir das 12 palavras, neste aparelho.', icon: 'password', label: 'frase', done: 'Seus contatos verão um aviso de troca de chave. Verifique os mais importantes.' },
  file: { title: 'Restaurando do arquivo', sub: 'Arquivo .piu cifrado com a sua senha.', icon: 'sd_card', label: 'arquivo', done: 'Seus contatos verão um aviso de troca de chave. Verifique os mais importantes.' },
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
/**
 * Prévia da tela bloqueada: um aviso de cada tipo, com textos genéricos (sem pessoas nem valores de
 * exemplo), só para mostrar o efeito da pré-visualização. `priv` é o texto quando o conteúdo fica oculto.
 */
export interface LockNotif { id: string; critical?: boolean; title: string; body: string; priv?: string; time: string; stacked?: boolean; count?: string; href: string }
export const LOCK_NOTIFS: LockNotif[] = [
  { id: 'alert', critical: true, title: 'Alerta de emergência · exemplo', body: 'Alertas assinados por fonte oficial sempre mostram o conteúdo.', time: 'agora', href: '/alert' },
  { id: 'msg', title: 'Nome do contato', body: 'Texto da mensagem aparece aqui.', priv: 'Nova mensagem', time: '2 min', href: '/(tabs)' },
  { id: 'group', title: 'Nome do grupo', body: 'Quem escreveu: texto da mensagem.', priv: 'Novas mensagens', time: '8 min', stacked: true, count: 'mais mensagens do grupo', href: '/(tabs)' },
  { id: 'nearby', title: 'Pedido de conversa', body: 'Alguém por perto quer conversar · expira em 24 h', priv: 'Novo pedido de conversa', time: '15 min', href: '/nearby/requests' },
  { id: 'wallet', title: 'Movimentação na carteira', body: 'LUNES recebidos e bônus liberados aparecem assim.', priv: 'Movimentação na carteira', time: '1 h', href: '/(tabs)/wallet' },
];

/** Alerta de emergência assinado (Defesa Civil). */
export const EMERGENCY = {
  title: 'Risco de deslizamento na Serra',
  body: 'Chuva acima de 80 mm nas últimas 6 h. Deixe áreas de encosta agora e siga para o ponto de apoio na Escola Municipal.',
  rows: [['Origem', 'Defesa Civil · Serra'], ['Recebido', 'LoRa 915 MHz · 3 saltos · 13:52'], ['Assinatura', 'chave oficial 2B7E…91AC']] as [string, string][],
};
