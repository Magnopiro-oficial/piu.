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
import { t, type Key } from '../i18n/core';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import type { NotifKey, Preview } from '../data/settings';
import { useSettings } from '../state/settings';
import { useStore } from '../state/store';
import { playPiu, preloadPiu } from './piuSound';
import { canChirp, isQuietHour, notifyMode, type Mode } from './piuChirp';
import { PiuCallAlert } from '../../modules/piu-voice/alert';
import { persistNow, readPersisted } from './persist';
import { badgeAfterOpen, nextBadgeCount } from './badgeCount';

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

/** Texto genérico quando o conteúdo fica oculto (design: "Piu · Nova mensagem"), no idioma do app. */
const HIDDEN_BODY: Record<NotifyKind, Key> = {
  msg: 'notify.hidden.msg', group: 'notify.hidden.msg', channel: 'notify.hidden.channel', nearby: 'notify.hidden.nearby',
  wallet: 'notify.hidden.wallet', network: 'notify.hidden.network', alert: 'notify.hidden.alert',
};

/** Nome e descrição saem no idioma em uso quando o canal é criado (ids fixos; o nome só muda se o canal for recriado). */
const CHANNELS = (): Record<Mode, Notifications.NotificationChannelInput> => ({
  normal: { name: t('channel.normal'), importance: Notifications.AndroidImportance.HIGH, sound: 'default', enableVibrate: true, vibrationPattern: [0, 250, 120, 250], lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE },
  piu: { name: t('channel.piu'), description: t('channel.piu.desc'), importance: Notifications.AndroidImportance.HIGH, sound: 'piu.wav', enableVibrate: true, vibrationPattern: [0, 250, 120, 250], lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE },
  discreet: { name: t('channel.discreet'), description: t('channel.discreet.desc'), importance: Notifications.AndroidImportance.HIGH, sound: null, enableVibrate: true, vibrationPattern: [0, 90], lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE },
  quiet: { name: t('channel.quiet'), description: t('channel.quiet.desc'), importance: Notifications.AndroidImportance.LOW, sound: null, enableVibrate: false, vibrationPattern: null, lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE },
  critical: { name: t('channel.critical'), description: t('channel.critical.desc'), importance: Notifications.AndroidImportance.MAX, sound: 'default', enableVibrate: true, vibrationPattern: [0, 600, 200, 600, 200, 600], lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE },
});
/** `critical-c`: canal novo (o antigo `piu-critical` era dos alertas oficiais, visível na tela bloqueada). */
const channelId = (m: Mode) => (m === 'critical' ? 'piu-critical-c' : `piu-${m}`);

let cfg: Cfg | null = null;
let active = AppState.currentState === 'active';
let channelsReady: Promise<void> | null = null;
/** Ações de toque das notificações postadas nesta execução. */
const actions = new Map<string, () => void>();
/** Evita duplicar quando `notify` e o espelho do banner disparam a mesma coisa. */
let last = { key: '', at: 0 };
/** Número no ícone do app (lib/badgeCount.ts): soma a cada aviso comum, zera ao abrir o app. */
let badgeCount = 0;

function setBadge(n: number) {
  if (Platform.OS === 'web') return;
  badgeCount = n;
  void Notifications.setBadgeCountAsync(n).catch(() => {});
}

AppState.addEventListener('change', s => { active = s === 'active'; });

// Em primeiro plano o app mostra o banner in-app; o sistema não repete.
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

export { isQuietHour };

/** O piu ao abrir o app já tocou nesta execução. */
let launchChirped = false;

/**
 * Com o app aberto: o piu junto do banner, numa conversa aberta ou ao abrir o app (sem `kind`). Só
 * para o que já passou pelos filtros (tipo ligado, conversa não silenciada); as regras estão em
 * lib/piuChirp.ts (modo noturno, "Som de piu", primeiro plano, silencioso do Android).
 */
export function chirpInApp(kind?: NotifyKind) {
  if (canChirp(cfg, { kind, active, ringer: PiuCallAlert.ringerMode() })) void playPiu();
}

function ensureChannels() {
  if (Platform.OS !== 'android') return Promise.resolve();
  // O canal antigo dos alertas oficiais (CAP) sai: os alertas agora são da comunidade.
  void Notifications.deleteNotificationChannelAsync('piu-critical').catch(() => {});
  const channels = CHANNELS();
  channelsReady ??= Promise.all((Object.keys(channels) as Mode[]).map(m => Notifications.setNotificationChannelAsync(channelId(m), channels[m]))).then(() => {}).catch(() => { channelsReady = null; });
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
  // `allowBadge`: o número no ícone do app (iPhone só mostra com essa permissão).
  const p = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: true, allowCriticalAlerts: false } });
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
  return { title: 'Piu', body: t(HIDDEN_BODY[n.kind]) };
}

/**
 * Dispara uma notificação do sistema, se os ajustes permitirem e o app não estiver em primeiro plano.
 * Devolve `true` se disparou.
 */
export const notify = async (n: NotifyInput) => (await deliver(n, 0)) !== null;

/**
 * Aviso de teste (Ajustes → Notificações, "Testar com o app fechado"): chega em 5 s, para dar tempo
 * de fechar o app ou bloquear a tela e ver como fica com a pré-visualização escolhida. O toque abre
 * a lista de Conversas (`/(tabs)`): é o que acontece com uma mensagem real; a prévia da tela
 * bloqueada (`/lock`) continua acessível pelo link "Ver na tela bloqueada" na mesma tela.
 */
export const sendTestNotification = async () =>
  (await deliver({ kind: 'msg', title: t('notify.test.title'), body: t('notify.test.body'), data: { href: '/(tabs)' } }, 5)) !== null;

/**
 * Lembrete agendado (chamada recusada com "Em 10 min", src/calls/callRemind.ts): chega daqui a
 * `delaySec` s com o app aberto ou fechado, conforme os ajustes. Não soma no número do ícone (não é
 * nada novo de alguém). Devolve o id para `cancelNotice`, ou `null` se não agendou.
 */
export const scheduleNotice = (n: NotifyInput, delaySec: number) => deliver(n, Math.max(1, Math.round(delaySec)), false);

/** Desagenda um lembrete e, se ele já chegou, tira da lista de notificações. */
export function cancelNotice(id: string) {
  if (Platform.OS === 'web') return;
  actions.delete(id);
  void Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
  void Notifications.dismissNotificationAsync(id).catch(() => {});
}

/** Entrega (ou agenda, com `delaySec`) e devolve o id da notificação; `null` se não disparou. */
async function deliver(n: NotifyInput, delaySec: number, countBadge = true): Promise<string | null> {
  const c = cfg;
  if (!c || !c.onboarded || (active && !delaySec)) return null;
  const critical = !!n.critical;
  if (c.notifs[n.kind] === false) return null;
  const key = `${n.kind}|${n.title}|${n.body}`;
  if (key === last.key && Date.now() - last.at < 3000) return null;
  last = { key, at: Date.now() };

  const mode: Mode = notifyMode(c, critical);
  const { title, body } = present({ ...n, critical }, c.preview);
  const data = { ...n.data, kind: n.kind };

  try {
    if (Platform.OS === 'web') {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return null;
      setTimeout(() => {
        const w = new Notification(title, { body, tag: n.data?.href ?? n.kind, silent: mode !== 'normal' && mode !== 'piu' && mode !== 'critical', data });
        w.onclick = () => { window.focus(); open(n.go, n.data?.href); w.close(); };
      }, delaySec * 1000);
      return `web-${key}`;
    }
    if ((await notificationPermission()) !== 'granted') return null;
    await ensureChannels();
    // Número no ícone: alertas críticos não contam. `badge` no conteúdo vale quando a notificação
    // chega (iPhone, inclusive a agendada); `setBadgeCountAsync` cobre o launcher do Android agora.
    const badge = countBadge ? nextBadgeCount(badgeCount, { critical }) : badgeCount;
    const counts = badge !== badgeCount;
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title, body, data,
        badge: counts ? badge : undefined,
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
    // Agendada com o app aberto (aviso de teste): o número só muda quando ela chegar, pelo `badge` acima.
    if (counts) { if (active) badgeCount = badge; else setBadge(badge); }
    return id;
  } catch {
    return null;
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
  // Carrega o piu de antemão: o primeiro aviso não espera o arquivo abrir.
  useEffect(() => { if (piuSound && Platform.OS !== 'web') preloadPiu(); }, [piuSound]);

  // O piu ao abrir o app: uma vez por execução, com o cadastro feito e o app na frente. Aberto por
  // cima do bloqueio (chamada recebida) fica quieto: quem toca é a chamada.
  useEffect(() => {
    if (!onboarded || Platform.OS === 'web') return;
    const hello = () => {
      if (launchChirped || !active || PiuCallAlert.isLocked()) return;
      launchChirped = true;
      chirpInApp();
    };
    hello();
    const sub = AppState.addEventListener('change', s => { if (s === 'active') hello(); });
    return () => sub.remove();
  }, [onboarded]);

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

  // Ao voltar para o app, limpa as notificações já vistas e zera o número no ícone.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const clear = () => { void Notifications.dismissAllNotificationsAsync().catch(() => {}); setBadge(badgeAfterOpen()); };
    if (active) clear(); // já aberto ao montar (o sistema pode ter guardado um número de antes)
    const sub = AppState.addEventListener('change', s => { if (s === 'active') clear(); });
    return () => sub.remove();
  }, []);

  return null;
}
