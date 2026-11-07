import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LANGS, STRINGS, matchLang, translator, type Lang } from '../src/i18n.ts';

const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

test('idioma do sistema: os mesmos 11 idiomas do painel, variante regional e reserva pt-BR', () => {
  assert.deepEqual(LANGS, ['pt-BR', 'pt-PT', 'en', 'es', 'fr', 'de', 'it', 'ja', 'zh', 'ar', 'hi']);
  assert.equal(matchLang(['pt-BR']), 'pt-BR');
  assert.equal(matchLang(['pt_PT']), 'pt-PT');
  assert.equal(matchLang(['pt']), 'pt-BR');
  assert.equal(matchLang(['en-GB']), 'en');
  assert.equal(matchLang(['zh-Hans-CN']), 'zh');
  assert.equal(matchLang(['ko-KR', 'fr-CA']), 'fr');
  assert.equal(matchLang(['', 'xx']), null);
  assert.equal(matchLang([]), null);
});

test('paridade: todo idioma tem as chaves e variáveis do pt-BR, sem texto vazio nem cópia', () => {
  const ref = STRINGS['pt-BR'];
  for (const lang of LANGS) {
    const d = STRINGS[lang];
    assert.deepEqual(Object.keys(d).sort(), Object.keys(ref).sort(), `${lang}: chaves`);
    for (const k of Object.keys(ref) as (keyof typeof ref)[]) {
      assert.ok(d[k].trim(), `${lang}.${k}: vazio`);
      assert.deepEqual(vars(d[k]), vars(ref[k]), `${lang}.${k}: variáveis`);
      for (const brand of ['Piu', 'LUNES', 'piu-node', 'SHA-256']) {
        if (ref[k].includes(brand)) assert.ok(d[k].includes(brand), `${lang}.${k}: perdeu "${brand}"`);
      }
    }
    if (lang !== 'pt-BR' && lang !== 'pt-PT') {
      const same = (Object.keys(ref) as (keyof typeof ref)[]).filter(k => d[k] === ref[k] && ref[k].length > 12);
      assert.deepEqual(same, [], `${lang}: iguais ao pt-BR`);
    }
  }
});

test('versão e atualização: chaves presentes e interpolação', () => {
  const keys = ['menu.help', 'menu.version', 'menu.checkUpdates', 'menu.updateNotify', 'update.title', 'update.latest',
    'update.available', 'update.availableDetail', 'update.open', 'update.offline', 'update.offlineDetail', 'update.github', 'update.githubDetail'];
  for (const lang of LANGS) for (const k of keys) assert.ok(k in STRINGS[lang], `${lang}.${k}`);
  for (const lang of LANGS) {
    const tr = translator(lang);
    assert.match(tr('update.latest', { version: '0.1.2' }), /0\.1\.2/);
    assert.match(tr('update.available', { version: '0.1.3' }), /Piu Provider.*0\.1\.3|0\.1\.3.*Piu Provider/);
    assert.match(tr('menu.version', { version: '0.1.2' }), /0\.1\.2/);
  }
});

test('translator: interpola {var}, idioma desconhecido cai no pt-BR', () => {
  const en = translator('en');
  assert.equal(en('menu.node'), 'Node');
  assert.match(en('lan.detailOn', { port: 8420 }), /piu-node\.local:8420/);
  const pt = translator(matchLang(['ko']) ?? 'pt-BR');
  assert.equal(pt('menu.node'), 'Nó');
  const all = LANGS.map((l: Lang) => translator(l)('tray.tooltipLan'));
  assert.ok(all.every(s => s.includes('Piu Provider')));
});
