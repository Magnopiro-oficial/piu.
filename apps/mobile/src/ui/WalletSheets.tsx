import { View } from 'react-native';
import { MAINNET_PENDING } from '../data/wallet';
import { lunes2 } from '../lib/walletCore';
import { useWallet } from '../state/wallet';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Sheet } from './Sheet';
import { T } from './T';

/**
 * Enviar LUNES: a transação é assinada no aparelho e liquidada na Lunes Mainnet. Essa liquidação ainda
 * não está conectada, e sem ela não há saldo nem envio de verdade: a folha diz isso em vez de simular.
 */
export function SendSheet({ onClose }: { onClose: () => void }) {
  const { c } = useTheme();
  const { onchain } = useWallet();
  return (
    <Sheet onClose={onClose} label="Enviar LUNES">
      <T size={22} w={700} ls={-0.03} accessibilityRole="header">Enviar LUNES</T>
      <Pending icon="cloud_off" title="Envio ainda não disponível" body={`Enviar LUNES depende da liquidação na Lunes Mainnet, ainda não conectada. Nada é assinado nem enviado por enquanto.`} />
      <View style={{ borderRadius: 18, backgroundColor: c.bg2, paddingVertical: 14, paddingHorizontal: 16, gap: 10 }}>
        {[['Disponível', `${lunes2(onchain)} LUNES`], ['Liquidação', MAINNET_PENDING]].map(([l, v]) => (
          <View key={l} style={{ flexDirection: 'row', gap: 16 }}>
            <T size={13} color={c.ink2}>{l}</T>
            <T size={13} w={550} align="right" tabular style={{ flex: 1 }}>{v}</T>
          </View>
        ))}
      </View>
      <Button label="Assinar e enviar" disabled left={<Icon name="fingerprint" size={20} color={c.invink} />} onPress={() => {}} />
    </Sheet>
  );
}

/** Receber LUNES: o endereço da carteira só aparece quando a liquidação estiver conectada. */
export function ReceiveSheet({ onClose }: { onClose: () => void }) {
  const { c } = useTheme();
  return (
    <Sheet onClose={onClose} label="Receber LUNES">
      <T size={22} w={700} ls={-0.03} accessibilityRole="header">Receber LUNES</T>
      <Pending icon="qr_code_2" title="Endereço ainda não disponível" body="O endereço e o QR para receber aparecem quando a carteira for conectada à Lunes Mainnet. Até lá, não compartilhe outro endereço como se fosse do Piu." />
      <T size={12.5} lh={1.4} color={c.ink2}>Quando existir, este endereço não fica ligado às suas identidades de conversa.</T>
    </Sheet>
  );
}

function Pending({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  const { c } = useTheme();
  return (
    <View accessibilityLiveRegion="polite" style={{ padding: 16, borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2, flexDirection: 'row', gap: 12 }}>
      <Icon name={icon} size={24} w={300} />
      <View style={{ flex: 1, gap: 3 }}>
        <T size={15} w={600}>{title}</T>
        <T size={13} lh={1.45} color={c.ink2}>{body}</T>
      </View>
    </View>
  );
}
