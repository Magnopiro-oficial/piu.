import { ComingSoon } from '../../ui/ComingSoon';
import { Screen } from '../../ui/Screen';

export default function Tab() {
  return (
    <Screen edges={['top']}>
      <ComingSoon title="Por perto" icon="radar" desc="Perfis públicos ao redor com proximidade aproximada (nunca a localização exata), convite pago e pedidos de conversa." />
    </Screen>
  );
}
