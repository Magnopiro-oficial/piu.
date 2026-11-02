// Gera src/ui/icons.generated.ts com os caminhos SVG dos Material Symbols Rounded usados no app.
// Uso: npm run icons (depois de acrescentar nomes em scripts/icon-names.json).
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const names = [...new Set(JSON.parse(readFileSync(resolve(here, 'icon-names.json'), 'utf8')))].sort();
const pathOf = (weight, file) => {
  const dir = dirname(require.resolve(`@material-symbols/svg-${weight}/package.json`));
  const svg = readFileSync(resolve(dir, 'rounded', file), 'utf8');
  const ds = [...svg.matchAll(/ d="([^"]+)"/g)].map(m => m[1]);
  if (!ds.length) throw new Error(`sem path em ${weight}/${file}`);
  return ds.join(' ');
};
// Nomes antigos (ainda aceitos como ligadura na fonte) que viraram outro arquivo nos SVGs.
const ALIASES = { smartphone: 'mobile', install_mobile: 'mobile_arrow_down', phone_iphone: 'mobile_3', phone_android: 'mobile_2', battery_saver: 'battery_android_plus', phonelink_ring: 'mobile_vibrate' };
const lines = names.map(n => {
  const f = ALIASES[n] ?? n;
  const v = [pathOf(300, `${f}.svg`), pathOf(300, `${f}-fill.svg`), pathOf(400, `${f}.svg`), pathOf(400, `${f}-fill.svg`)];
  return `  ${JSON.stringify(n)}: [${v.map(x => JSON.stringify(x)).join(', ')}],`;
});
const out = `// Gerado por scripts/gen-icons.mjs — não edite à mão.
// Material Symbols Rounded (Apache 2.0). Ordem: [w300, w300 preenchido, w400, w400 preenchido]; viewBox "0 -960 960 960".
export const ICONS = {
${lines.join('\n')}
} as const;

export type IconName = keyof typeof ICONS;
`;
writeFileSync(resolve(here, '../src/ui/icons.generated.ts'), out);
console.log(`${names.length} ícones gerados`);
