/**
 * Código de segurança (verificação pessoal de contatos): 60 dígitos em 12 grupos de 5,
 * igual nos dois aparelhos. Derivado das chaves públicas das duas identidades com hash iterado
 * (como o "safety number" do Signal), para que trocar uma chave mude o código.
 */
import { concat, utf8 } from './bytes';
import type { PublicIdentity } from './keys';
import { hash512 } from './suite';

const ITERATIONS = 5200;

function half(p: PublicIdentity): string {
  let h = concat(utf8('piu/v0/safety'), p.signPk, p.agreePk);
  for (let i = 0; i < ITERATIONS; i++) h = hash512(concat(h, p.signPk));
  let out = '';
  for (let i = 0; i < 6; i++) {
    const c = h.slice(i * 5, i * 5 + 5);
    const n = c.reduce((acc, b) => acc * 256 + b, 0); // 40 bits cabem com folga num número JS
    out += String(n % 100000).padStart(5, '0');
  }
  return out;
}

/** 12 grupos de 5 dígitos; a ordem não depende de quem calcula. */
export function safetyNumber(a: PublicIdentity, b: PublicIdentity): string[] {
  const [x, y] = [half(a), half(b)].sort();
  const all = x + y;
  return Array.from({ length: 12 }, (_, i) => all.slice(i * 5, i * 5 + 5));
}
