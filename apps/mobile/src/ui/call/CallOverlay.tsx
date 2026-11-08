import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { BackHandler, View } from 'react-native';
import { IDLE } from '../../calls/callMachine';
import { CallScreen, type CallPerf } from './CallScreen';
import { useCall, type CallApi } from './CallContext';
import { CallBanner, CallToast, MiniPill, RequestNotice } from './CallNotices';
import { PreSheet } from './PreSheet';
import { useLast, usePresence } from './anim';

/**
 * Tudo da chamada que fica por cima do app (montado no layout raiz): folha "pre", tela cheia, aviso
 * no topo, notificação de pedido, pílula minimizada e aviso escuro. Sem provedor de chamada, nada.
 */
export function CallOverlay({ onPerf }: { onPerf?: (p: CallPerf) => void }) {
  const api = useCall();
  return api ? <Overlay api={api} onPerf={onPerf} /> : null;
}

function Overlay({ api, onPerf }: { api: CallApi; onPerf?: (p: CallPerf) => void }) {
  const { controller } = api;
  const scene = useLast(api.scene);
  const s = api.scene?.state ?? IDLE;
  const now = api.now ?? Date.now;
  // Aviso no topo → tocar no corpo abre a tela de toque em tela cheia.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const expanded = s.phase === 'ringing' && !!s.callId && (expandedId === s.callId || api.shownCallId === s.callId);

  const full = s.phase === 'calling' || s.phase === 'ending' || (s.phase === 'active' && !s.mini) || (s.phase === 'ringing' && (expanded || !!api.locked));
  const banner = s.phase === 'ringing' && !full;
  const pre = s.phase === 'pre';
  const req = s.phase === 'reqIn';
  const mini = s.phase === 'active' && s.mini;
  // Cada peça fica montada enquanto aparece e durante a saída animada.
  const fullM = usePresence(full, 700);
  const preM = usePresence(pre, 600);
  const bannerM = usePresence(banner, 650);
  const reqM = usePresence(req, 650);
  const miniM = usePresence(mini, 500);

  // Voltar do Android: fecha a folha, fecha as palavras, minimiza; durante o toque, não sai da chamada.
  useEffect(() => {
    if (!pre && !full) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const st = controller.state;
      if (st.phase === 'pre') controller.dispatch({ type: 'closePre' });
      else if (st.phase === 'active' && st.wordsOpen) controller.dispatch({ type: 'closeWords' });
      else if (st.phase === 'active') controller.dispatch({ type: 'minimize' });
      return true;
    });
    return () => sub.remove();
  }, [pre, full, controller]);

  if (!scene) return null;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
      {full && <StatusBar style="light" animated />}
      {fullM && <CallScreen scene={scene} controller={controller} on={full} locked={api.locked} now={now} onPerf={onPerf} />}
      {preM && <PreSheet scene={scene} on={pre} controller={controller} onRecordAudio={api.onRecordAudio} />}
      {bannerM && <CallBanner scene={scene} on={banner} controller={controller} onExpand={() => setExpandedId(s.callId ?? null)} />}
      {reqM && <RequestNotice scene={scene} on={req} controller={controller} />}
      {miniM && <MiniPill scene={scene} on={mini} controller={controller} now={now} />}
      <CallToast toast={api.toast} onDark={full} />
    </View>
  );
}
