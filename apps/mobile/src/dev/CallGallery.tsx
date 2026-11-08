/**
 * SÓ DESENVOLVIMENTO (importado por src/app/__dev/call.tsx atrás de `__DEV__`; fora do build de produção).
 * Os 7 cenários do protótipo Piu 14 (out · inapp · lock · bt · mesh · reqin · missed), intensa/suave,
 * com as MESMAS peças do app (src/ui/call/*) dirigidas por um `CallController` real. As portas de
 * exemplo fazem o papel do outro lado nos tempos do protótipo, e os níveis de voz seguem a fórmula de
 * simulação do §5.4 — nada disso existe fora desta galeria.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CallController, type CallPorts } from '../calls/callController';
import type { CallRecord, LiveRoute } from '../calls/callMachine';
import { contactOf, type CallScene, type RequestStep } from '../calls/callView';
import { useT } from '../i18n';
import { useTheme } from '../theme/ThemeProvider';
import { Avatar } from '../ui/Avatar';
import { Icon, type IconName } from '../ui/Icon';
import { T } from '../ui/T';
import { CallButton, CallRecordCard, CallRequestCard } from '../ui/call/CallCards';
import { CallContext, useCallState, type CallApi } from '../ui/call/CallContext';
import { CallOverlay } from '../ui/call/CallOverlay';
import type { CallPerf } from '../ui/call/CallScreen';

type Scen = 'out' | 'inapp' | 'lock' | 'bt' | 'mesh' | 'reqin' | 'missed';
const SCENS: [Scen, string, string][] = [
  ['out', 'Fazer uma chamada', 'Direto pelo Wi-Fi local'], ['inapp', 'Receber com o app aberto', 'Aviso no topo, um toque'],
  ['lock', 'Receber com a tela bloqueada', 'Tela cheia de toque'], ['bt', 'Sem Wi-Fi nenhum', 'Direto por Bluetooth, até ~30 m'],
  ['mesh', 'Sem caminho ao vivo', 'Vira pedido de chamada'], ['reqin', 'Receber um pedido', 'Chegou pela malha'], ['missed', 'Chamada perdida', 'Ligar de volta'],
];
const LATENCY: Record<LiveRoute, number> = { direct: 18, bt: 42, point: 64 };
const WORDS = ['lua', 'ponte', 'sal', 'rio'];
const PEER = 'piu:demo';
const HOPS = 3;

type Item = { k: 'text'; who: 'me' | 'them'; text: string; time: string } | { k: 'rec'; rec: CallRecord; time: string } | { k: 'req'; time: string };

const clock = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const newId = () => Math.random().toString(36).slice(2, 12);

/** Voz simulada do protótipo (§5.4): turno pelo seno lento, sílabas pelos senos rápidos. */
function simulatedLevels(t: number) {
  const g = Math.sin(t * 0.55 + 0.3);
  const raw = 0.35 + 0.65 * Math.abs(Math.sin(t * 11.3) * Math.sin(t * 6.1 + 0.7));
  const amp = Math.abs(g) > 0.12 ? raw * Math.min(1, (Math.abs(g) - 0.12) * 5) : 0;
  return g > 0.12 ? { mine: 0, theirs: amp } : g < -0.12 ? { mine: amp, theirs: 0 } : { mine: 0, theirs: 0 };
}

export default function CallGallery() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string; anim?: string }>();
  const [scen, setScen] = useState<Scen>(SCENS.some(s => s[0] === params.id) ? (params.id as Scen) : 'out');
  const [soft, setSoft] = useState(params.anim === 'suave');
  const [seq, setSeq] = useState(0);
  const [perf, setPerf] = useState<CallPerf | null>(null);
  const [weak, setWeak] = useState<{ label: string; run: () => void } | null>(null);
  const play = (s: Scen) => { setScen(s); setSeq(n => n + 1); setPerf(null); };
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ flex: 1, overflow: 'hidden' }}>
        <Demo key={`${scen}-${seq}`} scen={scen} soft={soft} onPerf={setPerf} onWeak={setWeak} />
      </View>
      <View style={{ paddingTop: 8, paddingBottom: Math.max(insets.bottom, 8), borderTopWidth: 1, borderTopColor: c.line, backgroundColor: c.bg, gap: 8 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 10, gap: 6 }}>
          {SCENS.map(([id, title, sub], i) => (
            <Pressable key={id} onPress={() => play(id)} accessibilityRole="button" accessibilityState={{ selected: scen === id }}
              style={{ minHeight: 44, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: scen === id ? c.ink : c.bg2, justifyContent: 'center' }}>
              <T size={12.5} w={620} color={scen === id ? c.invink : c.ink}>{String(i + 1).padStart(2, '0')} · {title}</T>
              <T size={11} color={scen === id ? c.invink : c.ink2} style={{ opacity: 0.75 }}>{sub}</T>
            </Pressable>
          ))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center', gap: 6, paddingHorizontal: 10 }}>
          {(['intensa', 'suave'] as const).map(a => (
            <Pressable key={a} onPress={() => setSoft(a === 'suave')} accessibilityRole="button" accessibilityState={{ selected: soft === (a === 'suave') }}
              style={{ height: 44, paddingHorizontal: 14, borderRadius: 22, justifyContent: 'center', backgroundColor: soft === (a === 'suave') ? c.ink : c.bg2 }}>
              <T size={13} w={600} color={soft === (a === 'suave') ? c.invink : c.ink}>{a}</T>
            </Pressable>
          ))}
          <Pressable onPress={() => play(scen)} accessibilityRole="button" accessibilityLabel="Recomeçar"
            style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg2 }}>
            <Icon name="replay" size={20} />
          </Pressable>
          {weak && (
            <Pressable onPress={weak.run} accessibilityRole="button"
              style={{ height: 44, paddingHorizontal: 14, borderRadius: 22, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: c.line2 }}>
              <Icon name="wifi_off" size={18} />
              <T size={13} w={600}>{weak.label}</T>
            </Pressable>
          )}
          {perf && <T size={11} mono color={c.ink2}>JS {perf.ms.toFixed(2)} ms/quadro · {perf.buckets} faixas · {perf.dots} pontos</T>}
        </ScrollView>
      </View>
    </View>
  );
}

/** Um cenário: controlador real + portas de exemplo que simulam o outro lado. */
function Demo({ scen, soft, onPerf, onWeak }: { scen: Scen; soft: boolean; onPerf: (p: CallPerf) => void; onWeak: (w: { label: string; run: () => void } | null) => void }) {
  const t = useT();
  const { reduceMotion } = useTheme();
  const contact = useMemo(() => contactOf(scen === 'reqin' ? 'Ana Souza' : 'Marina Alves'), [scen]);
  const [route, setRoute] = useState<LiveRoute | 'mesh'>(scen === 'mesh' ? 'mesh' : scen === 'bt' || scen === 'lock' ? 'bt' : 'direct');
  const routeRef = useRef(route);
  routeRef.current = route;
  const [items, setItems] = useState<Item[]>(() => {
    const base: Item[] = scen === 'reqin'
      ? [{ k: 'text', who: 'them', text: 'Chegou o material da horta comunitária', time: '13:40' }, { k: 'text', who: 'me', text: 'Que ótimo! Passo aí no sábado', time: '13:42' }]
      : [{ k: 'text', who: 'them', text: 'Consegui a extensão de 10 m pro mutirão', time: '14:02' }, { k: 'text', who: 'me', text: 'Boa! Te ligo pra combinar o horário', time: '14:03' }];
    if (scen === 'missed') base.push({ k: 'rec', time: '14:05', rec: { callId: 'missed', peer: PEER, dir: 'in', outcome: 'missed', at: Date.now(), rangMs: 22_000, route: 'direct' } });
    return base;
  });
  const [reqStep, setReqStep] = useState<RequestStep>('traveling');
  const [draft, setDraft] = useState('');
  const [toast, setToast] = useState<{ text: string; seq: number } | null>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const later = useCallback((ms: number, fn: () => void) => {
    const h = setTimeout(() => { timers.current.delete(h); fn(); }, ms);
    timers.current.add(h);
  }, []);

  const [ctl] = useState(() => {
    const ref: { c?: CallController } = {};
    const ports: CallPorts = {
      now: () => Date.now(),
      newId,
      send(peer, sig) {
        const c = ref.c!;
        if (sig.t === 'invite') {
          // O outro aparelho toca em 1,5 s e atende em 4,6 s.
          later(1500, () => c.dispatch({ type: 'peerRinging', callId: sig.callId }));
          later(4600, () => c.dispatch({ type: 'connected', callId: sig.callId, now: Date.now() }));
        } else if (sig.t === 'request') {
          setItems(xs => [...xs, { k: 'req', time: clock() }]);
          setReqStep('traveling');
          later(1900, () => setReqStep('delivered'));
          later(4000, () => { setReqStep('accepted'); setRoute('direct'); });
          later(5600, () => c.dispatch({ type: 'requestAccepted', requestId: sig.requestId, peer, route: 'direct', callId: newId(), now: Date.now() }));
        } else if (sig.t === 'requestAnswer' && sig.ok) {
          later(4600, () => c.dispatch({ type: 'incoming', callId: newId(), peer, route: 'direct', now: Date.now(), requestId: sig.requestId }));
        }
      },
      record: rec => setItems(xs => [...xs, { k: 'rec', rec, time: clock() }]),
      media: () => {},
      toast: kind => setToast(x => ({
        seq: (x?.seq ?? 0) + 1,
        text: kind === 'verified' ? t('call.toast.verified') : kind === 'remindLater' ? t('call.toast.remind') : t('call.toast.requestLater', { first: contact.first }),
      })),
      draft: () => setDraft(t('call.declineDraft')),
    };
    ref.c = new CallController(ports);
    return ref.c;
  });
  const state = useCallState(ctl);

  useEffect(() => {
    if (scen === 'out' || scen === 'bt' || scen === 'mesh') later(800, () => ctl.open(PEER, routeRef.current === 'mesh' ? null : routeRef.current));
    if (scen === 'inapp') later(1100, () => ctl.dispatch({ type: 'incoming', callId: newId(), peer: PEER, route: 'direct', now: Date.now() }));
    if (scen === 'lock') later(1300, () => ctl.dispatch({ type: 'incoming', callId: newId(), peer: PEER, route: 'bt', now: Date.now() }));
    if (scen === 'reqin') later(1000, () => ctl.dispatch({ type: 'requestIn', requestId: newId(), peer: PEER }));
    const ts = timers.current;
    return () => { ts.forEach(clearTimeout); ts.clear(); ctl.dispose(); };
  }, [scen, ctl, later]);

  // "Simular: o Wi-Fi caiu" — o caminho cai e outro aparece em 2,2 s, sem desligar.
  const live = state.phase === 'active' && !state.switching ? state.route : undefined;
  useEffect(() => {
    if (!live) { onWeak(null); return; }
    onWeak({
      label: live === 'bt' ? 'Simular: saiu do alcance do Bluetooth' : 'Simular: o Wi-Fi caiu',
      run: () => {
        ctl.dispatch({ type: 'routeLost', now: Date.now() });
        later(2200, () => ctl.dispatch({ type: 'routeFound', route: live === 'bt' ? 'point' : 'bt' }));
      },
    });
  }, [live, ctl, later, onWeak]);
  useEffect(() => () => onWeak(null), [onWeak]);

  const levels = useCallback(() => {
    const st = ctl.state;
    return st.phase === 'active' ? simulatedLevels((Date.now() - (st.connectedAt ?? Date.now())) / 1000) : { mine: 0, theirs: 0 };
  }, [ctl]);
  const scene: CallScene | null = state.phase === 'idle' ? null : {
    state, contact, words: state.phase === 'active' ? WORDS : null, hops: HOPS, levels, soft: soft || reduceMotion,
    latencyMs: (() => { const r = state.phase === 'pre' ? state.preRoute : state.route; return r ? LATENCY[r] : undefined; })(),
  };
  const api: CallApi = {
    controller: ctl, scene, toast, locked: scen === 'lock', now: Date.now,
    callChat: () => ctl.open(PEER, routeRef.current === 'mesh' ? null : routeRef.current),
  };

  return (
    <CallContext.Provider value={api}>
      <FakeChat contact={contact} route={route} items={items} reqStep={reqStep} draft={draft} onCall={() => api.callChat('demo')} />
      <CallOverlay onPerf={onPerf} />
    </CallContext.Provider>
  );
}

/** Conversa de exemplo com o botão ligar e os cartões de chamada reais. */
function FakeChat({ contact, route, items, reqStep, draft, onCall }: {
  contact: ReturnType<typeof contactOf>; route: LiveRoute | 'mesh'; items: Item[]; reqStep: RequestStep; draft: string; onCall: () => void;
}) {
  const { c } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const scroller = useRef<ScrollViewInstance>(null);
  const sub = route === 'mesh' ? t('call.chat.mesh', { hops: HOPS }) : route === 'bt' ? t('call.chat.bt') : route === 'point' ? t('call.chat.point') : t('call.chat.direct');
  const icon: IconName = route === 'mesh' ? 'hub' : route === 'bt' ? 'bluetooth' : route === 'point' ? 'storefront' : 'wifi';
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ paddingTop: insets.top + 6, paddingBottom: 8, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderBottomColor: c.line }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('common.back')} style={{ width: 38, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="arrow_back_ios_new" size={22} />
        </Pressable>
        <Avatar initials={contact.initials} size={40} inverted />
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <T size={16} w={650} ls={-0.015} numberOfLines={1}>{contact.name}</T>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon name={icon} size={14} color={c.ink2} />
            <T size={12.5} color={c.ink2} numberOfLines={1}>{sub}</T>
          </View>
        </View>
        <CallButton onPress={onCall} />
        <View style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}><Icon name="more_horiz" size={22} /></View>
      </View>
      <ScrollView ref={scroller} onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })} contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end', padding: 14, gap: 8 }}>
        <View style={{ alignSelf: 'center', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 10, backgroundColor: c.bg2, marginBottom: 6 }}>
          <T size={11} w={500} mono color={c.ink2}>HOJE</T>
        </View>
        {items.map((m, i) => m.k === 'text' ? (
          <View key={i} style={{ alignSelf: m.who === 'me' ? 'flex-end' : 'flex-start', maxWidth: '76%', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 20, backgroundColor: m.who === 'me' ? c.ink : c.bg2, gap: 3 }}>
            <T size={14.5} lh={1.4} color={m.who === 'me' ? c.invink : c.ink}>{m.text}</T>
            <T size={10.5} w={500} mono color={m.who === 'me' ? c.invink : c.ink} style={{ opacity: 0.55, alignSelf: 'flex-end' }}>{m.time}</T>
          </View>
        ) : m.k === 'rec' ? (
          <CallRecordCard key={i} record={m.rec} contact={contact} time={m.time} onCallBack={onCall} />
        ) : (
          <CallRequestCard key={i} step={reqStep} contact={contact} hops={HOPS} time={m.time} />
        ))}
      </ScrollView>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 8, paddingHorizontal: 12, paddingBottom: 12 }}>
        <View style={{ flex: 1, height: 48, borderRadius: 24, backgroundColor: c.bg2, justifyContent: 'center', paddingHorizontal: 18 }}>
          <T size={14.5} color={draft ? c.ink : c.ink3} numberOfLines={1}>{draft || t('chat.message')}</T>
        </View>
        <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={draft ? 'arrow_upward' : 'mic'} size={22} color={c.invink} />
        </View>
      </View>
    </View>
  );
}
