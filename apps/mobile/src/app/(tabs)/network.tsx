import { ComingSoon } from '../../ui/ComingSoon';
import { Screen } from '../../ui/Screen';

export default function Tab() {
  return (
    <Screen edges={['top']}>
      <ComingSoon title="Rede" icon="hub" desc="Radar de nós, modo nó, transportes, limites, diagnóstico local e o provider pelo celular." />
    </Screen>
  );
}
