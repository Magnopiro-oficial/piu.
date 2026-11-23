/**
 * Cabeçalho AX.25 mínimo (quadro UI, sem conexão): destino (7) · origem (7) · controle 0x03 · PID 0xF0.
 * É o que os modems de rádio de banda estreita (Direwolf, NinoTNC) esperam dentro do quadro KISS. O modem
 * cuida do resto no ar (flags, verificação FCS, bit stuffing). O conteúdo do Piu vai depois dos 16 bytes.
 * O endereço só separa o tráfego do Piu do que mais passar no canal: a identidade é a do envelope.
 */
export const AX25_HEADER = 16;
const CONTROL_UI = 0x03, PID_NONE = 0xf0;
const CALL = /^([A-Z0-9]{1,6})(?:-(\d{1,2}))?$/;

/** "PIU-7" → nome (até 6 letras ou números) e SSID (0 a 15). `null` se não é um endereço AX.25. */
export function parseCall(s: string): { name: string; ssid: number } | null {
  const m = CALL.exec(s.trim().toUpperCase());
  if (!m) return null;
  const ssid = Number(m[2] ?? 0);
  return ssid <= 15 ? { name: m[1]!, ssid } : null;
}

function address(call: string, last: boolean): Uint8Array {
  const c = parseCall(call);
  if (!c) throw new Error(`Indicativo AX.25 inválido: ${call} (até 6 letras ou números e, se quiser, -0 a -15).`);
  const b = new Uint8Array(7);
  for (let i = 0; i < 6; i++) b[i] = (c.name.charCodeAt(i) || 0x20) << 1;
  b[6] = 0x60 | (c.ssid << 1) | (last ? 1 : 0);
  return b;
}

export function ax25Encode(payload: Uint8Array, a: { dst: string; src: string }): Uint8Array {
  const out = new Uint8Array(AX25_HEADER + payload.length);
  out.set(address(a.dst, false), 0);
  out.set(address(a.src, true), 7);
  out[14] = CONTROL_UI; out[15] = PID_NONE;
  out.set(payload, AX25_HEADER);
  return out;
}

/** O conteúdo de um quadro UI endereçado a `dst`; `null` para o resto (APRS de outros, quadros com caminho, ruído). */
export function ax25Decode(frame: Uint8Array, dst: string): Uint8Array | null {
  if (frame.length <= AX25_HEADER || frame[14] !== CONTROL_UI || frame[15] !== PID_NONE) return null;
  if (!(frame[13]! & 1)) return null; // há repetidores no caminho: não é um quadro do Piu
  const want = address(dst, false);
  for (let i = 0; i < 6; i++) if (frame[i] !== want[i]) return null;
  if ((frame[6]! & 0x1e) !== (want[6]! & 0x1e)) return null; // SSID
  return frame.slice(AX25_HEADER);
}
