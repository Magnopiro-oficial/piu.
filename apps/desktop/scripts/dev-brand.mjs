// Em desenvolvimento, o macOS mostra na barra de menus o nome do bundle do Electron ("Electron"),
// que `app.setName` não muda. Este script renomeia, de forma idempotente, o bundle de desenvolvimento
// em node_modules (CFBundleName/CFBundleDisplayName = "Piu") para o app se chamar "Piu" também no dev.
// Só mexe em node_modules local; o app empacotado (electron-builder) já sai com o nome certo.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const plist = join(process.cwd(), 'node_modules/electron/dist/Electron.app/Contents/Info.plist');
if (process.platform !== 'darwin' || !existsSync(plist)) process.exit(0);
let xml = readFileSync(plist, 'utf8');
const before = xml;
for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
  const re = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`);
  xml = re.test(xml) ? xml.replace(re, `$1Piu$2`) : xml.replace('<dict>', `<dict>\n\t<key>${key}</key>\n\t<string>Piu</string>`);
}
if (xml !== before) { writeFileSync(plist, xml); console.log('dev-brand: bundle de desenvolvimento renomeado para "Piu"'); }
