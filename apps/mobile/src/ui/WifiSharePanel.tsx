import Constants from 'expo-constants';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { PiuAppShare, type WifiShareInfo } from '../../modules/piu-app-share';
import { apkShareName, appShareError } from '../lib/appShare';
import { downloadPageHtml, SHARE_PORT, SHARE_WINDOW_MS, shareTimeLeft, wifiPageUrl, wifiQr } from '../lib/wifiShare';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeProvider';
import { requestWifiDirectPermission } from '../transport/permissions';
import { Button } from './Button';
import { Icon } from './Icon';
import { QrCode } from './QrCode';
import { T } from './T';

/**
 * Enviar o Piu por Wi-Fi Direct (regra 6.1): enquanto este painel está na tela, o celular abre a rede
 * `DIRECT-Pi-Piu-XXXX` com senha e serve o instalador numa página local, por até 10 min. O outro
 * celular entra na rede pelo QR e baixa pela página. Fechar o painel (ou sair da tela) fecha a rede.
 */
export function WifiSharePanel({ onClose }: { onClose: () => void }) {
  const { c } = useTheme();
  const { showToast } = useStore();
  const [info, setInfo] = useState<WifiShareInfo | null>(null);
  const [state, setState] = useState<'opening' | 'open' | 'closed'>('opening');
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const alive = useRef(true);

  const open = async () => {
    if (!PiuAppShare) return;
    setState('opening');
    if (await requestWifiDirectPermission() !== 'granted') {
      showToast({ icon: 'error', ...appShareError('ERR_NO_PERMISSION') });
      if (alive.current) setState('closed');
      return;
    }
    const file = apkShareName(Constants.expoConfig?.version ?? '');
    try {
      const r = await PiuAppShare.startWifiShare(file, downloadPageHtml(file, PiuAppShare.apkSize()), SHARE_PORT, SHARE_WINDOW_MS);
      if (!alive.current) { void PiuAppShare.stopWifiShare(); return; }
      setInfo(r); setStartedAt(Date.now()); setNow(Date.now()); setState('open');
    } catch (e) {
      showToast({ icon: 'error', ...appShareError((e as { code?: string })?.code ?? '') });
      if (alive.current) setState('closed');
    }
  };

  useEffect(() => {
    alive.current = true;
    void open();
    return () => { alive.current = false; void PiuAppShare?.stopWifiShare(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Contagem dos 10 min; no fim, a rede já fechou no nativo.
  useEffect(() => {
    if (state !== 'open') return;
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n - startedAt >= SHARE_WINDOW_MS) setState('closed');
    }, 1000);
    return () => clearInterval(t);
  }, [state, startedAt]);

  const close = () => { void PiuAppShare?.stopWifiShare(); onClose(); };
  const url = info ? wifiPageUrl(info.ip, info.port) : '';

  return (
    <View style={{ gap: 12, paddingTop: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name={state === 'open' ? 'wifi_tethering' : 'portable_wifi_off'} size={18} />
        <T size={13.5} w={600} style={{ flex: 1 }}>
          {state === 'opening' ? 'Abrindo a rede Wi-Fi Direct…' : state === 'open' ? `Rede aberta · fecha em ${shareTimeLeft(startedAt, now)}` : 'Rede fechada'}
        </T>
      </View>
      {state === 'open' && info && (
        <>
          <T size={12.5} w={600}>1 · No celular dela, entre nesta rede</T>
          <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
            <QrCode value={wifiQr(info.ssid, info.passphrase)} size={124} radius={14} label="QR para entrar na rede Wi-Fi" />
            <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
              <T size={11.5} color={c.ink2}>Rede</T>
              <T size={13} w={600} mono selectable>{info.ssid}</T>
              <T size={11.5} color={c.ink2}>Senha</T>
              <T size={15} w={650} mono selectable>{info.passphrase}</T>
            </View>
          </View>
          <T size={12} lh={1.4} color={c.ink2}>Ela aponta a câmera para o código, ou escolhe a rede no Wi-Fi e digita a senha. Se o celular avisar que a rede não tem internet, toque em manter conectado.</T>
          <T size={12.5} w={600}>2 · Ela abre a página e baixa o Piu</T>
          <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
            <QrCode value={url} size={96} radius={12} label="QR da página para baixar o Piu" />
            <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
              <T size={11.5} color={c.ink2}>No navegador</T>
              <T size={13.5} w={600} mono selectable>{url}</T>
            </View>
          </View>
          <T size={12} lh={1.4} color={c.ink2}>Toque em "Baixar o Piu", abra o arquivo e permita a instalação quando o Android pedir. Depois, ela escaneia o seu código de convite.</T>
        </>
      )}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {state === 'closed' && <Button label="Abrir de novo" height={42} fontSize={13.5} style={{ flex: 1 }} onPress={() => void open()} />}
        <Button label="Fechar a rede" variant="outline" height={42} fontSize={13.5} style={{ flex: 1 }} onPress={close} />
      </View>
    </View>
  );
}
