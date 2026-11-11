/**
 * Props dos campos da frase de recuperação (ui/PhraseInput.tsx), testadas em __tests__/phraseField.test.ts.
 * - Android: `visible-password` desliga aprendizado e sugestões na maioria dos teclados (o dicionário
 *   pessoal e a nuvem do teclado não guardam as palavras); fora do autofill.
 * - iPhone: sem tipo de conteúdo, para o sistema não oferecer senha nem preenchimento.
 */
export function phraseFieldProps(os: string) {
  return {
    autoCapitalize: 'none' as const,
    autoCorrect: false,
    autoComplete: 'off' as const,
    spellCheck: false,
    importantForAutofill: 'no' as const,
    textContentType: 'none' as const,
    ...(os === 'android' ? { keyboardType: 'visible-password' as const } : {}),
  };
}
