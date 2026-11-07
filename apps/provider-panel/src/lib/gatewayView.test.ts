import { describe, expect, it } from 'vitest';
import { shortInbox, shortRef } from '../pages/Gateway';

describe('painel do gateway (E3)', () => {
  it('referência curta: 4 primeiros e 4 últimos hex, em maiúsculas, sem 0x', () => {
    expect(shortRef('0x8e41aa00bb11cc22dd33ee44ff5566778899aabbccddeeff00112233445c07a')).toBe('8E41 … C07A');
    expect(shortRef('abcd')).toBe('ABCD');
  });
  it('caixa do validador sem o esquema e sem a barra final', () => {
    expect(shortInbox('https://validador.example/caixa/')).toBe('validador.example/caixa');
    expect(shortInbox('HTTPS://v.example')).toBe('v.example');
  });
});
