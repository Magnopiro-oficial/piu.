/**
 * País do aparelho pela língua do sistema ("pt-BR" → "BR"); null sem país. Só sugere a região na tela
 * (RegionPicker): o rádio não transmite antes da pessoa escolher ou confirmar. Testado em
 * __tests__/piulora.test.ts.
 */
export function countryFromLocale(locale: string | null | undefined): string | null {
  const m = /[-_]([A-Za-z]{2})(?:[-_@.]|$)/.exec(locale ?? '');
  return m ? m[1]!.toUpperCase() : null;
}
