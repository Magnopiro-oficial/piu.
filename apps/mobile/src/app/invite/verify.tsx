import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { VERIFY_CHECKS } from '../../data/wallet';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Screen } from '../../ui/Screen';
import { T } from '../../ui/T';

/** Primeira abertura de uma cópia recebida de outra pessoa: 5 verificações antes de criar a identidade. */
export default function VerifyCopy() {
  const { c } = useTheme();
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
          <T size={12} w={500} mono ls={0.04} color={c.ink2}>PRIMEIRA ABERTURA</T>
          <T size={30} w={650} ls={-0.035} lh={1.06} accessibilityRole="header" accessibilityLiveRegion="polite">{done ? 'Esta cópia é autêntica.' : 'Verificando sua cópia do Piu…'}</T>
          <T size={14.5} lh={1.4} color={c.ink2}>Antes de criar sua identidade, o Piu confere se esta cópia é original.</T>
        </View>
        <View>
          {VERIFY_CHECKS('Cardeal').map(([t, d], i) => {
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
