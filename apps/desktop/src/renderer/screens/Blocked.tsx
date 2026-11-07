/**
 * Privacidade → Contatos bloqueados (D2 lista · D2v ninguém bloqueado), do "Piu 10 Desktop telas novas.dc.html".
 * Desbloquear usa o diálogo `unblock:` que já existia (Settings → `askUnblock`).
 * Adaptações honestas:
 * - "Valer em todos os meus aparelhos": o computador ainda não sincroniza bloqueios com outro aparelho
 *   (com identidade própria não há outro aparelho; vinculado, quem bloqueia é o celular). Vira uma linha
 *   informativa, sem chave, e o D2e ("desbloqueio não sincronizou") não existe porque não há sincronização.
 * - "Bloquear pedidos de anônimos": o mensageiro não distingue pedidos anônimos; o que existe de verdade é
 *   recusar pedidos de conversa de quem só tem o seu código (`find: 'none'`, o mesmo de "Quem me encontra").
 */
import { useMemo, useState } from 'react';
import type { BlockedContact, Prefs } from '../../shared/types';
import { fmtDate, t as tNow, useT } from '../i18n';
import { F, FM, Toggle } from '../ui';
import { Back, Row, Section, Val } from './settingsUi';

const MS = "'Material Symbols Rounded'";
const fp = (id: string) => (id.replace(/^(piu|group):/, '').slice(0, 8).toUpperCase().match(/.{1,4}/g) ?? []).join(' ');
const since = (ms: number) => fmtDate(ms, { day: 'numeric', month: 'short' }).replace('.', '');
const sinceText = (ms: number) => (new Date(ms).toDateString() === new Date().toDateString() ? tNow('settings.blocked.sinceToday') : tNow('settings.blocked.since', { date: since(ms) }));
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(w => w[0]!.toUpperCase()).join('');

export function BlockedPage({ blocked, linked, prefs, mod, onBack, onUnblock, updatePrefs }: {
  blocked: BlockedContact[]; linked: boolean; prefs: Prefs; mod: string;
  onBack: () => void; onUnblock: (b: BlockedContact) => void; updatePrefs: (p: Partial<Prefs>) => Promise<void>;
}) {
  const t = useT();
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const s = q.trim().toLowerCase().replace(/\s+/g, '');
    if (!s) return blocked;
    return blocked.filter(b => b.name.toLowerCase().replace(/\s+/g, '').includes(s) || fp(b.id).replace(/\s/g, '').toLowerCase().includes(s));
  }, [blocked, q]);
  const refuse = prefs.find === 'none';
  return (
    <>
      <Back label={t('settings.page.privacy')} onClick={onBack} />
      <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.04em' }}>{t('settings.privacy.blocked')}</div>
      <div style={{ fontSize: 14, color: 'var(--ink2)', lineHeight: 1.45, marginBottom: 14, maxWidth: 560, textWrap: 'pretty' }}>{t('settings.blocked.intro')}</div>
      {linked ? (
        <div style={{ borderRadius: 20, background: 'var(--bg2)', overflow: 'hidden' }}><Row name={t('settings.linkedPhone')} desc={t('settings.blocked.linkedDesc')} icon="smartphone" first /></div>
      ) : blocked.length === 0 ? (
        // D2v: substitui a busca e a lista; "Opções" continua embaixo.
        <div style={{ padding: '48px 40px', borderRadius: 24, background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, textAlign: 'center', animation: 'piuUp .45s .05s both' }}>
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--bg2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ fontFamily: MS, fontSize: 32, lineHeight: 1, fontVariationSettings: "'wght' 300" }}>block</span></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.03em' }}>{t('settings.privacy.blockedNone')}</div><div style={{ fontSize: 13.5, color: 'var(--ink2)', lineHeight: 1.45, maxWidth: 340, textWrap: 'pretty' }}>{t('settings.blocked.howTo')}</div></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--ink2)' }}>
            {[mod, 'I'].map(k => <span key={k} style={{ minWidth: 26, height: 24, padding: '0 7px', borderRadius: 6, background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2) inset,0 2px 0 var(--line2)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: `550 11.5px ${FM}`, color: 'var(--ink)' }}>{k}</span>)}{t('settings.blocked.opensDetails')}
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div style={{ flex: 1, height: 38, borderRadius: 11, background: 'var(--bg2)', display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px' }}>
              <span style={{ fontFamily: MS, fontSize: 18, lineHeight: 1, color: 'var(--ink2)' }}>search</span>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('settings.blocked.searchPh')} aria-label={t('settings.blocked.searchAria')} style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none', fontSize: 14, color: 'var(--ink)' }} />
            </div>
            <div style={{ font: `500 12px ${FM}`, color: 'var(--ink2)' }}>{t('settings.blocked.count', { count: blocked.length })}</div>
          </div>
          <div style={{ borderRadius: 20, background: 'var(--bg2)', overflow: 'hidden', animation: 'piuUp .45s .05s both' }}>
            {list.map((b, i) => (
              <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', minHeight: 64, borderTop: i ? '1px solid var(--line)' : 'none' }}>
                {b.name ? <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: `600 14px ${F}`, flex: 'none' }}>{initials(b.name)}</div>
                  : <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><span style={{ fontFamily: MS, fontSize: 20, lineHeight: 1 }}>visibility_off</span></div>}
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name || t('settings.profile.anon', { id: fp(b.id).slice(0, 4) })}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>{sinceText(b.at)} · {b.via === 'anon' ? t('settings.blocked.viaAnon') : t('settings.blocked.viaPublic')}</div>
                </div>
                <div className="sel" style={{ font: `400 11.5px ${FM}`, color: 'var(--ink3)' }}>{fp(b.id)}</div>
                <button className="a-94" onClick={() => onUnblock(b)} style={{ height: 34, padding: '0 14px', border: 'none', borderRadius: 17, background: 'var(--bg)', color: 'var(--ink)', font: `600 13px ${F}`, cursor: 'pointer', boxShadow: '0 0 0 1px var(--line2) inset' }}>{t('settings.unblock.action')}</button>
              </div>
            ))}
            {list.length === 0 && <Row name={t('settings.blocked.notFound')} desc={t('settings.blocked.notFoundDesc')} first />}
          </div>
        </>
      )}
      <Section title={t('settings.blocked.options')} i={1}>
        <Row name={t('settings.blocked.allDevices')} desc={linked ? t('settings.blocked.allDevicesLinked') : t('settings.blocked.allDevicesDesc')} first><Val>{t('settings.blocked.thisOnly')}</Val></Row>
        <Row name={t('settings.blocked.refuse')} desc={linked ? t('settings.blocked.refuseLinked') : t('settings.blocked.refuseDesc')}>
          <Toggle on={!linked && refuse} disabled={linked} onChange={v => void updatePrefs({ find: v ? 'none' : 'all' })} label={t('settings.blocked.refuse')} />
        </Row>
      </Section>
    </>
  );
}
