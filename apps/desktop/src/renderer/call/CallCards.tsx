/**
 * Cartões da chamada na conversa (340 px): registro (`recordCard`), chamada perdida com "Ligar de volta"
 * e pedido de chamada com 3 traços de progresso (`requestCard`). Alinhados ao lado de quem iniciou.
 * A conversa liga cada registro (CallRecord) ou pedido à mensagem dela: `<CallRecordCard record contact time onCallBack />`.
 */
import type { CallRecord } from '../../../../mobile/src/calls/callMachine';
import { recordCard, requestCard, type Contact, type RequestStep } from '../../../../mobile/src/calls/callView';
import { FM, Sym } from '../ui';
import { useTr } from './CallContext';

type CardProps = { mine: boolean; icon: string; title: string; sub: string; time: string; dots?: boolean[]; button?: { label: string; onClick: () => void } };

function CallCard({ mine, icon, title, sub, time, dots, button }: CardProps) {
  return (
    <div style={{ alignSelf: mine ? 'flex-end' : 'flex-start', width: 340, maxWidth: '100%', padding: 14, borderRadius: 20, background: mine ? 'var(--ink)' : 'var(--bg)', color: mine ? 'var(--invink)' : 'var(--ink)', boxShadow: mine ? 'none' : '0 0 0 1px var(--line2)', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 40, height: 40, borderRadius: 20, background: mine ? 'rgba(127,127,127,.25)' : 'var(--bg2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Sym name={icon} size={20} /></span>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 14, fontWeight: 650 }}>{title}</span>
          <span style={{ fontSize: 12, opacity: .7, lineHeight: 1.35 }}>{sub}</span>
        </span>
        <span style={{ font: `500 10.5px ${FM}`, opacity: .55, alignSelf: 'flex-start' }}>{time}</span>
      </div>
      {dots && (
        <div style={{ display: 'flex', gap: 4 }}>
          {dots.map((on, i) => <span key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: on ? 'var(--invink)' : 'rgba(127,127,127,.35)', transition: 'background .4s' }} />)}
        </div>
      )}
      {button && (
        <button className="a-97" onClick={button.onClick} style={{ height: 38, border: 'none', borderRadius: 19, background: mine ? 'var(--invink)' : 'var(--ink)', color: mine ? 'var(--ink)' : 'var(--invink)', fontSize: 13.5, fontWeight: 650, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Sym name="call" size={18} fill={1} />{button.label}
        </button>
      )}
    </div>
  );
}

/** Registro de chamada; perdida ganha "Ligar de volta" quando `onCallBack` vem (abre a caixa "pre"). */
export function CallRecordCard({ record, contact, time, onCallBack }: { record: CallRecord; contact: Contact; time: string; onCallBack?: () => void }) {
  const t = useTr();
  const c = recordCard(t, record, contact, { desktop: true });
  return <CallCard mine={c.mine} icon={c.icon} title={c.title} sub={c.sub} time={time} button={c.callBack && onCallBack ? { label: t('call.rec.callBack'), onClick: onCallBack } : undefined} />;
}

/** Pedido de chamada que eu mandei pela malha, com os 3 traços (viajando · entregue · aceito). */
export function CallRequestCard({ step, contact, hops, time }: { step: RequestStep; contact: Contact; hops?: number; time: string }) {
  const t = useTr();
  const c = requestCard(t, step, contact, hops);
  return <CallCard mine icon={c.icon} title={c.title} sub={c.sub} time={time} dots={c.dots} />;
}
