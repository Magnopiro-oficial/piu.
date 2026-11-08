/// <reference types="node" />
/**
 * Conversas com dados reais: rota (meio, envelope, blocos, prioridade, histórico conforme a
 * Privacidade), separador de data, localização em texto curto, limpeza das prévias de mídia e nome
 * seguro para abrir um arquivo recebido.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Chat, Msg } from '../../data/types';
import { Priority } from '../../protocol/envelope';
import { dayLabel, daySeparators, msgSummary } from '../chatCore';
import { formatCoords, locationText, mapUrl, parseLocation, placeFromText } from '../locationCore';
import { safeFileName } from '../mediaCore';
import { buildRoute } from '../route';
import { addRoute, cleanBook, dropChatRoutes, fragmentsFor, lastRoute, makeRoute, patchRoute, pruneRoutes, ROUTE_HISTORY, routeLabel, routeOf, trimBook } from '../routeCore';
import { mediaBytes, previewBytes, stripPreviews } from '../storageCore';

const rec = (m: string, o: Partial<Parameters<typeof makeRoute>[0]> = {}) =>
  makeRoute({ msgId: m, dir: 'out', medium: 'ble', bytes: 1200, priority: Priority.Normal, at: 1, ...o });

test('rota: blocos pelo meio real (BLE 512 com cabeçalho de 8; Wi-Fi Direct cabe inteiro)', () => {
  assert.equal(fragmentsFor(504, 'ble'), 1);
  assert.equal(fragmentsFor(505, 'ble'), 2);
  assert.equal(fragmentsFor(16_500, 'ble'), 33);
  assert.equal(fragmentsFor(16_500, 'nearby'), 1);
  assert.equal(fragmentsFor(16_500, 'sim'), 1);
});

test('rota: rótulo como no design, com saltos só no recebimento', () => {
  assert.equal(routeLabel(rec('a')), 'Bluetooth LE');
  assert.equal(routeLabel(rec('a', { dir: 'in', hops: 1 })), 'Bluetooth LE · direto');
  assert.equal(routeLabel(rec('a', { dir: 'in', hops: 3, medium: 'nearby' })), 'Wi-Fi Direct · 3 saltos');
  assert.equal(routeLabel(rec('a', { medium: 'sim' })), 'Simulado');
});

test('rota: histórico por conversa (20) ou só a última, conforme "Não guardar rotas"', () => {
  let b = {};
  for (let i = 0; i < 25; i++) b = addRoute(b, 'c1', rec('m' + i), true);
  assert.equal((b as Record<string, unknown[]>).c1.length, ROUTE_HISTORY);
  assert.equal(lastRoute(b, 'c1')?.m, 'm24');
  assert.equal(routeOf(b, 'c1', 'm10')?.m, 'm10');
  assert.equal(routeOf(b, 'c1', 'm1'), undefined, 'os mais antigos saem');
  // A mesma mensagem não duplica.
  b = addRoute(b, 'c1', rec('m24', { bytes: 9 }), true);
  assert.equal((b as Record<string, unknown[]>).c1.length, ROUTE_HISTORY);
  assert.equal(lastRoute(b, 'c1')?.b, 9);
  const t = trimBook(b, false);
  assert.deepEqual(Object.values(t).map(l => l.length), [1]);
  assert.equal(lastRoute(t, 'c1')?.m, 'm24');
  let n = {};
  n = addRoute(n, 'c2', rec('x'), false);
  n = addRoute(n, 'c2', rec('y'), false);
  assert.deepEqual((n as Record<string, { m: string }[]>).c2.map(r => r.m), ['y'], 'ligado: só o mínimo para a tela');
  assert.deepEqual(dropChatRoutes(n, 'c2'), {});
});

test('rota: limpa mensagens que sumiram e conversas apagadas, mantendo a última', () => {
  let b = {};
  for (const m of ['a', 'b', 'c']) b = addRoute(b, 'c1', rec(m), true);
  b = addRoute(b, 'c9', rec('z'), true);
  const p = pruneRoutes(b, new Set(['b']), new Set(['c1']));
  assert.deepEqual((p as Record<string, { m: string }[]>).c1.map(r => r.m), ['b', 'c']);
  assert.equal('c9' in p, false);
  assert.equal(pruneRoutes(p, new Set(['b', 'c']), new Set(['c1'])), p, 'sem mudança, mesmo objeto');
});

test('rota: o que foi gravado é conferido ao ler', () => {
  const ok = rec('m1');
  const b = cleanBook({ c1: [ok, { m: 1 }, { ...ok, md: 'fax' }, null], c2: 'x', c3: [] });
  assert.deepEqual(b, { c1: [ok] });
  // Rotas pelo LoRa (Meshtastic e rádio do Piu) continuam depois de reabrir o app.
  const air = [rec('l1', { medium: 'lora' }), rec('l2', { medium: 'piulora' })];
  assert.deepEqual(cleanBook({ c1: air }), { c1: air });
  assert.deepEqual(cleanBook(null), {});
});

const chat: Chat = { id: 'p1', ident: 'public', kind: 'direct', name: 'Beto', initials: 'B', time: '', unread: 0, peer: 'piu:x' };

test('folha de rota: envelope, blocos e prioridade reais; sem registro, traço', () => {
  const m: Msg = { id: 'n1', from: 'me', text: 'Oi', time: '', status: 'entregue', at: Date.now() };
  const r = buildRoute(chat, m, rec('n1', { bytes: 1200 }));
  const meta = Object.fromEntries(r.meta.map(x => [x.l, x.v]));
  assert.equal(meta.Envelope, '1 KB');
  assert.equal(meta.Fragmentos, '3 de 3');
  assert.equal(meta.Prioridade, 'Normal');
  assert.equal(r.hops[0].via, 'Bluetooth LE');
  assert.equal(r.hops[0].viaIcon, 'bluetooth');
  assert.equal(r.hops[1].reached, true);
  const q = buildRoute(chat, { ...m, status: 'aguardando' });
  const qm = Object.fromEntries(q.meta.map(x => [x.l, x.v]));
  assert.equal(qm.Envelope, '—');
  assert.equal(qm.Fragmentos, '—');
  assert.equal(q.hops[0].via, 'aguardando rota');
  assert.equal(q.hops[1].reached, false);
  // Canal com prioridade alta: vale para o que ainda não tem registro; o registro manda.
  assert.equal(Object.fromEntries(buildRoute(chat, { ...m, status: 'aguardando' }, undefined, Priority.High).meta.map(x => [x.l, x.v])).Prioridade, 'Alta');
  assert.equal(Object.fromEntries(buildRoute(chat, m, rec('n1', { priority: Priority.High })).meta.map(x => [x.l, x.v])).Prioridade, 'Alta');
  // Recebida: vem do outro lado, com os saltos reais.
  const inn = buildRoute(chat, { id: 'in-1', from: 'them', text: 'Oi', time: '' }, rec('in-1', { dir: 'in', hops: 2, medium: 'nearby' }));
  assert.deepEqual(inn.hops.map(h => h.n), ['Beto', 'Você']);
  assert.equal(inn.hops[0].via, 'Wi-Fi Direct · 2 saltos');
});

test('rota pelo LoRa (desenho 4b): celular → rádio por Bluetooth LE, depois LoRa; pedaços de 226 bytes', () => {
  const m: Msg = { id: 'l1', from: 'me', text: 'Oi', time: '', status: 'entregue', at: Date.now() };
  const out = buildRoute(chat, m, rec('l1', { medium: 'lora', bytes: 593 }));
  assert.deepEqual(out.hops.map(h => h.n), ['Você', 'Rádio Meshtastic', 'Beto']);
  assert.deepEqual(out.hops.slice(0, 2).map(h => h.via), ['Bluetooth LE', 'via LoRa (Meshtastic)']);
  assert.deepEqual(out.hops.slice(0, 2).map(h => h.viaIcon), ['bluetooth', 'settings_input_antenna']);
  assert.deepEqual(out.hops.map(h => h.reached), [true, true, true]);
  assert.equal(Object.fromEntries(out.meta.map(x => [x.l, x.v])).Fragmentos, '3 de 3');
  const inn = buildRoute(chat, { id: 'l2', from: 'them', text: 'Oi', time: '' }, rec('l2', { dir: 'in', medium: 'lora', bytes: 593 }));
  assert.deepEqual(inn.hops.map(h => h.n), ['Beto', 'Rádio Meshtastic', 'Você']);
  assert.deepEqual(inn.hops.slice(0, 2).map(h => h.via), ['via LoRa (Meshtastic)', 'Bluetooth LE']);
  // Ainda sem confirmação: o rádio recebeu, o destino não.
  const wait = buildRoute(chat, { ...m, status: 'encaminhada' }, rec('l1', { medium: 'lora', bytes: 593 }));
  assert.deepEqual(wait.hops.map(h => h.reached), [true, true, false]);
});

test('rota pelo LoRa: quando o Automático trocou de rádio, uma linha diz por quê (desenho Piu 17, 5 · M)', () => {
  const m: Msg = { id: 'l1', from: 'me', text: 'Oi', time: '', status: 'entregue', at: Date.now() };
  assert.equal(buildRoute(chat, m, { ...rec('l1', { medium: 'lora' }), w: 'away' }).why, 'Automático: o rádio do Piu estava fora do alcance, seguiu pelo Meshtastic.');
  assert.equal(buildRoute(chat, m, { ...rec('l1', { medium: 'lora' }), w: 'failed' }).why, 'Automático: o rádio do Piu falhou ao enviar, seguiu pelo Meshtastic.');
  assert.equal(buildRoute(chat, m, rec('l1', { medium: 'lora' })).why, undefined, 'sem troca, sem linha');
  assert.equal(buildRoute(chat, m, rec('l1', { medium: 'piulora' })).why, undefined);
  // O transporte confirma o meio depois do envio: o registro troca de rádio e guarda o porquê.
  let b = addRoute({}, 'p1', rec('l1', { medium: 'piulora' }), true);
  b = patchRoute(b, 'p1', 'l1', { medium: 'lora', fallback: 'away' });
  assert.deepEqual([b.p1![0]!.md, b.p1![0]!.w], ['lora', 'away']);
  assert.equal(patchRoute(b, 'p1', 'l1', { medium: 'lora', fallback: 'away' }), b, 'sem mudança, mesmo objeto');
  assert.equal(patchRoute(b, 'p1', 'l1', { medium: 'piulora' }).p1![0]!.w, undefined, 'pelo rádio do Piu, sem linha');
  assert.equal(patchRoute(b, 'p9', 'x', { medium: 'lora' }), b);
  // Gravado: o motivo é conferido ao ler.
  const ok = { ...rec('m1', { medium: 'lora' }), w: 'away' as const };
  assert.deepEqual(cleanBook({ c1: [ok, { ...ok, w: 'outro' }] }), { c1: [ok] });
});

test('separador de data: Hoje, Ontem e data por extenso; agrupa por dia', () => {
  const now = new Date(2026, 10, 3, 15, 0).getTime();
  assert.equal(dayLabel(new Date(2026, 10, 3, 0, 5).getTime(), now), 'Hoje');
  assert.equal(dayLabel(new Date(2026, 10, 2, 23, 59).getTime(), now), 'Ontem');
  assert.equal(dayLabel(new Date(2026, 2, 12, 9).getTime(), now), '12 de março');
  assert.equal(dayLabel(new Date(2025, 11, 31, 9).getTime(), now), '31 de dezembro de 2025');
  // Virada de mês: 1º de novembro → ontem é 31 de outubro.
  assert.equal(dayLabel(new Date(2026, 9, 31, 10).getTime(), new Date(2026, 10, 1, 8).getTime()), 'Ontem');
  const at = (d: number, h: number) => new Date(2026, 10, d, h).getTime();
  assert.deepEqual(daySeparators([{}, { at: at(1, 9) }, { at: at(1, 18) }, {}, { at: at(3, 8) }, { at: at(3, 9) }], now), [null, '1 de novembro', null, null, 'Hoje', null]);
});

test('localização: digitada ou colada de link de mapa; fora da faixa não vale', () => {
  assert.deepEqual(parseLocation('-23.550521, -46.633308'), { lat: -23.55052, lon: -46.63331 });
  assert.deepEqual(parseLocation('-23,5505 -46,6333'), { lat: -23.5505, lon: -46.6333 });
  assert.deepEqual(parseLocation('-23.5505;-46.6333'), { lat: -23.5505, lon: -46.6333 });
  assert.deepEqual(parseLocation('geo:-22.9068,-43.1729'), { lat: -22.9068, lon: -43.1729 });
  assert.deepEqual(parseLocation('https://www.google.com/maps/place/X/@-22.9519,-43.2105,17z'), { lat: -22.9519, lon: -43.2105 });
  assert.deepEqual(parseLocation('https://maps.google.com/?q=-22.95,-43.21'), { lat: -22.95, lon: -43.21 });
  assert.deepEqual(parseLocation('https://maps.apple.com/?ll=-22.95%2C-43.21'), { lat: -22.95, lon: -43.21 });
  assert.deepEqual(parseLocation('https://www.openstreetmap.org/?mlat=-22.95&mlon=-43.21#map=17'), { lat: -22.95, lon: -43.21 });
  assert.equal(parseLocation('91, 10'), null);
  assert.equal(parseLocation('10, 181'), null);
  assert.equal(parseLocation('praça da matriz'), null);
  assert.equal(parseLocation(''), null);
  const l = { lat: -22.9, lon: -43.2 };
  assert.equal(formatCoords(l), '-22.90000, -43.20000');
  assert.equal(locationText(l, '  Portão   do galpão '), 'Portão do galpão');
  assert.equal(locationText(l, ''), '-22.90000, -43.20000', 'sem nome, as coordenadas vão como texto');
  assert.equal(placeFromText(l, '-22.90000, -43.20000'), '');
  assert.equal(placeFromText(l, 'Galpão'), 'Galpão');
  assert.equal(mapUrl(l, 'android'), 'geo:-22.9,-43.2?q=-22.9,-43.2');
  assert.match(mapUrl(l, 'ios'), /^https:\/\/maps\.apple\.com\/\?ll=-22\.9,-43\.2/);
  assert.equal(msgSummary({ text: '', loc: l }), 'Localização: -22.90000, -43.20000');
  assert.equal(msgSummary({ text: 'Galpão', loc: l }), 'Localização: Galpão');
});

test('limpar cache de mídia: tira as prévias embutidas e o número cai de verdade', () => {
  const photo = 'data:image/jpeg;base64,' + 'A'.repeat(4000);
  const chats: Chat[] = [
    { ...chat, photo, msgs: [
      { id: 'f1', from: 'them', text: '', time: '', file: { name: 'a.jpg', mb: 0.1, blocks: 1, icon: 'image', done: 1, state: 'verified', incoming: true, preview: photo } },
      { id: 't1', from: 'me', text: 'oi', time: '' },
    ] },
    { ...chat, id: 'p2', msgs: [{ id: 't2', from: 'them', text: 'sem mídia', time: '' }] },
  ];
  const before = mediaBytes(chats);
  assert.equal(previewBytes(chats), photo.length);
  const r = stripPreviews(chats);
  assert.equal(r.freed, photo.length);
  assert.equal(previewBytes(r.chats), 0);
  assert.equal(mediaBytes(r.chats), before - photo.length, 'a foto do perfil do contato não é cache de mídia');
  const f = r.chats[0].msgs![0].file!;
  assert.equal(f.preview, undefined);
  assert.equal(f.purged, true);
  assert.equal(r.chats[0].msgs![1], chats[0].msgs![1], 'mensagens de texto ficam iguais');
  assert.equal(r.chats[1], chats[1]);
  assert.equal(msgSummary(r.chats[0].msgs![0]), 'Mídia apagada: a.jpg');
  assert.equal(stripPreviews(r.chats).freed, 0);
});

test('abrir arquivo recebido: nome seguro para o temporário', () => {
  assert.equal(safeFileName('../../etc/passwd'), '_.._etc_passwd');
  assert.equal(safeFileName('.oculto'), 'oculto');
  assert.equal(safeFileName('foto', 'image/jpeg'), 'foto.jpg');
  assert.equal(safeFileName('relatorio.pdf', 'application/pdf'), 'relatorio.pdf');
  assert.equal(safeFileName('', 'text/plain'), 'arquivo.txt');
  assert.equal(safeFileName('a\u0000b\nc.txt'), 'a_b_c.txt');
  const long = safeFileName('x'.repeat(200) + '.jpeg');
  assert.equal(long.length, 80);
  assert.ok(long.endsWith('.jpeg'));
});


test('rota: prazo temporário limita a fila e não promete 48 h para uma mensagem de 24 h', () => {
  const now = Date.now();
  const waiting: Msg = { id: 'temp', from: 'me', text: 'oi', time: '', status: 'aguardando', at: now - 2 * 3_600_000, expiresAt: now + 22 * 3_600_000 };
  const meta = (m: Msg) => Object.fromEntries(buildRoute(chat, m).meta.map(x => [x.l, x.v]));
  assert.equal(meta(waiting)['Expira em'], '22 h');
  assert.equal(meta({ ...waiting, status: 'expirada' })['Expira em'], '24 h esgotadas');
  assert.equal(meta({ ...waiting, expiresAt: now - 1 })['Expira em'], '0 h');
  assert.equal(meta({ ...waiting, expiresAt: now + 7 * 86400_000 })['Expira em'], '46 h');
  assert.equal(meta({ ...waiting, status: 'lida' })['Cópias em trânsito'], 'removida');
});
