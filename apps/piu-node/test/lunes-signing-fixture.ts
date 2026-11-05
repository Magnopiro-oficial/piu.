/**
 * Metadata v14 mínima gerada pelos codecs oficiais @polkadot/types. Não é metadata da Mainnet:
 * o objetivo é exercer o decoder genérico (índices de pallet/variante vêm da metadata), incluindo
 * eventos de outra fase/índice. Payloads SCALE também são gerados pela biblioteca, não por heurística.
 */
import { Metadata, TypeRegistry } from '@polkadot/types';
const registry = new TypeRegistry();
const field = (type: number) => ({ name: null, type, typeName: null, docs: [] });
const type = (id: number, path: string[], def: unknown) => ({ id, type: { path, params: [], def, docs: [] } });
const metadata = new Metadata(registry, { magicNumber: 0x6174656d, metadata: { V14: {
  lookup: { types: [
    type(0, [], { primitive: 'U32' }),
    type(1, [], { tuple: [] }),
    type(2, ['sp_runtime', 'DispatchError'], { variant: { variants: [{ name: 'Other', index: 0, fields: [], docs: [] }] } }),
    type(3, ['frame_system', 'Event'], { variant: { variants: [
      { name: 'ExtrinsicSuccess', index: 7, fields: [field(1)], docs: [] },
      { name: 'ExtrinsicFailed', index: 9, fields: [field(2), field(1)], docs: [] },
    ] } }),
  ] },
  pallets: [{ name: 'System', storage: { prefix: 'System', items: [{ name: 'Events', modifier: 'Default', type: { plain: 1 }, fallback: '0x00', docs: [] }] }, calls: null, events: { type: 3 }, constants: [], errors: null, index: 6 }],
  extrinsic: { type: 1, version: 4, signedExtensions: [] }, type: 1,
} } });
registry.setMetadata(metadata);
export const SIGNING_METADATA = metadata.toHex();
export function executionEvents(events: { index?: number; phase?: 'Finalization' | 'Initialization'; success: boolean }[]): string {
  return registry.createType('Vec<EventRecord>', events.map(e => ({
    phase: e.phase ? { [e.phase]: null } : { ApplyExtrinsic: e.index ?? 0 },
    event: Uint8Array.from(e.success ? [6, 7] : [6, 9, 0]), topics: [],
  }))).toHex();
}
