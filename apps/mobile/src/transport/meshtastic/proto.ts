/**
 * Subconjunto do protobuf do Meshtastic (meshtastic/protobufs: mesh.proto, portnums.proto) que o Piu usa
 * para falar com o rádio pela API de cliente: pedir a configuração, mandar um pacote para todos na porta
 * privada e ler o que o rádio entrega. Sem dependência: varint/fixed32/bytes à mão (docs/transporte/
 * piu-sobre-meshtastic.md). Testado em __tests__/meshtastic.test.ts.
 */
export const PRIVATE_APP = 256;
export const BROADCAST = 0xffffffff;
/** Maior payload de um pacote Meshtastic (DATA_PAYLOAD_LEN). */
export const DATA_PAYLOAD_LEN = 233;
const PRIORITY_BACKGROUND = 10;

// ── escrita ──
class W {
  private b: number[] = [];
  varint(v: number) { let x = v >>> 0; while (x > 0x7f) { this.b.push((x & 0x7f) | 0x80); x >>>= 7; } this.b.push(x); return this; }
  tag(field: number, wire: number) { return this.varint((field << 3) | wire); }
  uint(field: number, v: number) { return this.tag(field, 0).varint(v); }
  fixed32(field: number, v: number) { this.tag(field, 5); const x = v >>> 0; this.b.push(x & 0xff, (x >>> 8) & 0xff, (x >>> 16) & 0xff, x >>> 24); return this; }
  bytes(field: number, v: Uint8Array) { this.tag(field, 2).varint(v.length); for (const x of v) this.b.push(x); return this; }
  out() { return Uint8Array.from(this.b); }
}

/** `ToRadio{want_config_id}`: o rádio responde com a configuração e termina com `config_complete_id`. */
export const encodeWantConfig = (id: number) => new W().uint(3, id).out();

/** `ToRadio{packet: MeshPacket}` para todos (canal 0), porta privada, sem pedir confirmação do rádio. */
export function encodeToRadioPacket(p: { payload: Uint8Array; id: number; hopLimit?: number; channel?: number }): Uint8Array {
  if (p.payload.length > DATA_PAYLOAD_LEN) throw new Error('Pedaço maior que um pacote LoRa.');
  const data = new W().uint(1, PRIVATE_APP).bytes(2, p.payload).out();
  const mp = new W().fixed32(2, BROADCAST);
  if (p.channel) mp.uint(3, p.channel);
  mp.bytes(4, data).fixed32(6, p.id).uint(9, p.hopLimit ?? 3).uint(11, PRIORITY_BACKGROUND);
  return new W().bytes(1, mp.out()).out();
}

// ── leitura ──
type Field = { field: number; wire: number; v: number; bytes?: Uint8Array };

function* fields(b: Uint8Array): Generator<Field> {
  let i = 0;
  const varint = () => { let r = 0, s = 0, x: number; do { if (i >= b.length) throw new Error('protobuf truncado'); x = b[i++]!; r += (x & 0x7f) * 2 ** s; s += 7; } while (x & 0x80); return r; };
  while (i < b.length) {
    const key = varint(), field = Math.floor(key / 8), wire = key & 7;
    if (wire === 0) yield { field, wire, v: varint() };
    else if (wire === 1) { i += 8; if (i > b.length) throw new Error('protobuf truncado'); }
    else if (wire === 5) { if (i + 4 > b.length) throw new Error('protobuf truncado'); const v = (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0; i += 4; yield { field, wire, v }; }
    else if (wire === 2) { const n = varint(); if (i + n > b.length) throw new Error('protobuf truncado'); yield { field, wire, v: n, bytes: b.subarray(i, i + n) }; i += n; }
    else throw new Error('protobuf: tipo não suportado');
  }
}

export type RxPacket = { from?: number; to?: number; id?: number; channel?: number; hopLimit?: number; hopStart?: number; portnum?: number; payload?: Uint8Array; encrypted?: boolean };
/** Um nó da malha que o rádio conhece (NodeInfo: num=1, user=2 {long_name=2, short_name=3}, device_metrics=6 {battery_level=1}). */
export type RxNode = { num: number; longName?: string; shortName?: string; battery?: number };
export type FromRadio = { packet?: RxPacket; myNodeNum?: number; configCompleteId?: number; queueFree?: number; node?: RxNode;
  /** Config.lora (6).region (7): 0 = não definida (o rádio não transmite). */
  loraRegion?: number };

const utf8 = (b: Uint8Array) => { try { return new TextDecoder().decode(b); } catch { return undefined; } };

function decodeNode(b: Uint8Array): RxNode {
  const n: RxNode = { num: 0 };
  for (const f of fields(b)) {
    if (f.field === 1 && f.wire === 0) n.num = f.v;
    else if (f.field === 2 && f.bytes) for (const u of fields(f.bytes)) { if (u.field === 2 && u.bytes) n.longName = utf8(u.bytes); else if (u.field === 3 && u.bytes) n.shortName = utf8(u.bytes); }
    else if (f.field === 6 && f.bytes) for (const d of fields(f.bytes)) { if (d.field === 1 && d.wire === 0) n.battery = d.v; }
  }
  return n;
}

function decodePacket(b: Uint8Array): RxPacket {
  const p: RxPacket = {};
  for (const f of fields(b)) {
    if (f.field === 1 && f.wire === 5) p.from = f.v;
    else if (f.field === 2 && f.wire === 5) p.to = f.v;
    else if (f.field === 3 && f.wire === 0) p.channel = f.v;
    else if (f.field === 4 && f.bytes) for (const d of fields(f.bytes)) { if (d.field === 1 && d.wire === 0) p.portnum = d.v; else if (d.field === 2 && d.bytes) p.payload = d.bytes.slice(); }
    else if (f.field === 5 && f.bytes) p.encrypted = true;
    else if (f.field === 6 && f.wire === 5) p.id = f.v;
    else if (f.field === 9 && f.wire === 0) p.hopLimit = f.v;
    else if (f.field === 15 && f.wire === 0) p.hopStart = f.v;
  }
  return p;
}

/** Só o que o Piu usa de `FromRadio`; o resto (registros, outros ajustes) é pulado. */
export function decodeFromRadio(b: Uint8Array): FromRadio {
  const out: FromRadio = {};
  for (const f of fields(b)) {
    if (f.field === 2 && f.bytes) out.packet = decodePacket(f.bytes);
    else if (f.field === 3 && f.bytes) for (const m of fields(f.bytes)) { if (m.field === 1 && m.wire === 0) out.myNodeNum = m.v; }
    else if (f.field === 4 && f.bytes) out.node = decodeNode(f.bytes);
    else if (f.field === 5 && f.bytes) for (const c of fields(f.bytes)) {
      if (c.field === 6 && c.bytes) { out.loraRegion = 0; for (const l of fields(c.bytes)) if (l.field === 7 && l.wire === 0) out.loraRegion = l.v; }
    }
    else if (f.field === 7 && f.wire === 0) out.configCompleteId = f.v;
    else if (f.field === 11 && f.bytes) for (const q of fields(f.bytes)) { if (q.field === 2 && q.wire === 0) out.queueFree = q.v; }
  }
  return out;
}
