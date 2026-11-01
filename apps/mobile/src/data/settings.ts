// Perfil, segurança e ajustes, notificações (design/PiuApp.dc.html). Dados ilustrativos.
import type { IconName } from '../ui/Icon';

export const PROFILES = {
  public: { radius: 'circle' as const, note: 'Perfil público. Pessoas podem encontrar você por nome ou código.', fp: ['7F3A', '91C2', '0B4E', 'D8A1', '55E0', '3C7F', 'A912', 'C19E'] },
  anon: { name: 'Anônimo · 7F3A', handle: 'piu:b7e0…41dc', initials: '7F', radius: 'square' as const, note: 'Chaves e contatos separados. Sem vínculo público com seu perfil.', fp: ['B7E0', '2D19', 'F4C8', '0A63', '9E21', '7B5D', 'C0F4', '41DC'] },
};

// ── backup ───────────────────────────────────────────────
/** Frase de recuperação (12 palavras). */
export const PHRASE = ['farol', 'caju', 'vento', 'rio', 'pedra', 'lume', 'serra', 'barco', 'linha', 'ninho', 'trigo', 'maré'];
/** Confirmação: [posição, opções, resposta]. */
export const QUIZ: [number, string[], string][] = [[4, ['mar', 'rio', 'sol'], 'rio'], [7, ['vale', 'ponte', 'serra'], 'serra'], [11, ['trigo', 'milho', 'arroz'], 'trigo']];
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
  device: { title: 'Transferindo do Galaxy antigo', sub: 'Direto por Wi-Fi Direct, cifrado. Nada passa por servidor.', icon: 'phone_android', label: 'Galaxy antigo', done: 'O aparelho antigo foi desconectado e as chaves de sessão foram trocadas.' },
  phrase: { title: 'Recuperando pela frase', sub: 'As chaves são recriadas a partir das 12 palavras, neste aparelho.', icon: 'password', label: 'frase', done: 'Seus contatos verão um aviso de troca de chave. Verifique os mais importantes.' },
  file: { title: 'Restaurando do arquivo', sub: 'piu-backup-2026-10.piu · cifrado com a sua frase.', icon: 'sd_card', label: 'arquivo', done: 'Seus contatos verão um aviso de troca de chave. Verifique os mais importantes.' },
};
export const migItems = (m: RestoreMode): [string, string][] => m === 'device'
  ? [['Identidade pública', 'Cardeal · chaves copiadas'], ['Identidade anônima', 'separada · sem vínculo com a pública'], ['Contatos e conversas', '214 contatos · 38 conversas · 1,1 GB'], ['Carteira LUNES', 'chave da carteira · 58,40 LUNES'], ['Sessões antigas', 'encerradas · chaves de sessão rotacionadas']]
  : [['Identidade pública', 'recuperada da frase'], ['Identidade anônima', 'recuperada · separada da pública'], ['Contatos', 'avisados da troca de aparelho'], ['Carteira LUNES', '58,40 LUNES'], ['Histórico de conversas', m === 'file' ? '38 conversas do arquivo cifrado' : 'não fica na frase · só por aparelho ou arquivo']];

// ── aparelhos ────────────────────────────────────────────
export interface MyDevice { id: string; icon: IconName; name: string; desc: string; tag: string; current?: boolean; revoked?: boolean; canDrop?: boolean }
export const MY_DEVICES: MyDevice[] = [
  { id: 'this', icon: 'smartphone', name: 'Este aparelho', desc: 'Pixel 8 · desde 24 out', tag: 'atual', current: true },
  { id: 'note', icon: 'computer', name: 'Notebook', desc: 'painel do provider · pareado em 30 out', tag: 'ativo', canDrop: true },
  { id: 'old', icon: 'phone_android', name: 'Galaxy antigo', desc: 'desconectado em 24 out · chaves rotacionadas', tag: 'revogado', revoked: true },
];

// ── armazenamento ────────────────────────────────────────
/** [rótulo, MB, texto, opacidade] — total 1.195 MB ≈ 1,2 GB. */
export const STORAGE_USE: [string, number, string, number][] = [['Conversas', 820, '820 MB', 1], ['Mídia', 310, '310 MB', 0.55], ['De terceiros', 61, '61 MB', 0.3], ['Recibos e créditos', 4, '4 MB', 0.15]];

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
/** Tela bloqueada: avisos de exemplo. `priv` é o texto quando o conteúdo fica oculto. */
export interface LockNotif { id: string; critical?: boolean; title: string; body: string; priv?: string; time: string; stacked?: boolean; count?: string; href: string }
export const LOCK_NOTIFS: LockNotif[] = [
  { id: 'alert', critical: true, title: 'Alerta · Defesa Civil', body: 'Risco de deslizamento na Serra. Deixe áreas de encosta agora.', time: 'agora', href: '/alert' },
  { id: 'marina', title: 'Marina Alves', body: 'Cheguei na praça! Onde você está?', priv: 'Nova mensagem', time: '2 min', href: '/chat/marina' },
  { id: 'mutirao', title: 'Mutirão Vila Esperança', body: 'João: Gerador ligado. O roteador do galpão voltou a retransmitir.', priv: '4 novas mensagens', time: '8 min', stacked: true, count: '+3 mensagens de Lia e Seu Antônio', href: '/chat/mutirao' },
  { id: 'helena', title: 'Helena quer conversar', body: '+3,00 LUNES se você aceitar · expira em 24 h', priv: 'Novo pedido de conversa', time: '15 min', href: '/nearby/requests' },
  { id: 'lunes', title: 'Você recebeu 25,00 LUNES', body: 'Distribuição · Seu Antônio ficou ativo por 7 dias', priv: 'Movimentação na carteira', time: '1 h', href: '/wallet' },
];

/** Alerta de emergência assinado (Defesa Civil). */
export const EMERGENCY = {
  title: 'Risco de deslizamento na Serra',
  body: 'Chuva acima de 80 mm nas últimas 6 h. Deixe áreas de encosta agora e siga para o ponto de apoio na Escola Municipal.',
  rows: [['Origem', 'Defesa Civil · Serra'], ['Recebido', 'LoRa 915 MHz · 3 saltos · 13:52'], ['Assinatura', 'chave oficial 2B7E…91AC']] as [string, string][],
};
