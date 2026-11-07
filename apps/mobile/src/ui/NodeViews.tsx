/**
 * Telas do Piu 11 "Modo nó e malha" (design/handoff/design/"Piu 11 Modo no e malha.dc.html"), só
 * apresentação: cada uma recebe o estado já calculado (enums e números do modo nó, da carteira e da
 * malha) e as ações. As rotas (src/app/provider/phone/*, src/app/wallet/*, Rede) ligam os hooks reais
 * (`usePhoneNode`, `useWallet`, `useNetwork`, `useMessaging`); a galeria de desenvolvimento
 * (src/app/__dev/node.tsx, só em __DEV__) liga estados de exemplo pela MESMA interface.
 * Nenhum número de regra é fixo aqui: caução, avais, dias e limites chegam por `params`.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, TextInput, type TextInputInstance, View } from 'react-native';
import { fmtDate, fmtNumber, useT, type Key } from '../i18n';
import type { TransitPill, TransitStep } from '../lib/carryView';
import type { PauseReason, RequestState, EndorseBlock } from '../lib/phoneNodeCore';
import type { BondSheet, EvidenceRow, PhaseCard, TrailKey, TrailState as TrailStepState } from '../lib/phoneNodeView';
import type { PhraseIssue, SlotState } from '../lib/phraseConfirm';
import { dayLabel } from '../lib/walletCore';
import { fontFamily } from '../theme/fonts';
import { useTheme } from '../theme/ThemeProvider';
import { Toggle } from './Controls';
import { HoldToSign } from './HoldToSign';
import { Icon, type IconName } from './Icon';
import {
  Bar, CardButton, EmptyCard, FeatureRow, IconTile, InfoRows, Initial, KeyCard, Kicker, Lead, ListRow, LiveDot, Note, PhaseRow, PnButton, PnHeader, RowsCard, Shake,
  SmallButton, Spinner, StateCard, Tag, Trail, TravelLine, type TrailState,
} from './PhoneNode';
import { T } from './T';

type Tr = ReturnType<typeof useT>;
const DAY_MS = 86_400_000;
const hm = (ms: number) => fmtDate(ms, { hour: '2-digit', minute: '2-digit' });
const day = (ms: number, t: Tr) => dayLabel(ms, Date.now(), t);
const dayLower = (ms: number, t: Tr) => day(ms, t).toLowerCase();
const when = (ms: number, t: Tr) => `${dayLower(ms, t)}, ${hm(ms)}`;
export const nodeKeyLabel = (groups: string, t: Tr) => (groups === '—' ? groups : t('n11.keyPrefix', { key: groups }));

/** Parâmetros do programa (sempre os de `usePhoneNode().params`, nunca números fixos na tela). */
export interface NodeParams { bond: string; minEndorsements: number; days: number; batteryPct: number; dailyMb: number; rewardsOn: boolean; refundDays: number; endorseValidityDays: number; maxPerMonth: number }

/** Corpo com o padding do protótipo (6/20/32, gap 16) dentro de uma rolagem que cresce até o fim da tela. */
function Body({ children, gap = 16, top = 6, bottom = 32 }: { children: ReactNode; gap?: number; top?: number; bottom?: number }) {
  return <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: top, paddingHorizontal: 20, paddingBottom: bottom, gap }} keyboardShouldPersistTaps="handled">{children}</ScrollView>;
}
const Spacer = () => <View style={{ flex: 1 }} />;

// ══ N1 Entrada · Do celular ══════════════════════════════════

/** Segmentado com ícones do N1 ("Do celular" | "Pelo terminal"): `bg2` r14 p4; opção 38 r10, a ativa `bg` com sombra. */
export function IconSegmented<V extends string>({ value, options, onChange, label }: { value: V; options: [V, IconName, string][]; onChange: (v: V) => void; label: string }) {
  const { c } = useTheme();
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label} style={{ flexDirection: 'row', padding: 4, borderRadius: 14, backgroundColor: c.bg2, gap: 4 }}>
      {options.map(([v, icon, text]) => {
        const on = v === value;
        return (
          <Pressable key={v} onPress={() => onChange(v)} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={text}
            style={{ flex: 1, height: 38, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
              ...(on ? { backgroundColor: c.bg, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 } : {}) }}>
            <Icon name={icon} size={18} color={on ? c.ink : c.ink2} />
            <T size={14} w={on ? 600 : 550} color={on ? c.ink : c.ink2}>{text}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

export function EntryBody({ params, onActivate, onLater, busy }: { params: NodeParams; onActivate: () => void; onLater: () => void; busy?: boolean }) {
  const { c } = useTheme();
  const t = useT();
  return (
    <>
      <Lead kicker={t('n11.n1.kicker')} title={t('n11.n1.title')} sub={t('n11.n1.sub')} />
      <View>
        <FeatureRow icon="battery_5_bar" title={t('n11.n1.battery')} body={t('n11.n1.battery.body', { pct: params.batteryPct })} />
        <FeatureRow icon="swap_vert" title={t('n11.n1.data')} body={t('n11.n1.data.body', { mb: params.dailyMb })} />
        {params.rewardsOn
          ? <FeatureRow icon="toll" title={t('n11.n1.rewards')} body={t('pn.m1.rewards.on')} />
          : <FeatureRow icon="toll" title={t('n11.n1.rewards')} badge={t('n11.n1.rewards.badge')} body={t('n11.n1.rewards.body')} />}
      </View>
      <Spacer />
      <View style={{ borderRadius: 20, backgroundColor: c.bg2, paddingVertical: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <T size={12.5} color={c.ink2}>{t('n11.n1.bondLabel')}</T>
          <T size={22} w={700} ls={-0.03}>{t('n11.lunes', { amount: params.bond })}</T>
        </View>
        <View style={{ gap: 3, alignItems: 'flex-end' }}>
          <T size={12.5} color={c.ink2}>{t('n11.n1.plusDays', { n: params.days })}</T>
          <T size={12.5} color={c.ink2}>{t('n11.n1.plusEndorse', { count: params.minEndorsements })}</T>
        </View>
      </View>
      <View style={{ gap: 6 }}>
        <PnButton label={t('n11.n1.activate')} onPress={onActivate} busy={busy} />
        <PnButton ghost label={t('n11.n1.later')} onPress={onLater} />
      </View>
    </>
  );
}

/** N1 inteira (cabeçalho "Conectar" + segmentado + corpo), como na rota provider/connect com "Do celular". */
export function EntryScreen({ params, onActivate, onLater, onMode, onBack, busy }: { params: NodeParams; onActivate: () => void; onLater: () => void; onMode: (m: 'phone' | 'terminal') => void; onBack?: () => void; busy?: boolean }) {
  const t = useT();
  return (
    <>
      <PnHeader title={t('n11.n1.header')} onBack={onBack} />
      <Body>
        <IconSegmented label={t('provConnect.mode.a11y')} value="phone" onChange={onMode}
          options={[['phone', 'smartphone', t('provConnect.mode.phone')], ['terminal', 'terminal', t('provConnect.mode.terminal')]]} />
        <EntryBody params={params} onActivate={onActivate} onLater={onLater} busy={busy} />
      </Body>
    </>
  );
}

// ══ N2 Painel · N2b fases · N7b · N10a–c ═════════════════════

export interface PanelData {
  params: NodeParams;
  pause: PauseReason | null;
  card: PhaseCard | null;
  /** Dados das linhas de fase (N2b). */
  phase: { streak: number; daysLeft: number; endorsements: number; needed: number; refund: 'none' | 'waiting' | 'overdue' | 'returned'; refundDueMs: number | null; minutes: number };
  exitShare: boolean;
  trail: { key: TrailKey; state: TrailStepState }[];
  confirmedAtMs: number | null;
  certError: boolean;
  credits: { value: number; receipts: number };
  keyGroups: string;
  evidence: EvidenceRow;
  left: boolean;
  /** Pedidos de aval válidos esperando (sem desenho no Piu 11: a linha leva ao N6 sem depender da notificação). */
  requests: number;
}
export interface PanelActions {
  payBond: () => void; confirmBond: () => void; retryBond: () => void; abandonBond: () => void; ask: () => void; share: () => void; sendEvidence: () => void;
  leave: () => void; backToNode: () => void; copyKey: () => void; retryCert: () => void; requests: () => void; back?: () => void;
}

const PAUSE: Record<PauseReason, Key> = { off: 'pn.pause.off', battery: 'pn.pause.battery', charging: 'pn.pause.charging', dailyLimit: 'pn.pause.dailyLimit', hours: 'pn.pause.hours', noPeers: 'pn.pause.noPeers' };

/** Linha de uma fase (N2b): ícone, título, texto e a ação dela. */
export function PhaseLine({ card, d, a, first }: { card: PhaseCard; d: PanelData['phase'] & { bond: string; days: number }; a: Partial<PanelActions>; first?: boolean }) {
  const { c } = useTheme();
  const t = useT();
  const tile = (name: IconName, solid?: boolean) => <IconTile name={name} solid={solid} />;
  switch (card) {
    case 'needsBond':
      return <PhaseRow first={first} tile={tile('account_balance_wallet')} title={t('n11.n2b.needsBond')} sub={t('n11.n2b.needsBond.sub', { bond: d.bond })} right={<SmallButton label={t('n11.payBond')} onPress={a.payBond} />} />;
    case 'bondSent':
      return <PhaseRow first={first} tile={<View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}><Spinner size={18} /></View>} title={t('n11.n2b.bondSent')} sub={t('n11.n2b.bondSent.sub')} />;
    case 'bondUnconfirmed':
      return <PhaseRow first={first} tile={tile('cloud_off')} title={t('pn.m2e2.title')} sub={t('pn.m2e2.sub', { min: d.minutes })} right={<SmallButton outline label={t('n11.retry')} onPress={a.retryBond} />} />;
    case 'bondFailed':
      return <PhaseRow first={first} tile={tile('error')} title={t('pn.m2f.title')} sub={t('pn.m2f.sub')} right={<SmallButton label={t('n11.payAgain')} onPress={a.abandonBond} />} />;
    case 'confirmBond':
      return <PhaseRow first={first} tile={tile('task_alt')} title={t('n11.n2b.confirm')} sub={t('n11.n2b.confirm.sub')} right={<SmallButton label={t('n11.confirm')} onPress={a.confirmBond} />} />;
    case 'days':
      return <PhaseRow first={first} tile={tile('hourglass_top')} title={t('n11.n2b.days', { n: d.days })} sub={t('n11.daysLeft', { count: d.daysLeft })} right={<T size={12} w={500} mono color={c.ink2}>{`${d.streak}/${d.days}`}</T>} />;
    case 'endorse':
      return <PhaseRow first={first} tile={tile('handshake')} title={t('n11.n2b.endorse', { n: d.endorsements, needed: d.needed })} sub={t('n11.n2b.endorse.sub', { count: Math.max(0, d.needed - d.endorsements) })} right={<SmallButton outline label={t('pn.ask')} onPress={a.ask} />} />;
    case 'ready':
      return <PhaseRow first={first} tile={tile('verified', true)} title={t('n11.trail.ready')} sub={t('n11.trail.readyDone')} />;
    case 'left':
      return <PhaseRow first={first} tile={tile('logout')} title={t('n11.n2b.left')} sub={t(d.refund === 'returned' ? 'n11.n2b.left.returned' : d.refund === 'overdue' ? 'n11.n2b.left.overdue' : 'n11.n2b.left.sub')}
        right={<SmallButton outline icon="ios_share" label={t('n11.registry')} onPress={a.share} />} />;
  }
}

/** N10a–c: a linha "Enviar evidências pela malha". */
export function EvidenceLine({ row, onSend, first }: { row: EvidenceRow; onSend: () => void; first?: boolean }) {
  const t = useT();
  const title = t('n11.n2.evidence');
  switch (row.kind) {
    case 'ready': return <ListRow first={first} icon="hub" title={title} sub={t('n11.n10.ready', { count: row.n })} right={<SmallButton label={t('n11.n10.send')} onPress={onSend} />} />;
    case 'noValidator': return <ListRow first={first} dim icon="hub" title={title} sub={t('n11.n10.noValidator')} right={<View style={{ opacity: 0.45 }}><SmallButton label={t('n11.n10.send')} disabled /></View>} />;
    case 'notReady': return <ListRow first={first} dim icon="hub" title={title} sub={t('n11.n10.notReady')} right={<View style={{ opacity: 0.45 }}><SmallButton label={t('n11.n10.send')} disabled /></View>} />;
    case 'nothing': return <ListRow first={first} icon="hub" title={title} sub={row.carried ? t('n11.n10.carried') : t('n11.n10.nothing')} right={<Icon name="check_circle" size={22} fill />} />;
  }
}

export function PanelView({ d, a }: { d: PanelData; a: PanelActions }) {
  const { c } = useTheme();
  const t = useT();
  const { params } = d;
  const phase = { ...d.phase, bond: params.bond, days: params.days };
  const chev = <Icon name="chevron_right" size={20} color={c.ink3} />;
  const stepTitle: Record<TrailKey, string> = {
    paid: t('n11.trail.paid'), confirmed: t('n11.trail.confirmed'), days: t('n11.trail.days', { n: params.days }), endorse: t('n11.trail.endorse'), ready: t('n11.trail.ready'),
  };
  const steps = d.trail.map(s => {
    const base = { state: s.state as TrailState, title: stepTitle[s.key] };
    switch (s.key) {
      case 'paid': return { ...base, right: t('n11.lunes', { amount: params.bond }) };
      case 'confirmed': return { ...base, right: s.state === 'done' && d.confirmedAtMs ? dayLower(d.confirmedAtMs, t) : undefined };
      case 'days':
        return { ...base, right: s.state === 'done' ? t('n11.trail.daysDone') : s.state === 'current' ? t('n11.daysLeftShort', { count: d.phase.daysLeft }) : undefined,
          sub: s.state === 'current' && d.certError ? t('n11.trail.certErr') : undefined,
          extra: s.state === 'current' ? (
            <View style={{ gap: 10 }}>
              <Bar pct={d.phase.streak / params.days} />
              {d.certError ? <SmallButton outline icon="refresh" label={t('n11.retry')} onPress={a.retryCert} /> : null}
            </View>
          ) : undefined };
      case 'endorse':
        return { ...base, right: t('n11.trail.endorseCount', { n: d.phase.endorsements, needed: d.phase.needed }),
          extra: s.state === 'current' ? <SmallButton outline icon="handshake" label={t('pn.ask')} onPress={a.ask} /> : undefined };
      case 'ready': return { ...base, sub: s.state === 'done' ? t('n11.trail.readyDone') : t('n11.trail.readySub') };
    }
  });

  return (
    <>
      <PnHeader title={t('n11.n2.title')} onBack={a.back} right={d.left ? undefined : <Tag>{d.pause ? t('n11.n2.paused') : t('n11.n2.active')}</Tag>} />
      <Body top={4} bottom={30}>
        {d.exitShare && (
          <StateCard icon="logout" title={t('n11.n7b.title')} body={t('n11.n7b.body')} actions={<CardButton label={t('n11.n2.share')} onPress={a.share} />} />
        )}
        {d.card && (
          <RowsCard><PhaseLine first card={d.card} d={phase} a={a} /></RowsCard>
        )}
        {!d.left && <Trail steps={steps} />}
        {!d.left && d.pause && <T size={12.5} color={c.ink2} style={{ marginTop: -6 }}>{t('n11.n2.pausedWhy', { why: t(PAUSE[d.pause]) })}</T>}
        {!d.left && (
          <View style={{ borderRadius: 20, backgroundColor: c.bg2, paddingVertical: 13, paddingHorizontal: 16, gap: 4 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <T size={13} color={c.ink2}>{t('n11.n2.credits')}</T>
              <Tag>{t('n11.n2.notMoney')}</Tag>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <T size={26} w={700} ls={-0.04} tabular>{fmtNumber(d.credits.value, { maximumFractionDigits: 1 })}</T>
              <T size={13} color={c.ink2}>{t('n11.n2.creditsSub', { count: d.credits.receipts })}</T>
            </View>
          </View>
        )}
        {!d.left && <KeyCard label={t('n11.n2.keyLabel')} value={nodeKeyLabel(d.keyGroups, t)} onCopy={a.copyKey} copyLabel={t('common.copy')} />}
        <View style={{ borderRadius: 20, overflow: 'hidden' }}>
          <ListRow first icon="ios_share" title={t('n11.n2.share')} right={chev} onPress={a.share} />
          <EvidenceLine row={d.evidence} onSend={a.sendEvidence} />
          {d.requests > 0 && !d.left && <ListRow icon="handshake" title={t('n11.n6.title')} onPress={a.requests} right={<><T size={12} w={500} mono color={c.ink2}>{String(d.requests)}</T>{chev}</>} />}
          {d.left
            ? <ListRow icon="restart_alt" title={t('n11.n2.backToNode')} sub={t('n11.n2.backToNode.sub', { n: params.days })} right={chev} onPress={a.backToNode} />
            : <ListRow icon="logout" title={t('n11.n2.leave')} right={chev} onPress={a.leave} />}
        </View>
      </Body>
    </>
  );
}

/** N2b no protótipo: todas as linhas de fase empilhadas (galeria). */
export function PhaseLinesCard({ cards, d, a }: { cards: PhaseCard[]; d: PanelData['phase'] & { bond: string; days: number }; a: Partial<PanelActions> }) {
  return <RowsCard>{cards.map((k, i) => <PhaseLine key={k} first={i === 0} card={k} d={d} a={a} />)}</RowsCard>;
}

// ══ N3 Pagar caução · N3a–e estados · N3f–h erros ═══════════

export type BondError = { kind: 'insufficient'; missing: string; have: string; need: string } | { kind: 'cancelled' } | { kind: 'busy' } | { kind: 'quote' };
export interface BondData {
  params: NodeParams;
  sheet: BondSheet;
  /** Cotação real (formatada) ou null enquanto calcula. */
  quote: { to: string; fee: string; total: string; after: string } | null;
  error: BondError | null;
  registeredSinceMs: number | null;
  holdKey: number;
}
export function BondSheetView({ d, a }: { d: BondData; a: { close: () => void; sign: () => void; createWallet: () => void; activate: () => void; receive: () => void; retry: () => void } }) {
  const { c } = useTheme();
  const t = useT();
  const bond = d.params.bond;
  const state = (() => {
    switch (d.sheet) {
      case 'soon': return <StateCard icon="schedule" title={t('n11.n3a.title')} body={t('n11.n3a.body')} actions={<CardButton disabled label={t('n11.payBond')} />} />;
      case 'noWallet': return <StateCard icon="account_balance_wallet" title={t('n11.n3b.title')} body={t('n11.n3b.body')} actions={<CardButton label={t('n11.n3b.do')} onPress={a.createWallet} />} />;
      case 'sent': return <StateCard spinner title={t('n11.n3c.title')} body={t('n11.n3c.body')} />;
      case 'registered': return <StateCard icon="verified" solid title={t('n11.n3d.title')} body={d.registeredSinceMs ? t('n11.n3d.body', { bond, date: dayLower(d.registeredSinceMs, t) }) : t('n11.n3d.bodyNoDate', { bond })} />;
      case 'inactive': return <StateCard icon="power_settings_new" title={t('n11.n3e.title')} body={t('n11.n3e.body')} actions={<CardButton label={t('n11.n1.activate')} onPress={a.activate} />} />;
      default: return null;
    }
  })();
  const err = d.error?.kind === 'insufficient'
    ? <StateCard icon="account_balance_wallet" solid title={t('n11.n3f.title', { amount: d.error.missing })} body={t('n11.n3f.body', { have: d.error.have, need: d.error.need })} actions={<CardButton label={t('n11.n3f.do')} onPress={a.receive} />} />
    : d.error?.kind === 'cancelled' ? <StateCard icon="fingerprint" solid title={t('n11.n3g.title')} body={t('n11.n3g.body')} />
    : d.error?.kind === 'busy' ? <StateCard icon="hourglass_empty" solid title={t('n11.n3h.title')} body={t('n11.n3h.body')} actions={<CardButton label={t('n11.retry')} onPress={a.retry} />} />
    : null;
  return (
    <View style={{ flex: 1 }}>
      <PnHeader title={t('n11.n2.title')} onBack={a.close} />
      <View style={{ paddingTop: 6, paddingHorizontal: 20, opacity: 0.5 }}>
        <Lead kicker={t('n11.n3.kicker')} title={t('n11.n2b.needsBond')} size={26} />
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={a.close} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.scrim }} />
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: 150, borderTopLeftRadius: 32, borderTopRightRadius: 32, backgroundColor: c.bg,
        shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 40, shadowOffset: { width: 0, height: -10 }, elevation: 12 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: 10, paddingHorizontal: 20, paddingBottom: 32, gap: 16 }}>
          <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: c.bg3, alignSelf: 'center' }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <T size={18} w={650} ls={-0.02} accessibilityRole="header">{t('n11.payBond')}</T>
            <Pressable onPress={a.close} accessibilityRole="button" accessibilityLabel={t('common.close')} style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={18} w={300} />
            </Pressable>
          </View>
          {state ?? (
            <>
              <View style={{ alignItems: 'center', gap: 6, paddingTop: 10, paddingBottom: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                  <T size={68} w={700} ls={-0.06} tabular style={{ lineHeight: 68 }}>{bond}</T>
                  <T size={16} w={500} mono>LUNES</T>
                </View>
                <T size={14} color={c.ink2} align="center">{t('n11.n3.locked')}</T>
              </View>
              <InfoRows rows={[
                { label: t('n11.n3.to'), value: d.quote ? t('n11.n3.toValue', { addr: d.quote.to }) : '—', mono: true },
                { label: t('n11.n3.fee'), value: d.quote ? t('n11.lunes', { amount: d.quote.fee }) : t('ownWallet.estimating') },
                { label: t('n11.n3.total'), value: d.quote ? t('n11.lunes', { amount: d.quote.total }) : '—', strong: true },
                { label: t('n11.n3.after'), value: d.quote ? t('n11.lunes', { amount: d.quote.after }) : '—' },
              ]} />
              <Spacer />
              {err}
              <View style={{ gap: 10 }}>
                <HoldToSign key={d.holdKey} look="node" onSign={a.sign} disabled={!d.quote || d.error?.kind === 'insufficient'}
                  label={t('n11.hold.sign')} holdingLabel={t('n11.hold.holding')} doneLabel={t('n11.hold.bondDone')} note={d.error?.kind === 'quote' ? t('pn.m2.quoteFail') : null} />
                <T size={11.5} mono color={c.ink2} align="center">{t('n11.n3.signsWith')}</T>
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

// ══ N4 Confirmar caução · N4a–d ══════════════════════════════

export type ConfirmResult = 'ok' | 'notFinal' | 'cancelled' | 'recover' | null;
export interface ConfirmData { bond: string; days: number; hash: string; finalizedMs: number | null; result: ConfirmResult; busy: boolean }
export function ConfirmView({ d, a }: { d: ConfirmData; a: { confirm: () => void; later: () => void; panel: () => void; phrase: () => void; back?: () => void } }) {
  const { c } = useTheme();
  const t = useT();
  const card = d.result === 'ok' ? <StateCard icon="verified" solid title={t('n11.n4a.title')} body={t('n11.n4a.body', { days: d.days })} actions={<CardButton label={t('n11.n4a.do')} onPress={a.panel} />} />
    : d.result === 'notFinal' ? <StateCard icon="hourglass_top" title={t('n11.n4b.title')} body={t('n11.n4b.body')} actions={<><CardButton ghost label={t('common.close')} onPress={a.later} /><CardButton label={t('n11.n4b.do')} onPress={a.panel} /></>} />
    : d.result === 'cancelled' ? <StateCard icon="block" title={t('n11.n4c.title')} body={t('n11.n4c.body')} actions={<CardButton label={t('common.close')} onPress={a.panel} />} />
    : d.result === 'recover' ? <StateCard icon="key" solid title={t('n11.n4d.title')} body={t('n11.n4d.body')} actions={<CardButton label={t('n11.n4d.do')} onPress={a.phrase} />} />
    : null;
  return (
    <>
      <PnHeader title={t('n11.n4.header')} onBack={a.back} />
      <Body>
        <View style={{ alignItems: 'center', gap: 16, paddingTop: 16 }}>
          <View style={{ width: 150, height: 150, borderRadius: 75, borderWidth: 10, borderColor: c.bg3, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 65, borderWidth: 1.5, borderColor: c.ink }} />
            <Icon name="task_alt" size={52} w={300} />
          </View>
          <View style={{ gap: 6, alignItems: 'center' }}>
            <T size={22} w={700} ls={-0.03} align="center" accessibilityRole="header">{t('n11.n4.title')}</T>
            <T size={14} lh={1.45} color={c.ink2} align="center" style={{ maxWidth: 300 }}>{t('n11.n4.sub')}</T>
          </View>
        </View>
        <InfoRows rows={[
          { label: t('n11.n4.value'), value: t('n11.lunes', { amount: d.bond }) },
          { label: t('n11.n4.tx'), value: d.hash, mono: true },
          { label: t('n11.n4.final'), value: d.finalizedMs ? when(d.finalizedMs, t) : '—' },
        ]} />
        <Spacer />
        {card ?? (
          <View style={{ gap: 6 }}>
            <PnButton icon="fingerprint" label={t('n11.n4.do')} onPress={a.confirm} busy={d.busy} />
            <PnButton ghost label={t('n11.n4.later')} onPress={a.later} />
          </View>
        )}
      </Body>
    </>
  );
}

// ══ N4e Confirme a sua frase de novo · N4f–h ════════════════

export interface PhraseData { words: string[]; cursor: number; slots: SlotState[]; issue: PhraseIssue | { kind: 'other' } | null; shake: number; suggestions: string[]; result: 'confirmed' | 'without' | null; busy: boolean; n: number }
export function PhraseView({ d, a }: { d: PhraseData; a: { close: () => void; focus: (i: number) => void; type: (i: number, v: string) => void; pick: (w: string) => void; submit: () => void; without: () => void; file: () => void; confirmBond: () => void; panel: () => void } }) {
  const { c } = useTheme();
  const t = useT();
  const err = d.issue?.kind === 'notInList' ? t('n11.n4f.notInList', { n: d.issue.index + 1 })
    : d.issue?.kind === 'checksum' ? t('n11.n4f.checksum', { n: d.n })
    : d.issue?.kind === 'other' ? t('n11.n4f.other') : null;
  const complete = d.words.every(Boolean);
  const refs = useRef<(TextInputInstance | null)[]>([]);
  useEffect(() => { refs.current[d.cursor]?.focus(); }, [d.cursor]);
  return (
    <>
      <PnHeader close title={t('n11.n4e.header')} onBack={a.close} />
      <Body gap={20}>
        <Lead kicker={t('n11.n4e.kicker')} title={t('n11.n4e.title')} sub={t('n11.n4e.sub', { n: d.n })} subSize={14} />
        {d.result === 'confirmed' ? (
          <StateCard icon="verified" solid title={t('n11.n4g.title')} body={t('n11.n4g.body')} actions={<CardButton label={t('n11.n4g.do')} onPress={a.confirmBond} />} />
        ) : d.result === 'without' ? (
          <StateCard icon="schedule" title={t('n11.n4h.title')} body={t('n11.n4h.body')} actions={<CardButton label={t('n11.n4h.do')} onPress={a.panel} />} />
        ) : (
          <>
            <View style={{ gap: 14 }}>
              <Shake trigger={d.shake} style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 10, columnGap: 8 }}>
                {d.slots.map((s, i) => (
                  <View key={i} style={{ width: '31.5%', flexGrow: 1, gap: 6, alignItems: 'center' }}>
                    <T size={11.5} w={500} mono color={c.ink2}>{`#${i + 1}`}</T>
                    <TextInput ref={r => { refs.current[i] = r; }} value={d.words[i] ?? ''} onFocus={() => a.focus(i)} onChangeText={v => a.type(i, v)}
                      autoCapitalize="none" autoCorrect={false} autoComplete="off" spellCheck={false} editable={!d.busy}
                      accessibilityLabel={t('phrase.word', { n: i + 1 })} returnKeyType={i < d.n - 1 ? 'next' : 'done'} onSubmitEditing={() => (i < d.n - 1 ? a.focus(i + 1) : a.submit())}
                      style={{ width: '100%', height: 48, borderRadius: 14, textAlign: 'center', fontSize: 15, fontFamily: fontFamily(600), paddingVertical: 0,
                        ...(s === 'filled' ? { backgroundColor: c.ink, color: c.invink } : s === 'current' ? { borderWidth: 2, borderColor: c.ink, color: c.ink } : { backgroundColor: c.bg2, color: c.ink }),
                        outlineWidth: 0 } as object} />
                  </View>
                ))}
              </Shake>
              {err && (
                <View accessibilityRole="alert" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Icon name="error" size={18} fill />
                  <T size={13.5} w={600} style={{ flex: 1 }}>{err}</T>
                </View>
              )}
            </View>
            {d.suggestions.length > 0 && (
              <View accessibilityLabel={t('phrase.suggestions')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {d.suggestions.map(w => (
                  <Pressable key={w} onPress={() => a.pick(w)} accessibilityRole="button" accessibilityLabel={w}
                    style={({ pressed }) => ({ width: '31.5%', flexGrow: 1, height: 44, borderRadius: 12, borderWidth: 1, borderColor: c.line2, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>
                    <T size={15} w={550}>{w}</T>
                  </Pressable>
                ))}
              </View>
            )}
            <Note icon="lock">{t('n11.n4e.note')}</Note>
            <Spacer />
            <View style={{ gap: 0 }}>
              <PnButton label={t('n11.n4e.do')} onPress={a.submit} disabled={!complete} busy={d.busy} />
              <PnButton ghost label={t('n11.n4e.without')} onPress={a.without} />
              <PnButton ghost label={t('n11.n4e.file')} onPress={a.file} />
            </View>
          </>
        )}
      </Body>
    </>
  );
}

// ══ N5 Pedir aval · N5v ═════════════════════════════════════

export type AskItem = { contactId: string; name: string } & (
  | { kind: 'received'; atMs: number } | { kind: 'asked'; atMs: number } | { kind: 'eligible' }
  | { kind: 'tooNew'; nodeDays: number; daysLeft: number } | { kind: 'notVerified' } | { kind: 'noNode' }
);
export interface AskData { endorsements: number; needed: number; items: AskItem[]; keyGroups: string; bondPending: boolean; busy: string | null }
export function AskView({ d, a }: { d: AskData; a: { ask: (id: string) => void; verify: (id: string) => void; copyKey: () => void; addContact: () => void; back?: () => void } }) {
  const { c } = useTheme();
  const t = useT();
  const left = Math.max(0, d.needed - d.endorsements);
  const sub = (r: AskItem) => {
    switch (r.kind) {
      case 'received': return t('n11.n5.received', { date: dayLower(r.atMs, t) });
      case 'asked': return t('n11.n5.asked', { when: dayLower(r.atMs, t) });
      case 'eligible': return t('n11.n5.public');
      case 'tooNew': return t('pn.m4.tooNew', { n: r.nodeDays, left: r.daysLeft });
      case 'notVerified': return t('pn.m4.notVerified');
      case 'noNode': return t('pn.m4.noNode');
    }
  };
  return (
    <>
      <PnHeader title={t('pn.ask')} onBack={a.back} />
      <Body>
        <Lead title={left > 0 ? t('n11.n5.title', { count: left }) : t('n11.n5.done')} sub={t('n11.n5.sub')} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1, flexDirection: 'row', gap: 6 }}>
            {Array.from({ length: d.needed }, (_, i) => <View key={i} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: i < d.endorsements ? c.ink : c.bg3 }} />)}
          </View>
          <T size={12} w={500} mono color={c.ink2}>{t('n11.n5.count', { n: Math.min(d.endorsements, d.needed), needed: d.needed })}</T>
        </View>
        {d.items.length === 0 ? (
          <EmptyCard icon="group_off" title={t('n11.n5v.title')} body={t('n11.n5v.body')}
            actions={<><CardButton ghost label={t('n11.n5v.copy')} onPress={a.copyKey} /><CardButton label={t('n11.n5v.add')} onPress={a.addContact} /></>} />
        ) : (
          <>
            <View>
              <Kicker>{t('n11.n5.contacts')}</Kicker>
              <View style={{ height: 6 }} />
              {d.items.map((r, i) => (
                <View key={r.contactId} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                  <Initial name={r.name} />
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <T size={15} w={600} numberOfLines={1}>{r.name}</T>
                    <T size={12.5} lh={1.35} color={c.ink2} numberOfLines={1}>{sub(r)}</T>
                  </View>
                  {r.kind === 'received' ? <Icon name="check_circle" size={22} fill />
                    : r.kind === 'asked' ? <Tag>{t('n11.n5.tag')}</Tag>
                    : r.kind === 'eligible' ? <SmallButton label={t('pn.ask')} onPress={d.busy ? undefined : () => a.ask(r.contactId)} disabled={!!d.busy} />
                    : r.kind === 'notVerified' ? <SmallButton outline label={t('pn.verify')} onPress={() => a.verify(r.contactId)} />
                    : null}
                </View>
              ))}
            </View>
            {d.bondPending && <T size={12.5} lh={1.4} color={c.ink2}>{t('pn.m4.bondPending')}</T>}
            <Spacer />
            <KeyCard label={t('n11.n5.keyLabel')} value={nodeKeyLabel(d.keyGroups, t)} onCopy={a.copyKey} copyLabel={t('common.copy')} />
          </>
        )}
      </Body>
    </>
  );
}

// ══ N6 Pedidos recebidos · N6a–d · N6v · N6n ════════════════

export interface RequestItemData { contactId: string; name: string; createdAtMs: number; keyGroups: string; state: RequestState; block: EndorseBlock | null; expanded: boolean; givenAtMs: number | null }
export interface RequestsData { given: number; max: number; renewsMs: number; items: RequestItemData[]; validityDays: number; minAgeDays: number; ttlDays: number; holdKey: number }
export function RequestsView({ d, a }: { d: RequestsData; a: { endorse: (id: string) => void; ignore: (id: string) => void; expand: (id: string) => void; activate: () => void; verify: (id: string) => void; openChat: (id: string) => void; back?: () => void } }) {
  const { c } = useTheme();
  const t = useT();
  const renews = day(d.renewsMs, t).toLowerCase();
  const open = d.items.find(r => r.expanded);
  const rest = d.items.filter(r => !r.expanded);
  const first = (n: string) => n.split(/\s+/)[0] || n;
  const blockCard = (r: RequestItemData) => {
    const reason = r.state !== 'ok' ? r.state : r.block;
    if (!reason) return null;
    const name = first(r.name);
    switch (reason) {
      case 'inactive': return <StateCard bare icon="power_settings_new" title={t('n11.n6a.title')} body={t('n11.n6a.body', { name })} actions={<CardButton label={t('n11.n6a.do')} onPress={a.activate} />} />;
      case 'self': return <StateCard bare icon="person_off" title={t('n11.n6b.title')} body={t('n11.n6b.body')} />;
      case 'already': return <StateCard bare icon="check_circle" title={t('n11.n6c.title', { name })} body={r.givenAtMs ? t('n11.n6c.body', { date: dayLower(r.givenAtMs, t) }) : t('n11.n6c.bodyNoDate')} />;
      case 'monthly': return <StateCard bare icon="event_busy" title={t('n11.n6d.title', { n: d.given, max: d.max })} body={t('n11.n6d.body', { date: renews })} />;
      default: {
        const vars = { name, days: d.ttlDays, age: d.minAgeDays, max: d.max };
        const icon: IconName = reason === 'notVerified' ? 'qr_code_scanner' : reason === 'tooNew' ? 'schedule' : reason === 'noBond' ? 'lock' : 'hourglass_disabled';
        return <StateCard bare icon={icon} title={t(`pn.m5e.${reason}.title` as Key, vars)} body={t(`pn.m5e.${reason}.body` as Key, vars)}
          actions={reason === 'notVerified' ? <CardButton label={t('pn.m5e.verify', { name })} onPress={() => a.verify(r.contactId)} /> : <CardButton ghost label={t('pn.m5e.openChat', { name })} onPress={() => a.openChat(r.contactId)} />} />;
      }
    }
  };
  return (
    <>
      <PnHeader title={t('n11.n6.title')} onBack={a.back} />
      <Body>
        <View style={{ gap: 8, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 20, backgroundColor: c.bg2 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <T size={15} w={600}>{t('n11.n6.count', { n: d.given, max: d.max })}</T>
            <T size={12} w={500} mono color={c.ink2}>{t('n11.n6.renews', { date: renews })}</T>
          </View>
          <Bar pct={d.max ? d.given / d.max : 1} />
        </View>
        {!open ? (
          <EmptyCard icon="inbox" title={t('n11.n6v.title')} body={t('n11.n6v.body')} />
        ) : (
          <>
            <View style={{ padding: 16, borderRadius: 22, borderWidth: 1, borderColor: c.line2, gap: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Initial name={open.name} />
                <View style={{ flex: 1, gap: 2 }}>
                  <T size={16} w={650} numberOfLines={1}>{open.name}</T>
                  <T size={12.5} color={c.ink2}>{t('n11.n6.askedAt', { when: when(open.createdAtMs, t) })}</T>
                </View>
              </View>
              {blockCard(open) ?? (
                <>
                  <View style={{ paddingVertical: 9, paddingHorizontal: 12, borderRadius: 12, backgroundColor: c.bg2 }}>
                    <T size={12.5} w={500} mono selectable>{nodeKeyLabel(open.keyGroups, t)}</T>
                  </View>
                  <T size={13.5} lh={1.45} color={c.ink2}>{t('n11.n6.info', { days: d.validityDays })}</T>
                  <View style={{ gap: 10 }}>
                    <HoldToSign key={`${open.contactId}-${d.holdKey}`} look="node" onSign={() => a.endorse(open.contactId)}
                      label={t('n11.hold.endorse')} holdingLabel={t('n11.hold.holding')} doneLabel={t('n11.hold.endorseDone', { name: first(open.name) })} />
                  </View>
                </>
              )}
              <PnButton ghost height={40} label={t('n11.n6.ignore')} onPress={() => a.ignore(open.contactId)} />
            </View>
            {rest.length > 0 && (
              <View>
                {rest.map((r, i) => (
                  <View key={r.contactId} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                    <Initial name={r.name} />
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <T size={15} w={600} numberOfLines={1}>{r.name}</T>
                      <T size={12.5} lh={1.35} color={c.ink2} numberOfLines={1}>{t('n11.n6.askedShort', { when: dayLower(r.createdAtMs, t) })}</T>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <SmallButton outline label={t('n11.n6.ignore')} onPress={() => a.ignore(r.contactId)} />
                      <SmallButton label={t('n11.n6.endorse')} onPress={() => a.expand(r.contactId)} />
                    </View>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </Body>
    </>
  );
}

/** N6n: como a notificação aparece (a de verdade é do sistema; dentro do app, o aviso do Toast). */
export function RequestNotificationPreview({ name }: { name: string }) {
  const { c } = useTheme();
  const t = useT();
  return (
    <View style={{ paddingVertical: 12, paddingHorizontal: 14, borderRadius: 22, backgroundColor: c.bg2, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 30, shadowOffset: { width: 0, height: 8 }, flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
      <View style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}><Icon name="verified" size={20} color={c.invink} /></View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T size={14} w={650}>Piu</T><T size={12} color={c.ink2}>{t('n11.now')}</T></View>
        <T size={14} w={550}>{t('n11.n6n.title')}</T>
        <T size={13.5} color={c.ink2}>{t('n11.n6n.body', { name })}</T>
      </View>
    </View>
  );
}

// ══ N7 Sair · N7b ═══════════════════════════════════════════

export interface LeaveData { params: NodeParams; mode: 'refund' | 'turnOff' | 'wait'; holdKey: number }
export function LeaveView({ d, a }: { d: LeaveData; a: { sign: () => void; stay: () => void; back?: () => void } }) {
  const { c } = useTheme();
  const t = useT();
  const p = d.params;
  return (
    <>
      <PnHeader onBack={a.back} />
      <Body>
        <Lead kicker={t('n11.n7.kicker')} title={d.mode === 'refund' ? t('n11.n7.title') : t('pn.m6.titleOff')} sub={t('n11.n7.sub')} size={30} />
        <View>
          {d.mode === 'refund' ? (
            <>
              <FeatureRow icon="schedule" title={t('n11.n7.refund')} body={t('n11.n7.refund.body', { bond: p.bond, days: p.refundDays })} />
              <FeatureRow icon="receipt_long" title={t('n11.n7.receipts')} body={t('n11.n7.receipts.body')} />
              <FeatureRow icon="ios_share" title={t('n11.n7.file')} body={t('n11.n7.file.body')} />
            </>
          ) : (
            <>
              <FeatureRow icon="receipt_long" title={t('n11.n7.receipts')} body={t('n11.n7.receipts.body')} />
              {d.mode === 'wait'
                ? <FeatureRow icon="schedule" title={t('pn.m6.wait')} body={t('pn.m6.wait.body')} />
                : <FeatureRow icon="lock_open" title={t('pn.m6.noBond')} body={t('pn.m6.noBond.body')} />}
            </>
          )}
        </View>
        <Spacer />
        {d.mode === 'wait' ? (
          <PnButton label={t('pn.m6.waitBtn')} icon="schedule" disabled />
        ) : (
          <View style={{ gap: 10 }}>
            <HoldToSign key={d.holdKey} look="node" onSign={a.sign} label={t('n11.hold.leave')} holdingLabel={t('n11.hold.holding')} doneLabel={t('n11.hold.leaveDone')} />
            <T size={11.5} mono color={c.ink2} align="center">{t('n11.n7.signsWith')}</T>
          </View>
        )}
        <PnButton ghost label={t('n11.n7.stay')} onPress={a.stay} />
      </Body>
    </>
  );
}

// ══ N8 Enviar sem internet · N8a–b ══════════════════════════

export type MeshBlock = { kind: 'noReading'; maxDays: number } | { kind: 'stale'; days: number; maxDays: number } | { kind: 'funds'; have: string; need: string } | null;
export interface MeshSendData { name: string | null; address: string; amount: string; fee: string; total: string; readingDays: number | null; block: MeshBlock; holdKey: number; error: string | null }
export function MeshSendView({ d, a }: { d: MeshSendData; a: { sign: () => void; adjust: () => void; back?: () => void } }) {
  const { c } = useTheme();
  const t = useT();
  const card = d.block?.kind === 'noReading' ? <StateCard icon="wifi_off" solid title={t('n11.n8a.none')} body={t('n11.n8a.noneBody', { max: d.block.maxDays })} />
    : d.block?.kind === 'stale' ? <StateCard icon="wifi_off" solid title={t('n11.n8a.title')} body={t('n11.n8a.body', { max: d.block.maxDays, count: d.block.days })} />
    : d.block?.kind === 'funds' ? <StateCard icon="account_balance_wallet" solid title={t('n11.n8b.title')} body={t('n11.n8b.body', { have: d.block.have, need: d.block.need })} actions={<CardButton label={t('n11.n8b.do')} onPress={a.adjust} />} />
    : null;
  return (
    <>
      <PnHeader title={t('wallet.send')} onBack={a.back} />
      <Body>
        <MeshBanner />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}>
          <Initial name={d.name ?? '?'} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <T size={15} w={600} numberOfLines={1}>{d.name ?? t('n11.n8.other')}</T>
            <T size={12.5} lh={1.35} mono color={c.ink2} numberOfLines={1}>{d.address}</T>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 8, paddingVertical: 6 }}>
          <T size={68} w={700} ls={-0.06} tabular style={{ lineHeight: 68 }}>{d.amount}</T>
          <T size={16} w={500} mono>LUNES</T>
        </View>
        <InfoRows rows={[
          { label: t('n11.n8.fee'), value: t('n11.n8.feeValue', { fee: d.fee }) },
          { label: t('n11.n3.total'), value: t('n11.lunes', { amount: d.total }), strong: true },
          { label: t('n11.n8.reading'), value: d.readingDays === null ? '—' : d.readingDays === 0 ? t('n11.n8.readingToday') : t('n11.n8.readingAgo', { count: d.readingDays }) },
        ]} />
        <Spacer />
        {card}
        <View style={{ gap: 10 }}>
          <HoldToSign key={d.holdKey} look="node" onSign={a.sign} disabled={!!d.block}
            label={t('n11.hold.sign')} holdingLabel={t('n11.hold.holding')} doneLabel={t('n11.hold.meshDone')} note={d.error} />
          <T size={11.5} mono color={c.ink2} align="center">{t('n11.n8.signsWith')}</T>
        </View>
      </Body>
    </>
  );
}

/** Aviso do topo do N8 (também na folha Enviar quando não há rede). */
export function MeshBanner() {
  const { c } = useTheme();
  const t = useT();
  return (
    <View style={{ paddingVertical: 14, paddingHorizontal: 16, borderRadius: 18, backgroundColor: c.ink, flexDirection: 'row', gap: 12 }}>
      <Icon name="hub" size={22} color={c.invink} />
      <View style={{ flex: 1, gap: 3 }}>
        <T size={15} w={650} color={c.invink}>{t('n11.n8.banner')}</T>
        <T size={13} lh={1.4} color={c.invink} style={{ opacity: 0.78 }}>{t('n11.n8.bannerBody')}</T>
      </View>
    </View>
  );
}

// ══ N9 Em trânsito · N9a · N9b · N9c · N9d ══════════════════

const PILL: Record<TransitPill, Key> = {
  traveling: 'n11.n9.pill.traveling', reported: 'n11.n9.pill.reported', refused: 'n11.n9.pill.refused', meshError: 'n11.n9.pill.meshError', confirmed: 'n11.n9.pill.confirmed', failed: 'n11.n9.pill.failed',
};
export interface TransitData { amount: string; name: string; pill: TransitPill; steps: TransitStep[]; block: number | null; reason: string | null; error: string | null; busy: boolean; showLegend: boolean }
export function TransitView({ d, a }: { d: TransitData; a: { recarry: () => void; check: () => void; legend: () => void; back?: () => void } }) {
  const { c } = useTheme();
  const t = useT();
  const [w, setW] = useState(0);
  const settled = d.pill === 'confirmed' || d.pill === 'failed';
  const gatewayTitle = (s: TransitStep) => {
    switch (s.note) {
      case 'pool': return t('n11.n9b.pool');
      case 'finalized': return t('n11.n9b.finalized');
      case 'invalid': return t('n11.n9b.invalid');
      case 'error': return t('n11.n9.gwError');
      case 'waiting': return t('n11.n9.gateway');
      default: return t('n11.n9b.included');
    }
  };
  const steps = d.steps.map(s => {
    const at = s.at ? hm(s.at) : undefined;
    switch (s.key) {
      case 'signed': return { state: s.state as TrailState, title: t('n11.n9.signed'), right: at };
      case 'mesh': return { state: s.state as TrailState, title: t('n11.n9.mesh'), right: s.state === 'done' ? at : undefined, sub: s.note === 'meshError' ? (d.error ?? t('n11.n9.meshError')) : s.state === 'done' ? t('n11.n9.meshSub') : undefined };
      case 'gateway': return { state: s.state as TrailState, title: s.state === 'done' ? t('n11.n9b.included') : gatewayTitle(s), right: s.state === 'current' && s.note !== 'waiting' ? at : undefined,
        sub: s.state !== 'current' ? undefined : s.note === 'waiting' ? t('n11.n9.waiting') : `${t('n11.n9.informed')}${d.block && (s.note === 'included' || s.note === 'finalized') ? ` · #${d.block}` : ''}${d.reason && (s.note === 'invalid' || s.note === 'error') ? ` · ${d.reason}` : ''}` };
      case 'confirmed': return { state: s.state as TrailState, title: s.state === 'failed' ? t('n11.n9.pill.failed') : t('n11.n9b.confirmed'), right: s.state === 'done' ? at : undefined,
        sub: s.state === 'pending' ? t('n11.n9.confirmSub') : s.state === 'done' ? t('n11.n9.confirmedSub') : (d.error ?? undefined) };
    }
  });
  return (
    <>
      <PnHeader title={t('n11.n9.header')} onBack={a.back} />
      <Body>
        <View onLayout={e => setW(e.nativeEvent.layout.width - 60)} style={{ height: 64, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 6 }}>
          {!settled ? <TravelLine width={w} /> : <View pointerEvents="none" style={{ position: 'absolute', left: 30, right: 30, top: 22, borderTopWidth: 2, borderStyle: 'dashed', borderColor: c.bg3 }} />}
          {([['smartphone', 'n11.n9.thisPhone'], ['hub', 'n11.n9.meshNode'], ['cell_tower', 'n11.n9.gatewayNode']] as [IconName, Key][]).map(([icon, k]) => (
            <View key={k} style={{ width: 60, alignItems: 'center', gap: 6 }}>
              <IconTile size={44} name={icon} />
              <View style={{ width: 96, marginHorizontal: -18, alignItems: 'center' }}><T size={11.5} color={c.ink2} align="center">{t(k)}</T></View>
            </View>
          ))}
        </View>
        <View style={{ alignItems: 'center', gap: 8 }}>
          <T size={44} w={700} ls={-0.05} tabular style={{ lineHeight: 44 }}>{`−${t('n11.lunes', { amount: d.amount })}`}</T>
          <T size={14} color={c.ink2}>{t('n11.n9.to', { name: d.name })}</T>
          <View style={{ height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: c.bg2, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
            {d.pill === 'confirmed' ? <Icon name="check_circle" size={15} fill /> : settled ? <Icon name="error" size={15} fill /> : <LiveDot />}
            <T size={13.5} w={600}>{t(PILL[d.pill])}</T>
          </View>
        </View>
        <Trail steps={steps} />
        {!settled && <Note icon="lock">{t('n11.n9.lockNote')}</Note>}
        <ListRow icon="info" title={t('n11.n9.legend')} onPress={a.legend} right={<Icon name={d.showLegend ? 'arrow_drop_up' : 'arrow_drop_down'} size={20} color={c.ink3} />} />
        {d.showLegend && <GatewayLegend />}
        <Spacer />
        {d.pill === 'refused' ? (
          <StateCard icon="block" solid title={t('n11.n9c.title')} body={t('n11.n9c.body')} actions={<CardButton label={t('n11.n9c.do')} onPress={a.recarry} />} />
        ) : !settled ? (
          <View style={{ gap: 6 }}>
            <PnButton outline icon="replay" label={t('n11.n9.recarry')} onPress={a.recarry} busy={d.busy} />
            <PnButton ghost label={t('n11.n9.check')} onPress={a.check} busy={d.busy} />
          </View>
        ) : null}
      </Body>
    </>
  );
}

/** N9b: o que um gateway pode informar (nada disso é conferido) e a única etapa conferida pelo próprio celular. */
export function GatewayLegend() {
  const t = useT();
  const rows: [IconName, Key, boolean, boolean][] = [
    ['schedule', 'n11.n9b.pool', false, false], ['deployed_code', 'n11.n9b.included', false, false], ['task_alt', 'n11.n9b.finalized', false, false],
    ['block', 'n11.n9b.invalid', false, false], ['verified', 'n11.n9b.confirmed', true, true],
  ];
  return (
    <RowsCard>
      {rows.map(([icon, k, verified, fill], i) => (
        <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: 'transparent' }}>
          <Icon name={icon} size={21} w={fill ? 400 : 300} fill={fill} />
          <T size={15} w={verified ? 650 : 550} style={{ flex: 1 }}>{t(k)}</T>
          <Tag solid={verified}>{verified ? t('n11.n9b.verified') : t('n11.n9b.informedTag')}</Tag>
        </View>
      ))}
    </RowsCard>
  );
}

/** N9a: a transferência na atividade da carteira. */
export function TransitActivityRow({ name, amount, pill, atMs, first, onPress }: { name: string; amount: string; pill: TransitPill; atMs: number | null; first?: boolean; onPress?: () => void }) {
  const { c } = useTheme();
  const t = useT();
  const sub = pill === 'traveling' || pill === 'meshError'
    ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><LiveDot /><T size={12.5} color={c.ink2} numberOfLines={1}>{t(PILL[pill])}</T></View>
    : pill === 'confirmed'
      ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Icon name="check_circle" size={15} fill /><T size={12.5} color={c.ink2}>{t('n11.n9b.confirmed')}</T></View>
      : <T size={12.5} color={c.ink2} numberOfLines={1}>{pill === 'reported' ? t('n11.n9a.reported') : pill === 'refused' ? t('n11.n9a.refused') : t('n11.n9.pill.failed')}</T>;
  const tagged = pill === 'reported' || pill === 'refused';
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={`${t('n11.n9a.to', { name })}, −${amount}`}>
      <PhaseRow first={first} tile={<IconTile name="north_east" />} title={t('n11.n9a.to', { name })} sub={sub}
        right={<View style={{ alignItems: 'flex-end', gap: 3 }}>
          <T size={15} w={600} tabular>{`−${amount}`}</T>
          {tagged ? <Tag>{t('n11.n9a.notVerified')}</Tag> : pill === 'confirmed' && atMs ? <T size={12} w={500} mono color={c.ink2}>{hm(atMs)}</T> : null}
        </View>} />
    </Pressable>
  );
}

/** N9d: no lugar do Enviar enquanto houver algo em trânsito. */
export function InTransitCard({ onOpen }: { onOpen: () => void }) {
  const t = useT();
  return <StateCard icon="lock" title={t('n11.n9d.title')} body={t('n11.n9d.body')} actions={<CardButton label={t('n11.n9d.do')} onPress={onOpen} />} />;
}

// ══ N10 Gateway em Rede ═════════════════════════════════════

export function GatewaySection({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: ReactNode }) {
  const { c } = useTheme();
  const t = useT();
  return (
    <>
      {label}
      <View style={{ marginHorizontal: 20, gap: 16 }}>
        <View style={{ borderRadius: 20, backgroundColor: c.bg2, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 16 }}>
            <Icon name="cell_tower" size={21} w={300} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <T size={15} w={550}>{t('n11.n10.title')}</T>
              <T size={12.5} lh={1.35} color={c.ink2}>{t('n11.n10.body')}</T>
            </View>
            <Toggle on={on} onChange={onToggle} label={t('n11.n10.title')} />
          </View>
        </View>
        <Note icon="battery_alert">{t('n11.n10.note')}</Note>
      </View>
    </>
  );
}

/** N10 no protótipo: o rótulo "GATEWAY" mono 12 (na tela Rede do app, o rótulo de seção dela). */
export function GatewayKicker() {
  const t = useT();
  return <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 }}><Kicker>{t('n11.n10.label')}</Kicker></View>;
}
