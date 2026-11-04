/** Imagem da identidade anônima (sem dependência nativa: testável em Node). Ver lib/avatar.ts. */
import type { IconName } from '../ui/icons.generated';

export interface AnonAvatar { icon: IconName; hue: number }

/** Ícones da imagem anônima (design: `AVI`). */
export const ANON_ICONS: IconName[] = ['pets', 'eco', 'spa', 'water_drop', 'bolt', 'star', 'cloud', 'park', 'sailing', 'rocket_launch', 'local_florist', 'cruelty_free',
  'flutter_dash', 'emoji_nature', 'forest', 'landscape', 'waves', 'diamond', 'auto_awesome', 'icecream', 'coffee', 'music_note', 'anchor', 'cookie', 'hive', 'ac_unit',
  'sunny', 'bedtime', 'filter_vintage', 'egg'];

/** As 11 opções de uma rodada (mais a opção "só o código"), com o mesmo sorteio do design. */
export function anonChoices(seed: number): AnonAvatar[] {
  let sx = (seed * 7919) % 233280;
  const rnd = () => (sx = (sx * 9301 + 49297) % 233280) / 233280;
  const pool = ANON_ICONS.slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j]!, pool[i]!]; }
  return pool.slice(0, 11).map(icon => ({ icon, hue: Math.floor(rnd() * 12) * 30 }));
}

/** OKLCH → hex sRGB (o design usa oklch(); o React Native não lê esse formato). */
export function oklchHex(L: number, C: number, hDeg: number): string {
  const h = (hDeg * Math.PI) / 180, a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return '#' + lin.map(x => {
    const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.max(x, 0) ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  }).join('');
}

/** Cores da imagem anônima (design: fundo oklch(0.86 0.07 h), desenho oklch(0.34 0.09 h)). */
export const anonColors = (a: AnonAvatar) => ({ bg: oklchHex(0.86, 0.07, a.hue), fg: oklchHex(0.34, 0.09, a.hue) });

export const sameAnon = (a: AnonAvatar | null | undefined, b: AnonAvatar | null | undefined) => (!a && !b) || (!!a && !!b && a.icon === b.icon && a.hue === b.hue);
