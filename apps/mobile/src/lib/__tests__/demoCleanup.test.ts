/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Chat } from '../../data/types';
import { cleanBlocked, cleanChats, cleanProfile, cleanVerified, DEMO_CHAT_IDS, DEMO_PROFILE_NAME, isRealChat } from '../demoCleanup';

const base = { ident: 'public', kind: 'direct', initials: 'X', time: '10:00', unread: 0 } as const;
// Como as versões antigas salvavam: as conversas de exemplo (sem contato nem grupo) e um canal só local.
const demo: Chat[] = [
  ...DEMO_CHAT_IDS.map(id => ({ ...base, id, name: id, msgs: [{ id: id + '1', from: 'them' as const, text: 'exemplo', time: '09:00' }] })),
  { ...base, id: 'ch1700000000000', kind: 'channel', name: 'Canal local', owner: true },
];
const real: Chat[] = [
  { ...base, id: 'pabc', peer: 'piu:abcdef0123', name: 'Aparelho de teste', msgs: [{ id: 'n1', from: 'me', text: 'oi', time: '10:01', status: 'entregue' }] },
  { ...base, id: 'pdef', peer: 'piu:def456', name: 'Pedido', request: true },
  { ...base, id: 'g0011', group: '00112233445566778899aabbccddeeff', kind: 'group', name: 'Grupo real' },
  { ...base, id: 'g2233', group: '2233', kind: 'community', name: 'Comunidade real', ident: 'anon' },
];

test('migração: remove as conversas de exemplo e mantém as reais, na mesma ordem e intactas', () => {
  const saved = [demo[0], real[0], ...demo.slice(1, 5), real[1], real[2], ...demo.slice(5), real[3]];
  const out = cleanChats(saved);
  assert.deepEqual(out, real);
  assert.equal(out[0], real[0], 'não copia nem altera as reais');
  assert.deepEqual(cleanChats(real), real, 'só reais: nada muda');
  assert.deepEqual(cleanChats(cleanChats(saved)), real, 'idempotente');
});

test('migração: tolera o que vier do disco ou de um backup antigo', () => {
  assert.deepEqual(cleanChats(undefined), []);
  assert.deepEqual(cleanChats({ chats: real }), []);
  assert.deepEqual(cleanChats([null, 3, 'x', { peer: 'piu:1' }, ...real]), real, 'sem id não é conversa');
  assert.equal(isRealChat({ peer: 'marina' }), false, 'peer precisa ser uma chave piu:');
  assert.equal(isRealChat({ group: '' }), false);
  assert.equal(isRealChat(null), false);
});

test('migração: bloqueios só de contatos reais, verificações só de conversas que ficaram', () => {
  const blocked = [{ id: 'ana', name: 'Ana' }, { id: 'piu:abcdef0123', name: 'Real' }, { id: 'pedro', name: 'Pedro' }];
  assert.deepEqual(cleanBlocked(blocked), [{ id: 'piu:abcdef0123', name: 'Real' }]);
  assert.deepEqual(cleanBlocked('lixo'), []);
  const verified = { marina: true, ana: true, pabc: true, pdef: false, g0011: true };
  assert.deepEqual(cleanVerified(verified, cleanChats([...demo, ...real])), { pabc: true, g0011: true });
  assert.deepEqual(cleanVerified(null, real), {});
});

test('perfil: o nome de exemplo só sai antes do onboarding', () => {
  const p = { idType: 'public', name: DEMO_PROFILE_NAME, photo: null };
  assert.deepEqual(cleanProfile(p, false), { ...p, name: '' });
  assert.equal(cleanProfile(p, true), p, 'depois do onboarding o nome é da pessoa');
  const mine = { idType: 'public', name: 'Joana' };
  assert.equal(cleanProfile(mine, false), mine);
});
