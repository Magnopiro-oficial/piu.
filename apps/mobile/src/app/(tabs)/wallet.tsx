import { ComingSoon } from '../../ui/ComingSoon';
import { Screen } from '../../ui/Screen';

export default function Tab() {
  return (
    <Screen edges={['top']}>
      <ComingSoon title="Carteira" icon="account_balance_wallet" desc="Saldo LUNES, enviar e receber sem internet, bônus de boas-vindas, convidados e créditos de rede." />
    </Screen>
  );
}
