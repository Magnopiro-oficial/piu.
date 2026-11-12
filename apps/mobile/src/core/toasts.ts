/**
 * Banners e notificações sem tela. Com a tela desmontada (deslizar o app dos recentes) ou o núcleo
 * subindo pela tarefa sem tela, quem decide se avisa é o que está salvo em Ajustes → Notificações,
 * não um componente montado:
 * - `persistedNotifyCfg`: os ajustes de notificação lidos do salvo, com os mesmos padrões de
 *   state/settings.tsx (lib/notifications.ts lê daqui a cada aviso).
 * - `createToasts`: barramento de banners. Com tipo, toca o piu e vira notificação do sistema (que não
 *   dispara com o app aberto); o banner dentro do app só vai a quem assina `onBanner` (o <Toast/>).
 * Sem react-native: roda no app (core/chatStore.ts) e nos testes.
 */
import { DEFAULT_NOTIFS, type NotifKey, type Preview } from '../data/settings';
import type { ToastData } from '../data/types';
import { SOUND_DEFAULTS } from '../lib/piuChirp';

export interface NotifyCfg { preview: Preview; notifs: Record<NotifKey, boolean>; quiet: boolean; discreet: boolean; piu: boolean; onboarded: boolean }

/** Ajustes de notificação salvos (chaves e padrões de state/settings.tsx; o padrão não é gravado). */
export function persistedNotifyCfg(read: <T>(key: string) => T | undefined): NotifyCfg {
  return {
    preview: read<Preview>('set.preview') ?? 'always',
    // Tipo novo (ex.: Alertas da comunidade) entra com o padrão em quem já tinha os ajustes salvos.
    notifs: { ...DEFAULT_NOTIFS, ...read<Record<NotifKey, boolean>>('set.notifs') },
    quiet: read<boolean>('set.quiet') ?? SOUND_DEFAULTS.quiet,
    discreet: read<boolean>('set.discreet') ?? SOUND_DEFAULTS.discreet,
    piu: read<boolean>('set.piuSound') ?? SOUND_DEFAULTS.piu,
    onboarded: read<boolean>('onboarded') === true,
  };
}

type Kind = NonNullable<ToastData['kind']>;
export interface ToastDeps {
  /** Notificação do sistema (lib/notifications.ts: confere tipos ligados, silêncio, prévia e app aberto). */
  notify: (n: { kind: Kind; title: string; body: string; go?: () => void; critical?: boolean; data?: { href: string } }) => void;
  /** O piu dentro do app. */
  chirp: (kind: Kind) => void;
  /** Ajustes de agora (o salvo: `persistedNotifyCfg`). */
  cfg: () => Pick<NotifyCfg, 'notifs'>;
}

export type Toasts = ReturnType<typeof createToasts>;

export function createToasts(deps: ToastDeps) {
  const banners = new Set<(t: ToastData) => void>();
  return {
    /**
     * Banner com `kind` também vira notificação do sistema quando o app não está em primeiro plano
     * (`notify` confere tipos ligados, silêncio e prévia, e não dispara com o app aberto). Tipo
     * desligado em Ajustes → Notificações: nada aparece. O banner dentro do app (já conforme a
     * pré-visualização) é da tela que assina `onBanner`.
     */
    show: (t: ToastData) => {
      if (t.kind && deps.cfg().notifs[t.kind] === false) return;
      if (t.kind) deps.chirp(t.kind);
      if (t.kind) deps.notify({ kind: t.kind, title: t.title, body: t.body, go: t.go, ...(t.critical ? { critical: true } : {}), ...(t.href ? { data: { href: t.href } } : {}) });
      banners.forEach(fn => { try { fn(t); } catch { /* ouvinte */ } });
    },
    onBanner: (fn: (t: ToastData) => void) => { banners.add(fn); return () => { banners.delete(fn); }; },
  };
}
