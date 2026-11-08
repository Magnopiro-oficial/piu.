/**
 * Região do rádio próprio no app: a que a pessoa escolheu; senão a do país do aparelho; senão nenhuma
 * (a tela pede para escolher). Testado em __tests__/piulora.test.ts.
 */
import { REGIONS, regionForCountry } from './regions';

/** País do aparelho pela língua do sistema ("pt-BR" → "BR"); null sem país. */
export function countryFromLocale(locale: string | null | undefined): string | null {
  const m = /[-_]([A-Za-z]{2})(?:[-_@.]|$)/.exec(locale ?? '');
  return m ? m[1]!.toUpperCase() : null;
}

export function initialRegion(o: { saved?: string | null; country?: string | null }): string | null {
  if (o.saved && REGIONS.some(r => r.id === o.saved)) return o.saved;
  return regionForCountry(o.country ?? undefined);
}
