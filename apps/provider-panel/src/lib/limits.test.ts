import { beforeAll, describe, expect, it } from 'vitest';
import { LANGS, setLang, tIn } from '../i18n';
import { ptBR } from '../i18n/pt-BR';
import type { ApiRelay } from './api';
import { LIMIT_DEFAULTS, bandNote, storageNote } from './limits';

const GiB = 1024 ** 3, MiB = 1024 ** 2;

/** `GET /api/relay` com só o que os avisos leem (armazenamento e limites em vigor). */
function relay(maxBytes: number, effective: { bwMbps: number; stoGB: number }): ApiRelay {
  return {
    enabled: true, relayMode: true, relaying: true, lnnp: { version: 1, minVersion: 1 }, node: 'abcd', neighbors: [],
    store: { envelopes: 0, bytes: 0, maxBytes, seen: 0 },
    counters: { received: 0, forwarded: 0, duplicates: 0, rejected: 0, receipts: 0, delivered: 0, handshakesOk: 0, handshakesFailed: 0 },
    limits: { bwMbps: 50, stoGB: 8, hours: 'always', media: true, effective: { ...effective, hours: ['always'] } },
  } as unknown as ApiRelay;
}

describe('padrões dos limites', () => {
  it('são os mesmos do piu-node (50 Mbps, 8 GB, sempre)', () => {
    expect(LIMIT_DEFAULTS).toEqual({ bw: 50, sto: 8, hours: 'always' });
  });
});

describe('aviso de armazenamento: o que vale de verdade no nó', () => {
  beforeAll(() => setLang('pt-BR', { persist: false }));

  it('sem o motor (demonstração ou motor desligado), não avisa', () => {
    expect(storageNote(8, null)).toBeNull();
    expect(storageNote(8, { enabled: false })).toBeNull();
  });

  it('teto de memória do nó menor que a escolha: diz o tamanho real e o motivo', () => {
    const note = storageNote(8, relay(256 * MiB, { bwMbps: 50, stoGB: 8 }));
    expect(note).toContain('256 MB');
    expect(note).toMatch(/memória/);
  });

  it('regra do equipamento menor que a escolha: aponta para Equipamentos', () => {
    const note = storageNote(8, relay(4 * GiB, { bwMbps: 50, stoGB: 4 }));
    expect(note).toContain('4 GB');
    expect(note).toMatch(/Equipamentos/);
  });

  it('o nó guarda tudo o que foi escolhido: sem aviso', () => {
    expect(storageNote(8, relay(8 * GiB, { bwMbps: 50, stoGB: 8 }))).toBeNull();
  });
});

describe('aviso de banda', () => {
  beforeAll(() => setLang('pt-BR', { persist: false }));

  it('regra do equipamento mais baixa: diz a banda que vale', () => {
    const note = bandNote(50, relay(8 * GiB, { bwMbps: 20, stoGB: 8 }));
    expect(note).toContain('20 Mbps');
    expect(note).toMatch(/Equipamentos/);
  });

  it('sem regra mais baixa ou sem motor: sem aviso', () => {
    expect(bandNote(50, relay(8 * GiB, { bwMbps: 50, stoGB: 8 }))).toBeNull();
    expect(bandNote(50, null)).toBeNull();
  });
});

describe.each(LANGS.map(l => l.code))('textos das Configurações (%s)', lang => {
  beforeAll(() => setLang(lang, { persist: false }));

  it('os avisos saem no idioma com o tamanho e a banda', () => {
    expect(storageNote(8, relay(256 * MiB, { bwMbps: 50, stoGB: 8 }))).toMatch(/256/);
    expect(storageNote(8, relay(4 * GiB, { bwMbps: 50, stoGB: 4 }))).toMatch(/4/);
    expect(bandNote(50, relay(8 * GiB, { bwMbps: 20, stoGB: 8 }))).toMatch(/20/);
  });

  it('cada limite explica o que faz e mostra o padrão', () => {
    for (const k of ['st.bandDesc', 'st.storageDesc', 'st.hoursDesc'] as const) expect(tIn(lang, k).length, k).toBeGreaterThan(15); // chinês e japonês dizem o mesmo em menos caracteres
    expect(tIn(lang, 'st.default', { v: '50 Mbps' })).toContain('50 Mbps');
  });
});

describe('nomes dos idiomas', () => {
  it('em português, o português aparece em português (não em inglês)', () => {
    for (const lang of ['pt-BR', 'pt-PT'] as const) {
      expect(tIn(lang, 'lang.name.pt-BR'), lang).toMatch(/^Português/);
      expect(tIn(lang, 'lang.name.pt-PT'), lang).toMatch(/^Português/);
    }
  });
});

describe('troca da chave de operador', () => {
  it('em pt-BR, a tela fala em "trocar a chave", não em "rotacionar"', () => {
    const textos = Object.entries(ptBR).filter(([k]) => k.startsWith('ok.') || k === 'st.rotate').flatMap(([, v]) => (typeof v === 'string' ? [v] : Object.values(v)));
    expect(textos.filter(s => /rotacion|rotação|rotações/i.test(s))).toEqual([]);
  });
});
