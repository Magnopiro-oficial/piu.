/// <reference types="node" />
/**
 * Alertas oficiais (CAP) no celular: o que o nó manda é conferido, filtrado por vigência e pela
 * região escolhida (UF pelo código IBGE ou pelo texto da área, sem GPS), e só os severos e
 * extremos viram notificação, uma vez. A tela de bloqueio mostra as mensagens reais não lidas
 * conforme a pré-visualização.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inRegion, mergeAlerts, type OfficialAlert, sanitizeAlert, sourceLabel, toNotify, visibleAlerts } from '../alertsCore';
import { lockItems, lockTime } from '../lockFeed';
import { NodeApi, type NodeRequest, SESSION_COOKIE } from '../nodeApi';
import type { Chat } from '../../data/types';

const T0 = Date.parse('2026-11-03T12:00:00-03:00');

/** Formato de `GET /api/alerts` do piu-node para o CAP do INMET (apps/piu-node/test/fixtures/cap). */
const tempestade = {
  id: 'cap@inmet.gov.br|urn:oid:2.49.0.1.76.0.2026.11.3.1.1', identifier: 'urn:oid:2.49.0.1.76.0.2026.11.3.1.1', sender: 'cap@inmet.gov.br',
  sent: '2026-11-03T10:00:00-03:00', msgType: 'Alert', references: [],
  info: {
    language: 'pt-BR', senderName: 'INMET', event: 'Tempestade', severity: 'Severe', urgency: 'Immediate', certainty: 'Likely',
    headline: 'Aviso de Tempestade', description: 'Chuva entre 30 e 60 mm/h.', instruction: 'Não se abrigue debaixo de árvores.', web: 'https://alertas2.inmet.gov.br',
    effective: '2026-11-03T10:00:00-03:00', onset: '', expires: '2026-11-04T10:00:00-03:00',
    areas: [{ areaDesc: 'Aviso para as Áreas: Metropolitana de São Paulo, Vale do Paraíba Paulista', geocodes: [{ valueName: 'TMUNICIPIO', value: '3550308' }] }],
  },
  source: { feed: 'http://alert-as.inmet.gov.br/cap_12/rss/alert-as.rss', url: 'http://alert-as.inmet.gov.br/cap_12/xml/2026/11/03/tempestade-teste.xml' },
  receivedAt: T0 - 60_000,
};
const umidade = {
  ...tempestade, id: 'cap@inmet.gov.br|umidade', identifier: 'umidade', sent: '2026-11-03T09:00:00-03:00',
  info: { ...tempestade.info, event: 'Baixa Umidade', headline: 'Aviso de Baixa Umidade', severity: 'Moderate', expires: '2026-11-03T20:00:00-03:00',
    areas: [{ areaDesc: 'Centro Goiano, Leste Goiano', geocodes: [{ valueName: 'TMUNICIPIO', value: '5208707' }] }] },
};
const semCodigo = {
  ...tempestade, id: 'x|ms', identifier: 'ms', info: { ...tempestade.info, severity: 'Extreme', headline: 'Onda de calor', areas: [{ areaDesc: 'Pantanal Sul-Mato-Grossense - MS', geocodes: [] }] },
};
const mt = { ...semCodigo, id: 'x|mt', identifier: 'mt', info: { ...semCodigo.info, areas: [{ areaDesc: 'Estado de Mato Grosso do Sul', geocodes: [] }] } };

const clean = (raws: unknown[], via = 'Galpão', now = T0) => raws.map(r => sanitizeAlert(r, via, now)).filter((a): a is OfficialAlert => !!a);

test('o que vem do nó é conferido: sem o essencial, cancelado ou vencido não entra', () => {
  const [a] = clean([tempestade]);
  assert.equal(a!.via, 'Galpão');
  assert.equal(a!.until, Date.parse('2026-11-04T10:00:00-03:00'));
  assert.equal(sanitizeAlert({ ...tempestade, sender: '' }, 'n', T0), null);
  assert.equal(sanitizeAlert({ ...tempestade, msgType: 'Cancel' }, 'n', T0), null);
  assert.equal(sanitizeAlert(tempestade, 'n', Date.parse('2026-11-05T00:00:00Z')), null, 'vencido');
  assert.equal(sanitizeAlert('lixo', 'n', T0), null);
  assert.equal(sanitizeAlert({ ...tempestade, info: { ...tempestade.info, severity: 'Apocalíptica', web: 'javascript:alert(1)' } }, 'n', T0)!.info.web, '');
  // Sem `expires`: vale 24 h depois do `sent`.
  assert.equal(sanitizeAlert({ ...tempestade, info: { ...tempestade.info, expires: '' } }, 'n', T0)!.until, Date.parse(tempestade.sent) + 24 * 3600_000);
});

test('origem explícita: publicado em CAP pelo órgão, recebido pelo nó (sem dizer "assinado")', () => {
  const [a] = clean([tempestade]);
  assert.equal(sourceLabel(a!), 'Fonte: INMET (CAP) · recebido pelo seu Piu Node');
  assert.equal(sourceLabel({ ...a!, info: { ...a!.info, senderName: '' } }), 'Fonte: cap@inmet.gov.br (CAP) · recebido pelo seu Piu Node');
  assert.ok(!/assinad/i.test(sourceLabel(a!)));
});

test('região: UF pelo código IBGE, pelo nome ou sigla na área, e trecho da área; sem UF vale o Brasil', () => {
  const [t, u, ms, msName] = clean([tempestade, umidade, semCodigo, mt]);
  assert.equal(inRegion(t!, { uf: 'SP', area: '' }), true);
  assert.equal(inRegion(t!, { uf: 'RJ', area: '' }), false);
  assert.equal(inRegion(u!, { uf: 'GO', area: '' }), true);
  assert.equal(inRegion(ms!, { uf: 'MS', area: '' }), true, 'sigla na área');
  assert.equal(inRegion(msName!, { uf: 'MS', area: '' }), true, 'nome na área');
  assert.equal(inRegion(msName!, { uf: 'MT', area: '' }), false, '"Mato Grosso" não casa com "Mato Grosso do Sul"');
  assert.equal(inRegion(t!, { uf: 'SP', area: 'vale do paraiba' }), true, 'sem acento e sem caixa');
  assert.equal(inRegion(t!, { uf: 'SP', area: 'Baixada Santista' }), false);
  assert.equal(inRegion(u!, { uf: null, area: '' }), true);
  assert.deepEqual(visibleAlerts([u!, t!, ms!], { uf: null, area: '' }, T0).map(a => a.info.headline), ['Onda de calor', 'Aviso de Tempestade', 'Aviso de Baixa Umidade'], 'mais graves primeiro');
  assert.deepEqual(visibleAlerts([u!, t!], { uf: null, area: '' }, Date.parse('2026-11-03T21:00:00-03:00')).map(a => a.info.event), ['Tempestade'], 'umidade venceu às 20h');
});

test('junta com o guardado: o nó consultado manda a lista completa; vencido sai; outro nó continua', () => {
  const [t, u] = clean([tempestade, umidade]);
  const [other] = clean([semCodigo], 'Outro nó');
  const saved = [t!, u!, other!];
  // O Galpão respondeu só a tempestade (a umidade foi cancelada lá): sai; o alerta do outro nó fica.
  const merged = mergeAlerts(saved, clean([tempestade]), T0, ['Galpão']);
  assert.deepEqual(merged.map(a => a.id).sort(), [t!.id, other!.id].sort());
  assert.deepEqual(mergeAlerts(saved, [], Date.parse('2026-11-05T00:00:00Z')), []);
});

test('notifica só severos e extremos da região, uma vez cada', () => {
  const list = clean([tempestade, umidade, semCodigo]);
  const sp = { uf: 'SP' as const, area: '' };
  assert.deepEqual(toNotify(list, [], sp, T0).map(a => a.info.event), ['Tempestade'], 'umidade é moderada e de GO; MS fora da região');
  assert.deepEqual(toNotify(list, [tempestade.id], sp, T0), [], 'já notificado');
  assert.deepEqual(toNotify(list, [], { uf: null, area: '' }, T0).length, 2);
});

test('NodeApi.alerts(): GET /api/alerts com a sessão do celular', async () => {
  const log: NodeRequest[] = [];
  const base = 'https://piu-node.local:8420';
  const send = async (r: NodeRequest) => {
    log.push(r);
    if (r.headers.Cookie !== `${SESSION_COOKIE}=tok`) return { status: 401, headers: {}, body: JSON.stringify({ error: 'Sessão necessária.' }) };
    return { status: 200, headers: {}, body: JSON.stringify({ enabled: true, feeds: [], alerts: [tempestade] }) };
  };
  const api = new NodeApi({ base, pin: 'AB'.repeat(32), operator: 'Ana', send, session: { token: 'tok', csrf: 'c', at: 0 } });
  const r = await api.alerts();
  assert.equal(r.alerts![0]!.info.senderName, 'INMET');
  assert.equal(log[0]!.method, 'GET');
  assert.equal(log[0]!.url, base + '/api/alerts');
  assert.equal(log[0]!.headers.Origin, undefined, 'leitura: sem Origin/CSRF');
  await assert.rejects(new NodeApi({ base, pin: 'x', operator: 'Ana', send }).alerts(), /Sessão necessária/);
});

const NOTIFS = { msg: true, group: true, channel: true, nearby: true, wallet: true, network: false };
const chat = (p: Partial<Chat>): Chat => ({ id: 'c1', ident: 'public', kind: 'direct', name: 'Contato', initials: 'CO', time: '11:58', unread: 0, msgs: [], ...p });

test('tela de bloqueio: só notificações reais (não lidas), respeitando pré-visualização, tipos e silêncio', () => {
  assert.deepEqual(lockItems({ chats: [], preview: 'always', notifs: NOTIFS, now: T0 }), [], 'sem nada novo: vazio');
  const chats: Chat[] = [
    chat({ id: 'a', name: 'Ana', unread: 2, msgs: [{ id: 'm0', from: 'me', text: 'oi', time: '11:50' }, { id: 'in-1', from: 'them', text: 'tudo bem?', time: '11:55', at: T0 - 5 * 60_000 }, { id: 'in-2', from: 'them', text: 'chegou?', time: '11:58', at: T0 - 2 * 60_000 }] }),
    chat({ id: 'g', name: 'Mutirão', kind: 'group', unread: 1, msgs: [{ id: 'in-3', from: 'them', sender: 'Bia', text: 'amanhã 8h', time: '11:30', at: T0 - 30 * 60_000 }] }),
    chat({ id: 'mudo', name: 'Silenciada', unread: 3, muted: true, msgs: [{ id: 'in-4', from: 'them', text: 'x', time: '11:00' }] }),
    chat({ id: 'lida', name: 'Lida', unread: 0, msgs: [{ id: 'in-5', from: 'them', text: 'já li', time: '10:00' }] }),
    chat({ id: 'canal', name: 'Canal', kind: 'channel', unread: 1, msgs: [{ id: 'in-6', from: 'them', text: 'post', time: '09:00', at: T0 - 3 * 3600_000 }] }),
  ];
  const all = lockItems({ chats, preview: 'always', notifs: NOTIFS, now: T0 });
  assert.deepEqual(all.map(i => [i.title, i.body, i.more]), [['Ana', 'chegou?', 1], ['Mutirão', 'Bia: amanhã 8h', 0], ['Canal', 'post', 0]]);
  assert.deepEqual(all.map(i => lockTime(i, T0)), ['2 min', '30 min', '3 h']);
  assert.equal(all[0]!.href, '/chat/a');
  for (const preview of ['unlocked', 'never'] as const) {
    const hidden = lockItems({ chats, preview, notifs: NOTIFS, now: T0 });
    assert.deepEqual(hidden.map(i => [i.title, i.body]), [['Piu', 'Novas mensagens'], ['Piu', 'Nova mensagem'], ['Piu', 'Nova publicação']]);
    assert.ok(!JSON.stringify(hidden).match(/Ana|chegou|Bia|Mutirão/));
  }
  assert.deepEqual(lockItems({ chats, preview: 'always', notifs: { ...NOTIFS, group: false, channel: false }, now: T0 }).map(i => i.title), ['Ana'], 'tipos desligados ficam de fora');
  // Alerta oficial severo da região: sempre com conteúdo, no topo.
  const withAlert = lockItems({ chats, preview: 'never', notifs: NOTIFS, alerts: clean([tempestade, umidade]), region: { uf: 'SP', area: '' }, now: T0 });
  assert.deepEqual([withAlert[0]!.critical, withAlert[0]!.title], [true, 'Aviso de Tempestade']);
  assert.equal(withAlert.filter(i => i.critical).length, 1, 'moderado não aparece');
});
