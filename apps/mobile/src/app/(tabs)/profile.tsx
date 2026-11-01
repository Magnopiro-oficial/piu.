import { ComingSoon } from '../../ui/ComingSoon';
import { Screen } from '../../ui/Screen';

export default function Tab() {
  return (
    <Screen edges={['top']}>
      <ComingSoon title="Perfil" icon="person" desc="Suas identidades, backup das chaves, aparelhos, privacidade, armazenamento, bateria e notificações." />
    </Screen>
  );
}
