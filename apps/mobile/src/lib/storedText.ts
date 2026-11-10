/**
 * Textos do sistema que a conversa grava (subtítulo e avisos): ficam salvos em pt-BR, como sempre
 * ficaram, e são traduzidos na hora de mostrar. Assim conversas antigas também seguem o idioma do
 * app (puro, testado em __tests__/storedText.test.ts). Os textos vêm de i18n/stored/pt-BR.ts.
 */
import { t as tGlobal, type Key, type Vars } from '../i18n/core';
import { storedPtBR } from '../i18n/stored/pt-BR';

type Tr = (key: Key, vars?: Vars) => string;

/** O que se grava na conversa (pt-BR, igual ao dicionário de referência). */
export const STORED = {
  subRequest: storedPtBR['stored.sub.request'],
  subE2e: storedPtBR['stored.sub.e2e'],
  subNearby: storedPtBR['stored.sub.nearby'],
  sysRequest: storedPtBR['stored.sys.request'],
  sysKeys: storedPtBR['stored.sys.keys'],
  sysNearYou: storedPtBR['stored.sys.nearYou'],
  sysRevoked: storedPtBR['stored.sys.revoked'],
  sysLeftChannel: storedPtBR['stored.sys.leftChannel'],
  sysRemoved: storedPtBR['stored.sys.removed'],
  sysGroupRevoked: storedPtBR['stored.sys.groupRevoked'],
  sysGroup: storedPtBR['stored.sys.group'],
  sysChannel: storedPtBR['stored.sys.channel'],
  sysCommunity: storedPtBR['stored.sys.community'],
} as const;

/** "{name} aceitou seu convite de Por perto…" (sem nome: "A pessoa aceitou…"). */
export const nearAcceptedText = (name: string) =>
  name ? storedPtBR['stored.sys.nearThem'].replace('{name}', name) : storedPtBR['stored.sys.nearSomeone'];

const BY_TEXT = new Map<string, Key>(Object.entries(storedPtBR).filter(([k]) => k !== 'stored.sys.nearThem').map(([k, v]) => [v, k as Key]));
const [NEAR_HEAD, NEAR_TAIL] = storedPtBR['stored.sys.nearThem'].split('{name}') as [string, string];

/** Texto gravado → idioma do app. O que não for texto do sistema (o que a pessoa escreveu) volta igual. */
export function localizeStored(text: string, t: Tr = tGlobal): string {
  const k = BY_TEXT.get(text);
  if (k) return t(k);
  if (text.startsWith(NEAR_HEAD) && text.endsWith(NEAR_TAIL) && text.length > NEAR_HEAD.length + NEAR_TAIL.length) {
    return t('stored.sys.nearThem', { name: text.slice(NEAR_HEAD.length, text.length - NEAR_TAIL.length) });
  }
  return text;
}
