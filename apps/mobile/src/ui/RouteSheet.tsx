import { useRef } from 'react';
import { View } from 'react-native';
import type { Chat, Msg } from '../data/types';
import { buildRoute } from '../lib/route';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { Icon } from './Icon';
import { Sheet, type SheetHandle } from './Sheet';
import { T } from './T';

/**
 * Folha “Rota da mensagem”: barra de 4 etapas, saltos com o transporte de cada um,
 * envelope, fragmentos, validade, prioridade e a nota de que os nós no caminho não leem nada.
 */
export function RouteSheet({ chat, msg, onClose }: { chat: Chat; msg: Msg; onClose: () => void }) {
  const { c } = useTheme();
  const r = buildRoute(chat, msg);
  const sheet = useRef<SheetHandle>(null);
  return (
    <Sheet ref={sheet} onClose={onClose} label="Rota da mensagem">
      <View style={{ gap: 6 }}>
        <T size={22} w={700} ls={-0.03} accessibilityRole="header">Rota da mensagem</T>
        <T size={14} color={c.ink2} numberOfLines={1}>“{r.text}”</T>
      </View>

      <View style={{ flexDirection: 'row', gap: 4 }} accessibilityLabel={'Etapa: ' + (r.steps.find(s => s.current)?.label ?? '')}>
        {r.steps.map(s => (
          <View key={s.label} style={{ flex: 1, gap: 7 }}>
            <View style={{ height: 4, borderRadius: 2, backgroundColor: s.done ? c.ink : c.bg3 }} />
            <T size={11.5} w={s.current ? 650 : 450} lh={1.2} color={s.done ? c.ink : c.ink2}>{s.label}</T>
          </View>
        ))}
      </View>

      <View style={{ paddingVertical: 4 }}>
        {r.hops.map((h, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 14 }}>
            <View style={{ width: 18, alignItems: 'center' }}>
              <View style={{ width: 14, height: 14, borderRadius: 7, marginTop: 3, borderWidth: 1.5, borderColor: c.ink, backgroundColor: h.reached ? c.ink : 'transparent' }} />
              {!h.last && <View style={{ flex: 1, width: 0, borderLeftWidth: 1.5, borderStyle: h.solid ? 'solid' : 'dashed', borderColor: c.ink, opacity: 0.5, marginVertical: 3 }} />}
            </View>
            <View style={{ flex: 1, gap: 2, paddingBottom: h.last ? 0 : 14 }}>
              <T size={15} w={600} color={h.reached ? c.ink : c.ink2}>{h.n}</T>
              <T size={12} mono color={c.ink2}>{h.k}</T>
              {!h.last && (
                <View style={{ alignSelf: 'flex-start', marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 8, backgroundColor: c.bg2 }}>
                  <Icon name={h.viaIcon} size={14} />
                  <T size={11.5} w={500} mono>{h.via}</T>
                </View>
              )}
            </View>
          </View>
        ))}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {r.meta.map(x => (
          <View key={x.l} style={{ width: '48.5%', flexGrow: 1, padding: 12, borderRadius: 14, backgroundColor: c.bg2, gap: 3 }}>
            <T size={11.5} color={c.ink2}>{x.l}</T>
            <T size={14} w={500} mono>{x.v}</T>
          </View>
        ))}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <Icon name="lock" size={18} />
        <T size={13} lh={1.4} color={c.ink2} style={{ flex: 1 }}>Os nós intermediários transportam apenas o envelope cifrado. Nenhum deles consegue ler esta mensagem.</T>
      </View>
      <Button label="Fechar" variant="soft" height={50} onPress={() => sheet.current?.close()} />
    </Sheet>
  );
}
