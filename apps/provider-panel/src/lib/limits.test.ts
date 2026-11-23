import { beforeAll, describe, expect, it } from 'vitest';
import { LANGS, setLang, tIn } from '../i18n';
import { ptBR } from '../i18n/pt-BR';
import type { ApiRelay } from './api';
import { LIMIT_DEFAULTS, STORAGE_OPTIONS_MB, bandNote, deviceStorageRuleNote, sameSettings, storageNote } from './limits';

const MiB = 1024 ** 2;

/** `GET /api/relay` com só o que os avisos leem (armazenamento e limites em vigor). */
function relay(maxBytes: number, effective: { bwMbps: number; stoMB: number }): ApiRelay {
  return {
    enabled: true, relayMode: true, relaying: true, lnnp: { version: 1, minVersion: 1 }, node: 'abcd', neighbors: [],
    store: { envelopes: 0, bytes: 0, maxBytes, seen: 0 },
    counters: { received: 0, forwarded: 0, duplicates: 0, rejected: 0, receipts: 0, delivered: 0, handshakesOk: 0, handshakesFailed: 0 },
    limits: { bwMbps: 50, stoMB: 256, hours: 'always', media: true, effective: { ...effective, hours: ['always'] } },
  } as unknown as ApiRelay;
}

describe('padrões dos limites', () => {
  it('são os mesmos do piu-node (50 Mbps, 256 MB, sempre)', () => {
    expect(LIMIT_DEFAULTS).toEqual({ bw: 50, sto: 256, hours: 'always' });
  });

  it('as opções de espaço são as que o nó cumpre (em MB, abaixo do teto do roteador: 20 mil mensagens de até 32 KB)', () => {
    expect(STORAGE_OPTIONS_MB).toEqual([128, 256, 512]);
    expect(STORAGE_OPTIONS_MB).toContain(LIMIT_DEFAULTS.sto);
    for (const mb of STORAGE_OPTIONS_MB) expect(mb * MiB).toBeLessThanOrEqual(20000 * 32 * 1024);
  });
});

describe('aviso de armazenamento: o que vale de verdade no nó', () => {
  beforeAll(() => setLang('pt-BR', { persist: false }));

  it('sem o motor (demonstração ou motor desligado), não avisa', () => {
    expect(storageNote(256, null)).toBeNull();
    expect(storageNote(256, { enabled: false })).toBeNull();
  });

  it('teto de memória do nó menor que a escolha: diz o tamanho real e o motivo', () => {
    const note = storageNote(512, relay(256 * MiB, { bwMbps: 50, stoMB: 512 }));
    expect(note).toContain('256 MB');
    expect(note).toMatch(/memória/);
  });

  it('regra do equipamento menor que a escolha: aponta para Equipamentos', () => {
    const note = storageNote(512, relay(128 * MiB, { bwMbps: 50, stoMB: 128 }));
    expect(note).toContain('128 MB');
    expect(note).toMatch(/Equipamentos/);
  });

  it('o nó guarda tudo o que foi escolhido: sem aviso', () => {
    expect(storageNote(512, relay(512 * MiB, { bwMbps: 50, stoMB: 512 }))).toBeNull();
  });
});

describe('aviso de banda', () => {
  beforeAll(() => setLang('pt-BR', { persist: false }));

  it('regra do equipamento mais baixa: diz a banda que vale', () => {
    const note = bandNote(50, relay(256 * MiB, { bwMbps: 20, stoMB: 256 }));
    expect(note).toContain('20 Mbps');
    expect(note).toMatch(/Equipamentos/);
  });

  it('sem regra mais baixa ou sem motor: sem aviso', () => {
    expect(bandNote(50, relay(256 * MiB, { bwMbps: 50, stoMB: 256 }))).toBeNull();
    expect(bandNote(50, null)).toBeNull();
  });
});

describe.each(LANGS.map(l => l.code))('textos das Configurações (%s)', lang => {
  beforeAll(() => setLang(lang, { persist: false }));

  it('os avisos saem no idioma com o tamanho e a banda', () => {
    expect(storageNote(512, relay(256 * MiB, { bwMbps: 50, stoMB: 512 }))).toMatch(/256/);
    expect(storageNote(512, relay(128 * MiB, { bwMbps: 50, stoMB: 128 }))).toMatch(/128/);
    expect(bandNote(50, relay(256 * MiB, { bwMbps: 20, stoMB: 256 }))).toMatch(/20/);
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

describe('salvar ajustes: só quando o dono muda algo', () => {
  const loaded = { limits: { bw: 50, sto: 256, hours: 'always' as const }, policies: { media: true, unknown: true, community: false } };

  it('o que acabou de ser lido do nó é igual ao que está na tela: não regrava (nem mostra "Salvo")', () => {
    expect(sameSettings(loaded, { limits: { ...loaded.limits }, policies: { ...loaded.policies } })).toBe(true);
    expect(sameSettings(null, loaded)).toBe(false);
  });

  it('qualquer mudança de limite ou de política conta', () => {
    expect(sameSettings(loaded, { ...loaded, limits: { ...loaded.limits, bw: 100 } })).toBe(false);
    expect(sameSettings(loaded, { ...loaded, limits: { ...loaded.limits, sto: 512 } })).toBe(false);
    expect(sameSettings(loaded, { ...loaded, policies: { ...loaded.policies, media: false } })).toBe(false);
  });
});

describe.each(LANGS.map(l => l.code))('regras do equipamento: espaço (%s)', lang => {
  beforeAll(() => setLang(lang, { persist: false }));

  it('1, 4 e 8 GB passam do que um nó guarda hoje: a tela diz o teto real', () => {
    for (const gb of [1, 4, 8]) expect(deviceStorageRuleNote(gb), `${gb} GB`).toMatch(/512/);
  });

  it('uma regra menor que o teto limitaria de verdade: sem aviso', () => {
    expect(deviceStorageRuleNote(0.25)).toBeNull();
  });
});
