/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_LANG, LANGS, decimalSeparator, dictOf, interpolate, isLang, matchLang, regionLocale, regionSample, resolveLang, selectPlural, setLang, setRegion, t, tIn, varsOf,
  type Dict, type Lang, type Plural,
} from '../../i18n';
import { ptBR } from '../../i18n/pt-BR';

const ALL: Lang[] = LANGS.map(l => l.code);

test('idioma: a lista é a do design (11 idiomas, nomes nativos) e pt-BR é o padrão', () => {
  assert.deepEqual(ALL, ['pt-BR', 'pt-PT', 'en', 'es', 'fr', 'de', 'it', 'ja', 'zh', 'ar', 'hi']);
  assert.equal(LANGS.find(l => l.code === 'ja')?.native, '日本語');
  assert.equal(DEFAULT_LANG, 'pt-BR');
  assert.ok(isLang('en') && !isLang('xx') && !isLang(3));
});

test('idioma do sistema: tag exata, variante regional e português genérico', () => {
  assert.equal(matchLang(['pt-BR']), 'pt-BR');
  assert.equal(matchLang(['pt_BR']), 'pt-BR');
  assert.equal(matchLang(['pt-PT']), 'pt-PT');
  assert.equal(matchLang(['pt']), 'pt-BR');
  assert.equal(matchLang(['en-GB']), 'en');
  assert.equal(matchLang(['zh-TW']), 'zh');
  assert.equal(matchLang(['es-419']), 'es');
  assert.equal(matchLang(['', ' ', 'xx-YY']), null);
  assert.equal(matchLang(['ko', 'fr-CA']), 'fr');
});

test('preferência: idioma escolhido manda; auto segue o sistema se suportado, senão pt-BR', () => {
  assert.equal(resolveLang('de', 'en'), 'de');
  assert.equal(resolveLang('auto', 'en'), 'en');
  assert.equal(resolveLang('auto', null), 'pt-BR');
  assert.equal(resolveLang(null, null), 'pt-BR');
  assert.equal(resolveLang(undefined, 'hi'), 'hi');
});

test('t: interpolação, variável ausente fica visível, chave desconhecida devolve a chave', () => {
  assert.equal(interpolate('Olá, {name}!', { name: 'Ana' }), 'Olá, Ana!');
  assert.equal(interpolate('Olá, {name}!', {}), 'Olá, {name}!');
  assert.equal(tIn('pt-BR', 'profile.anonName', { code: 'ab12' }), 'Anônimo · ab12');
  assert.equal(tIn('pt-BR', 'nao.existe' as never), 'nao.existe');
});

test('t: plural pela categoria CLDR do idioma', () => {
  assert.equal(tIn('pt-BR', 'common.unread', { count: 1 }), '1 não lida');
  assert.equal(tIn('pt-BR', 'common.unread', { count: 2 }), '2 não lidas');
  assert.equal(tIn('en', 'common.unread', { count: 1 }), '1 unread');
  assert.equal(tIn('en', 'common.unread', { count: 0 }), '0 unread');
});

test('t: troca de idioma global e reserva em pt-BR para chave que falte', () => {
  setLang('en');
  assert.equal(t('tabs.chats'), 'Chats');
  setLang('pt-BR');
  assert.equal(t('tabs.chats'), 'Conversas');
  // Chave só no pt-BR: idioma sem ela cai na referência.
  const d = dictOf('en') as Dict;
  const k = Object.keys(ptBR)[0]!;
  const saved = d[k]!;
  delete d[k];
  assert.equal(tIn('en', k as never), (ptBR as Dict)[k]);
  d[k] = saved;
});

test('região: formato de número e data pelo idioma ou forçado (1.234,56 / 1,234.56)', () => {
  assert.equal(regionLocale('en', 'auto'), 'en-US');
  assert.equal(regionLocale('en', 'br'), 'pt-BR');
  assert.equal(regionLocale('pt-BR', 'us'), 'en-US');
  assert.equal(regionSample('pt-BR', 'auto'), '1.234,56');
  assert.equal(regionSample('en', 'auto'), '1,234.56');
  assert.equal(regionSample('en', 'br'), '1.234,56');
  assert.equal(regionSample('ja', 'us'), '1,234.56');
  // Árabe com algarismos latinos: números técnicos (LUNES) continuam legíveis.
  assert.match(regionSample('ar', 'auto'), /^1[,.٬]234[.,٫]56$/);
  assert.equal(decimalSeparator('pt-BR', 'auto'), ',');
  assert.equal(decimalSeparator('de', 'us'), '.');
  setRegion('auto');
});

test('paridade: todo idioma tem exatamente as chaves do pt-BR, com as mesmas variáveis', () => {
  const ref = ptBR as Dict;
  const refKeys = Object.keys(ref).sort();
  for (const lang of ALL) {
    if (lang === 'pt-BR') continue;
    const d = dictOf(lang);
    assert.ok(d, `dicionário ${lang} não registrado`);
    const keys = Object.keys(d!).sort();
    const missing = refKeys.filter(k => !(k in d!));
    const extra = keys.filter(k => !(k in ref));
    assert.deepEqual(missing, [], `${lang}: chaves faltando`);
    assert.deepEqual(extra, [], `${lang}: chaves a mais`);
    for (const k of refKeys) {
      const a: string | Plural = ref[k]!;
      const b: string | Plural = (d as Dict)[k]!;
      assert.equal(typeof a === 'string', typeof b === 'string', `${lang}.${k}: plural e texto simples não batem`);
      assert.deepEqual(varsOf(b), varsOf(a), `${lang}.${k}: variáveis diferentes`);
      if (typeof b !== 'string') assert.ok(b.other, `${lang}.${k}: plural sem "other"`);
      const text = typeof b === 'string' ? b : b.other;
      assert.ok(text.trim().length > 0, `${lang}.${k}: vazio`);
    }
  }
});

test('paridade: nomes do produto não se traduzem', () => {
  for (const lang of ALL) {
    const d = dictOf(lang) as Dict;
    for (const [k, v] of Object.entries(ptBR as Dict)) {
      const a = typeof v === 'string' ? v : v.other;
      const w = d[k]!;
      const b: string = typeof w === 'string' ? w : w.other;
      for (const brand of ['Piu', 'LUNES', 'LNNP', 'Mainnet']) {
        if (a.includes(brand)) assert.ok(b.includes(brand), `${lang}.${k}: perdeu "${brand}"`);
      }
    }
  }
});


test('Hermes sem Intl.PluralRules: Chats e demais plurais não derrubam o app', () => {
  const descriptor = Object.getOwnPropertyDescriptor(Intl, 'PluralRules')!;
  Object.defineProperty(Intl, 'PluralRules', { ...descriptor, value: undefined });
  try {
    assert.equal(tIn('pt-BR', 'common.unread', { count: 1 }), '1 não lida');
    assert.equal(tIn('pt-BR', 'common.unread', { count: 2 }), '2 não lidas');
    for (const lang of ALL) {
      for (const count of [0, 1, 2, 3, 11, 100]) {
        for (const key of ['chats.nodes.pill', 'chats.queued', 'common.unread'] as const) {
          const text = tIn(lang, key, { count });
          assert.ok(text.trim() && !text.includes('{count}'), `${lang}.${key}: ${count}`);
        }
      }
    }
  } finally {
    Object.defineProperty(Intl, 'PluralRules', descriptor);
  }
});

test('Hermes: reserva CLDR mantém categorias dos 11 idiomas, decimais, negativos e milhões', () => {
  const descriptor = Object.getOwnPropertyDescriptor(Intl, 'PluralRules')!;
  const values = [
    0, -0, 1, -1, 2, -2, 3, 4, 10, 11, 12, 99, 100, 101, 102, 103, 110, 111,
    1000, 1000000, -2000000, 1000001, 1e15, Number.MAX_SAFE_INTEGER,
    0.0001, 0.0005, 0.5, 0.9999, 1.0004, 1.0005, 1.1, 1.5, 1.9999,
    2.0001, 2.5, 3.1, 3.5, 10.5, 11.5, 99.5, -0.5, -1.5, 1000000.0004, 1000000.001,
  ];
  const expected = ALL.map(lang => {
    const rule = new Intl.PluralRules(LANGS.find(l => l.code === lang)!.locale);
    return values.map(n => rule.select(n));
  });
  Object.defineProperty(Intl, 'PluralRules', { ...descriptor, value: undefined });
  try {
    ALL.forEach((lang, li) => values.forEach((n, ni) => {
      assert.equal(selectPlural(lang, n), expected[li]![ni], `${lang}: ${n}`);
    }));
    assert.deepEqual([0, 1, 2, 3, 11, 100].map(n => selectPlural('ar', n)), ['zero', 'one', 'two', 'few', 'many', 'other']);
    assert.equal(selectPlural('pt-BR', NaN), 'one');
    assert.equal(selectPlural('ar', Infinity), 'zero');
  } finally {
    Object.defineProperty(Intl, 'PluralRules', descriptor);
  }
});
