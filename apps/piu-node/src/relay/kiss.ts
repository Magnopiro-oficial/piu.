/**
 * Enquadramento KISS (o padrão dos modems de rádio, TNC): cada quadro entre `FEND` (0xC0), com
 * 0xC0 → 0xDB 0xDC e 0xDB → 0xDB 0xDD. O primeiro byte é o comando: 0x00 = dados na porta 0.
 * É o que o piu-node fala pela porta serial (USB) com o rádio LoRa ou com outro nó por cabo.
 */
export const FEND = 0xc0, FESC = 0xdb, TFEND = 0xdc, TFESC = 0xdd;
export const KISS_DATA = 0x00;

export function kissEncode(payload: Uint8Array, cmd = KISS_DATA): Uint8Array {
  const out: number[] = [FEND, cmd];
  for (const b of payload) {
    if (b === FEND) out.push(FESC, TFEND);
    else if (b === FESC) out.push(FESC, TFESC);
    else out.push(b);
  }
  out.push(FEND);
  return Uint8Array.from(out);
}

/** Separa o fluxo serial em quadros de dados. Quadro grande demais ou escape inválido é descartado. */
export class KissDecoder {
  private buf: number[] = [];
  private esc = false;
  private bad = false;
  /** Quadros descartados (ruído na linha, quadro grande demais). */
  dropped = 0;
  constructor(private maxFrame: number) {}

  push(chunk: Uint8Array): Uint8Array[] {
    const out: Uint8Array[] = [];
    for (const b of chunk) {
      if (b === FEND) {
        if (this.buf.length && !this.bad) {
          const cmd = this.buf[0]!;
          if (cmd === KISS_DATA) out.push(Uint8Array.from(this.buf.slice(1)));
          // outros comandos (configuração do TNC, outras portas) não são deste protocolo
        } else if (this.bad) this.dropped++;
        this.buf = []; this.esc = false; this.bad = false;
        continue;
      }
      if (this.bad) continue;
      if (this.esc) {
        this.esc = false;
        if (b === TFEND) this.buf.push(FEND);
        else if (b === TFESC) this.buf.push(FESC);
        else { this.bad = true; continue; }
      } else if (b === FESC) { this.esc = true; continue; } else this.buf.push(b);
      if (this.buf.length > this.maxFrame + 1) this.bad = true;
    }
    return out;
  }
}
