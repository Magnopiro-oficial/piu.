/**
 * Ponto de entrada do idioma (renderer e processo principal): registra todos os dicionários, que vêm no
 * pacote (nada é baixado). O núcleo puro está em ./core.ts; a paridade de chaves e variáveis em test/i18n.test.ts.
 */
import { registerDict } from './core';
import { dict as ar } from './ar';
import { dict as de } from './de';
import { dict as en } from './en';
import { dict as es } from './es';
import { dict as fr } from './fr';
import { dict as hi } from './hi';
import { dict as it } from './it';
import { dict as ja } from './ja';
import { dict as ptPT } from './pt-PT';
import { dict as zh } from './zh';

registerDict('pt-PT', ptPT);
registerDict('en', en);
registerDict('es', es);
registerDict('fr', fr);
registerDict('de', de);
registerDict('it', it);
registerDict('ja', ja);
registerDict('zh', zh);
registerDict('ar', ar);
registerDict('hi', hi);

export * from './core';
