import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ContactInfo } from '../src/shared/types';
import {
  burstParticles, FEE_ESTIMATE_LUNES, fmtLunes, headerLunesAddr, OTHER_ID, parseAmount, planckToNumber, QUICK_AMOUNTS, recipientsFrom, sanitizeAmount, sendModel, shortLunesAddr, statusBadge,
} from '../src/renderer/walletSend';

const contact = (id: string, name: string, lunesAddress?: string): ContactInfo => ({ id, name, via: 'public', request: false, ...(lunesAddress ? { lunesAddress } : {}) });
const ADDR = '6iUb9rXg2AiDh1Sq6uRzpqjSvgZ6NPayojzGM6zh33vZ4Gse';

describe('formatação pt-BR (fmt do protótipo)', () => {
  it('duas casas, vírgula decimal e ponto de milhar', () => {
    assert.equal(fmtLunes(58.4), '58,40');
    assert.equal(fmtLunes(5), '5,00');
    assert.equal(fmtLunes(1234567.891), '1.234.567,89');
    assert.equal(fmtLunes(0), '0,00');
  });
  it('planck (texto da ponte) vira LUNES; sem leitura é 0', () => {
    assert.equal(planckToNumber('5840000000'), 58.4);
    assert.equal(planckToNumber(null), 0);
  });
  it('endereço curto como no protótipo: 8 iniciais … 8 finais', () => {
    assert.equal(shortLunesAddr(ADDR), '6iUb9rXg…33vZ4Gse');
  });
  it('endereço do topo da página como no protótipo (lunes:7f3a…c19e): 4 iniciais … 4 finais', () => {
    assert.equal(headerLunesAddr(ADDR), 'lunes:6iUb…4Gse');
  });
});

describe('valor digitado', () => {
  it('aceita só dígitos, vírgula e ponto', () => {
    assert.equal(sanitizeAmount('1a2,5x'), '12,5');
    assert.equal(sanitizeAmount('abc'), '');
  });
  it('vírgula é decimal; vazio ou lixo vira 0', () => {
    assert.equal(parseAmount('5'), 5);
    assert.equal(parseAmount('2,5'), 2.5);
    assert.equal(parseAmount('2.5'), 2.5);
    assert.equal(parseAmount(''), 0);
    assert.equal(parseAmount(','), 0);
  });
  it('chips são exatamente 1 · 5 · 10 · 25 e a taxa é a da Mainnet', () => {
    assert.deepEqual(QUICK_AMOUNTS, [1, 5, 10, 25]);
    assert.ok(FEE_ESTIMATE_LUNES > 0.001 && FEE_ESTIMATE_LUNES < 0.002);
  });
});

describe('destinatários a partir dos contatos reais', () => {
  it('só contatos com endereço Lunes entram, no máximo 3, sempre com "Outro" no fim (4 lugares, como no protótipo)', () => {
    const list = [contact('piu:1', 'Marina Alves', ADDR), contact('piu:2', 'Ana Costa'), contact('piu:3', 'Pedro Lima', ADDR), contact('piu:4', 'João Souza', ADDR), contact('piu:5', 'Bia', ADDR), contact('piu:6', 'Caio', ADDR)];
    const r = recipientsFrom(list);
    assert.deepEqual(r.map(x => x.id), ['piu:1', 'piu:3', 'piu:4', OTHER_ID]);
    assert.equal(r[0]!.ini, 'MA'); assert.equal(r[0]!.first, 'Marina'); assert.equal(r[0]!.name, 'Marina Alves');
    assert.equal(r.at(-1)!.first, 'Outro');
  });
  it('grupos e pedidos de conversa ficam de fora; sem contato com endereço só resta "Outro"', () => {
    const list = [{ ...contact('piu:g', 'Grupo', ADDR), kind: 'group' as const }, { ...contact('piu:r', 'Pedido', ADDR), request: true }, contact('piu:x', 'Sem endereço')];
    assert.deepEqual(recipientsFrom(list).map(x => x.id), [OTHER_ID]);
  });
  it('o contato pedido (botão de pagar da conversa) entra na lista mesmo se estiver além dos 3 primeiros', () => {
    const list = [contact('piu:1', 'Marina Alves', ADDR), contact('piu:3', 'Pedro Lima', ADDR), contact('piu:4', 'João Souza', ADDR), contact('piu:5', 'Bia', ADDR)];
    assert.deepEqual(recipientsFrom(list, 'piu:5').map(x => x.id), ['piu:5', 'piu:1', 'piu:3', OTHER_ID]);
    assert.deepEqual(recipientsFrom(list, 'piu:3').map(x => x.id), ['piu:1', 'piu:3', 'piu:4', OTHER_ID]);
    assert.deepEqual(recipientsFrom(list, 'piu:x').map(x => x.id), ['piu:1', 'piu:3', 'piu:4', OTHER_ID]);
  });
});

describe('modelo do painel Enviar', () => {
  const recipients = recipientsFrom([contact('piu:1', 'Marina Alves', ADDR)]);
  it('estado do protótipo: Marina, 5 LUNES, chip 5 ativo, botão a 100%', () => {
    const m = sendModel({ recipients, to: 'piu:1', other: '', amount: '5', balance: 58.4, hidden: false });
    assert.equal(m.toLabel, 'Marina Alves');
    assert.equal(m.dest, ADDR);
    assert.deepEqual(m.quick.map(q => q.active), [false, true, false, false]);
    assert.equal(m.available, '58,40');
    assert.equal(m.ok, true); assert.equal(m.error, null); assert.equal(m.buttonOpacity, 1);
    assert.equal(m.sentLabel, '5,00 LUNES para Marina Alves');
  });
  it('valor maior que o saldo: aviso e botão a 35%', () => {
    const m = sendModel({ recipients, to: 'piu:1', other: '', amount: '80', balance: 58.4, hidden: false });
    assert.equal(m.ok, false); assert.equal(m.error, 'Valor maior que o saldo disponível'); assert.equal(m.buttonOpacity, 0.35);
  });
  it('valor zero não envia mas não mostra o aviso de saldo', () => {
    const m = sendModel({ recipients, to: 'piu:1', other: '', amount: '', balance: 58.4, hidden: false });
    assert.equal(m.ok, false); assert.equal(m.error, null); assert.equal(m.buttonOpacity, 0.35);
  });
  it('saldo oculto mostra •••• no Disponível', () => {
    assert.equal(sendModel({ recipients, to: 'piu:1', other: '', amount: '5', balance: 58.4, hidden: true }).available, '••••');
  });
  it('"Outro": o endereço digitado vale e precisa ser válido; o rótulo é o endereço curto', () => {
    const bad = sendModel({ recipients, to: OTHER_ID, other: 'xyz', amount: '5', balance: 58.4, hidden: false });
    assert.equal(bad.ok, false); assert.equal(bad.dest, null); assert.equal(bad.toLabel, '—');
    const good = sendModel({ recipients, to: OTHER_ID, other: ` ${ADDR} `, amount: '5', balance: 58.4, hidden: false });
    assert.equal(good.ok, true); assert.equal(good.dest, ADDR); assert.equal(good.toLabel, '6iUb9rXg…33vZ4Gse');
    assert.equal(good.sentLabel, '5,00 LUNES para 6iUb9rXg…33vZ4Gse');
  });
  it('"Outro": aceita o endereço colado com o prefixo lunes:', () => {
    const m = sendModel({ recipients, to: OTHER_ID, other: `lunes:${ADDR}`, amount: '5', balance: 58.4, hidden: false });
    assert.equal(m.dest, ADDR); assert.equal(m.ok, true); assert.equal(m.destError, null);
  });
  it('"Outro": endereço digitado e inválido avisa; vazio não avisa', () => {
    assert.equal(sendModel({ recipients, to: OTHER_ID, other: 'xyz', amount: '5', balance: 58.4, hidden: false }).destError, 'Endereço Lunes inválido');
    assert.equal(sendModel({ recipients, to: OTHER_ID, other: '  ', amount: '5', balance: 58.4, hidden: false }).destError, null);
    assert.equal(sendModel({ recipients, to: 'piu:1', other: 'xyz', amount: '5', balance: 58.4, hidden: false }).destError, null);
  });
  it('Disponível pronto para exibir: "58,40 LUNES", "•••• LUNES" oculto e só "—" sem leitura', () => {
    assert.equal(sendModel({ recipients, to: 'piu:1', other: '', amount: '5', balance: 58.4, hidden: false }).availableText, '58,40 LUNES');
    assert.equal(sendModel({ recipients, to: 'piu:1', other: '', amount: '5', balance: 58.4, hidden: true }).availableText, '•••• LUNES');
    assert.equal(sendModel({ recipients, to: 'piu:1', other: '', amount: '5', balance: null, hidden: false }).availableText, '—');
  });
});

describe('sucesso e selos', () => {
  it('14 partículas no círculo, raios 80/102/124 e atrasos (i%4)·0,03 s', () => {
    const b = burstParticles();
    assert.equal(b.length, 14);
    assert.deepEqual(b[0], { x: '80px', y: '0px', delay: '0s' });
    assert.equal(b[1]!.delay, '0.03s'); assert.equal(b[4]!.delay, '0s');
    assert.equal(Math.round(Math.hypot(parseFloat(b[2]!.x), parseFloat(b[2]!.y))), 124);
  });
  it('selo da linha é o estado real do pedido, em português', () => {
    assert.equal(statusBadge('waiting'), 'aguardando o celular');
    assert.equal(statusBadge('submitted'), 'enviado à Mainnet');
    assert.equal(statusBadge('finalized'), '');
    assert.equal(statusBadge('failed'), 'falhou');
  });
});

describe('saldo ainda não lido', () => {
  it('sem leitura da Mainnet não compara, não envia e mostra "—" no Disponível', async () => {
    const { recipientsFrom, sendModel } = await import('../src/renderer/walletSend');
    const recipients = recipientsFrom([]);
    const m = sendModel({ recipients, to: 'other', other: '6iUb9rXg2AiDh1Sq6uRzpqjSvgZ6NPayojzGM6zh33vZ4Gse', amount: '5', balance: null, hidden: false });
    assert.equal(m.ok, false); assert.equal(m.error, null); assert.equal(m.available, '—'); assert.equal(m.buttonOpacity, 0.35);
    assert.equal(sendModel({ recipients, to: 'other', other: '', amount: '5', balance: null, hidden: true }).available, '••••');
  });
});
