import { beforeAll, describe, expect, it } from 'vitest';
import { LANGS, dateFormat, decimalSeparator, dictOf, getLocaleKey, getRegion, loadLang, matchLang, numberFormat, setLang, setRegion, t, tIn, type Dict, type Plural } from './index';
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
    expect(t('head.devicesCount', { count: 0 })).toBe('0 equipamentos');
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

describe('formato de números e datas (Configurações)', () => {
  const day = new Date(2026, 9, 31);
  const money = (n: number) => numberFormat({ minimumFractionDigits: 2 }).format(n);
  it('"Do idioma" segue a região do idioma; br e us trocam separadores e a ordem dia/mês', async () => {
    await setLang('pt-BR', { persist: false });
    setRegion('auto', { persist: false });
    expect(money(1234.56)).toBe('1.234,56');
    const before = getLocaleKey();
    setRegion('us', { persist: false });
    expect(getRegion()).toBe('us');
    expect(getLocaleKey()).not.toBe(before);
    expect(money(1234.56)).toBe('1,234.56');
    expect(decimalSeparator()).toBe('.');
    expect(dateFormat({ day: '2-digit', month: '2-digit' }).format(day)).toBe('10/31');
    expect(t('dev.receipts', { count: 24880 })).toBe('24,880 recibos');
    // Mês por extenso continua no idioma do painel.
    expect(dateFormat({ day: 'numeric', month: 'short' }).format(day)).toMatch(/out/);
    await setLang('en', { persist: false });
    setRegion('br', { persist: false });
    expect(money(1234.56)).toBe('1.234,56');
    expect(dateFormat({ day: '2-digit', month: '2-digit' }).format(day)).toBe('31/10');
    expect(dateFormat({ day: 'numeric', month: 'short' }).format(day)).toMatch(/Oct/);
    setRegion('auto', { persist: false });
    expect(money(1234.56)).toBe('1,234.56');
    await setLang('pt-BR', { persist: false });
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
