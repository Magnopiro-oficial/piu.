import { describe, expect, it } from 'vitest';
import type { PageId } from '../types';
import { GLOSSARY, HELP, termsOf } from './help';

const PAGES: PageId[] = ['overview', 'devices', 'mesh', 'earnings', 'wallet', 'settings'];

describe('ajuda por página', () => {
  it('toda página explica o que mostra e o que fazer', () => {
    for (const p of PAGES) {
      expect(HELP[p].what.length, p).toBeGreaterThan(30);
      expect(HELP[p].todo.length, p).toBeGreaterThanOrEqual(2);
      expect(HELP[p].terms.length, p).toBeGreaterThanOrEqual(2);
    }
  });

  it('os termos de cada página vêm do glossário, sem repetir', () => {
    for (const p of PAGES) {
      const t = termsOf(p);
      expect(t.length).toBe(new Set(HELP[p].terms).size);
      for (const x of t) expect(Object.values(GLOSSARY)).toContain(x);
    }
  });

  it('o glossário explica cada termo em poucas palavras', () => {
    for (const [id, g] of Object.entries(GLOSSARY)) {
      expect(g.term.length, id).toBeGreaterThan(0);
      expect(g.plain.length, id).toBeGreaterThan(20);
      expect(g.plain.length, id).toBeLessThanOrEqual(220);
    }
  });
});
