/// <reference types="node" />
/**
 * Perfil e Nova conversa: data real do último backup e o que a busca aceita (nome, id, convite colado).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeCard } from '../../messaging/card';
import { deriveIdentity, newSeed } from '../../protocol/keys';
import { backupLabel } from '../backupStatus';
import { inviteLink } from '../inviteLink';
import { matchesId, readSearch } from '../searchInput';

test('backup: "Feito em …" com a data real, "Ainda não feito" sem backup', () => {
  const now = new Date(2026, 10, 3, 15, 0).getTime();
  assert.equal(backupLabel(null, false, now), 'Ainda não feito');
  assert.equal(backupLabel(null, true, now), 'Feito (data não registrada)', 'versões antigas só guardavam "feito"');
  assert.equal(backupLabel({ at: new Date(2026, 10, 3, 8, 0).getTime(), how: 'file' }, true, now), 'Feito hoje · arquivo');
  assert.equal(backupLabel({ at: new Date(2026, 10, 2, 23, 59).getTime(), how: 'phrase' }, true, now), 'Feito ontem · frase');
  assert.equal(backupLabel({ at: new Date(2026, 8, 7).getTime(), how: 'phrase' }, true, now), 'Feito em 07/09 · frase');
  assert.equal(backupLabel({ at: new Date(2025, 11, 25).getTime(), how: 'file' }, true, now), 'Feito em 25/12/2025 · arquivo');
});

test('busca de Nova conversa: cartão, link de convite, convite de grupo, id e nome', () => {
  const me = deriveIdentity(newSeed(), 'public');
  const card = encodeCard(me, 'Cardeal', { code: '0011223344556677', expiresAt: 1_800_086_400 });
  assert.deepEqual(readSearch(card), { kind: 'card', card });
  assert.deepEqual(readSearch(`Oi! Abra: ${inviteLink(card)}`), { kind: 'card', card }, 'link piu:// dentro de uma mensagem');
  assert.deepEqual(readSearch('piug:eyJjIjoi'), { kind: 'group', link: 'piug:eyJjIjoi' });
  assert.deepEqual(readSearch('  '), { kind: 'empty' });
  assert.deepEqual(readSearch('Ana'), { kind: 'name', term: 'ana' });
  assert.deepEqual(readSearch('@' + me.id.toUpperCase().replace('PIU:', 'piu:')), { kind: 'id', id: me.id });
  // Impressão digital em blocos (como no Perfil): vira o id.
  const fp = me.id.slice(4).toUpperCase().match(/.{4}/g)!.slice(0, 3).join(' ');
  const r = readSearch(fp);
  assert.equal(r.kind, 'id');
  assert.ok(r.kind === 'id' && matchesId(me.id, r.id));
  assert.ok(!matchesId(me.id, 'piu:'), 'prefixo curto demais não casa');
  assert.ok(!matchesId(undefined, me.id));
  // Palavra comum sem dígitos não vira id (ex.: nomes como "Abel" ou "Cafe").
  assert.equal(readSearch('cafebabe').kind, 'name');
});
