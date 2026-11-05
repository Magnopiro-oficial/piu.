/**
 * Resultado de execução por System.Events, decodificado pela metadata do bloco via biblioteca
 * oficial. Inclusão/finalização não provam sucesso do call. Ausência, bytes inválidos e eventos
 * conflitantes são resultado desconhecido: nunca autorizam informar pagamento concluído.
 * @polkadot/types é carregado só ao verificar um pagamento já incluído em bloco.
 */
import type { TypeRegistry } from '@polkadot/types';
import type { Vec } from '@polkadot/types-codec';
import type { EventRecord } from '@polkadot/types/interfaces';
import { LunesRpc, isHash, toHex } from './lunesRpc.js';
import { twox128 } from './xxhash.js';

export type ExecutionOutcome = { ok: true } | { ok: false; error: string } | { ok: null; error: string };
const unknown = (error: string): ExecutionOutcome => ({ ok: null, error });
const registries = new Map<string, TypeRegistry>();

async function registryOf(metadataHex: string): Promise<TypeRegistry> {
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(metadataHex)) throw new Error('Metadata inválida.');
  const cached = registries.get(metadataHex);
  if (cached) return cached;
  const { Metadata, TypeRegistry } = await import('@polkadot/types');
  const registry = new TypeRegistry();
  const metadata = new Metadata(registry, metadataHex as `0x${string}`);
  if (metadata.version < 14) throw new Error('Metadata anterior a v14 não suportada para conferir a execução.');
  registry.setMetadata(metadata);
  if (registries.size >= 2) registries.delete(registries.keys().next().value!);
  registries.set(metadataHex, registry);
  return registry;
}

export async function decodeExecution(metadataHex: string, eventsHex: string | null, index: number): Promise<ExecutionOutcome> {
  if (!Number.isSafeInteger(index) || index < 0) return unknown('Índice de transação inválido.');
  if (!eventsHex || !/^0x(?:[0-9a-fA-F]{2})+$/.test(eventsHex)) return unknown('Eventos de execução indisponíveis.');
  try {
    const registry = await registryOf(metadataHex);
    const records = registry.createType('Vec<EventRecord>', eventsHex) as Vec<EventRecord>;
    // O codec deve consumir os bytes inteiros: não aceitar um prefixo válido de resposta truncada/adulterada.
    if (records.toHex().toLowerCase() !== eventsHex.toLowerCase()) return unknown('Codificação dos eventos não confere.');
    const results: ExecutionOutcome[] = [];
    for (const { phase, event } of records) {
      if (!phase.isApplyExtrinsic || phase.asApplyExtrinsic.toNumber() !== index || event.section !== 'system') continue;
      if (event.method === 'ExtrinsicSuccess') results.push({ ok: true });
      else if (event.method === 'ExtrinsicFailed') {
        const dispatch = event.data[0];
        let error = dispatch?.toString() || 'Falha de execução sem descrição.';
        if (dispatch && 'isModule' in dispatch && dispatch.isModule && 'asModule' in dispatch) {
          try { const meta = registry.findMetaError(dispatch.asModule as never); error = `${meta.section}.${meta.name}`; } catch { /* mantém erro bruto decodificado */ }
        }
        results.push({ ok: false, error });
      }
    }
    return results.length === 1 ? results[0]! : unknown(results.length ? 'Eventos de execução conflitantes.' : 'Sem resultado de execução para esta transação.');
  } catch (e) { return unknown(`Não foi possível decodificar a execução: ${e instanceof Error ? e.message : String(e)}`); }
}

export async function readExecution(rpc: LunesRpc, blockHash: string, index: number): Promise<ExecutionOutcome> {
  if (!isHash(blockHash)) return unknown('Hash do bloco inválido.');
  try {
    const key = toHex(Uint8Array.from([...twox128('System'), ...twox128('Events')]));
    const [metadata, events] = await Promise.all([
      rpc.call<string>('state_getMetadata', [blockHash]),
      rpc.call<string | null>('state_getStorage', [key, blockHash]),
    ]);
    return await decodeExecution(metadata, events, index);
  } catch (e) { return unknown(`Não foi possível ler a execução: ${e instanceof Error ? e.message : String(e)}`); }
}
