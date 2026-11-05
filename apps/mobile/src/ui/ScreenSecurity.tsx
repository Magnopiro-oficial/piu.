import { useFocusEffect } from 'expo-router';
import * as ScreenCapture from 'expo-screen-capture';
import { useCallback } from 'react';
import { Platform } from 'react-native';
import { SCREEN_SECURITY_KEY, shouldPreventCapture } from '../lib/screenSecurity';
import { useSettings } from '../state/settings';

/**
 * "Segurança da tela" (Ajustes → Privacidade) na tela da conversa (`app/chat/[id].tsx`): com o
 * ajuste ligado, no Android a conversa em foco recebe FLAG_SECURE (`preventScreenCaptureAsync`,
 * expo-screen-capture SDK 58): sem print nem gravação, prévia em branco nos apps recentes. Ao sair
 * da conversa (perder o foco ou desmontar) ou ao desligar o ajuste, libera (`allowScreenCaptureAsync`).
 * Chave própria, para não brigar com o bloqueio da tela de backup (`usePreventCapture('backup')`):
 * cada chave é liberada por si. No iPhone e na web não faz nada.
 */
export function useChatScreenSecurity(): void {
  const { screenSecurity } = useSettings();
  const active = shouldPreventCapture(Platform.OS, screenSecurity);
  useFocusEffect(useCallback(() => {
    if (!active) return;
    ScreenCapture.preventScreenCaptureAsync(SCREEN_SECURITY_KEY).catch(() => {});
    // A limpeza roda ao perder o foco, ao desmontar e quando `active` muda (ajuste desligado na conversa).
    return () => { ScreenCapture.allowScreenCaptureAsync(SCREEN_SECURITY_KEY).catch(() => {}); };
  }, [active]));
}
