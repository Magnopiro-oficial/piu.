import { useRef, useState } from 'react';
import { Platform, Pressable, TextInput, type TextInputInstance, View } from 'react-native';
import { phraseFieldProps } from '../lib/phraseField';
import { PHRASE_WORDS, suggestWords, WORDLIST } from '../protocol';
import { useT } from '../i18n';
import { fontFamily } from '../theme/fonts';
import { useTheme } from '../theme/ThemeProvider';
import { T } from './T';

/**
 * Digitação da frase de recuperação: 12 campos em 3 colunas, sugestões da lista oficial,
 * colar a frase inteira no primeiro campo preenche todos. Palavra fora da lista: borda tracejada.
 */
export function PhraseInput({ words, onChange }: { words: string[]; onChange: (w: string[]) => void }) {
  const { c } = useTheme();
  const t = useT();
  const refs = useRef<(TextInputInstance | null)[]>([]);
  const [focus, setFocus] = useState<number | null>(null);
  const set = (i: number, v: string) => {
    const parts = v.trim().toLowerCase().split(/\s+/);
    if (parts.length > 1) { // colou várias palavras
      const next = [...words];
      parts.slice(0, PHRASE_WORDS - i).forEach((p, k) => { next[i + k] = p; });
      onChange(next);
      refs.current[Math.min(PHRASE_WORDS - 1, i + parts.length)]?.focus();
      return;
    }
    const next = [...words]; next[i] = v.toLowerCase().replace(/\s/g, ''); onChange(next);
  };
  const sugg = focus != null ? suggestWords(words[focus] ?? '').filter(s => s !== words[focus]) : [];

  return (
    <View style={{ gap: 10 }}>
      <View style={{ padding: 14, borderRadius: 22, backgroundColor: c.bg2, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {Array.from({ length: PHRASE_WORDS }, (_, i) => {
          const w = words[i] ?? '';
          const bad = w.length > 0 && focus !== i && !WORDLIST.includes(w);
          return (
            <View key={i} style={{ width: '31%', flexGrow: 1, height: 40, borderRadius: 12, backgroundColor: c.bg, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 10,
              borderWidth: 1, borderStyle: bad ? 'dashed' : 'solid', borderColor: focus === i || bad ? c.ink : 'transparent' }}>
              <T size={10.5} w={500} mono color={c.ink2}>{i + 1}</T>
              <TextInput ref={r => { refs.current[i] = r; }} value={w} onChangeText={v => set(i, v)} onFocus={() => setFocus(i)} onBlur={() => setFocus(f => (f === i ? null : f))}
                {...phraseFieldProps(Platform.OS)} returnKeyType={i < PHRASE_WORDS - 1 ? 'next' : 'done'}
                onSubmitEditing={() => refs.current[i + 1]?.focus()} accessibilityLabel={`${t('phrase.word', { n: i + 1 })}${bad ? `, ${t('phrase.notInList')}` : ''}`}
                style={{ flex: 1, minWidth: 0, height: 38, fontSize: 14.5, color: c.ink, fontFamily: fontFamily(600), paddingVertical: 0, outlineWidth: 0 }} />
            </View>
          );
        })}
      </View>
      {sugg.length > 0 && (
        <View accessibilityLabel={t('phrase.suggestions')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {sugg.map(s => (
            <Pressable key={s} onPress={() => { set(focus!, s); refs.current[Math.min(PHRASE_WORDS - 1, focus! + 1)]?.focus(); }} accessibilityRole="button" accessibilityLabel={`Usar ${s}`}
              style={{ paddingVertical: 7, paddingHorizontal: 12, borderRadius: 99, borderWidth: 1, borderColor: c.line2 }}>
              <T size={13} w={550}>{s}</T>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}
