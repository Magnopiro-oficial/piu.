import { beforeAll, describe, expect, it } from 'vitest';
import { LANGS, decimalSeparator, dictOf, loadLang, matchLang, setLang, t, tIn, type Dict, type Plural } from './index';
import { ptBR } from './pt-BR';

const OTHERS = LANGS.map(l => l.code).filter(c => c !== 'pt-BR');
const forms = (v: string | Plural): string[] => (typeof v === 'string' ? [v] : Object.values(v).filter((x): x is string => typeof x === 'string'));
const vars = (v: string | Plural) => new Set(forms(v).flatMap(s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]!)));

beforeAll(async () => { await Promise.all(LANGS.map(l => loadLang(l.code))); });

describe('dicionários', () => {
  it('o design lista 11 idiomas e o pt-BR é a referência', () => {
    expect(LANGS.map(l => l.code)).toEqual(['pt-BR', 'pt-PT', 'en', 'es', 'fr', 'de', 'it', 'ja', 'zh', 'ar', 'hi']);
    expect(Object.keys(ptBR).length).toBeGreaterThan(500);
  });

  describe.each(OTHERS)('%s', lang => {
    const dict = () => dictOf(lang) as Dict;

    it('tem exatamente as mesmas chaves do pt-BR', () => {
      const ref = Object.keys(ptBR).sort(), got = Object.keys(dict()).sort();
      expect(got.filter(k => !ref.includes(k)), 'chaves a mais').toEqual([]);
      expect(ref.filter(k => !got.includes(k)), 'chaves faltando').toEqual([]);
    });

    it('cada chave tem as mesmas variáveis de interpolação e o mesmo tipo (texto ou plural)', () => {
      const d = dict();
      for (const [k, ref] of Object.entries(ptBR as Dict)) {
        const v = d[k]!;
        expect(typeof v, k).toBe(typeof ref);
        expect([...vars(v)].sort(), k).toEqual([...vars(ref)].sort());
        if (typeof v !== 'string') expect(v.other, k).toBeTruthy();
        for (const s of forms(v)) expect(s.trim().length, k).toBeGreaterThan(0);
      }
    });

    it('mantém os termos técnicos do produto', () => {
      const d = dict();
      for (const k of ['glossary.link.plain', 'live.selfModel', 'glossary.lunes.term', 'ovl.noNeighbors'] as const) {
        const ref = forms(ptBR[k]).join(' '), got = forms(d[k]!).join(' ');
        for (const term of ['LNNP', 'LUNES', 'piu-node']) if (ref.includes(term)) expect(got, k).toContain(term);
      }
    });
  });
});

describe('t()', () => {
  it('interpola e escolhe o plural pelo count, formatando o número na região', async () => {
    await setLang('pt-BR', { persist: false });
    expect(t('head.devicesCount', { count: 1 })).toBe('1 equipamento');
    expect(t('head.devicesCount', { count: 2 })).toBe('2 equipamentos');
    expect(t('dev.receipts', { count: 24880 })).toBe('24.880 recibos');
    expect(t('lang.toast', { name: 'English' })).toBe('Idioma: English');
    expect(tIn('en', 'head.devicesCount', { count: 1 })).toBe('1 device');
    expect(tIn('en', 'dev.receipts', { count: 24880 })).toBe('24,880 receipts');
  });

  it('variável ausente fica visível em vez de sumir', () => {
    expect(t('lang.toast', {})).toBe('Idioma: {name}');
  });

  it('separador decimal segue a região', async () => {
    expect(decimalSeparator('pt-BR')).toBe(',');
    expect(decimalSeparator('en')).toBe('.');
    expect(decimalSeparator('de')).toBe(',');
  });
});

describe('detecção do idioma do navegador', () => {
  it('casa o idioma exato, a base ou volta null', () => {
    expect(matchLang(['pt-BR'])).toBe('pt-BR');
    expect(matchLang(['pt-PT'])).toBe('pt-PT');
    expect(matchLang(['pt'])).toBe('pt-BR');
    expect(matchLang(['en-GB', 'fr'])).toBe('en');
    expect(matchLang(['zh-TW'])).toBe('zh');
    expect(matchLang(['sw', 'xx-YY'])).toBeNull();
  });
});
