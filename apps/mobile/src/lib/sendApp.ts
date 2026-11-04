import Constants from 'expo-constants';
import { useCallback, useState } from 'react';
import { Platform } from 'react-native';
import { PiuAppShare } from '../../modules/piu-app-share';
import { useStore } from '../state/store';
import { apkShareName, appShareError, canSendApp } from './appShare';

/**
 * "Enviar o Piu" (regra 6.1): o instalador deste celular vai para o outro por Bluetooth ou Quick
 * Share, sem loja e sem internet. `canSend` é falso fora do Android nativo.
 */
export function useSendApp() {
  const { showToast } = useStore();
  const [sending, setSending] = useState(false);
  const send = useCallback(async () => {
    if (!PiuAppShare || sending) return;
    setSending(true);
    try { await PiuAppShare.shareApk(apkShareName(Constants.expoConfig?.version ?? ''), 'Enviar o Piu'); }
    catch (e) { showToast({ icon: 'error', ...appShareError((e as { code?: string })?.code ?? '') }); }
    finally { setSending(false); }
  }, [sending, showToast]);
  return { canSend: canSendApp(Platform.OS, !!PiuAppShare), sending, send };
}
