import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useT } from '../i18n';
import { autoCheckIsDue, canAutoCheck, openRelease, runUpdateCheck } from '../lib/update';
import { outcomeText } from '../lib/updateCore';
import { useSettings } from '../state/settings';
import { useStore } from '../state/store';

/** Espera depois de abrir o app, para não disputar a rede com o começo do mensageiro. */
const START_DELAY_MS = 8_000;

/**
 * Aviso automático de versão nova ("Avisar sobre novas versões", ligado de fábrica). No Android, com o
 * app aberto: no máximo uma checagem por dia que chegue ao GitHub. Sem internet não conta e tenta de novo
 * na próxima vez que o app voltar à frente. Só avisa quando há versão nova: banner discreto "Piu X
 * disponível", sem notificação do sistema; o toque abre a página da versão. Montado em app/_layout.tsx.
 */
export function UpdateWatch() {
  const { updateNotify } = useSettings();
  const { onboarded, showToast } = useStore();
  const t = useT();
  const latest = useRef({ showToast, t });
  latest.current = { showToast, t };
  useEffect(() => {
    if (!canAutoCheck || !updateNotify || !onboarded) return;
    let alive = true;
    const tryCheck = () => {
      if (!alive || !autoCheckIsDue()) return;
      void runUpdateCheck().then(o => {
        if (!alive || o.state !== 'available') return;
        const { showToast: show, t: tr } = latest.current;
        const { title, body } = outcomeText(o, tr);
        show({ icon: 'system_update_alt', title, body, action: tr('update.open'), go: () => { void openRelease(o.url); } });
      });
    };
    const timer = setTimeout(tryCheck, START_DELAY_MS);
    const sub = AppState.addEventListener('change', s => { if (s === 'active') tryCheck(); });
    return () => { alive = false; clearTimeout(timer); sub.remove(); };
  }, [updateNotify, onboarded]);
  return null;
}
