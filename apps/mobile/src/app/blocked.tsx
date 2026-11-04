import { useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { type Blocked, useStore } from '../state/store';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { BackHeader } from '../ui/Controls';
import { Icon, type IconName } from '../ui/Icon';
import { Screen } from '../ui/Screen';
import { Sheet, type SheetHandle } from '../ui/Sheet';
import { T } from '../ui/T';

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const since = (ms: number) => {
  const d = new Date(ms), now = new Date();
  return d.toDateString() === now.toDateString() ? 'hoje' : `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};

/**
 * Contatos bloqueados (design: Privacidade → Bloqueio). Quem está aqui não consegue te mandar
 * mensagem nem pedido de conversa: o mensageiro descarta o que chega dessas pessoas, sem avisar.
 */
export default function BlockedContacts() {
  const { c } = useTheme();
  const { blocked } = useStore();
  const { sel } = useLocalSearchParams<{ sel?: string }>();
  const [unblockId, setUnblockId] = useState<string | null>(sel ?? null);
  const target = blocked.find(b => b.id === unblockId) ?? null;

  return (
    <Screen>
      <BackHeader title="Contatos bloqueados" />
      <ScrollView contentContainerStyle={{ paddingBottom: 28 }}>
        <T size={13.5} lh={1.45} color={c.ink2} style={{ paddingHorizontal: 24, paddingBottom: 16 }}>
          Quem está aqui não consegue te mandar mensagem, pedido de conversa nem ver seu status. A pessoa não é avisada.
        </T>
        {blocked.length ? (
          <View style={{ paddingHorizontal: 20, gap: 8 }}>
            {blocked.map(b => (
              <View key={b.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 20, borderWidth: 1, borderColor: c.line2 }}>
                <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}>
                  <T size={14} w={650}>{b.initials}</T>
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <T size={15} w={600} numberOfLines={1}>{b.name}</T>
                  <T size={11.5} mono lh={1.4} color={c.ink2}>{`desde ${since(b.at)} · ${b.how}${b.reported ? ' · denunciado' : ''}`}</T>
                </View>
                <Pressable onPress={() => setUnblockId(b.id)} accessibilityRole="button" accessibilityLabel={`Desbloquear ${b.name}`}
                  style={({ pressed }) => ({ height: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: c.line2, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
                  <T size={12.5} w={550}>Desbloquear</T>
                </Pressable>
              </View>
            ))}
          </View>
        ) : (
          <View style={{ marginHorizontal: 20, marginVertical: 8, paddingVertical: 36, paddingHorizontal: 20, borderRadius: 22, backgroundColor: c.bg2, alignItems: 'center', gap: 8 }}>
            <Icon name="block" size={34} w={300} color={c.ink2} />
            <T size={15} w={600}>Ninguém bloqueado</T>
            <T size={13} lh={1.4} color={c.ink2} align="center">Para bloquear, abra a conversa e toque no nome.</T>
          </View>
        )}
      </ScrollView>
      {target && <UnblockSheet b={target} onClose={() => setUnblockId(null)} />}
    </Screen>
  );
}

function UnblockSheet({ b, onClose }: { b: Blocked; onClose: () => void }) {
  const { c } = useTheme();
  const { unblock, showToast } = useStore();
  const sheet = useRef<SheetHandle>(null);
  const first = b.name.split(' ')[0];
  const facts: [IconName, string][] = [
    ['chat', `${first} volta a poder te mandar mensagens e pedidos de conversa.`],
    ['history', 'O que foi enviado enquanto estava bloqueado não é reentregue. Os relays já descartaram.'],
    ['notifications_off', 'Não é avisado(a) do desbloqueio.'],
    ...(b.reported ? [['flag', 'A denúncia feita continua registrada.'] as [IconName, string]] : []),
  ];
  return (
    <Sheet ref={sheet} onClose={onClose} label={`Desbloquear ${b.name}?`}>
      <T size={20} w={700} ls={-0.03} accessibilityRole="header">{`Desbloquear ${b.name}?`}</T>
      <View>
        {facts.map(([icon, t], i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 12, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
            <Icon name={icon} size={20} w={300} />
            <T size={13.5} lh={1.45} color={c.ink2} style={{ flex: 1 }}>{t}</T>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button label="Cancelar" variant="soft" height={50} style={{ flex: 1 }} onPress={() => sheet.current?.close()} />
        <Button label="Desbloquear" height={50} style={{ flex: 1 }} onPress={() => sheet.current?.close(() => {
          unblock(b.id);
          showToast({ icon: 'lock_open', title: `${b.name} desbloqueado(a)`, body: 'Pode voltar a te mandar mensagens.' });
        })} />
      </View>
    </Sheet>
  );
}
