import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { type Key } from '../i18n';
import { useT } from '../i18n/react';
import { nextStep, setupProgress, setupSteps, type SetupSignals, type StepGo } from '../lib/guide';
import { glossary, help, term, termsOf, type Term, type TermId } from '../lib/help';
import { relayOn } from '../lib/live';
import { useStore } from '../state/store';
import type { PageId } from '../types';
import { Bar, Icon, useEscape } from './ui';

/** Leva a uma página (e a um cartão dela, piscando) ou abre o assistente. */
function useGoTo() {
  const { navigate, setWizardOpen } = useStore();
  return useCallback((go: StepGo) => {
    if ('wizard' in go) { setWizardOpen(true); return; }
    navigate(go.page);
    if (!go.anchor) return;
    const id = go.anchor;
    // O cartão pode aparecer só depois que a página lê o nó: tenta por ~1,5 s.
    let tries = 0;
    const t = window.setInterval(() => {
      const el = document.getElementById(id);
      if (!el && ++tries < 25) return;
      window.clearInterval(t);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('guide-flash');
      window.setTimeout(() => el.classList.remove('guide-flash'), 2400);
    }, 60);
  }, [navigate, setWizardOpen]);
}

/** O que o guia precisa saber do nó: backup da chave, carteira, celular, vizinhos e equipamentos. */
function useSignals(): SetupSignals {
  const { api, phones, live, devices } = useStore();
  const [keyBackedUp, setKey] = useState<boolean | null>(null);
  const [payoutAddress, setPayout] = useState<boolean | null>(null);
  useEffect(() => {
    if (!api) return;
    let on = true;
    api.operatorKey().then(k => { if (on) setKey(k.lastBackupAt !== null); }).catch(() => {});
    api.lunesWallet().then(w => { if (on) setPayout(!!w.address); }).catch(() => {});
    return () => { on = false; };
  }, [api]);
  return {
    keyBackedUp, payoutAddress,
    phoneConfirmed: phones ? phones.some(p => p.confirmed) : null,
    neighbors: live === null ? null : relayOn(live)?.neighbors.length ?? 0,
    otherDevices: devices.filter(d => d.telemetry === 'none').length,
  };
}

/** “Primeiros passos” na Visão geral: o caminho de quem acabou de instalar, marcado pelo estado real do nó. */
export function SetupGuide() {
  const t = useT();
  const { guideHidden, setGuideHidden } = useStore();
  const goTo = useGoTo();
  const steps = setupSteps(useSignals());
  const progress = setupProgress(steps);
  const next = nextStep(steps);
  if (guideHidden) return null;

  if (progress.complete) {
    return (
      <section className="span12 card-soft row" style={{ padding: '16px 20px', borderRadius: 22, gap: 14, animation: 'piuUp .45s both' }}>
        <Icon name="task_alt" size={24} fill={1} />
        <div className="col grow" style={{ gap: 2 }}>
          <div style={{ fontSize: 15, fontWeight: 650 }}>{t('guide.doneTitle')}</div>
          <div style={{ fontSize: 13, color: 'var(--ink2)' }}>{t('guide.doneBody')}</div>
        </div>
        <button type="button" className="btn btn-outline" onClick={() => setGuideHidden(true)} style={{ height: 34, padding: '0 14px', borderRadius: 17, fontSize: 13 }}>{t('common.close')}</button>
      </section>
    );
  }

  return (
    <section aria-labelledby="guide-title" className="span12 card-soft col" style={{ padding: 22, borderRadius: 24, gap: 16, animation: 'piuUp .45s both' }}>
      <div className="row" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="col grow" style={{ gap: 4, minWidth: 220 }}>
          <div className="mono" style={{ fontSize: 11.5, fontWeight: 500, letterSpacing: '.06em', color: 'var(--ink2)' }}>{t('guide.kicker')}</div>
          <h2 id="guide-title" style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: '-0.03em' }}>{t('guide.title')}</h2>
          <div style={{ fontSize: 13, color: 'var(--ink2)' }}>{t('guide.sub')}</div>
        </div>
        <div className="col" style={{ gap: 6, width: 180, flex: 'none' }}>
          <div className="mono" style={{ fontSize: 12, textAlign: 'right' }}>{t('guide.progress', { done: progress.done, total: progress.total })}</div>
          <Bar pct={`${Math.round((progress.done / progress.total) * 100)}%`} />
        </div>
        <button type="button" className="btn btn-soft" onClick={() => setGuideHidden(true)} title={t('guide.hideTitle')} style={{ height: 32, padding: '0 12px', borderRadius: 16, fontSize: 12.5, flex: 'none' }}>{t('guide.hide')}</button>
      </div>
      <ol style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {steps.map((s, i) => {
          const isNext = next?.id === s.id;
          return (
            <li key={s.id} className="row" style={{ gap: 14, padding: '12px 0', borderTop: i ? '1px solid var(--line)' : 'none', alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <Icon name={s.done === true ? 'check_circle' : s.done === null ? 'hourglass_empty' : 'radio_button_unchecked'} size={22} fill={s.done === true ? 1 : 0} style={{ marginTop: 1 }} />
              <div className="col grow" style={{ gap: 3, minWidth: 200, flexBasis: 260 }}>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14.5, fontWeight: isNext ? 700 : 600, textDecorationLine: s.done === true ? 'line-through' : 'none', textDecorationColor: 'var(--ink3)' }}>{s.title}</span>
                  {s.optional && <span className="mono" style={{ fontSize: 10.5, padding: '1px 7px', borderRadius: 6, border: '1px solid var(--line2)', color: 'var(--ink2)' }}>{t('common.optional')}</span>}
                  {s.done === null && <span className="mono" style={{ fontSize: 11, color: 'var(--ink2)' }}>{t('guide.checking')}</span>}
                </div>
                {(s.done !== true || s.id === 'pair') && <div style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.45, textWrap: 'pretty' }}>{s.why}</div>}
              </div>
              {s.done === false && s.cta && (
                <button type="button" className={'btn ' + (isNext ? 'btn-primary' : 'btn-outline')} onClick={() => goTo(s.go)} style={{ height: 36, padding: '0 16px', borderRadius: 18, fontSize: 13, flex: 'none' }}>
                  {s.cta}<Icon name="arrow_forward" size={16} />
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Botão “Ajuda” do cabeçalho: abre a explicação da página atual. */
export function HelpButton({ page, title }: { page: PageId; title: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-outline" aria-haspopup="dialog" onClick={() => setOpen(true)} style={{ height: 40, padding: '0 16px', borderRadius: 20, fontSize: 13.5 }}>
        <Icon name="help" size={18} />{t('help.btn')}
      </button>
      {open && <HelpDrawer page={page} title={title} onClose={() => setOpen(false)} />}
    </>
  );
}

function HelpDrawer({ page, title, onClose }: { page: PageId; title: string; onClose: () => void }) {
  const t = useT();
  const { nodeMode, guideHidden, setGuideHidden, navigate } = useStore();
  const [all, setAll] = useState(false);
  useEscape(true, onClose);
  const h = help(page);
  const terms = all ? Object.values(glossary()) as Term[] : termsOf(page);
  const reopenGuide = () => { setGuideHidden(false); navigate('overview'); onClose(); };

  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', zIndex: 45, animation: 'piuFade .2s ease-out both' }} />
      <aside role="dialog" aria-modal="true" aria-labelledby="help-title" className="scroll-thin col"
        style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 420, maxWidth: '100vw', zIndex: 46, background: 'var(--bg)', color: 'var(--ink)', boxShadow: '0 0 0 1px var(--line2), -20px 0 60px rgba(0,0,0,.2)', overflowY: 'auto', padding: '22px 22px 28px', gap: 20, boxSizing: 'border-box', animation: 'piuPanel .3s var(--ease-out) both' }}>
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <div className="col grow" style={{ gap: 4 }}>
            <div className="mono" style={{ fontSize: 11.5, fontWeight: 500, letterSpacing: '.06em', color: 'var(--ink2)' }}>{t('help.kicker')}</div>
            <h2 id="help-title" style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-0.035em' }}>{title}</h2>
          </div>
          <button type="button" className="btn" aria-label={t('help.closeAria')} autoFocus onClick={onClose} style={{ width: 34, height: 34, borderRadius: 17, background: 'var(--bg2)', flex: 'none' }}><Icon name="close" size={19} /></button>
        </div>

        <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.5, textWrap: 'pretty' }}>{h.what}</p>

        <div className="col" style={{ gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 650 }}>{t('help.todoTitle')}</div>
          <ol className="col" style={{ margin: 0, padding: '4px 14px', listStyle: 'none', borderRadius: 16, background: 'var(--bg2)' }}>
            {h.todo.map((x, i) => (
              <li key={x} style={{ display: 'flex', gap: 12, padding: '10px 0', borderTop: i ? '1px solid var(--line)' : 'none' }}>
                <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--ink)', color: 'var(--invink)', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{i + 1}</div>
                <div style={{ fontSize: 13.5, lineHeight: 1.45 }}>{x}</div>
              </li>
            ))}
          </ol>
        </div>

        <div className="col" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 8, justifyContent: 'space-between' }}>
            <div style={{ fontSize: 13, fontWeight: 650 }}>{all ? t('help.allWords') : t('help.pageWords')}</div>
            <button type="button" className="btn" onClick={() => setAll(a => !a)} style={{ background: 'none', padding: 0, fontSize: 12.5, fontWeight: 600, textDecoration: 'underline' }}>{all ? t('help.onlyPage') : t('help.seeAll')}</button>
          </div>
          <dl className="col" style={{ margin: 0, gap: 12 }}>
            {terms.map(x => (
              <div key={x.term} className="col" style={{ gap: 3 }}>
                <dt style={{ fontSize: 13.5, fontWeight: 600 }}>{x.term}</dt>
                <dd style={{ margin: 0, fontSize: 13, color: 'var(--ink2)', lineHeight: 1.45 }}>{x.plain}</dd>
              </div>
            ))}
          </dl>
        </div>

        {nodeMode === 'node' && (
          <button type="button" className="btn btn-soft" onClick={reopenGuide} style={{ height: 42, borderRadius: 21, fontSize: 13.5, marginTop: 'auto' }}>
            <Icon name="checklist" size={18} />{guideHidden ? t('help.showSteps') : t('help.goSteps')}
          </button>
        )}
      </aside>
    </>,
    document.body,
  );
}

/** “O que é isso?” ao lado de um termo técnico: abre a explicação ali mesmo. `label` é uma chave do dicionário. */
export function Why({ term: id, label = 'why.label' }: { term: TermId; label?: Key }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const g = term(id);
  return (
    <div className="col" style={{ gap: 4 }}>
      <button type="button" className="btn" aria-expanded={open} onClick={() => setOpen(o => !o)}
        style={{ alignSelf: 'flex-start', background: 'none', padding: 0, gap: 4, fontSize: 12, fontWeight: 600, color: 'var(--ink2)', minHeight: 0 }}>
        <Icon name={open ? 'expand_less' : 'help'} size={15} />{open ? g.term : t(label)}
      </button>
      {open && <div role="note" style={{ fontSize: 12.5, lineHeight: 1.45, padding: '8px 10px', borderRadius: 10, background: 'var(--bg2)', color: 'var(--ink)', animation: 'piuFade .2s both' }}>{g.plain}</div>}
    </div>
  );
}

/** Ponto de Acesso: onde ficam, na maioria dos roteadores, os ajustes que o assistente pede. */
export function RouterHowTo() {
  const t = useT();
  const steps = ([1, 2, 3, 4, 5] as const).map(i => [t(`howto.${i}.t`), t(`howto.${i}.d`)] as const);
  return (
    <details className="howto" style={{ borderRadius: 14, border: '1px solid var(--line2)', padding: '10px 14px' }}>
      <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="help" size={16} />{t('howto.summary')}
      </summary>
      <ol className="col" style={{ margin: '10px 0 2px', padding: 0, listStyle: 'none', gap: 10 }}>
        {steps.map(([x, d], i) => (
          <li key={x} className="col" style={{ gap: 2 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{i + 1}. {x}</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.45 }}>{d}</div>
          </li>
        ))}
      </ol>
      <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.45, marginTop: 8 }}>{t('howto.note')}</div>
    </details>
  );
}
