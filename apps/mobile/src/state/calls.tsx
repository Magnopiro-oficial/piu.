import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { isLora } from '../transport/select';
import { AccessibilityInfo, PermissionsAndroid, Platform } from 'react-native';
import { router } from 'expo-router';
import PiuVoice from '../../modules/piu-voice';
import { routeOfMedium } from '../calls/callMedia';
import { CallService, type AudioEngine } from '../calls/callService';
import { LIVE_SIGNAL_TTL_SEC, REQUEST_TTL_SEC } from '../calls/callSignals';
import { callRecordMsg } from '../calls/callChat';
import { contactOf, requestCard, type Tr } from '../calls/callView';
import type { Chat, Msg } from '../data/types';
import { t } from '../i18n/core';
import { b64url } from '../messaging/card';
import { random } from '../protocol/suite';
import type { Messenger } from '../messaging/messenger';
import { nowHM } from '../lib/text';
import type { Medium } from '../transport/types';
import { CallContext, type CallApi } from '../ui/call/CallContext';

/**
 * Chamada de voz no celular: o `CallService` (src/calls) ligado ao mensageiro (sinais dentro da sessão
 * cifrada do contato), ao transporte (quadros de voz direto aos vizinhos) e ao módulo nativo piu-voice
 * (microfone com cancelamento de eco, Opus/PCMU). Sem o módulo (iPhone, web, Expo Go) não há chamada:
 * o provedor fica `null` e nada da chamada aparece.
 */

const tr = t as unknown as Tr;

/** Microfone e alto-falante do módulo nativo. A permissão do microfone é pedida só aqui, ao conectar. */
export function phoneAudio(onMicDenied: () => void): AudioEngine {
  let sub: { remove(): void } | null = null;
  return {
    async start(onFrame) {
      if (Platform.OS === 'android') {
        const got = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
        if (got !== PermissionsAndroid.RESULTS.GRANTED) { onMicDenied(); throw new Error(t('call.err.mic')); }
      }
      sub?.remove();
      sub = PiuVoice.addFrameListener(onFrame);
      await PiuVoice.start();
    },
    stop() { sub?.remove(); sub = null; PiuVoice.stop(); },
    play: (codec, payload, seq) => PiuVoice.play(codec, payload, seq),
    setMuted: m => PiuVoice.setMuted(m),
    setSpeaker: on => PiuVoice.setSpeaker(on),
    levels: () => PiuVoice.levels(),
  };
}

export type PhoneCallDeps = {
  messenger: Messenger;
  send(peerId: string, bytes: Uint8Array): Promise<void>;
  /** Meio de cada vizinho conectado agora (o mesmo mapa do MessagingProvider). */
  media: Map<string, Medium>;
  chatIdFor(contactId: string): string;
  receive(chatId: string, msg: Msg, opts?: { quiet?: boolean }): void;
  patchMsg(chatId: string, msgId: string, p: Partial<Msg>): void;
  nameOf(contactId: string): string;
};

/** O serviço e os avisos escuros dele (o provedor das telas assina). */
export type PhoneCall = { svc: CallService; onToast(fn: (text: string) => void): () => void };

const newId = () => b64url(random(16));

export function makePhoneCall(d: PhoneCallDeps): PhoneCall {
  const toasts = new Set<(text: string) => void>();
  const say = (text: string) => toasts.forEach(f => f(text));
  const svc = new CallService({
    now: () => Date.now(),
    newId,
    sendSignal: (peer, wire, live) => {
      try {
        return d.messenger.sendCallSignal(peer, wire, live
          ? { live: true, ttlSec: LIVE_SIGNAL_TTL_SEC }
          : { live: false, ttlSec: REQUEST_TTL_SEC, msgId: wire.s.t === 'request' ? wire.s.requestId : undefined });
      } catch { return false; }
    },
    record: rec => {
      const m = callRecordMsg(rec, d.nameOf(rec.peer));
      d.receive(d.chatIdFor(rec.peer), m, { quiet: m.from !== 'them' });
    },
    requestUpdate: (peer, requestId, step, dir) => {
      const cid = d.chatIdFor(peer), id = `callreq-${requestId}`, text = requestCard(tr, step, contactOf(d.nameOf(peer))).title;
      if (step === 'traveling' || (dir === 'in' && step === 'delivered')) d.receive(cid, { id, from: dir === 'out' ? 'me' : 'sys', time: nowHM(), at: Date.now(), text, callReq: { requestId, step } }, { quiet: true });
      else d.patchMsg(cid, id, { text, callReq: { requestId, step } });
    },
    toast: (text, peer) => say(text === 'verified' ? t('call.toast.verified') : text === 'remindLater' ? t('call.toast.remind')
      : t('call.toast.requestLater', { first: contactOf(peer ? d.nameOf(peer) : '').first })),
    draft: peer => router.push({ pathname: '/chat/[id]', params: { id: d.chatIdFor(peer) } }),
    liveRouteTo: peer => {
      const link = d.messenger.directLink(peer, 120);
      const medium = link ? d.media.get(link) : undefined;
      return medium && !isLora(medium) ? routeOfMedium(medium, false) : null;
    },
    // LoRa não carrega voz ao vivo (~1 kbps compartilhado): fica fora dos enlaces da chamada.
    links: () => [...d.media].filter(([, m]) => !isLora(m)).map(([peerId, medium]) => ({ peerId, medium })),
    sendFrame: (peerId, frame) => { void d.send(peerId, frame).catch(() => {}); },
    audio: phoneAudio(() => say(t('call.err.mic'))),
  });
  return { svc, onToast: fn => { toasts.add(fn); return () => { toasts.delete(fn); }; } };
}

/** O serviço da chamada criado pelo MessagingProvider (`null` sem módulo de áudio ou sem mensageiro). */
export const CallServiceCtx = createContext<PhoneCall | null>(null);

/** Transforma o serviço na `CallApi` que as telas (src/ui/call) usam. */
export function CallsProvider({ children, chats, onlyLora }: { children: ReactNode; chats: Chat[]; onlyLora?: boolean }) {
  const call = useContext(CallServiceCtx);
  const svc = call?.svc ?? null;
  const [toast, setToast] = useState<{ text: string; seq: number } | null>(null);
  const [soft, setSoft] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setSoft).catch(() => {});
    const s = AccessibilityInfo.addEventListener('reduceMotionChanged', setSoft);
    return () => s.remove();
  }, []);
  // Versão que muda a cada mudança do serviço (estado, palavras, latência).
  const ver = useSyncExternalStore(fn => (svc ? svc.subscribe(fn) : () => {}), () => (svc ? svc.state : null), () => null);
  useEffect(() => call?.onToast(text => setToast(x => ({ text, seq: (x?.seq ?? 0) + 1 }))), [call]);

  const api = useMemo<CallApi | null>(() => {
    if (!svc) return null;
    const s = svc.state;
    const chat = s.peer ? chats.find(c => c.peer === s.peer) : undefined;
    const direct = (id: string) => { const c = chats.find(x => x.id === id); return c?.peer && c.kind === 'direct' && !c.request ? c : null; };
    return {
      controller: svc.controller,
      scene: s.phase === 'idle' || !s.peer ? null : {
        state: s, contact: contactOf(chat?.name ?? ''), words: svc.words,
        ...(svc.latencyMs !== undefined ? { latencyMs: svc.latencyMs } : {}),
        levels: () => svc.levels(), soft,
        ...(onlyLora ? { lora: true } : {}),
      },
      callChat: id => { const c = direct(id); if (c) svc.open(c.peer!); },
      canCall: id => !!direct(id),
      toast,
      now: () => Date.now(),
    };
  }, [svc, ver, chats, toast, soft, onlyLora]); // eslint-disable-line react-hooks/exhaustive-deps

  return <CallContext.Provider value={api}>{children}</CallContext.Provider>;
}
