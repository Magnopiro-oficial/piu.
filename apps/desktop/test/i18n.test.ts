import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { LANGS as PHONE_LANGS } from '../../mobile/src/i18n/core';
import { sanitizePrefsPatch } from '../src/main/prefs';
import { applyMainLang, mainLang } from '../src/main/i18n';
import { dictOf, fmtNumber, LANGS, matchLang, regionSample, resolveLang, tIn, varsOf, type Dict, type Key } from '../src/shared/i18n';
import { ptBR } from '../src/shared/i18n/pt-BR';

const ref = ptBR as Dict;
const keys = Object.keys(ref) as Key[];

test('os mesmos 11 idiomas do celular, na mesma ordem e com os mesmos locales', () => {
  assert.equal(LANGS.length, 11);
  assert.deepEqual(LANGS.map(l => ({ ...l })), PHONE_LANGS.map(l => ({ ...l })));
});

test('todos os idiomas registrados, com as mesmas chaves e as mesmas variáveis do pt-BR', () => {
  for (const { code } of LANGS) {
    const d = dictOf(code);
    assert.ok(d, `${code} sem dicionário`);
    assert.deepEqual(Object.keys(d).sort(), [...keys].sort(), `${code}: chaves diferentes do pt-BR`);
    for (const k of keys) {
      assert.deepEqual(varsOf(d[k]!), varsOf(ref[k]!), `${code} ${k}: variáveis diferentes`);
      assert.equal(typeof d[k] === 'string', typeof ref[k] === 'string', `${code} ${k}: plural num e texto no outro`);
      const forms = typeof d[k] === 'string' ? [d[k] as string] : Object.values(d[k]!);
      for (const f of forms) assert.ok(f.trim().length > 0, `${code} ${k}: vazio`);
    }
  }
});

test('idiomas além do português não são cópias do pt-BR (exceto nomes técnicos curtos)', () => {
  for (const { code } of LANGS) {
    if (code === 'pt-BR' || code === 'pt-PT') continue;
    const d = dictOf(code)!;
    const same = keys.filter(k => typeof ref[k] === 'string' && d[k] === ref[k] && /[a-zà-ú]{4,}\s+[a-zà-ú]{3,}/i.test(ref[k] as string));
    assert.ok(same.length <= Math.ceil(keys.length * 0.02), `${code}: ${same.length} textos iguais ao pt-BR: ${same.slice(0, 8).join(', ')}`);
  }
});

test('nenhum texto da interface fica fora do dicionário: renderer sem palavras em português soltas no JSX', () => {
  const dir = join(import.meta.dirname, '../src/renderer/screens');
  const files = [...readdirSync(dir).map(f => join(dir, f)), join(import.meta.dirname, '../src/renderer/App.tsx'), join(import.meta.dirname, '../src/renderer/ui.tsx')];
  const offenders: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/.*$/gm, '');
    // Texto entre tags (>Texto<) ou atributos visíveis com palavras acentuadas típicas do português.
    for (const m of src.matchAll(/>([^<>{}]*[A-Za-zÀ-ú]{3,}[^<>{}]*)</g)) if (/[ãõçáéíóúâêô]/i.test(m[1]!)) offenders.push(`${f.split('/').pop()}: ${m[1]!.trim().slice(0, 50)}`);
    for (const m of src.matchAll(/(?:title|label|placeholder|aria-label|desc|name)=["']([^"']*[ãõçáéíóúâêô][^"']*)["']/gi)) offenders.push(`${f.split('/').pop()}: ${m[1]!.slice(0, 50)}`);
  }
  assert.deepEqual(offenders, []);
});

test('preferência de idioma: auto segue o sistema; idioma desconhecido cai no pt-BR; setPrefs só aceita valores da lista', () => {
  assert.equal(resolveLang('auto', ['en-GB', 'pt-BR']), 'en');
  assert.equal(resolveLang('auto', ['sv-SE']), 'pt-BR');
  assert.equal(resolveLang('ja', ['en-US']), 'ja');
  assert.equal(matchLang(['pt']), 'pt-BR');
  assert.equal(matchLang(['zh-TW']), 'zh');
  assert.deepEqual(sanitizePrefsPatch({ lang: 'ar', region: 'us' }), { lang: 'ar', region: 'us' });
  assert.deepEqual(sanitizePrefsPatch({ lang: 'auto' }), { lang: 'auto' });
  assert.throws(() => sanitizePrefsPatch({ lang: 'klingon' }), /lang/);
  assert.throws(() => sanitizePrefsPatch({ region: 'eu' }), /region/);
});

test('processo principal troca de idioma e avisa quando mudou (para refazer o menu)', () => {
  assert.equal(applyMainLang('en', 'auto', []), true);
  assert.equal(mainLang(), 'en');
  assert.equal(applyMainLang('en', 'auto', []), false);
  assert.equal(applyMainLang('auto', 'auto', ['xx']), true);
  assert.equal(mainLang(), 'pt-BR');
});

test('região: número no formato pedido; plural pela regra do idioma', () => {
  assert.equal(regionSample('en', 'br'), '1.234,56');
  assert.equal(regionSample('pt-BR', 'us'), '1,234.56');
  assert.equal(fmtNumber(1234.5, { maximumFractionDigits: 1 }, 'de', 'auto'), '1.234,5');
  assert.equal(tIn('pt-BR', 'common.today', { time: '10:00' }), 'hoje, 10:00');
  assert.equal(tIn('en', 'nonexistent' as Key), 'nonexistent');
});
