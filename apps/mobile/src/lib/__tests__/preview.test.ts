/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannerFor } from '../preview';

const msg = { kind: 'msg' as const, av: 'MA', title: 'Marina Alves', body: 'Cheguei na praça!', hidden: { title: 'Piu', body: 'Nova mensagem' } };

test('11.2 prévia "Nunca": banner dentro do app sem remetente, avatar nem conteúdo', () => {
  const b = bannerFor(msg, 'never');
  assert.equal(b.title, 'Piu');
  assert.equal(b.body, 'Nova mensagem');
  assert.equal(b.av, undefined);
  assert.ok(!JSON.stringify({ ...b, hidden: undefined }).includes('Marina'));
  assert.ok(!JSON.stringify({ ...b, hidden: undefined }).includes('praça'));
  // Banner de conversa sem versão neutra (ex.: pedido de Por perto) também não vaza o nome.
  const near = bannerFor({ kind: 'nearby', title: 'Helena quer conversar', body: '+3,00 LUNES' }, 'never');
  assert.deepEqual([near.title, near.body], ['Piu', 'Novo pedido de conversa']);
  // Aviso que não é de conversa continua igual.
  assert.equal(bannerFor({ kind: 'wallet', title: 'Lote fechado', body: '5 LUNES' }, 'never').title, 'Lote fechado');
});

test('11.2 "Sempre" e "Só desbloqueado" mostram o banner inteiro (só aparece com o app aberto)', () => {
  assert.equal(bannerFor(msg, 'always').title, 'Marina Alves');
  assert.equal(bannerFor(msg, 'unlocked').body, 'Cheguei na praça!');
});
