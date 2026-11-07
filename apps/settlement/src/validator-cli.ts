/**
 * Linha de comando do validador. Pasta de dados (padrão `dados/`):
 *   evidencias/*.json   recibos e provas de entrega (EvidenceFile v1/v2), de nós, gateways e aparelhos
 *   operadores.json     operadores admitidos (confiável; sem ele o close aborta)
 *   registro/*.json     certificados de nó e revogações dos operadores (se autoverificam)
 *   chave-provas.json   semente da chave que abre as provas seladas (0600; ou PIU_VALIDATOR_PROOF_SEED)
 *   carteiras/*.json    carteira de cada nó para o lote (ClaimFile, assinado pela chave do nó)
 *   auditorias/*.json   resultados de auditoria (AuditFile)
 *   validador.json      estado (o que cada nó tem a receber, por época)
 *   lotes/<id>.json     lote para `lot:pay`        relatorios/<época>.json   relatório da época
 *
 *   npm run validator:close -- --epoch 2026-S44 --budget 10000 [--dir dados] [--cap 2] [--min 5]
 *   npm run validator:paid  -- --lot piu-lote-2026-S44 [--dir dados] [--journal diario]
 *   npm run validator:keygen -- [--dir dados]   gera chave-provas.json e imprime a chave pública do app
 *   npm run validator:bonds -- list [--dir dados]                       cauções dos celulares
 *   npm run validator:bonds -- due  [--dir dados]                       devoluções vencidas (saída há 7 dias ou mais)
 *   npm run validator:bonds -- refund --operator <hex> [--tx <caução>] [--refund-tx <hash>] [--note "…"]
 *                                                                       marca devolvida (depois de devolver à mão)
 *   npm run validator:bonds -- slash  --operator <hex> [--tx <caução>] --note "motivo"  marca confiscada (fraude comprovada)
 *   npm run validator:inbox -- --from <pasta>                  pacotes da malha (.bin) → evidencias/ e registro/
 *   npm run validator:inbox -- --listen 8430 [--host 127.0.0.1] [--trust-proxy]  caixa HTTP (POST /caixa; HTTPS no proxy da frente)
 *
 * Pacotes pela malha (docs/carteira/transacoes-pela-malha.md): gateways entregam evidências e registros
 * selados para a chave das provas; a caixa abre e grava como arquivos comuns, conferidos no close.
 *
 * Celulares como nó (docs/economia/no-celular.md): `config.json` (confiável, opcional)
 *   { "phone": { "bondAddress": "5…", "minBondLunes": "100", "minAgeDays": 7, "minEndorsements": 2, "minRoots": 2,
 *                "maxEndorsementsPerMonth": 5, "maxEnabledPerRootPerMonth": 10, "rootSuspendAfterSlashes": 3,
 *                "endorsementValidityDays": 90, "endorsementBackdateDays": 7, "capFraction": 0.5, "maxPayoutBondRatio": 0.25 } }
 *   (minBondLunes padrão: 100, como no desenho; valores abaixo de 100 só para rede de teste.)
 * Com registros de celular em `registro/`, o close confere as cauções na Lunes (SÓ LEITURA; `--ws`
 * ou PIU_SETTLEMENT_WS). Sem `bondAddress`, nenhum celular é habilitado.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomic } from './fsutil.js';
import { Journal } from './journal.js';
import { checkEndpoints, expectedGenesis } from './chain.js';
import { fromHex } from './hex.js';
import { toHex } from './protocol/bytes.js';
import type { KeyPair } from './protocol/keys.js';
import { connect, MAINNET_ENDPOINTS, PolkadotChain } from './polkadot.js';
import { validatorProofKey } from './protocol/proof.js';
import { random } from './protocol/suite.js';
import { NodeRegistry, type OperatorsFile, type RegistryFile } from './registry.js';
import { markBond, refundsDue } from './bond.js';
import { collectPhones, phoneEligibility, phonePolicyFrom } from './phone-nodes.js';
import { lunesToPlanck, planckToLunes } from './units.js';
import { ingestBundle, inboxServer } from './inbox.js';
import { type AuditFile, buildLedger, type ClaimFile, closeEpoch, emptyState, type EvidenceFile, settleLot, type ValidatorState } from './validator.js';

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const dir = opt('dir') ?? 'dados';
/** Registro de nós/celulares não confiável: arquivo maior que isto é ignorado (com aviso). */
const MAX_REGISTRY_FILE_BYTES = 4 * 1024 * 1024;
/** Evidências, carteiras e auditorias: o mesmo teto por arquivo (um arquivo gigante não trava o close). */
const MAX_EVIDENCE_FILE_BYTES = 64 * 1024 * 1024;
const readAll = <T>(sub: string, maxBytes = Infinity): T[] => {
  const d = join(dir, sub);
  if (!existsSync(d)) return [];
  return readdirSync(d).filter(f => f.endsWith('.json')).sort().flatMap(f => {
    if (statSync(join(d, f)).size > maxBytes) { console.warn(`${join(d, f)} ignorado: maior que ${maxBytes} bytes.`); return []; }
    // Um arquivo malformado é ignorado com aviso; não derruba o close inteiro (B-08).
    try { return [JSON.parse(readFileSync(join(d, f), 'utf8')) as T]; } catch (e) { console.warn(`${join(d, f)} ignorado: JSON inválido (${(e as Error).message}).`); return []; }
  });
};
const statePath = join(dir, 'validador.json');
const loadState = (): ValidatorState => (existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) as ValidatorState : emptyState());
/** Gravação atômica com fsync (estado do validador, lotes, chave das provas). */
const save = (path: string, data: unknown) => writeFileAtomic(path, JSON.stringify(data, null, 2));

const keyPath = join(dir, 'chave-provas.json');

/** Chave que abre as provas seladas: env ou arquivo. Sem ela, nenhuma prova v2 abre (e nada é pago). */
function loadProofKey(): KeyPair {
  const env = process.env.PIU_VALIDATOR_PROOF_SEED?.trim();
  if (!env && existsSync(keyPath) && (statSync(keyPath).mode & 0o077) !== 0) throw new Error(`${keyPath}: permissão aberta demais; use chmod 600 (é a chave que abre as provas).`);
  const seed = env ?? (existsSync(keyPath) ? (JSON.parse(readFileSync(keyPath, 'utf8')) as { seed: string }).seed : undefined);
  if (!seed) throw new Error(`Sem a chave das provas (${keyPath} ou PIU_VALIDATOR_PROOF_SEED). Rode validator:keygen.`);
  const b = fromHex(seed);
  if (b.length !== 32) throw new Error('Semente da chave das provas inválida (32 bytes em hex).');
  return validatorProofKey(b);
}

function loadOperators(): OperatorsFile {
  const ops = join(dir, 'operadores.json');
  if (!existsSync(ops)) throw new Error(`Sem ${ops}: o validador só credita nós de operadores admitidos.`);
  return JSON.parse(readFileSync(ops, 'utf8')) as OperatorsFile;
}

const loadPhonePolicy = () => { const f = join(dir, 'config.json'); return phonePolicyFrom(existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null); };

function keygenCmd() {
  if (existsSync(keyPath)) throw new Error(`${keyPath} já existe. Não sobrescrevo (as provas seladas para ela deixariam de abrir).`);
  const seed = random(32);
  save(keyPath, { v: 1, seed: toHex(seed), createdAt: new Date().toISOString() });
  console.log(`Chave das provas gravada em ${keyPath} (faça backup).`);
  console.log(`Chave pública (VALIDATOR_PROOF_PK em apps/mobile/src/protocol/proof.ts): ${toHex(validatorProofKey(seed).pk)}`);
}

async function closeCmd() {
  const epoch = opt('epoch'), budget = opt('budget');
  if (!epoch || !budget) throw new Error('Use --epoch AAAA-Snn --budget <LUNES>.');
  const now = opt('now') ? Math.floor(Date.parse(opt('now')!) / 1000) : Math.floor(Date.now() / 1000);
  const policy = loadPhonePolicy();
  const params = { ...(opt('cap') ? { capPercent: Number(opt('cap')) } : {}), ...(opt('min') ? { minPayout: lunesToPlanck(opt('min')!) } : {}), phoneCapFraction: policy.capFraction, phoneMaxPayoutBondRatio: policy.maxPayoutBondRatio };
  const operators = loadOperators(), files = readAll<RegistryFile>('registro', MAX_REGISTRY_FILE_BYTES), state = loadState();
  // Celulares: conferir as cauções na chain (só leitura), só se houver registro de celular.
  const hasPhones = collectPhones(files).regs.size > 0;
  let api: Awaited<ReturnType<typeof connect>> | null = null;
  if (hasPhones && policy.bondAddress) {
    api = await connect(checkEndpoints((opt('ws') ?? process.env.PIU_SETTLEMENT_WS ?? MAINNET_ENDPOINTS.join(',')).split(',').map(x => x.trim()).filter(Boolean)));
    // As cauções só valem lidas da rede certa: nó de outra rede (ou que mente) não habilita celular (M-3).
    const g = (await api.rpc.chain.getBlockHash(0)).toHex();
    if (g !== expectedGenesis()) { await api.disconnect(); throw new Error(`O nó RPC não é da Lunes Mainnet (gênese ${g}). Use outro --ws.`); }
  }
  let phones;
  try {
    // Chaves admitidas (inclusive rotacionadas) → raiz; avais vistos gravados no estado (recordFirstSeen).
    phones = await phoneEligibility({ files, roots: NodeRegistry.build([operators], files).operatorRoots(), chain: api ? new PolkadotChain(api) : null, state, now, epoch, policy });
  } finally { await api?.disconnect(); }
  const registry = NodeRegistry.build([operators], files, phones.eligible);
  const ledger = buildLedger(readAll<EvidenceFile>('evidencias', MAX_EVIDENCE_FILE_BYTES), readAll<AuditFile>('auditorias', MAX_EVIDENCE_FILE_BYTES), now, { registry, proofKey: loadProofKey() });
  const r = closeEpoch({ epoch, budget: lunesToPlanck(budget), now, state: phones.state, ledger, claims: readAll<ClaimFile>('carteiras', MAX_EVIDENCE_FILE_BYTES), params, ...(hasPhones ? { phones: phones.report, suspendedRoots: phones.suspendedRoots } : {}) });
  if (r.lot) save(join(dir, 'lotes', `${r.lot.id}.json`), r.lot);
  save(join(dir, 'relatorios', `${epoch}.json`), r.report);
  save(statePath, r.state); // por último: se algo falhar antes, a época não fica fechada pela metade
  const rp = r.report;
  console.log(`Época ${epoch}: ${rp.deliveries} entregas comprovadas, ${rp.receipts.validated} recibos válidos, ${rp.receipts.noProof} sem prova, valor da unidade ${rp.unitValue} LUNES.`);
  console.log(r.lot ? `Lote ${r.lot.id}: ${r.lot.payouts.length} carteiras → ${join(dir, 'lotes', `${r.lot.id}.json`)}` : 'Nada a pagar neste lote.');
  if (rp.carried.length) console.log(`${rp.carried.length} nós ficam para o próximo lote (sem carteira ou abaixo do mínimo).`);
  if (rp.receipts.legacyOnly) console.log(`${rp.receipts.legacyOnly} recibos só com prova v1 (legado): não rendem.`);
  if (rp.flagged.length) console.log(`${rp.flagged.length} envelopes para auditoria (excesso de recibos ou provas conflitantes): ver o relatório.`);
  if (rp.phones) console.log(`Celulares: ${rp.phones.filter(p => p.eligible).length} habilitados, ${rp.phones.filter(p => !p.eligible).length} de fora (motivos no relatório).`);
}

function bondsCmd() {
  const sub = args[1];
  const state = loadState();
  const now = Math.floor(Date.now() / 1000);
  if (sub === 'due') {
    // Devoluções vencidas (saída assinada há 7 dias ou mais): quem tem a chave do endereço da caução
    // devolve À MÃO e marca com `refund`.
    const due = refundsDue(state.bonds ?? [], now);
    if (!due.length) { console.log('Nenhuma devolução vencida.'); return; }
    for (const b of due) console.log(`${b.operatorPk}  ${planckToLunes(BigInt(b.amount))} LUNES → ${b.wallet}  devida desde ${new Date(b.refundDueAt! * 1000).toISOString().slice(0, 10)}  (tx da caução ${b.txHash})`);
    return;
  }
  if (sub === 'list' || !sub) {
    const list = state.bonds ?? [];
    if (!list.length) { console.log('Nenhuma caução de celular no estado do validador (o close grava as conferidas).'); return; }
    for (const b of list) {
      const exit = b.exitAt !== undefined ? ` · saída pedida em ${new Date(b.exitAt * 1000).toISOString().slice(0, 10)}, devolução devida em ${new Date((b.refundDueAt ?? b.exitAt) * 1000).toISOString().slice(0, 10)}` : '';
      console.log(`${b.operatorPk.slice(0, 16)}…  ${b.state.padEnd(10)} ${planckToLunes(BigInt(b.amount))} LUNES  de ${b.wallet}  tx ${b.txHash} (bloco ${b.block})${exit}${b.note ? ` · ${b.note}` : ''}`);
    }
    return;
  }
  if (sub !== 'refund' && sub !== 'slash') throw new Error('Use: bonds list | due | refund --operator <hex> [--tx <caução>] [--refund-tx <hash>] [--note …] | slash --operator <hex> [--tx <caução>] --note …');
  const op = opt('operator');
  if (!op) throw new Error('Use --operator <chave de operador do celular, hex>.');
  state.bonds = markBond(state.bonds ?? [], op, sub === 'refund' ? 'devolvida' : 'confiscada', opt('note') ?? '', now,
    { ...(opt('tx') ? { txHash: opt('tx') } : {}), ...(opt('refund-tx') ? { refundTx: opt('refund-tx') } : {}) });
  save(statePath, state);
  console.log(`Caução de ${op.slice(0, 16)}… marcada como ${sub === 'refund' ? 'devolvida' : 'confiscada'}. Os recibos desse celular deixam de render a partir do próximo close.`);
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

function inboxCmd() {
  const key = loadProofKey();
  const from = opt('from'), listen = opt('listen');
  if (from) {
    let ok = 0, dup = 0, bad = 0;
    for (const f of readdirSync(from).filter(x => x.endsWith('.bin')).sort()) {
      const r = ingestBundle(new Uint8Array(readFileSync(join(from, f))), key, dir);
      if (!r.ok) { bad++; console.log(`${f}: recusado (${r.reason})`); } else if (r.duplicate) dup++; else ok++;
    }
    console.log(`Caixa: ${ok} gravados, ${dup} repetidos, ${bad} recusados.`);
    return;
  }
  if (!listen) throw new Error('Use --from <pasta com .bin> ou --listen <porta>.');
  const server = inboxServer({ proofKey: key, dir, trustProxy: args.includes('--trust-proxy'), log: m => console.log(m) });
  return new Promise<void>(resolve => {
    server.listen(Number(listen), opt('host') ?? '127.0.0.1', () => console.log(`Caixa ouvindo em ${opt('host') ?? '127.0.0.1'}:${listen} (POST /caixa). Ponha HTTPS na frente.`));
    process.on('SIGINT', () => server.close(() => resolve()));
  });
}

const cmds: Record<string, () => unknown> = { close: closeCmd, paid: paidCmd, keygen: keygenCmd, bonds: bondsCmd, inbox: inboxCmd };
if (process.argv[1] && /validator-cli\.[jt]s$/.test(process.argv[1])) {
  Promise.resolve().then(() => (cmds[args[0] ?? ''] ?? (() => { throw new Error('Comandos: close, paid, keygen, bonds, inbox'); }))())
    .catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
