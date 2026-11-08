import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { router } from 'expo-router';
import { CallReminders } from '../calls/callRemind';
import type { Chat } from '../data/types';
import { t } from '../i18n/core';
import { cancelNotice, scheduleNotice } from '../lib/notifications';
import { useStore } from './store';

/**
 * "Em 10 min" ao recusar uma chamada, no celular (src/calls/callRemind.ts): notificação local
 * "Ligar para {name}" agendada no sistema (expo-notifications, lib/notifications.ts, com os ajustes de
 * notificação e de pré-visualização) e, com o app aberto na hora, o banner do app no lugar dela.
 * Tocar abre a conversa, onde fica o botão de ligar.
 */
export function phoneReminders(d: { nameOf(peer: string): string; chatIdFor(peer: string): string }, show: (peer: string) => void) {
  return new CallReminders({
    schedule: (peer, sec) => scheduleNotice({
      kind: 'msg', title: t('call.remind.title', { name: d.nameOf(peer) }), body: t('call.remind.body'), data: { href: `/chat/${d.chatIdFor(peer)}` },
    }, sec),
    cancel: cancelNotice,
    active: () => AppState.currentState === 'active',
    show,
  });
}

/** Banner do lembrete com o app aberto (o mesmo dos avisos de mensagem, conforme a pré-visualização). */
export function useReminderBanner(onRemind: ((fn: (peer: string) => void) => () => void) | undefined, chats: Chat[]) {
  const { showToast } = useStore();
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  useEffect(() => onRemind?.(peer => {
    const c = chatsRef.current.find(x => x.peer === peer);
    if (!c) return;
    showToast({
      icon: 'call', av: c.initials, title: t('call.remind.title', { name: c.name }), body: t('call.remind.body'),
      hidden: { title: 'Piu', body: t('notify.hidden.msg') },
      go: () => router.push({ pathname: '/chat/[id]', params: { id: c.id } }),
    });
  }), [onRemind, showToast]);
}
