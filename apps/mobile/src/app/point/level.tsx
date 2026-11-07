import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useT } from '../../i18n';
import { stepDays, stepSpace, type PointLevel } from '../../lib/pointCore';
import { usePoint } from '../../state/point';
import { BackHeader } from '../../ui/Controls';
import { Screen } from '../../ui/Screen';
import { LevelView } from '../../ui/point/views';

/** P5: nível de compartilhamento. Do painel ("Nível e limites", `?edit=1`) salva direto no ponto. */
export default function PointLevelScreen() {
  const t = useT();
  const p = usePoint();
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const editing = edit === '1' && !!p.config;
  const src = editing ? p.config! : p.draft;
  const [level, setLevel] = useState<PointLevel>(src.level);
  const [spaceMb, setSpace] = useState(src.spaceMb);
  const [days, setDays] = useState(src.days);
  // Gateway só se o teste encontrou internet (ou se o ponto já é gateway).
  const internet = editing ? p.config!.level === 'gateway' || !!p.check.view?.internet : !!p.check.view?.internet;
  return (
    <Screen>
      <BackHeader title={t('point.level.header')} />
      <LevelView
        level={level} spaceMb={spaceMb} days={days} internet={internet} step={!editing}
        onLevel={setLevel} onSpace={d => setSpace(v => stepSpace(v, d))} onDays={d => setDays(v => stepDays(v, d))}
        cta={editing ? t('point.level.save') : undefined}
        onContinue={() => {
          if (editing) { p.setLevel(level, spaceMb, days); router.back(); return; }
          p.setDraft({ level, spaceMb, days });
          router.push('/point/activate');
        }}
      />
    </Screen>
  );
}
