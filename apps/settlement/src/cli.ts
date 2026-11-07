/**
 * Linha de comando do liquidante.
 *
 *   npm run mainnet:check [-- --ws wss://…]          só leitura: confere a chain contra o esperado
 *   npm run lot:plan -- lote.json [--ws …] [--from 5…] valida o lote; com --ws, estima taxa e saldo
 *   npm run lot:pay -- lote.json --confirm <id> [--ws …] [--journal dir] [--dir dados | --manual]
 *                                                     paga (precisa da conta pagadora, ver signer.ts).
 *                                                     Lote v2 é conferido contra dados/validador.json
 *                                                     (binding.ts); lote sem vínculo só com --manual.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { encodeAddress } from '@polkadot/util-crypto';
import { checkLotBinding } from './binding.js';
import { checkEndpoints, EXPECTED, expectedGenesis, preflight } from './chain.js';
import { Journal } from './journal.js';
import { planLot } from './lot.js';
import { connect, MAINNET_ENDPOINTS, PolkadotChain } from './polkadot.js';
import { payLot } from './settler.js';
import { loadSigner } from './signer.js';
import { planckToLunes } from './units.js';
import type { ValidatorState } from './validator.js';

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const endpoints = () => checkEndpoints((opt('ws') ?? process.env.PIU_SETTLEMENT_WS ?? MAINNET_ENDPOINTS.join(',')).split(',').map(s => s.trim()).filter(Boolean));
const ok = (good: boolean) => (good ? 'ok' : 'DIFERENTE');

async function check() {
  const api = await connect(endpoints());
  try {
    const chain = new PolkadotChain(api);
    const info = await chain.info();
    const ms = await chain.measuredBlockMs();
    const someone = encodeAddress(randomBytes(32), 42);
    const fee = BigInt((await api.tx.balances.transferKeepAlive(someone, 10n ** 8n).paymentInfo(someone)).partialFee.toString());
    const has = (s: string, m: string) => !!(api.tx as Record<string, Record<string, unknown>>)[s]?.[m];
    const rows: [string, string, string][] = [
      ['chain', info.chain, ''],
      ['runtime', `${info.specName} v${info.specVersion}`, ok(info.specName === EXPECTED.specName)],
      ['gênese', info.genesisHash, ok(info.genesisHash === expectedGenesis())],
      ['moeda', `${info.symbol}, ${info.decimals} casas`, ok(info.symbol === EXPECTED.symbol && info.decimals === EXPECTED.decimals)],
      ['SS58', String(info.ss58), ok(EXPECTED.ss58.includes(info.ss58))],
      ['depósito existencial', `${planckToLunes(info.existentialDeposit)} LUNES`, ok(info.existentialDeposit === EXPECTED.existentialDeposit)],
      ['bloco finalizado', String(info.finalized), ''],
      ['tempo de bloco medido', `${(ms / 1000).toFixed(2)} s`, ok(Math.abs(ms - EXPECTED.blockMs) < 1500)],
      ['taxa de 1 transferência', `${planckToLunes(fee)} LUNES`, ''],
      ['utility.batchAll · balances.transferKeepAlive · system.remarkWithEvent', [has('utility', 'batchAll'), has('balances', 'transferKeepAlive'), has('system', 'remarkWithEvent')].map(String).join(' · '),
        ok(has('utility', 'batchAll') && has('balances', 'transferKeepAlive') && has('system', 'remarkWithEvent'))],
    ];
    for (const [k, v, s] of rows) console.log(`${k.padEnd(28)} ${v}${s ? `  [${s}]` : ''}`);
    const p = preflight(info, expectedGenesis());
    console.log(p.length ? `\nNão liquidar: ${p.join('; ')}` : '\nA chain confere com o esperado para liquidar.');
  } finally { await api.disconnect(); }
}

async function plan(pay: boolean) {
  const file = args.find(a => a.endsWith('.json'));
  if (!file) throw new Error('Informe o arquivo do lote (.json).');
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const lot = planLot(raw);
  console.log(`Lote ${lot.id}: ${lot.payouts.length} pagamentos, total ${planckToLunes(lot.total)} LUNES`);
  console.log(`Remark: ${lot.remark}`);
  for (const p of lot.payouts) console.log(`  ${p.address}  ${planckToLunes(p.planck)}`);
  if (pay) {
    // Antes de qualquer conexão: id confirmado e (M-05) lote batendo com o estado do validador.
    if (opt('confirm') !== lot.id) throw new Error(`Para pagar de verdade, repita o id do lote: --confirm ${lot.id}`);
    if (!args.includes('--manual')) {
      const statePath = join(opt('dir') ?? 'dados', 'validador.json');
      if (!existsSync(statePath)) throw new Error(`Sem ${statePath} para conferir o lote (use --dir, ou --manual para lote sem validador).`);
      checkLotBinding(raw, lot, JSON.parse(readFileSync(statePath, 'utf8')) as ValidatorState);
      console.log('Lote confere com o estado do validador.');
    }
  }
  if (!pay && !opt('ws')) return;
  const api = await connect(endpoints());
  try {
    const chain = new PolkadotChain(api);
    if (!pay) {
      const from = opt('from');
      if (!from) { console.log(`Taxa (sem --from, estimada com a 1ª carteira): ~${planckToLunes(await chain.estimateFee(lot, lot.payouts[0]!.address))} LUNES`); return; }
      const fee = await chain.estimateFee(lot, from);
      const free = await chain.freeBalance(from);
      console.log(`Taxa ~${planckToLunes(fee)} LUNES · saldo da pagadora ${planckToLunes(free)} · precisa ${planckToLunes(lot.total + fee + (await chain.info()).existentialDeposit)}`);
      return;
    }

    const info = await chain.info();
    const genesis = expectedGenesis();
    const p = preflight(info, genesis);
    if (p.length) throw new Error(`A chain não é a esperada: ${p.join('; ')}.`);
    const signer = await loadSigner(process.env, info.ss58, info.genesisHash);
    const e = await payLot(chain, new Journal(opt('journal') ?? 'diario'), lot, { from: signer.address, signer, genesisHash: genesis, log: m => console.log(m) });
    console.log(`Resultado: ${e.state}${e.result ? ` no bloco ${e.result.blockNumber}` : ''}`);
    if (e.state !== 'finalizado') process.exitCode = 2;
  } finally { await api.disconnect(); }
}

const cmd = args[0];
(cmd === 'check' ? check() : cmd === 'plan' ? plan(false) : cmd === 'pay' ? plan(true) : Promise.reject(new Error('Comandos: check, plan, pay')))
  .catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
