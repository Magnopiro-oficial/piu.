import { useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { SEND_PEOPLE, WALLET_ADDR, fmtLunes, parseLunes } from '../data/wallet';
import { confirmDevice } from '../lib/deviceAuth';
import { useStore } from '../state/store';
import { useWallet } from '../state/wallet';
import { fontFamily } from '../theme/fonts';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { QrPlaceholder, Toggle } from './Controls';
import { Icon } from './Icon';
import { Sheet, type SheetHandle } from './Sheet';
import { T } from './T';

/** Enviar LUNES: assinado no aparelho, viaja cifrado e liquida quando um gateway alcançar a Mainnet. */
export function SendSheet({ onClose }: { onClose: () => void }) {
  const { c } = useTheme();
  const { balance, send } = useWallet();
  const sheet = useRef<SheetHandle>(null);
  const [to, setTo] = useState('marina');
  const [amt, setAmt] = useState('5');
  const [done, setDone] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [authErr, setAuthErr] = useState<string | null>(null);
  const [noLock, setNoLock] = useState(false);
  const n = parseLunes(amt);
  const ok = n > 0 && n <= balance;
  const name = (id: string) => ({ marina: 'Marina', ana: 'Ana', pedro: 'Pedro', joao: 'João' } as Record<string, string>)[id] ?? id;

  return (
    <Sheet ref={sheet} onClose={onClose} label="Enviar LUNES">
      {!done ? (
        <>
          <T size={22} w={700} ls={-0.03} accessibilityRole="header">Enviar LUNES</T>
          <View accessibilityRole="radiogroup" accessibilityLabel="Para quem" style={{ flexDirection: 'row', gap: 14 }}>
            {SEND_PEOPLE.map(([id, ini, first]) => {
              const on = to === id;
              return (
                <Pressable key={id} onPress={() => setTo(id)} accessibilityRole="radio" accessibilityState={{ checked: on }} aria-checked={on} accessibilityLabel={first} style={{ alignItems: 'center', gap: 6, width: 62 }}>
                  <View style={{ width: 52, height: 52, borderRadius: 26, borderWidth: 1.5, borderColor: c.ink, backgroundColor: on ? c.ink : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                    <T size={15} w={600} color={on ? c.invink : c.ink}>{ini}</T>
                  </View>
                  <T size={12} w={on ? 650 : 450}>{first}</T>
                </Pressable>
              );
            })}
          </View>
          <View style={{ alignItems: 'center', gap: 2, paddingVertical: 6 }}>
            <TextInput value={amt} onChangeText={v => setAmt(v.replace(/[^0-9,.]/g, ''))} inputMode="decimal" accessibilityLabel="Valor em LUNES"
              style={{ width: '100%', textAlign: 'center', fontSize: 56, letterSpacing: -0.055 * 56, color: c.ink, fontFamily: fontFamily(650), paddingVertical: 0 }} />
            <T size={14} w={600} color={c.ink2}>LUNES</T>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
            {[1, 5, 10].map(q => (
              <Pressable key={q} onPress={() => setAmt(String(q))} accessibilityRole="button" style={{ height: 32, paddingHorizontal: 14, borderRadius: 16, backgroundColor: c.bg2, justifyContent: 'center' }}>
                <T size={13.5} w={550}>{q} LUNES</T>
              </Pressable>
            ))}
          </View>
          <View style={{ borderRadius: 18, backgroundColor: c.bg2, paddingVertical: 14, paddingHorizontal: 16, gap: 10 }}>
            {[['Disponível', `${fmtLunes(balance)} LUNES`], ['Taxa estimada', '0,01 LUNES'], ['Liquidação', 'quando a malha alcançar a Mainnet']].map(([l, v]) => (
              <View key={l} style={{ flexDirection: 'row', gap: 16 }}>
                <T size={13} color={c.ink2}>{l}</T>
                <T size={13} w={550} align="right" tabular style={{ flex: 1 }}>{v}</T>
              </View>
            ))}
          </View>
          {authErr && <T size={12.5} color={c.ink2} align="center" accessibilityRole="alert">{authErr}</T>}
          <Button label={signing ? 'Confirmando…' : 'Assinar e enviar'} disabled={!ok || signing} left={<Icon name="fingerprint" size={20} color={c.invink} />}
            onPress={async () => {
              if (!ok || signing) return;
              // Design: assinar com biometria (ou o bloqueio do aparelho). Sem bloqueio configurado (e na web), segue com aviso.
              setSigning(true); setAuthErr(null);
              const r = await confirmDevice(`Assinar ${fmtLunes(n)} LUNES para ${name(to)}`);
              setSigning(false);
              if (r === 'denied') { setAuthErr('Assinatura cancelada. Nada foi enviado.'); return; }
              send(name(to), n);
              setDone(`${fmtLunes(n)} LUNES para ${name(to)}`);
              setNoLock(r === 'unavailable');
            }} />
        </>
      ) : (
        <>
          <View accessibilityLiveRegion="polite" style={{ alignItems: 'center', gap: 12, paddingTop: 18, paddingHorizontal: 8, paddingBottom: 6 }}>
            <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}><Icon name="schedule_send" size={36} color={c.invink} /></View>
            <T size={24} w={700} ls={-0.03} align="center">{done}</T>
            <T size={14} lh={1.45} color={c.ink2} align="center" style={{ maxWidth: 300 }}>Transação assinada neste aparelho. Ela viaja cifrada pela malha e é liquidada quando um gateway alcançar a Mainnet.</T>
            <T size={12} mono color={c.ink2}>tx 9f2c…a01b · na fila</T>
            {noLock && <T size={12.5} lh={1.4} color={c.ink2} align="center" style={{ maxWidth: 300 }}>Este aparelho não tem bloqueio de tela. Configure biometria ou PIN para proteger suas assinaturas.</T>}
          </View>
          <Button label="Concluir" variant="soft" height={52} onPress={() => sheet.current?.close()} />
        </>
      )}
    </Sheet>
  );
}

/** Receber LUNES: QR e endereço, e receber de alguém por perto sem internet. */
export function ReceiveSheet({ onClose }: { onClose: () => void }) {
  const { c } = useTheme();
  const { nearPay, setNearPay } = useWallet();
  const { showToast } = useStore();
  return (
    <Sheet onClose={onClose} label="Receber LUNES">
      <T size={22} w={700} ls={-0.03} accessibilityRole="header">Receber LUNES</T>
      <View style={{ alignSelf: 'center', borderWidth: 1, borderColor: c.line2, borderRadius: 24, overflow: 'hidden' }}>
        <QrPlaceholder size={208} radius={24} />
      </View>
      <Pressable onPress={() => showToast({ icon: 'content_copy', title: 'Endereço copiado', body: WALLET_ADDR.long })} accessibilityRole="button" accessibilityLabel={`Copiar endereço ${WALLET_ADDR.long}`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, backgroundColor: c.bg2 }}>
        <T size={13} w={500} mono style={{ flex: 1 }} selectable>{WALLET_ADDR.long}</T>
        <Icon name="content_copy" size={18} />
      </Pressable>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Icon name="bluetooth" size={22} w={300} />
        <View style={{ flex: 1, gap: 2 }}>
          <T size={14.5} w={550}>Receber de alguém por perto</T>
          <T size={12.5} color={c.ink2}>Pagamento assinado sem internet</T>
        </View>
        <Toggle on={nearPay} onChange={() => setNearPay(!nearPay)} label="Receber de alguém por perto" />
      </View>
      <T size={12.5} lh={1.4} color={c.ink2}>Este endereço não está ligado às suas identidades de conversa.</T>
    </Sheet>
  );
}
