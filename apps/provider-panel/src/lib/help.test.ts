import { beforeAll, describe, expect, it } from 'vitest';
import { LANGS, setLang } from '../i18n';
import type { PageId } from '../types';
import { HELP_TERMS, TERM_IDS, glossary, help, termsOf } from './help';

const PAGES: PageId[] = ['overview', 'devices', 'mesh', 'gateway', 'earnings', 'wallet', 'settings'];

// A ajuda vale em todos os idiomas do painel: cada verificação roda com cada dicionário carregado.
describe.each(LANGS.map(l => l.code))('ajuda por página (%s)', lang => {
  beforeAll(() => setLang(lang, { persist: false }));

  it('toda página explica o que mostra e o que fazer', () => {
    for (const p of PAGES) {
      const h = help(p);
      expect(h.what.length, p).toBeGreaterThan(30);
      expect(h.todo.length, p).toBeGreaterThanOrEqual(2);
      expect(h.terms.length, p).toBeGreaterThanOrEqual(2);
    }
  });

  it('os termos de cada página vêm do glossário, sem repetir', () => {
    const all = Object.values(glossary());
    for (const p of PAGES) {
      const t = termsOf(p);
      expect(t.length).toBe(new Set(HELP_TERMS[p]).size);
      for (const x of t) expect(all).toContainEqual(x);
    }
  });

  it('o glossário explica cada termo em poucas palavras', () => {
    const g = glossary();
    expect(Object.keys(g)).toEqual([...TERM_IDS]);
    for (const [id, x] of Object.entries(g)) {
      expect(x.term.length, id).toBeGreaterThan(0);
      expect(x.plain.length, id).toBeGreaterThan(20);
      expect(x.plain.length, id).toBeLessThanOrEqual(220);
    }
  });
});
