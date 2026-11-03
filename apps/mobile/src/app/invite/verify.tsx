import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useInviter } from '../../lib/inviter';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Screen } from '../../ui/Screen';
import { T } from '../../ui/T';

/**
 * Prévia da primeira abertura de uma cópia recebida de outra pessoa: as 5 verificações antes de criar a
 * identidade. Sem o envio do app, não há cópia recebida para conferir: a tela é marcada como prévia.
 */
export default function VerifyCopy() {
  const { c } = useTheme();
  const { name } = useInviter();
  const checks: [string, string][] = [
    ['Assinatura do desenvolvedor', 'certificado da Lunes Network'],
    ['Integridade do pacote', 'SHA-256 do pacote recebido'],
    ['Versão não revogada', 'lista de revogação recebida pela malha'],
    ['Confirmação independente', 'nós por perto anunciam o mesmo hash'],
    [name === 'Você' ? 'Convite' : `Convite de ${name}`, 'assinatura válida · uso único'],
  ];
  const [n, setN] = useState(0);
  const done = n >= 5;
  useEffect(() => {
    const t = setInterval(() => setN(x => { const v = x + 1; if (v >= 5) clearInterval(t); return Math.min(v, 5); }), 750);
    return () => clearInterval(t);
  }, []);
  return (
    <Screen style={{ paddingHorizontal: 24 }}>
      <View style={{ flex: 1, paddingTop: 42, gap: 24 }}>
        <View style={{ gap: 8 }}>
          <T size={12} w={500} mono ls={0.04} color={c.ink2}>PRÉVIA · PRIMEIRA ABERTURA</T>
          <T size={30} w={650} ls={-0.035} lh={1.06} accessibilityRole="header" accessibilityLiveRegion="polite">{done ? 'Assim a cópia é conferida.' : 'Verificando a cópia do Piu…'}</T>
          <T size={14.5} lh={1.4} color={c.ink2}>Antes de criar sua identidade, o Piu confere se esta cópia é original.</T>
        </View>
        <View>
          {checks.map(([t, d], i) => {
            const ok = i < n, cur = i === n;
            return (
              <View key={t} accessibilityLabel={`${t}: ${ok ? 'confere' : cur ? 'verificando' : 'aguardando'}`}
                style={{ flexDirection: 'row', gap: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.line, opacity: ok || cur ? 1 : 0.4 }}>
                <Icon name={ok ? 'check_circle' : cur ? 'pending' : 'radio_button_unchecked'} size={22} fill={ok} />
                <View style={{ flex: 1, gap: 3 }}>
                  <T size={15} w={600}>{t}</T>
                  <T size={11.5} mono lh={1.45} color={c.ink2}>{d}</T>
                </View>
              </View>
            );
          })}
        </View>
        <View style={{ flex: 1 }} />
        <Button label="Continuar" disabled={!done} style={{ marginBottom: 16 }} onPress={() => router.push('/invite/accept')} />
      </View>
    </Screen>
  );
}
