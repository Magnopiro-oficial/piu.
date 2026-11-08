import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useT } from '../../i18n';
import type { Key } from '../../i18n/core';
import { loraRowState, type LoraRowView } from '../../lib/loraRow';
import { freqLabel, inUse, piuRowState, waitingFor, type LoraMode, type PiuProblem, type PiuRowView } from '../../lib/piuLora';
import { useNetwork } from '../../state/network';
import { useTheme } from '../../theme/ThemeProvider';
import { Segmented, Toggle } from '../Controls';
import { Icon } from '../Icon';
import { T } from '../T';
import { ConnectPiuSheet } from './ConnectPiuSheet';
import { ConnectRadioSheet } from './ConnectRadioSheet';
import { RadioTypeSheet } from './RadioTypeSheet';
import { RegionPicker } from './RegionPicker';
import { useLora } from './useLora';
import { usePiuLora } from './usePiuLora';
import { BusyBar } from './LoraCard';

export const regionKey = (id: string) => `piu.region.${id}` as Key;

/**
 * Linha "Rádio LoRa" da aba Rede com os dois rádios (desenho Piu 17, 1a–1h): a chave liga e desliga os
 * dois; cada rádio conectado tem a sua linha (canal, Super Nodes, bateria, tempo de rádio, erro, fora de
 * alcance); com os dois, o seletor Automático · Só Piu · Só Meshtastic. Abre o tipo de rádio, a conexão
 * de cada um e a região do rádio do Piu.
 */
export function LoraBlock({ first, on, onToggle, granted, askPermission }: { first?: boolean; on: boolean; onToggle: (on: boolean) => void; granted: boolean; askPermission: () => void }) {
  const { loraMode, setLoraMode } = useNetwork();
  const mesh = useLora(), piu = usePiuLora();
  const [open, setOpen] = useState<null | 'type' | 'mesh' | 'piu' | 'region' | 'regionFirst' | { problem: PiuProblem }>(null);
  const mv = mesh ? loraRowState(mesh.status, mesh.link, { granted, now: mesh.now }) : null;
  const pv = piu ? piuRowState(piu.status, piu.link, { granted, now: piu.now }) : null;
  const connectPiu = () => setOpen(piu?.link.region ? 'piu' : 'regionFirst');
  const reconnect = (w: 'piu' | 'mesh') => {
    const id = (w === 'piu' ? piu : mesh)?.status.device?.id;
    if (id) void (w === 'piu' ? piu?.radio.connect(id) : mesh?.radio.connect(id));
  };
  return (
    <>
      <LoraBlockView first={first} on={on} onToggle={onToggle} noPerm={!granted} askPermission={askPermission} mode={loraMode} onMode={setLoraMode} pv={pv} mv={mv}
        onAdd={() => (!piu ? setOpen('mesh') : !mesh ? connectPiu() : setOpen('type'))} onRegion={() => setOpen('region')}
        onProblem={p => setOpen(p.kind === 'region' ? 'region' : { problem: p })} onReconnect={reconnect} />
      {open === 'type' ? <RadioTypeSheet onClose={() => setOpen(null)} onPick={k => (k === 'mesh' ? setOpen('mesh') : connectPiu())} /> : null}
      {open === 'mesh' && mesh ? <ConnectRadioSheet radio={mesh.radio} onConnected={() => onToggle(true)} onClose={() => setOpen(null)} /> : null}
      {open === 'piu' && piu ? <ConnectPiuSheet radio={piu.radio} onRegion={() => setOpen('region')} onClose={() => setOpen(null)} /> : null}
      {typeof open === 'object' && open && piu ? <ConnectPiuSheet radio={piu.radio} problem={open.problem} onRegion={() => setOpen('region')} onClose={() => setOpen(null)} /> : null}
      {(open === 'region' || open === 'regionFirst') && piu ? <RegionPicker link={piu.radio.link} first={open === 'regionFirst'} onDone={() => setOpen(open === 'regionFirst' ? 'piu' : null)} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

/** O desenho da linha (1a–1h) só com props: a aba Rede liga aos rádios (LoraBlock); a galeria usa dados de exemplo. */
export function LoraBlockView({ first, on, onToggle, noPerm, askPermission, mode, onMode, pv, mv, onAdd, onRegion, onProblem, onReconnect }: {
  first?: boolean; on: boolean; onToggle: (on: boolean) => void; noPerm: boolean; askPermission: () => void; mode: LoraMode; onMode: (m: LoraMode) => void;
  pv: PiuRowView | null; mv: LoraRowView | null; onAdd: () => void; onRegion: () => void; onProblem: (p: PiuProblem) => void; onReconnect: (w: 'piu' | 'mesh') => void;
}) {
  const { c } = useTheme();
  const t = useT();
  const shown = { piu: !!pv && pv.kind !== 'none' && pv.kind !== 'noPerm', mesh: !!mv && mv.kind !== 'none' && mv.kind !== 'noPerm' };
  const up = { piu: pv?.kind === 'connected', mesh: mv?.kind === 'connected' };
  const both = shown.piu && shown.mesh;
  const using = both ? inUse(mode, up) : null;
  const waiting = both ? waitingFor(mode, up) : null;
  const sub = !on ? t('piu.row.subOff') : noPerm ? t('lora.noPerm') : shown.piu || shown.mesh ? t('piu.row.sub') : t('piu.row.subNone');
  const nodes = (s?: { count: number; gateway: boolean }) => (s ? <Meta icon="hub" text={s.gateway ? t('lora.superNode.gateway', { count: s.count }) : t('lora.superNode', { count: s.count })} /> : null);

  return (
    <View style={{ paddingVertical: 13, paddingHorizontal: 12, borderTopWidth: first ? 0 : 1, borderTopColor: c.line, gap: 12 }}>
      <Pressable disabled={!noPerm} onPress={askPermission} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 2 }}>
        <Icon name="settings_input_antenna" size={22} w={300} style={{ opacity: on ? 1 : 0.45 }} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <T size={15} w={550}>{t('piu.row.title')}</T>
          <T size={12.5} lh={1.3} color={c.ink2}>{sub}</T>
        </View>
        <Toggle on={on} onChange={() => onToggle(!on)} label={t('piu.row.title')} />
      </Pressable>
      {on && !noPerm ? (
        <>
          {!shown.piu && !shown.mesh ? (
            <Pressable onPress={onAdd} accessibilityRole="button" style={{ height: 42, borderRadius: 21, backgroundColor: c.ink, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Icon name="add_link" size={18} w={400} color={c.invink} /><T size={14} w={650} color={c.invink}>{t('piu.row.connect')}</T>
            </Pressable>
          ) : null}
          {pv && shown.piu ? (
            <RadioLine name={t('piu.name.piu', { name: ('radio' in pv && pv.radio) || '' })}
              state={pv.kind === 'connected' ? 'ok' : pv.kind === 'failed' ? 'err' : pv.kind === 'away' ? (waiting === 'piu' ? 'warn' : 'lost') : 'busy'} inUse={using === 'piu'}>
              {pv.kind === 'connected' ? (
                <>
                  {pv.region ? (
                    <Pressable onPress={onRegion} accessibilityRole="button" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                      <T size={12} color={c.ink2}>{t(regionKey(pv.region))}{pv.freqHz ? ` · ${freqLabel(pv.freqHz)}` : ''} ·</T>
                      <T size={12} w={650} style={{ textDecorationLine: 'underline' }}>{t('piu.change')}</T>
                    </Pressable>
                  ) : null}
                  {nodes(pv.superNodes)}
                  {pv.busySec ? <AirLine sec={pv.busySec} /> : null}
                </>
              ) : pv.kind === 'failed' ? (
                <Pressable onPress={() => onProblem(pv.problem)} accessibilityRole="button" style={{ gap: 6 }}>
                  <T size={12} w={550} lh={1.4} color={c.err}>{problemText(t, pv.problem)}</T>
                  <T size={12} w={650} style={{ textDecorationLine: 'underline' }}>{t('piu.fail.what')}</T>
                </Pressable>
              ) : pv.kind === 'away' ? (
                waiting === 'piu'
                  ? <Waiting text={t('piu.wait.piu')} action={up.mesh ? t('piu.sendVia.mesh') : undefined} onAction={() => onMode('auto')} />
                  : <Lost text={t('piu.away')} onPress={() => onReconnect('piu')} />
              ) : <T size={12} color={c.ink2}>{t('piu.searching')}</T>}
            </RadioLine>
          ) : null}
          {mv && shown.mesh ? (
            <RadioLine name={t('piu.name.mesh', { name: mv.radio ?? '' })}
              state={mv.kind === 'connected' ? 'ok' : mv.kind === 'away' ? (waiting === 'mesh' ? 'warn' : 'lost') : 'busy'} inUse={using === 'mesh'}>
              {mv.kind === 'connected' ? (
                <>
                  <T size={12} color={c.ink2}>{[mv.battery !== undefined ? t('piu.battery', { pct: mv.battery }) : null, t('lora.hears', { count: mv.nodes ?? 0 }), mv.region].filter(Boolean).join(' · ')}</T>
                  {nodes(mv.superNodes)}
                  {mv.busySec ? <BusyBar sec={mv.busySec} inset={0} /> : null}
                </>
              ) : mv.kind === 'away' ? (
                waiting === 'mesh'
                  ? <Waiting text={t('piu.wait.mesh')} action={up.piu ? t('piu.sendVia.piu') : undefined} onAction={() => onMode('auto')} />
                  : <Lost text={t('piu.meshAway')} onPress={() => onReconnect('mesh')} />
              ) : <T size={12} color={c.ink2}>{t('piu.searching')}</T>}
            </RadioLine>
          ) : null}
          {both ? (
            <View style={{ gap: 8, paddingTop: 2 }}>
              <Segmented<LoraMode> label={t('piu.row.title')} value={mode} onChange={onMode}
                options={[['auto', t('piu.mode.auto')], ['piu', t('piu.mode.piu')], ['mesh', t('piu.mode.mesh')]]} />
              <T size={12} lh={1.45} color={c.ink2} style={{ paddingHorizontal: 4 }}>{t(`piu.mode.${mode}.d`)}</T>
            </View>
          ) : shown.piu || shown.mesh ? (
            <Pressable onPress={onAdd} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 }}>
              <Icon name="add" size={16} w={400} color={c.ink2} /><T size={12.5} w={600} color={c.ink2}>{t('piu.row.addOther')}</T>
            </Pressable>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

/** Uma linha do problema do rádio do Piu (1g). */
export function problemText(t: ReturnType<typeof useT>, p: PiuProblem): string {
  return p.kind === 'band' ? t('piu.fail.band') : p.kind === 'code' ? t('piu.fail.code', { code: p.code }) : p.kind === 'notRNode' ? t('piu.fail.notRNode')
    : p.kind === 'region' ? t('piu.fail.region') : t('piu.fail.other');
}

function RadioLine({ name, state, inUse: use, children }: { name: string; state: 'ok' | 'warn' | 'err' | 'lost' | 'busy'; inUse: boolean; children: ReactNode }) {
  const { c } = useTheme();
  const t = useT();
  const dim = state === 'warn' || state === 'lost';
  const dot = state === 'ok' ? c.ok : state === 'warn' ? c.warn : state === 'err' ? c.err : c.ink3;
  return (
    <View style={{ borderRadius: 16, backgroundColor: c.bg, paddingTop: 11, paddingHorizontal: 12, paddingBottom: 12, gap: 7 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center', opacity: dim ? 0.5 : 1 }}>
          <Icon name="settings_input_antenna" size={19} w={300} />
        </View>
        <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <T size={13.5} w={620} lh={1.25} style={{ flexShrink: 1 }}>{name}</T>
          {state === 'busy' ? <ActivityIndicator size="small" color={c.ink2} /> : <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} />}
        </View>
        {use ? (
          <View style={{ height: 22, paddingHorizontal: 8, borderRadius: 11, borderWidth: 1, borderColor: c.line2, justifyContent: 'center' }}>
            <T size={10.5} w={600} mono>{t('piu.inUse')}</T>
          </View>
        ) : null}
      </View>
      <View style={{ paddingLeft: 44, gap: 7 }}>{children}</View>
    </View>
  );
}

function Meta({ icon, text }: { icon: 'hub'; text: string }) {
  const { c } = useTheme();
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Icon name={icon} size={14} w={400} color={c.ink2} /><T size={12} color={c.ink2}>{text}</T></View>;
}

/** 1f: a região limita o tempo no ar; a barra esvazia até a próxima janela. */
function AirLine({ sec }: { sec: number }) {
  const { c } = useTheme();
  const t = useT();
  const [max] = useState(sec);
  return (
    <View style={{ gap: 6 }} accessibilityLiveRegion="polite">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><Icon name="hourglass_top" size={14} w={400} color={c.ink2} /><T size={12} color={c.ink2}>{t('piu.busy', { sec })}</T></View>
      <View style={{ height: 3, borderRadius: 2, backgroundColor: c.bg3, overflow: 'hidden' }}>
        <View style={{ width: `${Math.min(100, Math.round((sec / Math.max(max, sec)) * 100))}%`, height: 3, backgroundColor: c.ink2 }} />
      </View>
    </View>
  );
}

/** 1e: modo "Só …" com o rádio escolhido caído; o botão troca para Automático. */
function Waiting({ text, action, onAction }: { text: string; action?: string; onAction: () => void }) {
  const { c } = useTheme();
  return (
    <View style={{ padding: 10, borderRadius: 12, backgroundColor: c.warnbg, gap: 9 }}>
      <View style={{ flexDirection: 'row', gap: 5 }}><Icon name="schedule_send" size={15} w={400} color={c.warn} /><T size={12} w={600} lh={1.35} color={c.warn} style={{ flex: 1 }}>{text}</T></View>
      {action ? (
        <Pressable onPress={onAction} accessibilityRole="button" style={{ height: 34, borderRadius: 17, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}>
          <T size={12.5} w={650} color={c.invink}>{action}</T>
        </Pressable>
      ) : null}
    </View>
  );
}

/** 1h: fora do alcance, com "Reconectar". */
function Lost({ text, onPress }: { text: string; onPress: () => void }) {
  const { c } = useTheme();
  const t = useT();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <T size={12} lh={1.35} color={c.ink2} style={{ flex: 1 }}>{text}</T>
      <Pressable onPress={onPress} accessibilityRole="button" style={{ height: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: c.ink, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <Icon name="refresh" size={15} w={400} color={c.invink} /><T size={12} w={650} color={c.invink}>{t('lora.reconnect')}</T>
      </Pressable>
    </View>
  );
}
