/**
 * Notificações do sistema, sem servidor: tudo é notificação LOCAL (expo-notifications), disparada
 * pelo próprio app quando algo chega pela malha. Nenhum token de push é pedido nem enviado.
 *
 * - `notify()` respeita Ajustes → Notificações: tipos ligados, pré-visualização (Sempre /
 *   Desbloqueado / Nunca), modo noturno (22h–7h, só alertas Graves da comunidade tocam) e vibração discreta.
 * - Só dispara com o app fora do primeiro plano: em primeiro plano o app já mostra o banner in-app.
 * - `NotificationBridge` (montado uma vez, dentro dos provedores) liga os ajustes, abre a tela certa
 *   ao tocar na notificação e pede a permissão na hora certa. Os banners in-app com tipo chamam
 *   `notify` direto (state/store.tsx, `showToast`), com o conteúdo original e a rota (`href`).
 */
import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import type { NotifKey, Preview } from '../data/settings';
import { useSettings } from '../state/settings';
import { useStore } from '../state/store';
import { playPiu } from './piuSound';
import { persistNow, readPersisted } from './persist';

export type NotifyKind = NotifKey;

export interface NotifyInput {
  kind: NotifyKind;
  title: string;
  body: string;
  /**
   * Alerta crítico (alerta Grave da comunidade, messaging/communityAlerts.ts): canal de importância
   * máxima, toca até no modo noturno. Segue o tipo ligado e a pré-visualização como os demais.
   */
  critical?: boolean;
  /** `href`: rota a abrir ao tocar (ex.: `/chat/abc`). O resto vai junto na notificação. */
  data?: { href?: string } & Record<string, unknown>;
  /** Ação ao tocar enquanto o app ainda está vivo (tem prioridade sobre `href`). */
  go?: () => void;
}

interface Cfg { preview: Preview; notifs: Record<NotifKey, boolean>; quiet: boolean; discreet: boolean; piu: boolean; onboarded: boolean }

/** Texto genérico quando o conteúdo fica oculto (design: "Piu · Nova mensagem"). */
const HIDDEN_BODY: Record<NotifyKind, string> = {
  msg: 'Nova mensagem', group: 'Nova mensagem', channel: 'Nova publicação', nearby: 'Novo pedido de conversa',
  wallet: 'Movimentação na carteira', network: 'Aviso da rede', alert: 'Alerta da comunidade',
};

/** Canais do Android (importância e som são fixos depois de criados, por isso um canal por modo). */
type Mode = 'normal' | 'piu' | 'discreet' | 'quiet' | 'critical';
const CHANNELS: Record<Mode, Notifications.NotificationChannelInput> = {
  normal: { name: 'Mensagens e avisos', importance: Notifications.AndroidImportance.HIGH, sound: 'default', enableVibrate: true, vibrationPattern: [0, 250, 120, 250], lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE },
  piu: { name: 'Mensagens com piu', description: 'O som do Piu', importance: Notifications.AndroidImportance.HIGH, sound: 'piu.wav', enableVibrate: true, vibrationPattern: [0, 250, 120, 250], lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE },
  discreet: { name: 'Avisos discretos', description: 'Sem som; um toque curto', importance: Notifications.AndroidImportance.HIGH, sound: null, enableVibrate: true, vibrationPattern: [0, 90], lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE },
  quiet: { name: 'Modo noturno', description: 'Entre 22h e 7h: sem som nem vibração', importance: Notifications.AndroidImportance.LOW, sound: null, enableVibrate: false, vibrationPattern: null, lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE },
  critical: { name: 'Alertas graves da comunidade', description: 'Publicados por membros das suas comunidades. Não são avisos oficiais.', importance: Notifications.AndroidImportance.MAX, sound: 'default', enableVibrate: true, vibrationPattern: [0, 600, 200, 600, 200, 600], lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE },
};
/** `critical-c`: canal novo (o antigo `piu-critical` era dos alertas oficiais, visível na tela bloqueada). */
const channelId = (m: Mode) => (m === 'critical' ? 'piu-critical-c' : `piu-${m}`);

let cfg: Cfg | null = null;
let active = AppState.currentState === 'active';
let channelsReady: Promise<void> | null = null;
/** Ações de toque das notificações postadas nesta execução. */
const actions = new Map<string, () => void>();
/** Evita duplicar quando `notify` e o espelho do banner disparam a mesma coisa. */
let last = { key: '', at: 0 };

AppState.addEventListener('change', s => { active = s === 'active'; });

// Em primeiro plano o app mostra o banner in-app; o sistema não repete.
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

export const isQuietHour = (d = new Date()) => d.getHours() >= 22 || d.getHours() < 7;

/**
 * Com o app aberto: o piu junto do banner. Só para o que já passou pelos filtros (tipo ligado,
 * conversa não silenciada); fica quieto no modo noturno, com "Som de piu" desligado e fora de
 * primeiro plano (aí quem toca é a notificação do sistema).
 */
export function chirpInApp(kind: NotifyKind) {
  const c = cfg;
  if (!c?.onboarded || !c.piu || !active || !c.notifs[kind as NotifKey]) return;
  if (c.quiet && isQuietHour()) return;
  void playPiu();
}

function ensureChannels() {
  if (Platform.OS !== 'android') return Promise.resolve();
  // O canal antigo dos alertas oficiais (CAP) sai: os alertas agora são da comunidade.
  void Notifications.deleteNotificationChannelAsync('piu-critical').catch(() => {});
  channelsReady ??= Promise.all((Object.keys(CHANNELS) as Mode[]).map(m => Notifications.setNotificationChannelAsync(channelId(m), CHANNELS[m]))).then(() => {}).catch(() => { channelsReady = null; });
  return channelsReady;
}

/** iPhone: a pessoa deixou as prévias "Quando desbloqueado" no sistema? */
let iosPreviewsWhenUnlocked = false;

/** Estado da permissão do sistema. */
export async function notificationPermission(): Promise<'granted' | 'denied' | 'undetermined'> {
  if (Platform.OS === 'web') {
    if (typeof Notification === 'undefined') return 'denied';
    return Notification.permission === 'default' ? 'undetermined' : Notification.permission;
  }
  const p = await Notifications.getPermissionsAsync();
  iosPreviewsWhenUnlocked = p.ios?.allowsPreviews === Notifications.IosAllowsPreviews.WHEN_AUTHENTICATED;
  return p.granted || p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied';
}

/** Pede a permissão (uma vez por instalação, salvo se a pessoa pedir de novo nos ajustes). */
export async function requestNotificationPermission(): Promise<boolean> {
  void persistNow('notif.asked', true).catch(() => {});
  if (Platform.OS === 'web') {
    if (typeof Notification === 'undefined') return false;
    return (await Notification.requestPermission()) === 'granted';
  }
  await ensureChannels(); // Android 13+: o pedido só aparece depois de existir um canal
  const p = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false, allowCriticalAlerts: false } });
  iosPreviewsWhenUnlocked = p.ios?.allowsPreviews === Notifications.IosAllowsPreviews.WHEN_AUTHENTICATED;
  return p.granted;
}

/** Conteúdo final conforme a pré-visualização (vale também para os alertas da comunidade). */
function present(n: NotifyInput, preview: Preview): { title: string; body: string } {
  if (preview === 'always') return { title: n.title, body: n.body };
  // "Desbloqueado": o sistema esconde o conteúdo na tela bloqueada (Android: canal PRIVATE;
  // iPhone: só se as prévias do sistema estiverem em "Quando desbloqueado"). Onde não dá para
  // garantir (web, iPhone com prévias sempre), vai o texto genérico.
  if (preview === 'unlocked' && (Platform.OS === 'android' || (Platform.OS === 'ios' && iosPreviewsWhenUnlocked))) return { title: n.title, body: n.body };
  return { title: 'Piu', body: HIDDEN_BODY[n.kind] };
}

/**
 * Dispara uma notificação do sistema, se os ajustes permitirem e o app não estiver em primeiro plano.
 * Devolve `true` se disparou.
 */
export const notify = (n: NotifyInput) => deliver(n, 0);

/**
 * Aviso de teste (Ajustes → Notificações): chega em 5 s, para dar tempo de bloquear a tela ou sair
 * do app e ver como fica com a pré-visualização escolhida.
 */
export const sendTestNotification = () =>
  deliver({ kind: 'msg', title: 'Piu · aviso de teste', body: 'Assim chega uma mensagem nova com a pré-visualização escolhida.', data: { href: '/lock' } }, 5);

async function deliver(n: NotifyInput, delaySec: number): Promise<boolean> {
  const c = cfg;
  if (!c || !c.onboarded || (active && !delaySec)) return false;
  const critical = !!n.critical;
  if (c.notifs[n.kind] === false) return false;
  const key = `${n.kind}|${n.title}|${n.body}`;
  if (key === last.key && Date.now() - last.at < 3000) return false;
  last = { key, at: Date.now() };

  const mode: Mode = critical ? 'critical' : c.quiet && isQuietHour() ? 'quiet' : c.discreet ? 'discreet' : c.piu ? 'piu' : 'normal';
  const { title, body } = present({ ...n, critical }, c.preview);
  const data = { ...n.data, kind: n.kind };

  try {
    if (Platform.OS === 'web') {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
      setTimeout(() => {
        const w = new Notification(title, { body, tag: n.data?.href ?? n.kind, silent: mode !== 'normal' && mode !== 'piu' && mode !== 'critical', data });
        w.onclick = () => { window.focus(); open(n.go, n.data?.href); w.close(); };
      }, delaySec * 1000);
      return true;
    }
    if ((await notificationPermission()) !== 'granted') return false;
    await ensureChannels();
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title, body, data,
        sound: mode === 'piu' ? 'piu.wav' : mode === 'normal' || mode === 'critical' ? 'default' : false,
        vibrate: mode === 'discreet' ? [0, 90] : undefined,
        interruptionLevel: critical ? 'timeSensitive' : mode === 'quiet' ? 'passive' : 'active',
        threadIdentifier: n.data?.href,
      },
      trigger: delaySec
        ? { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: delaySec, channelId: channelId(mode) }
        : Platform.OS === 'android' ? { channelId: channelId(mode) } : null,
    });
    if (n.go) { actions.set(id, n.go); if (actions.size > 50) actions.delete(actions.keys().next().value!); }
    return true;
  } catch {
    return false;
  }
}

function open(go: (() => void) | undefined, href: unknown) {
  if (!cfg?.onboarded) return;
  if (go) { go(); return; }
  if (typeof href === 'string' && href.startsWith('/')) router.push(href as Href);
}

/** Pede a permissão a partir da 2ª abertura depois do onboarding (nunca na primeira). */
const OPENS = 'notif.opens';

/**
 * Liga as notificações ao app. Monte uma vez, dentro de SettingsProvider e StoreProvider
 * (em `_layout.tsx`, junto do `<Toast />`).
 */
export function NotificationBridge() {
  const { preview, notifs, quiet, discreet, piuSound } = useSettings();
  const { onboarded } = useStore();
  cfg = { preview, notifs, quiet, discreet, piu: piuSound, onboarded };

  // Toque na notificação → abre a tela (com o app aberto, em segundo plano ou fechado).
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const handle = (r: Notifications.NotificationResponse | null) => {
      if (!r) return;
      const id = r.notification.request.identifier;
      const go = actions.get(id);
      actions.delete(id);
      open(go, r.notification.request.content.data?.href);
    };
    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    if (onboarded) {
      // App aberto pelo toque (estava fechado).
      Notifications.getLastNotificationResponseAsync().then(r => { if (r) { handle(r); void Notifications.clearLastNotificationResponseAsync(); } }).catch(() => {});
    }
    return () => sub.remove();
  }, [onboarded]);

  // Permissão no momento certo: não no primeiro abrir nem no meio do onboarding.
  useEffect(() => {
    if (!onboarded) return;
    const opens = (readPersisted<number>(OPENS) ?? 0) + 1;
    void persistNow(OPENS, opens).catch(() => {});
    if (opens < 2 || readPersisted<boolean>('notif.asked')) return;
    const t = setTimeout(() => {
      void notificationPermission().then(p => { if (p === 'undetermined' && active) void requestNotificationPermission(); }).catch(() => {});
    }, 4000);
    return () => clearTimeout(t);
  }, [onboarded]);

  // Ao voltar para o app, limpa as notificações já vistas.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = AppState.addEventListener('change', s => { if (s === 'active') void Notifications.dismissAllNotificationsAsync().catch(() => {}); });
    return () => sub.remove();
  }, []);

  return null;
}
