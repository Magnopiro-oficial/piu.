import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Image, Pressable, ScrollView, View } from 'react-native';
import { useStore } from '../../state/store';
import { useLayout } from '../../lib/responsive';
import { useKeys } from '../../state/keys';
import { useSettings } from '../../state/settings';
import { useMessaging, useMyCard } from '../../state/messaging';
import { safetyNumber, toPublic } from '../../protocol';
import { QrCode } from '../../ui/QrCode';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../../ui/Button';
import { BackHeader, SectionLabel } from '../../ui/Controls';
import { Icon, type IconName } from '../../ui/Icon';
import { Screen } from '../../ui/Screen';
import { T } from '../../ui/T';

/** Verificar contato (seção 9): código de segurança 12×5 e QR, contra quem se passa por outra pessoa. */
export default function Contact() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const { compact } = useLayout();
  const { chats, verified, setVerified, showToast, block, isBlocked } = useStore();
  const { identities } = useKeys();
  const ident = chats.find(x => x.id === id)?.ident ?? 'public';
  const { contactKeys } = useMessaging();
  const [myCard] = useMyCard(ident);
  const { priv } = useSettings();
  // Chaves do contato: vieram no cartão (QR) ou na primeira mensagem (pedido de conversa).
  const real = id ? contactKeys(id) : null;
  // Código: chaves da identidade usada nesta conversa × chaves do contato.
  const mine = identities?.[ident];
  const [code, setCode] = useState<string[] | null>(null);
  // Hash iterado (~25 ms): calcula depois de desenhar a tela, para não travar a navegação.
  useEffect(() => {
    if (!mine || !real) return;
    const t = setTimeout(() => setCode(safetyNumber(toPublic(mine), real)), 0);
    return () => clearTimeout(t);
  }, [mine, real]);
  const shown = code ?? Array<string>(12).fill('·····');
  const chat = chats.find(x => x.id === id && x.peer);
  if (!chat?.peer) return <Screen><BackHeader /><T size={15} color={c.ink2} align="center">Contato não encontrado.</T></Screen>;

  const ver = !!verified[chat.id];

  const first = chat.name.split(' ')[0];
  const handle = `${chat.peer.slice(0, 8)}…${chat.peer.slice(-4)} · ${chat.ident === 'anon' ? 'anônima' : 'pública'}`;
  // Bloqueio (design): pelo id da chave do contato.
  const blockId = chat.peer;
  const isBl = isBlocked(blockId);
  const blockAct = isBl
    ? () => router.push({ pathname: '/blocked', params: { sel: blockId } })
    : () => {
      block({ id: blockId, chatId: chat.id, name: chat.name, initials: chat.initials, how: 'pela conversa', reported: false });
      showToast({ icon: 'block', title: `${first} bloqueado(a)`, body: 'Não é avisado(a). Desfaça em Privacidade → Contatos bloqueados.' });
    };
  const rows: [IconName, string, string, number, (() => void)?][] = [['route', 'Última rota', chat.via ?? '—', 450], ['timer', 'Mensagens temporárias', priv.temp === '24h' ? '24 horas' : priv.temp === '7d' ? '7 dias' : 'Desligado', 450],
    [isBl ? 'lock_open' : 'block', `${isBl ? 'Desbloquear' : 'Bloquear'} ${first}`, isBl ? 'Bloqueado' : '', 650, blockAct]];

  return (
    <Screen>
      <BackHeader />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={{ paddingHorizontal: 24, paddingBottom: 8, alignItems: 'center', gap: 10 }}>
          {chat.photo
            ? <Image source={{ uri: chat.photo }} accessibilityLabel={`Foto de ${chat.name}`} style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: c.bg2 }} />
            : <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}><T size={28} w={650} color={c.invink}>{chat.initials}</T></View>}
          <T size={24} w={700} ls={-0.03} align="center" accessibilityRole="header">{chat.name}</T>
          <T size={12.5} mono color={c.ink2}>{handle}</T>
          <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 99, backgroundColor: ver ? c.ink : c.bg2 }}>
            <Icon name={ver ? 'verified' : 'gpp_maybe'} size={15} fill={ver} color={ver ? c.invink : c.ink} />
            <T size={12.5} w={600} color={ver ? c.invink : c.ink}>{ver ? 'Verificado pessoalmente' : 'Ainda não verificado'}</T>
          </View>
        </View>

        <SectionLabel>CÓDIGO DE SEGURANÇA</SectionLabel>
        <View style={{ marginHorizontal: 20, padding: 16, borderRadius: 22, backgroundColor: c.bg2, gap: 14 }}>
          <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
            {myCard ? <QrCode value={myCard} size={100} label="Meu QR, para a outra pessoa escanear" /> : <View style={{ width: 100, height: 100, borderRadius: 14, backgroundColor: c.bg }} />}
            <View accessibilityLabel={code ? 'Código de segurança: ' + code.join(' ') : 'Calculando o código de segurança'} style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', rowGap: 6 }}>
              {shown.map((g, i) => <T key={i} size={13.5} w={500} mono style={{ width: '33.3%' }}>{g}</T>)}
            </View>
          </View>
          <T size={13} lh={1.45} color={c.ink2}>Compare com a tela de {first} ou escaneie o QR dela pessoalmente. Se bater, ninguém está no meio da conversa.</T>
          <View style={{ flexDirection: compact ? 'column' : 'row', gap: 8 }}>
            <Button label="Escanear QR" variant="outline" height={44} fontSize={14} style={[!compact && { flex: 1 }, { paddingHorizontal: 4 }]}
              onPress={() => router.push({ pathname: '/scan', params: { verify: chat.id } })} />
            <Button label={ver ? 'Remover verificação' : 'Marcar como verificado'} height={44} fontSize={13.5} style={[!compact && { flex: 1.3 }, { paddingHorizontal: 4 }]} onPress={() => setVerified(chat.id, !ver)} />
          </View>
        </View>

        <View style={{ marginTop: 14, marginHorizontal: 20, borderRadius: 22, backgroundColor: c.bg2, overflow: 'hidden' }}>
          {rows.map(([icon, l, v, w, act], i) => (
            <Pressable key={l} disabled={!act} onPress={act} accessibilityRole={act ? 'button' : undefined}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderTopWidth: i ? 1 : 0, borderTopColor: c.line, opacity: pressed ? 0.6 : 1 })}>
              <Icon name={icon} size={21} w={300} />
              <T size={15} w={w} style={{ flex: 1 }}>{l}</T>
              <T size={12.5} color={c.ink2}>{v}</T>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}
