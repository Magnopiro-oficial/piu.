/**
 * Conversas → Armazenamento (D4 · D4e disco quase cheio · D4v depois de limpar), do
 * "Piu 10 Desktop telas novas.dc.html". Só números medidos (main/storageUsage.ts):
 * - o computador não guarda fotos nem arquivos: "Fotos e arquivos" mostra 0 e "Limpar mídia" vira
 *   "Limpar" o histórico da conversa (com confirmação mostrando o total antes);
 * - os dois limites são os reais do nó: por quanto tempo guardar mensagens de outros e o teto da fila;
 * - D4e: menos de 1 GB livre no disco (`statfs`); o botão limpa a fila da malha (mensagens de outros, de passagem).
 * O toast "X liberados" usa a diferença real do `state.bin` antes e depois.
 */
import { type Dispatch, type SetStateAction, useCallback, useEffect, useState } from 'react';
import type { Prefs, StorageDetail } from '../../shared/types';
import { fmtBytes } from '../format';
import { useT } from '../i18n';
import { type DialogSpec, F, FM, Seg } from '../ui';
import { Back, Row, Section } from './settingsUi';

const MS = "'Material Symbols Rounded'";
const HATCH = 'repeating-linear-gradient(45deg,var(--ink3) 0 2px,transparent 2px 5px)';
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '··';

export function StoragePage({ prefs, linked, onBack, setDialog, toast, updatePrefs }: {
  prefs: Prefs; linked: boolean; onBack: () => void;
  setDialog: Dispatch<SetStateAction<DialogSpec | null>>; toast: (t: string, i?: string) => void; updatePrefs: (p: Partial<Prefs>) => Promise<void>;
}) {
  const t = useT();
  const [d, setD] = useState<StorageDetail | null>(null);
  /** D4v: conversas limpas nesta visita (a linha fica, sem barra e sem botão). */
  const [cleared, setCleared] = useState<Record<string, { name: string; freed: number }>>({});
  const load = useCallback(() => { void window.piu.storageDetail().then(setD).catch(() => setD(null)); }, []);
  useEffect(load, [load]);

  const askClear = (c: StorageDetail['conversations'][number]) => setDialog({
    icon: 'delete_sweep', title: c.name ? t('settings.storage.clearTitle', { name: c.name }) : t('settings.storage.clearTitleNoName'),
    body: t('settings.storage.clearBody', { count: c.count, size: fmtBytes(c.bytes) }), primary: t('settings.storage.clearSize', { size: fmtBytes(c.bytes) }),
    act: async () => {
      try {
        const { freed } = await window.piu.clearConversation(c.id);
        setDialog(null);
        setCleared(x => ({ ...x, [c.id]: { name: c.name, freed } }));
        toast(t('settings.storage.freed', { size: fmtBytes(freed) }), 'check');
        load();
      } catch (e) { toast((e as Error).message, 'error'); }
    },
  });
  const askRelay = () => d && setDialog({
    icon: 'hub', title: t('settings.storage.relayTitle'), body: t('settings.storage.relayBody', { size: fmtBytes(d.relayOthers) }), primary: t('settings.storage.clearSize', { size: fmtBytes(d.relayOthers) }),
    act: async () => {
      try { const { freed } = await window.piu.clearRelayQueue(); setDialog(null); toast(t('settings.storage.freed', { size: fmtBytes(freed) }), 'check'); load(); }
      catch (e) { toast((e as Error).message, 'error'); }
    },
  });

  const total = d?.total ?? 0;
  const messages = d?.messages ?? 0, relay = d?.relay ?? 0;
  const other = Math.max(0, total - messages - relay);
  const pct = (v: number) => (total > 0 ? `${(v / total) * 100}%` : '0%');
  const max = d?.conversations[0]?.bytes ?? 0;
  const rows = [...(d?.conversations ?? []).map(c => ({ ...c, done: null as null | { freed: number } })), ...Object.entries(cleared).filter(([id]) => !d?.conversations.some(c => c.id === id)).map(([id, x]) => ({ id, name: x.name, kind: undefined, via: 'public' as const, bytes: 0, count: 0, done: { freed: x.freed } }))];

  return (
    <>
      <Back label={t('settings.page.chats')} onClick={onBack} />
      <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.04em' }}>{t('settings.storage.title')}</div>
      <div style={{ fontSize: 14, color: 'var(--ink2)', lineHeight: 1.45, marginBottom: 12, maxWidth: 560, textWrap: 'pretty' }}>{t('settings.storage.intro')}</div>
      {d?.low && d.free !== null && (
        // D4e
        <div role="alert" style={{ padding: 16, borderRadius: 18, background: 'var(--ink)', color: 'var(--invink)', display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 12, animation: 'piuUp .45s both' }}>
          <span style={{ fontFamily: MS, fontSize: 21, lineHeight: 1, fontVariationSettings: "'FILL' 1" }}>hard_drive</span>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ fontSize: 14.5, fontWeight: 650 }}>{t('settings.storage.lowTitle', { size: fmtBytes(d.free) })}</div>
            <div style={{ fontSize: 12.5, opacity: .75, lineHeight: 1.4, textWrap: 'pretty' }}>{(d.relayOthers ?? 0) > 0 ? t('settings.storage.lowBodyRelay') : t('settings.storage.lowBody')}</div>
          </div>
          {(d.relayOthers ?? 0) > 0 && <button className="a-94" onClick={askRelay} style={{ height: 32, padding: '0 13px', border: 'none', borderRadius: 16, background: 'var(--invink)', color: 'var(--ink)', font: `600 12.5px ${F}`, cursor: 'pointer', flex: 'none' }}>{t('settings.storage.clearSize', { size: fmtBytes(d.relayOthers) })}</button>}
        </div>
      )}
      <div style={{ padding: 18, borderRadius: 20, background: 'var(--bg2)', display: 'flex', flexDirection: 'column', gap: 12, animation: 'piuUp .45s .05s both' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}><div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.03em', color: d ? 'var(--ink)' : 'var(--ink3)' }}>{d ? fmtBytes(total) : '—'}</div><div style={{ fontSize: 13, color: 'var(--ink2)' }}>{t('settings.storage.usedByPiu')}</div></div>
          <div style={{ font: `500 12px ${FM}`, color: 'var(--ink2)' }}>{d?.free != null ? t('settings.storage.free', { size: fmtBytes(d.free) }) : t('settings.storage.freeUnknown')}</div>
        </div>
        <div style={{ height: 10, borderRadius: 5, background: 'var(--bg3)', display: 'flex', overflow: 'hidden', gap: 2 }}>
          {d && total > 0 && <>
            <div style={{ width: pct(messages), background: 'var(--ink2)' }} />
            <div style={{ width: pct(relay), background: 'var(--ink3)' }} />
            <div style={{ width: pct(other), background: HATCH }} />
          </>}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px', fontSize: 12.5, color: 'var(--ink2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--ink)' }} />{t('settings.storage.legendMedia', { size: d ? fmtBytes(d.media) : '—' })}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--ink2)' }} />{t('settings.storage.legendMessages', { size: d ? fmtBytes(messages) : '—' })}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--ink3)' }} />{t('settings.storage.legendRelay', { size: d ? fmtBytes(d.relay) : '—' })}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 8, height: 8, borderRadius: 2, background: 'repeating-linear-gradient(45deg,var(--ink3) 0 2px,transparent 2px 4px)' }} />{t('settings.storage.legendOther', { size: d ? fmtBytes(other) : '—' })}</div>
        </div>
      </div>

      <div style={{ padding: '16px 4px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ font: `500 11.5px ${FM}`, letterSpacing: '.05em', color: 'var(--ink2)' }}>{t('settings.storage.byChat')}</span><span style={{ font: `500 11.5px ${FM}`, color: 'var(--ink2)' }}>{t('settings.storage.largestFirst')}</span></div>
      <div style={{ borderRadius: 20, background: 'var(--bg2)', overflow: 'hidden', animation: 'piuUp .45s .12s both' }}>
        {linked ? <Row name={t('settings.linkedPhone')} desc={t('settings.storage.linkedDesc')} icon="smartphone" first />
          : rows.length === 0 ? <Row name={t('settings.storage.empty')} desc={t('settings.storage.emptyDesc')} first />
            : rows.map((c, i) => {
              const sq = c.kind && c.kind !== 'direct';
              return (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: c.done ? '12px 16px' : '11px 16px', borderTop: i ? '1px solid var(--line)' : 'none' }}>
                  <div style={{ width: 36, height: 36, borderRadius: sq ? 12 : '50%', background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: `600 12.5px ${F}`, flex: 'none' }}>{initials(c.name)}</div>
                  {c.done ? (
                    // D4v: a linha fica, sem barra e sem botão.
                    <>
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}><div style={{ fontSize: 14, fontWeight: 600 }}>{c.name || t('settings.storage.contact')}</div><div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>{t('settings.storage.cleared', { size: fmtBytes(c.done.freed) })}</div></div>
                      <span style={{ fontFamily: MS, fontSize: 20, lineHeight: 1 }}>check</span>
                    </>
                  ) : (
                    <>
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><span style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name || t('settings.storage.contact')}</span><span style={{ font: `500 12.5px ${FM}`, flex: 'none' }}>{fmtBytes(c.bytes)}</span></div>
                        <div style={{ height: 4, borderRadius: 2, background: 'var(--bg3)' }}><div style={{ width: `${max ? Math.max(2, (c.bytes / max) * 100) : 0}%`, height: '100%', borderRadius: 2, background: 'var(--ink)' }} /></div>
                      </div>
                      <button className="a-94" onClick={() => askClear(c)} style={{ height: 32, padding: '0 13px', border: 'none', borderRadius: 16, background: 'var(--bg)', color: 'var(--ink)', font: `600 12.5px ${F}`, cursor: 'pointer', boxShadow: '0 0 0 1px var(--line2) inset' }}>{t('settings.storage.clear')}</button>
                    </>
                  )}
                </div>
              );
            })}
      </div>

      <Section title={t('settings.storage.limits')} i={2}>
        <Row name={t('settings.storage.keepOthers')} desc={linked ? t('settings.noRelayLinked') : t('settings.storage.keepOthersDesc')} first>
          {!linked && <Seg value={prefs.relayRetention} opts={[['24', t('settings.h24')], ['48', t('settings.h48')], ['168', t('settings.d7')]]} onChange={v => void updatePrefs({ relayRetention: v })} />}
        </Row>
        <Row name={t('settings.storage.queueSpace')} desc={linked ? t('settings.noRelayLinked') : t('settings.storage.queueSpaceDesc')}>
          {!linked && <Seg value={prefs.relayStorage} opts={[['100', '100 MB'], ['250', '250 MB'], ['500', '500 MB']]} onChange={v => void updatePrefs({ relayStorage: v })} />}
        </Row>
      </Section>
    </>
  );
}
