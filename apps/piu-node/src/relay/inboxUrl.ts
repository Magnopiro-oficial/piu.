/**
 * Caixa do validador (gateway): só `https://` com host público, sem usuário/senha no endereço, sem
 * espaços nem caracteres de controle. Devolve o motivo para a pessoa, ou `null` se serve.
 *
 * Host local (loopback, rede privada, link-local, `.local`) é recusado: o corpo do POST é escolhido por
 * qualquer remetente anônimo da malha, e apontar a caixa para dentro da rede do nó viraria um SSRF cego
 * (auditoria final 06/11/2026, B-N1). Vale para o painel (`PUT /api/gateway`) e para `PIU_VALIDATOR_INBOX`.
 * Nomes de DNS não são resolvidos aqui (um nome público que resolve para a rede local continua possível;
 * por isso o envio também não segue redirecionamentos, ver gatewayPost.ts).
 */
import { isIP } from 'node:net';

function privateV4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
function privateV6(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === '::' || v === '::1') return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) return privateV4(mapped[1]!);
  return /^(fe[89ab]|fc|fd|ff)/.test(v);
}

export function inboxUrlProblem(raw: unknown): string | null {
  if (typeof raw !== 'string') return 'Informe o endereço da caixa.';
  const v = raw.trim();
  if (!v || v.length > 512) return 'Endereço vazio ou longo demais.';
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(v)) return 'O endereço não pode ter espaços.';
  let u: URL;
  try { u = new URL(v); } catch { return 'Endereço inválido. Use https://…'; }
  if (u.protocol !== 'https:') return 'Use um endereço https:// (a caixa recebe as evidências cifradas pela internet).';
  if (!u.hostname) return 'Endereço sem servidor.';
  if (u.username || u.password) return 'Não coloque usuário nem senha no endereço.';
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const kind = isIP(host);
  if ((kind === 4 && privateV4(host)) || (kind === 6 && privateV6(host)) || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local'))
    return 'A caixa precisa ser um servidor na internet, não um endereço desta rede local.';
  return null;
}
