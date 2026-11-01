import { router } from 'expo-router';
import { Pressable } from 'react-native';
import { ComingSoon } from '../ui/ComingSoon';
import { Icon } from '../ui/Icon';
import { Screen } from '../ui/Screen';

export default function Restore() {
  return (
    <Screen style={{ paddingTop: 8 }}>
      <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Voltar" style={{ width: 40, height: 40, marginLeft: 12, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="arrow_back_ios_new" size={22} />
      </Pressable>
      <ComingSoon title="Restaurar" icon="smartphone" desc="Restaurar de outro aparelho por perto, pela frase de 12 palavras ou por arquivo, com rotação das chaves de sessão no fim." />
    </Screen>
  );
}
