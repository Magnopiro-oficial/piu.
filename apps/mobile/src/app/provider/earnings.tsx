import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { CREDIT_PARAMS } from '../../messaging/credits';
import { type ProvNode, useProvNodes } from '../../lib/approvalNodes';
import { NodeApiError } from '../../lib/nodeApi';
import { linkBlocker, nodeApiFor } from '../../lib/nodeLink';
import { nodeEarnings } from '../../lib/providerCore';
import { lunes2 } from '../../lib/walletCore';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../../ui/Button';
import { BackHeader, SectionLabel } from '../../ui/Controls';
import { Icon, type IconName } from '../../ui/Icon';
import { forgetSession, loadNode, type NodeLoad, NodeEarningsCard } from '../../ui/ProviderWallet';
import { Screen } from '../../ui/Screen';
import { T } from '../../ui/T';

/**
 * Ganhos do provider no celular, lidos de cada equipamento pareado e conectado (API local do
 * piu-node): recibos, saldo do nó e lotes liquidados que ele registrou, a carteira de provider na
 * Lunes Mainnet e a declaração da carteira do lote. Sem equipamento conectado, não há número: a tela
 * diz isso. Os créditos deste celular como nó ficam em Carteira → Créditos de rede.
 */
export default function ProvEarnings() {
  const { c } = useTheme();
  const { nodes } = useProvNodes();
  const [data, setData] = useState<Record<string, NodeLoad | { error: string }>>({});
  // Sessão perdida (401): `epoch` refaz os clientes, que releem a sessão guardada.
  const [epoch, setEpoch] = useState(0);
  const linked = useMemo(() => (nodes ?? []).map(d => ({ d, api: nodeApiFor(d) })), [nodes, epoch]); // eslint-disable-line react-hooks/exhaustive-deps
  const connected = linked.filter(x => x.api?.session);

  const load = useCallback(async (d: ProvNode) => {
    const api = linked.find(x => x.d.phoneId === d.phoneId)?.api;
    if (!api?.session) return;
    try { const r = await loadNode(api); setData(m => ({ ...m, [d.phoneId]: r })); }
    catch (e) {
      if (e instanceof NodeApiError && e.status === 401) { await forgetSession(d); setEpoch(x => x + 1); }
      setData(m => ({ ...m, [d.phoneId]: { error: (e as Error).message } }));
    }
  }, [linked]);
  useEffect(() => { for (const x of linked) if (x.api?.session) void load(x.d); }, [linked, load]);

  const loaded = connected.map(x => data[x.d.phoneId]).filter((v): v is NodeLoad => !!v && !('error' in v));
  const sum = loaded.reduce((a, v) => { const e = nodeEarnings(v.wallet, v.receipts); return { received: a.received + e.received, lots: a.lots + e.lots.length }; }, { received: 0, lots: 0 });
  const has = loaded.some(v => v.wallet);

  const how: [IconName, string, string][] = [
    ['verified_user', 'Recibo do seu nó', 'assinado a cada envelope de terceiro repassado'],
    ['verified', 'Prova de entrega', 'o destino confirma sem revelar quem é'],
    ['account_balance_wallet', 'Lote semanal', `mínimo de ${CREDIT_PARAMS.minLotLunes} LUNES · ${CREDIT_PARAMS.creditsPerLunes} créditos = 1 LUNES (provisório)`],
  ];

  return (
    <Screen>
      <BackHeader title="Ganhos do provider" />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={{ paddingTop: 4, paddingHorizontal: 20, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            {/* Sem nenhum equipamento lido: traço, não um zero que pareça resultado. */}
            <T size={44} w={650} ls={-0.05} tabular style={{ lineHeight: 46 }} accessibilityLiveRegion="polite">{has ? lunes2(sum.received) : '—'}</T>
            <T size={14} w={600} color={c.ink2}>LUNES recebidos</T>
          </View>
          <T size={13.5} lh={1.4} color={c.ink2}>{!has
            ? (connected.length ? 'Lendo os equipamentos conectados…' : 'Nenhum equipamento conectado a este celular: conecte um na tela dele para ver os ganhos.')
            : sum.lots ? `${sum.lots} ${sum.lots === 1 ? 'lote liquidado' : 'lotes liquidados'} registrados ${loaded.length === 1 ? 'no equipamento' : `em ${loaded.length} equipamentos`}`
              : 'Nenhum lote liquidado registrado nos equipamentos conectados'}</T>
        </View>

        <SectionLabel>{`EQUIPAMENTOS CONECTADOS · ${connected.length}`}</SectionLabel>
        <View style={{ gap: 12 }}>
          {connected.map(({ d, api }) => {
            const v = data[d.phoneId];
            if (!v) return <T key={d.phoneId} size={13} color={c.ink2} style={{ marginHorizontal: 24 }}>{`Lendo ${d.node}…`}</T>;
            if ('error' in v) return <T key={d.phoneId} size={13} color={c.ink2} style={{ marginHorizontal: 24 }}>{`${d.node}: ${v.error}`}</T>;
            return <NodeEarningsCard key={d.phoneId} d={d} api={api!} data={v} onReload={() => void load(d)} onLost={() => { void forgetSession(d).then(() => setEpoch(x => x + 1)); }} />;
          })}
          {nodes && linked.filter(x => !x.api?.session).map(({ d }) => (
            <Pressable key={d.phoneId} onPress={() => router.push({ pathname: '/provider/device/[id]', params: { id: d.phoneId } })} accessibilityRole="button"
              style={{ marginHorizontal: 20, padding: 14, borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Icon name="dns" size={22} w={300} />
              <View style={{ flex: 1, gap: 2 }}>
                <T size={14} w={600}>{d.node}</T>
                <T size={12.5} lh={1.35} color={c.ink2}>{linkBlocker(d) ?? 'Não conectado: abra o equipamento e digite o código dele para ler recibos e carteira.'}</T>
              </View>
              <Icon name="chevron_right" size={20} w={300} color={c.ink2} />
            </Pressable>
          ))}
          {nodes && nodes.length === 0 && <T size={13} lh={1.45} color={c.ink2} style={{ marginHorizontal: 24 }}>Nenhum equipamento pareado. Pareie um pelo QR do painel do Piu Node.</T>}
        </View>

        <SectionLabel>COMO O CRÉDITO É FORMADO</SectionLabel>
        <View style={{ marginHorizontal: 20, borderRadius: 22, backgroundColor: c.bg2, overflow: 'hidden' }}>
          {how.map(([icon, t, d], i) => (
            <View key={t} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
              <Icon name={icon} size={21} w={300} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <T size={14.5} w={550}>{t}</T>
                <T size={11.5} mono color={c.ink2}>{d}</T>
              </View>
            </View>
          ))}
        </View>

        <View style={{ paddingTop: 20, paddingHorizontal: 20 }}>
          <Button label="Ver créditos deste celular" variant="outline" height={50} left={<Icon name="toll" size={20} />} onPress={() => router.push('/(tabs)/wallet')} />
        </View>
        <View style={{ marginTop: 16, marginHorizontal: 24, flexDirection: 'row', gap: 10 }}>
          <Icon name="policy" size={17} w={300} />
          <T size={12.5} lh={1.45} color={c.ink2} style={{ flex: 1 }}>Cada crédito combina recibo do seu nó, confirmação do destino e auditoria por amostragem. Duplicatas, rotas circulares e tráfego artificial são rejeitados. O pagamento dos lotes depende da liquidação na Lunes.</T>
        </View>
      </ScrollView>
    </Screen>
  );
}
