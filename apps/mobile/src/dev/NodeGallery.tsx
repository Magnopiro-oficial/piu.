/**
 * SÓ DESENVOLVIMENTO (importado por src/app/__dev/node.tsx atrás de `__DEV__`; fora do build de produção).
 * Cada id do Piu 11 renderiza a MESMA tela/peça que a rota usa (src/ui/NodeViews.tsx), com estado de
 * exemplo pela mesma interface de props que as rotas preenchem a partir de `usePhoneNode`, `useWallet`,
 * `useNetwork` e `useMessaging`. Os números vêm de `nodeParamsOf` com os parâmetros reais do programa.
 */
import { router, useLocalSearchParams, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { transitPill, transitSteps } from '../lib/carryView';
import { NODE_MODE_LIMITS, PHONE_NODE_BOND, PHONE_NODE_MIN_ENDORSEMENTS, PHONE_NODE_REWARDS_ON } from '../lib/phoneNodeCore';
import { monthRenewalMs, nodeParamsOf, trailSteps, type PhaseCard } from '../lib/phoneNodeView';
import { phraseSlots } from '../lib/phraseConfirm';
import type { WalletTransferRecord } from '../lib/walletTransfer';
import { useTheme } from '../theme/ThemeProvider';
import {
  AskView, BondSheetView, ConfirmView, EntryScreen, EvidenceLine, GatewayLegend, GatewaySection, InTransitCard, LeaveView, MeshBanner, MeshSendView, PanelView, PhaseLinesCard,
  PhraseView, RequestNotificationPreview, RequestsView, TransitActivityRow, TransitView, type BondData, type PanelData, type RequestItemData,
} from '../ui/NodeViews';
import { Kicker, RowsCard, StateCard, CardButton } from '../ui/PhoneNode';
import { T } from '../ui/T';

const P = nodeParamsOf({ bond: PHONE_NODE_BOND, minEndorsements: PHONE_NODE_MIN_ENDORSEMENTS, dailyBytes: NODE_MODE_LIMITS.dailyBytes, batteryPct: NODE_MODE_LIMITS.batteryPct, rewardsOn: PHONE_NODE_REWARDS_ON });
const noop = () => {};
const NOW = Date.now();
const DAY = 86_400_000;
const KEY = '7F3A 91C2 4D0E 18B5';

const panel = (o: Partial<PanelData> = {}): PanelData => ({
  params: P, pause: null, card: null, exitShare: false, left: false, requests: 0,
  phase: { streak: 3, daysLeft: 4, endorsements: 1, needed: P.minEndorsements, refund: 'none', refundDueMs: null, minutes: 3 },
  trail: trailSteps({ bond: 'registered', certComplete: false, endorsements: 1, needed: P.minEndorsements, ready: false }),
  confirmedAtMs: NOW - 4 * DAY, certError: false, credits: { value: 3.8, receipts: 142 }, keyGroups: KEY, evidence: { kind: 'ready', n: 38 }, ...o,
});
const PA = { payBond: noop, confirmBond: noop, retryBond: noop, abandonBond: noop, ask: noop, share: noop, sendEvidence: noop, leave: noop, backToNode: noop, copyKey: noop, retryCert: noop, requests: noop };
const bond = (o: Partial<BondData> = {}): BondData => ({
  params: P, sheet: 'sheet', error: null, holdKey: 0, registeredSinceMs: NOW - 4 * DAY,
  quote: { to: '3P8x Kd2Q … 9vLm', fee: '0,01', total: `${P.bond},01`, after: '238,49' }, ...o,
});
const BA = { close: noop, sign: noop, createWallet: noop, activate: noop, receive: noop, retry: noop };
const confirm = (result: 'ok' | 'notFinal' | 'cancelled' | 'recover' | null) =>
  <ConfirmView d={{ bond: P.bond, days: P.days, hash: '8E41 … C07A', finalizedMs: NOW - 60_000, result, busy: false }} a={{ confirm: noop, later: noop, panel: noop, phrase: noop }} />;
const words = (n: number) => ['legal', 'winner', 'thank', 'year', 'wave', 'sausage', 'worth', 'useful', 'legal', 'winner', 'thank', 'yellow'].map((w, i) => (i < n ? w : ''));
const phrase = (o: { n?: number; cursor?: number; issue?: Parameters<typeof PhraseView>[0]['d']['issue']; result?: 'confirmed' | 'without' | null; shake?: number; typing?: string } = {}) => {
  const w = words(o.n ?? 2);
  const cursor = o.cursor ?? (o.n ?? 2);
  if (o.typing) w[cursor] = o.typing;
  return <PhraseView d={{ words: w, cursor, slots: phraseSlots(w, cursor), issue: o.issue ?? null, shake: o.shake ?? 0, suggestions: o.typing ? ['thank', 'that', 'theme', 'then', 'theory', 'there'] : [], result: o.result ?? null, busy: false, n: 12 }}
    a={{ close: noop, focus: noop, type: noop, pick: noop, submit: noop, without: noop, file: noop, confirmBond: noop, panel: noop }} />;
};
const req = (o: Partial<RequestItemData> & { contactId: string; name: string }): RequestItemData => ({ createdAtMs: NOW - 3600_000, keyGroups: '2C91 E07B 55AF 0D13', state: 'ok', block: null, expanded: false, givenAtMs: null, ...o });
const requests = (items: RequestItemData[], given = 2) =>
  <RequestsView d={{ given, max: P.maxPerMonth, renewsMs: monthRenewalMs(NOW / 1000), items, validityDays: P.endorseValidityDays, minAgeDays: 7, ttlDays: 3, holdKey: 0 }}
    a={{ endorse: noop, ignore: noop, expand: noop, activate: noop, verify: noop, openChat: noop }} />;
const firstReq = (o: Partial<RequestItemData> = {}) => [req({ contactId: 'r', name: 'Rita Alves', expanded: true, ...o }), req({ contactId: 't', name: 'Tomás Lima', createdAtMs: NOW - DAY }), req({ contactId: 'm', name: 'Marta Dias', createdAtMs: NOW - 2 * DAY })];
const rec = (o: Partial<WalletTransferRecord> = {}): WalletTransferRecord => ({
  id: 'h', from: 'a', dest: 'b', value: '2500000000', fee: '1500000', hash: 'h', hex: '00', validUntil: Number.MAX_SAFE_INTEGER, status: 'signed', createdAt: NOW - 3 * 3600_000, updatedAt: NOW,
  ctx: { specVersion: 1, transactionVersion: 1, genesisHash: '0x', blockHash: '0x', blockNumber: 1, nonce: 0, period: 0, tip: '0' },
  carried: { envelopeId: 'ab'.repeat(16), at: NOW - 2.6 * 3600_000, expiresAt: 9, report: { status: 'included', at: NOW - 3600_000, block: { number: 4821733, hash: '0x', index: 2 } } }, ...o,
});
const transit = (r: WalletTransferRecord, legend = false) =>
  <TransitView d={{ amount: '25', name: 'Lia Moreira', pill: transitPill(r), steps: transitSteps(r), block: r.carried?.report?.block?.number ?? null, reason: null, error: r.error ?? null, busy: false, showLegend: legend }} a={{ recarry: noop, check: noop, legend: noop }} />;
const mesh = (block: Parameters<typeof MeshSendView>[0]['d']['block']) =>
  <MeshSendView d={{ name: 'Lia Moreira', address: '3P2c … a91F', amount: '25', fee: '0,03', total: '25,03', readingDays: 2, block, holdKey: 0, error: null }} a={{ sign: noop, adjust: noop }} />;

/** Peça solta (estado/linha) no fundo do protótipo, com o rótulo do id. */
function Piece({ children }: { children: ReactNode }) {
  return <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>{children}</ScrollView>;
}
const phaseD = { ...panel().phase, bond: P.bond, days: P.days };

const SCREENS: Record<string, () => ReactNode> = {
  N1: () => <EntryScreen params={P} onActivate={noop} onLater={noop} onMode={noop} />,
  N2: () => <PanelView d={panel()} a={PA} />,
  N2b: () => <Piece><PhaseLinesCard cards={['needsBond', 'bondSent', 'days', 'endorse', 'ready', 'left'] as PhaseCard[]} d={phaseD} a={PA} /><PhaseLinesCard cards={['bondUnconfirmed', 'bondFailed', 'confirmBond']} d={phaseD} a={PA} /></Piece>,
  'N2-needsBond': () => <PanelView d={panel({ card: 'needsBond', trail: trailSteps({ bond: 'none', certComplete: false, endorsements: 0, needed: P.minEndorsements, ready: false }) })} a={PA} />,
  'N2-certErr': () => <PanelView d={panel({ certError: true, pause: 'battery' })} a={PA} />,
  N3: () => <BondSheetView d={bond()} a={BA} />,
  N3a: () => <BondSheetView d={bond({ sheet: 'soon', quote: null })} a={BA} />,
  N3b: () => <BondSheetView d={bond({ sheet: 'noWallet' })} a={BA} />,
  N3c: () => <BondSheetView d={bond({ sheet: 'sent' })} a={BA} />,
  N3d: () => <BondSheetView d={bond({ sheet: 'registered' })} a={BA} />,
  N3e: () => <BondSheetView d={bond({ sheet: 'inactive' })} a={BA} />,
  N3f: () => <BondSheetView d={bond({ error: { kind: 'insufficient', missing: '2,40', have: '97,61', need: `${P.bond},01` } })} a={BA} />,
  N3g: () => <BondSheetView d={bond({ error: { kind: 'cancelled' } })} a={BA} />,
  N3h: () => <BondSheetView d={bond({ error: { kind: 'busy' } })} a={BA} />,
  N4: () => confirm(null), N4a: () => confirm('ok'), N4b: () => confirm('notFinal'), N4c: () => confirm('cancelled'), N4d: () => confirm('recover'),
  N4e: () => phrase({ n: 2, typing: 'th' }),
  N4f: () => phrase({ n: 12, cursor: 7, issue: { kind: 'checksum' }, shake: 1 }),
  'N4f-list': () => phrase({ n: 12, cursor: 7, issue: { kind: 'notInList', index: 7 }, shake: 1 }),
  'N4f-other': () => phrase({ n: 12, cursor: 11, issue: { kind: 'other' }, shake: 1 }),
  N4g: () => phrase({ result: 'confirmed' }), N4h: () => phrase({ result: 'without' }),
  N5: () => <AskView d={{ endorsements: 1, needed: P.minEndorsements, keyGroups: KEY, bondPending: false, busy: null, items: [
    { contactId: 'l', name: 'Lia Moreira', kind: 'received', atMs: NOW - 3 * DAY }, { contactId: 'd', name: 'Davi Rocha', kind: 'asked', atMs: NOW - DAY },
    { contactId: 'r', name: 'Rita Alves', kind: 'eligible' }, { contactId: 't', name: 'Tomás Lima', kind: 'eligible' }, { contactId: 'j', name: 'Júlia Prado', kind: 'notVerified' }] }}
    a={{ ask: noop, verify: noop, copyKey: noop, addContact: noop }} />,
  N5v: () => <AskView d={{ endorsements: 0, needed: P.minEndorsements, keyGroups: KEY, bondPending: false, busy: null, items: [] }} a={{ ask: noop, verify: noop, copyKey: noop, addContact: noop }} />,
  N6: () => requests(firstReq()),
  N6a: () => requests(firstReq({ block: 'inactive' })),
  N6b: () => requests(firstReq({ block: 'self' })),
  N6c: () => requests(firstReq({ block: 'already', givenAtMs: NOW - 3 * DAY })),
  N6d: () => requests(firstReq({ block: 'monthly' }), P.maxPerMonth),
  N6v: () => requests([]),
  N6n: () => <Piece><RequestNotificationPreview name="Rita Alves" /></Piece>,
  N7: () => <LeaveView d={{ params: P, mode: 'refund', holdKey: 0 }} a={{ sign: noop, stay: noop }} />,
  N7b: () => <PanelView d={panel({ left: true, exitShare: true, card: 'left', phase: { ...panel().phase, refund: 'waiting' } })} a={PA} />,
  N8: () => mesh(null),
  N8a: () => mesh({ kind: 'stale', days: 9, maxDays: 7 }),
  'N8a-none': () => mesh({ kind: 'noReading', maxDays: 7 }),
  N8b: () => mesh({ kind: 'funds', have: '25,01', need: '25,03' }),
  'N8-sheet': () => <Piece><MeshBanner /></Piece>,
  N9: () => transit(rec()),
  'N9-traveling': () => transit(rec({ carried: { envelopeId: 'ab'.repeat(16), at: NOW - 3600_000, expiresAt: 9 } })),
  N9a: () => <Piece><RowsCard>
    <TransitActivityRow first name="Lia Moreira" amount="25" pill="traveling" atMs={null} />
    <TransitActivityRow name="Lia Moreira" amount="25" pill="reported" atMs={null} />
    <TransitActivityRow name="Lia Moreira" amount="25" pill="confirmed" atMs={NOW} />
  </RowsCard></Piece>,
  N9b: () => <Piece><GatewayLegend /></Piece>,
  N9c: () => transit(rec({ carried: { envelopeId: 'ab'.repeat(16), at: NOW - 3600_000, expiresAt: 9, report: { status: 'invalid', at: NOW, reason: 'nonce antigo' } } })),
  N9d: () => <Piece><InTransitCard onOpen={noop} /></Piece>,
  N10: () => <ScrollView contentContainerStyle={{ paddingVertical: 20 }}><GatewaySection on onToggle={noop} label={<View style={{ paddingHorizontal: 20, paddingBottom: 8 }}><Kicker>GATEWAY</Kicker></View>} /></ScrollView>,
  N10a: () => <Piece><RowsCard><EvidenceLine first row={{ kind: 'ready', n: 38 }} onSend={noop} /></RowsCard></Piece>,
  N10b: () => <Piece><RowsCard><EvidenceLine first row={{ kind: 'noValidator' }} onSend={noop} /></RowsCard></Piece>,
  N10c: () => <Piece><RowsCard><EvidenceLine first row={{ kind: 'nothing', carried: true }} onSend={noop} /></RowsCard><RowsCard><EvidenceLine first row={{ kind: 'nothing', carried: false }} onSend={noop} /></RowsCard></Piece>,
};

export default function NodeGallery() {
  const { c } = useTheme();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const render = id ? SCREENS[id] : undefined;
  if (render) return <View style={{ flex: 1, backgroundColor: c.bg }}>{render()}</View>;
  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 20, gap: 8 }}>
      <T size={20} w={700}>Piu 11 · galeria (dev)</T>
      {Object.keys(SCREENS).map(k => (
        <Pressable key={k} onPress={() => router.push(`/__dev/node?id=${encodeURIComponent(k)}` as Href)} style={{ paddingVertical: 8 }}><T size={15} w={550}>{k}</T></Pressable>
      ))}
      <StateCard icon="info" title="Só em desenvolvimento" body="Fora do build de produção." actions={<CardButton label="Início" onPress={() => router.replace('/' as Href)} />} />
    </ScrollView>
  );
}
