import Constants from 'expo-constants';
import { useCallback, useState } from 'react';
import { Platform } from 'react-native';
import { PiuAppShare } from '../../modules/piu-app-share';
import { useStore } from '../state/store';
import { apkShareName, appShareError, canSendApp } from './appShare';
import { type ApkIntegrity, normalizeIntegrity } from './apkIntegrity';

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

let integrityOnce: Promise<ApkIntegrity | null> | null = null;
/**
 * SHA-256 do instalador e do certificado (B-03), do módulo nativo. Nunca lança: null se o build não tem a
 * função, se o app veio em partes da loja ou se o cálculo falhar (o envio segue igual, só sem os valores).
 */
export function loadApkIntegrity(): Promise<ApkIntegrity | null> {
  const fn = PiuAppShare?.integrity;
  if (!PiuAppShare || typeof fn !== 'function') return Promise.resolve(null);
  if (!integrityOnce) {
    integrityOnce = fn.call(PiuAppShare).then(normalizeIntegrity, () => null);
    void integrityOnce.then(v => { if (!v) integrityOnce = null; }); // falhou: tenta de novo na próxima vez
  }
  return integrityOnce;
}
