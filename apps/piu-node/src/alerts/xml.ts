/**
 * Leitor de XML mínimo e defensivo, só para RSS/Atom e CAP 1.2 (sem dependência nova).
 *
 * - Recusa DTD (`<!DOCTYPE`) e, com ela, qualquer entidade declarada ou externa: não há XXE nem
 *   "billion laughs". Só as 5 entidades do XML (`&lt;` `&gt;` `&amp;` `&quot;` `&apos;`) e
 *   referências numéricas (`&#233;`, `&#xE9;`) são decodificadas; qualquer outra é erro.
 * - Limites: tamanho do documento, profundidade e número de elementos.
 * - Prefixos de namespace são descartados (`cap:alert` vira `alert`): o CAP e o RSS deste uso não
 *   misturam nomes iguais de vocabulários diferentes.
 * - Comentários, instruções de processamento e CDATA são tratados; o resto do XML (DTD, validação)
 *   não é necessário aqui.
 */
export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Texto direto do elemento (concatenado, sem o dos filhos). */
  text: string;
}

export class XmlError extends Error {}

export interface XmlLimits { maxBytes: number; maxDepth: number; maxElements: number }
export const DEFAULT_XML_LIMITS: XmlLimits = { maxBytes: 2 * 1024 * 1024, maxDepth: 32, maxElements: 20_000 };

const NAME = /^[A-Za-z_][\w.\-]*(?::[A-Za-z_][\w.\-]*)?$/;
const PREDEFINED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

const local = (qname: string) => qname.slice(qname.indexOf(':') + 1);

/** Decodifica as entidades permitidas; qualquer outra (declarada numa DTD, por exemplo) é recusada. */
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&([^;&\s]{1,10});/g, (_m, ent: string) => {
    if (ent in PREDEFINED) return PREDEFINED[ent]!;
    const num = ent.startsWith('#x') || ent.startsWith('#X') ? parseInt(ent.slice(2), 16) : ent.startsWith('#') ? parseInt(ent.slice(1), 10) : NaN;
    if (!Number.isInteger(num) || num <= 0 || num > 0x10ffff || (num >= 0xd800 && num <= 0xdfff)) throw new XmlError(`Entidade não permitida: &${ent};`);
    return String.fromCodePoint(num);
  });
  // "&" solto (XML malformado, comum em links de feed) fica como está.
}

function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  let consumed = 0;
  while ((m = re.exec(src))) {
    if (src.slice(consumed, m.index).trim()) throw new XmlError('Atributo malformado.');
    consumed = m.index + m[0].length;
    const v = m[3] ?? m[4] ?? '';
    if (v.includes('<')) throw new XmlError('"<" em valor de atributo.');
    attrs[local(m[1]!)] = decodeEntities(v);
  }
  if (src.slice(consumed).trim()) throw new XmlError('Atributo malformado.');
  return attrs;
}

/** Lê o documento e devolve o elemento raiz. Lança `XmlError` em qualquer coisa fora do esperado. */
export function parseXml(xml: string, limits: XmlLimits = DEFAULT_XML_LIMITS): XmlNode {
  if (Buffer.byteLength(xml, 'utf8') > limits.maxBytes) throw new XmlError('Documento grande demais.');
  let i = xml.charCodeAt(0) === 0xfeff ? 1 : 0;
  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;
  let count = 0;
  const n = xml.length;
  const text = (s: string) => { const top = stack.at(-1); if (top) top.text += s; else if (s.trim()) throw new XmlError('Texto fora do elemento raiz.'); };

  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) { text(decodeEntities(xml.slice(i))); break; }
    if (lt > i) text(decodeEntities(xml.slice(i, lt)));
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      if (end < 0) throw new XmlError('Comentário sem fim.');
      i = end + 3; continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      if (end < 0) throw new XmlError('CDATA sem fim.');
      if (!stack.length) throw new XmlError('CDATA fora do elemento raiz.');
      text(xml.slice(lt + 9, end));
      i = end + 3; continue;
    }
    if (xml.startsWith('<!', lt)) throw new XmlError('DTD e declarações não são aceitas.');
    if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2);
      if (end < 0) throw new XmlError('Instrução sem fim.');
      i = end + 2; continue;
    }
    const gt = xml.indexOf('>', lt + 1);
    if (gt < 0) throw new XmlError('Marcação sem fim.');
    const raw = xml.slice(lt + 1, gt);
    i = gt + 1;
    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim();
      const top = stack.pop();
      if (!top || top.name !== local(name)) throw new XmlError(`Fechamento inesperado: </${name}>.`);
      continue;
    }
    const selfClose = raw.endsWith('/');
    const body = selfClose ? raw.slice(0, -1) : raw;
    const sp = body.search(/\s/);
    const qname = sp < 0 ? body : body.slice(0, sp);
    if (!NAME.test(qname)) throw new XmlError('Nome de elemento inválido.');
    if (root && !stack.length) throw new XmlError('Mais de um elemento raiz.');
    if (++count > limits.maxElements) throw new XmlError('Elementos demais.');
    const node: XmlNode = { name: local(qname), attrs: sp < 0 ? {} : parseAttrs(body.slice(sp)), children: [], text: '' };
    const parent = stack.at(-1);
    if (parent) parent.children.push(node); else root = node;
    if (!selfClose) {
      stack.push(node);
      if (stack.length > limits.maxDepth) throw new XmlError('Aninhamento profundo demais.');
    }
  }
  if (stack.length) throw new XmlError(`Elemento sem fechamento: <${stack.at(-1)!.name}>.`);
  if (!root) throw new XmlError('Documento vazio.');
  return root;
}

/** Primeiro filho com este nome. */
export const child = (n: XmlNode | undefined, name: string) => n?.children.find(c => c.name === name);
/** Todos os filhos com este nome. */
export const childrenOf = (n: XmlNode | undefined, name: string) => n?.children.filter(c => c.name === name) ?? [];
/** Texto (aparado) do primeiro filho com este nome; vazio se não houver. */
export const textOf = (n: XmlNode | undefined, name: string) => child(n, name)?.text.trim() ?? '';
