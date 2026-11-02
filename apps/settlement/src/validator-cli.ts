/**
 * Linha de comando do validador. Pasta de dados (padrão `dados/`):
 *   evidencias/*.json   recibos e provas de entrega (EvidenceFile), de nós e gateways
 *   carteiras/*.json    carteira de cada nó para o lote (ClaimFile, assinado pela chave do nó)
 *   auditorias/*.json   resultados de auditoria (AuditFile)
 *   validador.json      estado (o que cada nó tem a receber, por época)
 *   lotes/<id>.json     lote para `lot:pay`        relatorios/<época>.json   relatório da época
 *
 *   npm run validator:close -- --epoch 2026-S44 --budget 10000 [--dir dados] [--cap 2] [--min 5]
 *   npm run validator:paid  -- --lot piu-lote-2026-S44 [--dir dados] [--journal diario]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Journal } from './journal.js';
import { lunesToPlanck } from './units.js';
import { type AuditFile, buildLedger, type ClaimFile, closeEpoch, emptyState, type EvidenceFile, settleLot, type ValidatorState } from './validator.js';

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const dir = opt('dir') ?? 'dados';
const readAll = <T>(sub: string): T[] => {
  const d = join(dir, sub);
  if (!existsSync(d)) return [];
  return readdirSync(d).filter(f => f.endsWith('.json')).sort().map(f => JSON.parse(readFileSync(join(d, f), 'utf8')) as T);
};
const statePath = join(dir, 'validador.json');
const loadState = (): ValidatorState => (existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) as ValidatorState : emptyState());
function save(path: string, data: unknown) {
  mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 });
  writeFileSync(path + '.tmp', JSON.stringify(data, null, 2), { mode: 0o600 });
  renameSync(path + '.tmp', path);
}

function closeCmd() {
  const epoch = opt('epoch'), budget = opt('budget');
  if (!epoch || !budget) throw new Error('Use --epoch AAAA-Snn --budget <LUNES>.');
  const now = opt('now') ? Math.floor(Date.parse(opt('now')!) / 1000) : Math.floor(Date.now() / 1000);
  const params = { ...(opt('cap') ? { capPercent: Number(opt('cap')) } : {}), ...(opt('min') ? { minPayout: lunesToPlanck(opt('min')!) } : {}) };
  const ledger = buildLedger(readAll<EvidenceFile>('evidencias'), readAll<AuditFile>('auditorias'), now);
  const r = closeEpoch({ epoch, budget: lunesToPlanck(budget), now, state: loadState(), ledger, claims: readAll<ClaimFile>('carteiras'), params });
  if (r.lot) save(join(dir, 'lotes', `${r.lot.id}.json`), r.lot);
  save(join(dir, 'relatorios', `${epoch}.json`), r.report);
  save(statePath, r.state); // por último: se algo falhar antes, a época não fica fechada pela metade
  const rp = r.report;
  console.log(`Época ${epoch}: ${rp.deliveries} entregas comprovadas, ${rp.receipts.validated} recibos válidos, ${rp.receipts.noProof} sem prova, valor da unidade ${rp.unitValue} LUNES.`);
  console.log(r.lot ? `Lote ${r.lot.id}: ${r.lot.payouts.length} carteiras → ${join(dir, 'lotes', `${r.lot.id}.json`)}` : 'Nada a pagar neste lote.');
  if (rp.carried.length) console.log(`${rp.carried.length} nós ficam para o próximo lote (sem carteira ou abaixo do mínimo).`);
}

function paidCmd() {
  const lot = opt('lot');
  if (!lot) throw new Error('Use --lot <id>.');
  const e = new Journal(opt('journal') ?? 'diario').get(lot);
  if (!e || (e.state !== 'finalizado' && e.state !== 'falhou')) throw new Error(`O lote ${lot} ainda não terminou no diário da liquidação (${e?.state ?? 'não encontrado'}).`);
  const r = settleLot(loadState(), lot, e.state);
  save(statePath, r.state);
  console.log(`Lote ${lot}: ${e.state}; ${r.changed} créditos ${e.state === 'finalizado' ? 'marcados como pagos' : 'voltam a aguardar o próximo lote'}.`);
}

try { (args[0] === 'close' ? closeCmd : args[0] === 'paid' ? paidCmd : () => { throw new Error('Comandos: close, paid'); })(); }
catch (e) { console.error(e instanceof Error ? e.message : e); process.exit(1); }
