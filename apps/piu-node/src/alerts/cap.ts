/**
 * Alertas públicos em CAP 1.2 (OASIS Common Alerting Protocol), como o INMET publica no feed RSS
 * `cap_12/rss/alert-as.rss` e a IDAP da Defesa Civil guarda os seus.
 *
 * Só os campos que o Piu mostra. Alertas que não são `status=Actual` (exercício, teste, rascunho)
 * são descartados. O nó NÃO confere assinatura: os órgãos não distribuem chave para apps de
 * terceiros, então o que sai daqui é "retransmitido pelo nó", nunca "assinado pelo órgão".
 */
import { child, childrenOf, parseXml, textOf, type XmlLimits, type XmlNode } from './xml.js';

export type CapSeverity = 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
export type CapUrgency = 'Immediate' | 'Expected' | 'Future' | 'Past' | 'Unknown';
export type CapMsgType = 'Alert' | 'Update' | 'Cancel';

export interface CapArea { areaDesc: string; geocodes: { valueName: string; value: string }[] }
export interface CapAlert {
  identifier: string;
  sender: string;
  /** ISO 8601, como veio. */
  sent: string;
  msgType: CapMsgType;
  /** `sender,identifier,sent` de alertas anteriores que este atualiza ou cancela. */
  references: { sender: string; identifier: string; sent: string }[];
  /** Bloco `info` escolhido (o em português, se houver mais de um idioma). */
  info: {
    language: string; senderName: string; event: string; severity: CapSeverity; urgency: CapUrgency; certainty: string;
    headline: string; description: string; instruction: string; web: string;
    effective: string; onset: string; expires: string;
    areas: CapArea[];
  };
}

const SEVERITY: CapSeverity[] = ['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown'];
const URGENCY: CapUrgency[] = ['Immediate', 'Expected', 'Future', 'Past', 'Unknown'];
const MSG_TYPES: CapMsgType[] = ['Alert', 'Update', 'Cancel'];
/** Teto por campo de texto (a descrição do INMET tem poucas centenas de caracteres). */
const MAX_TEXT = 4000;
const MAX_AREAS = 50, MAX_GEOCODES = 2000;

export const CAP_XML_LIMITS: XmlLimits = { maxBytes: 1024 * 1024, maxDepth: 16, maxElements: 10_000 };
export const FEED_XML_LIMITS: XmlLimits = { maxBytes: 2 * 1024 * 1024, maxDepth: 16, maxElements: 50_000 };

const clip = (s: string, max = MAX_TEXT) => (s.length > max ? s.slice(0, max - 1) + '…' : s);
const pick = <T extends string>(v: string, list: T[], def: T): T => (list.includes(v as T) ? (v as T) : def);
const validTime = (s: string) => (s && Number.isFinite(Date.parse(s)) ? s : '');

/** Links dos alertas num feed RSS 2.0 ou Atom (na ordem do feed). Documento que já é um `<alert>` devolve `[]`. */
export function feedLinks(root: XmlNode): string[] {
  const out: string[] = [];
  if (root.name === 'rss' || root.name === 'RDF') {
    const channel = child(root, 'channel');
    const items = [...childrenOf(channel, 'item'), ...childrenOf(root, 'item')];
    for (const it of items) {
      const link = textOf(it, 'link') || (child(it, 'guid')?.attrs.isPermaLink !== 'false' ? textOf(it, 'guid') : '');
      if (link) out.push(link);
    }
  } else if (root.name === 'feed') {
    for (const e of childrenOf(root, 'entry')) {
      const links = childrenOf(e, 'link');
      const l = links.find(x => x.attrs.type?.includes('cap') || x.attrs.type?.includes('xml')) ?? links.find(x => !x.attrs.rel || x.attrs.rel === 'alternate') ?? links[0];
      if (l?.attrs.href) out.push(l.attrs.href);
    }
  }
  return out;
}

function chooseInfo(alert: XmlNode): XmlNode | undefined {
  const infos = childrenOf(alert, 'info');
  return infos.find(i => /^pt/i.test(textOf(i, 'language'))) ?? infos.find(i => !textOf(i, 'language')) ?? infos[0];
}

/** Lê um `<alert>` CAP 1.2. `null` se não for CAP, faltar o essencial ou não for um alerta real (`Actual`). */
export function readCap(root: XmlNode): CapAlert | null {
  if (root.name !== 'alert') return null;
  const identifier = textOf(root, 'identifier'), sender = textOf(root, 'sender'), sent = validTime(textOf(root, 'sent'));
  if (!identifier || !sender || !sent) return null;
  if (textOf(root, 'status') !== 'Actual') return null;
  const msgType = pick(textOf(root, 'msgType'), MSG_TYPES, 'Alert');
  if (!MSG_TYPES.includes(textOf(root, 'msgType') as CapMsgType)) return null; // Ack, Error: não são alertas
  const references = textOf(root, 'references').split(/\s+/).filter(Boolean).map(r => {
    const [s = '', id = '', t = ''] = r.split(',');
    return { sender: s, identifier: id, sent: t };
  }).filter(r => r.sender && r.identifier);
  const info = chooseInfo(root);
  if (!info && msgType !== 'Cancel') return null;
  let geocodes = 0;
  const areas = childrenOf(info, 'area').slice(0, MAX_AREAS).map(a => ({
    areaDesc: clip(textOf(a, 'areaDesc'), 1000),
    geocodes: childrenOf(a, 'geocode').filter(() => ++geocodes <= MAX_GEOCODES)
      .map(g => ({ valueName: clip(textOf(g, 'valueName'), 64), value: clip(textOf(g, 'value'), 64) }))
      .filter(g => g.value),
  }));
  return {
    identifier: clip(identifier, 256), sender: clip(sender, 256), sent, msgType, references,
    info: {
      language: textOf(info, 'language'),
      senderName: clip(textOf(info, 'senderName'), 200),
      event: clip(textOf(info, 'event'), 200),
      severity: pick(textOf(info, 'severity'), SEVERITY, 'Unknown'),
      urgency: pick(textOf(info, 'urgency'), URGENCY, 'Unknown'),
      certainty: clip(textOf(info, 'certainty'), 32),
      headline: clip(textOf(info, 'headline'), 300),
      description: clip(textOf(info, 'description')),
      instruction: clip(textOf(info, 'instruction')),
      web: /^https?:\/\//i.test(textOf(info, 'web')) ? clip(textOf(info, 'web'), 500) : '',
      effective: validTime(textOf(info, 'effective')), onset: validTime(textOf(info, 'onset')), expires: validTime(textOf(info, 'expires')),
      areas,
    },
  };
}

export const parseCap = (xml: string) => readCap(parseXml(xml, CAP_XML_LIMITS));
export const parseFeed = (xml: string) => parseXml(xml, FEED_XML_LIMITS);
