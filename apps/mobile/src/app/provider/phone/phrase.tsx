import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { usePreventCapture } from '../../../lib/screenCapture';
import { phraseIssue, phraseSlots, phraseSuggestions, placeWord, type PhraseIssue } from '../../../lib/phraseConfirm';
import { PHRASE_WORDS } from '../../../protocol';
import { useKeys } from '../../../state/keys';
import { PhraseView } from '../../../ui/NodeViews';
import { Screen } from '../../../ui/Screen';

/**
 * N4e "Confirme a sua frase de novo" (Piu 11), adaptada (lib/phraseConfirm.ts): com a biometria trocada,
 * o celular não tem mais a frase (só a semente), então 3 palavras não bastam — a pessoa digita as 12,
 * com sugestões da lista BIP39, e o app confere derivando a semente (`recoverPhrase`, a mesma regra de
 * /vault-recover). N4f: palavra fora da lista (posição dita: é a que ela digitou), frase inválida (sem
 * dizer qual palavra) ou de outra identidade; a fileira chacoalha. N4g confirmada → volta ao N4.
 * N4h sem a frase agora → a caução espera. O arquivo de backup abre em /vault-recover.
 */
export default function PhoneNodePhrase() {
  const { recoverPhrase } = useKeys();
  usePreventCapture('phone-node-phrase');
  const [words, setWords] = useState<string[]>(() => Array(PHRASE_WORDS).fill(''));
  const [cursor, setCursor] = useState(0);
  const [issue, setIssue] = useState<PhraseIssue | { kind: 'other' } | null>(null);
  const [shake, setShake] = useState(0);
  const [result, setResult] = useState<'confirmed' | 'without' | null>(null);
  const [busy, setBusy] = useState(false);
  const panel = () => router.replace('/provider/phone' as Href);

  const type = (i: number, v: string) => {
    setIssue(null);
    if (/\s\S/.test(v.trim())) { const r = placeWord(words, i, v); setWords(r.words); setCursor(r.cursor); return; } // colou a frase
    const next = [...words]; next[i] = v.toLowerCase().replace(/\s/g, ''); setWords(next);
  };
  const pick = (w: string) => { const r = placeWord(words, cursor, w); setWords(r.words); setCursor(r.cursor); setIssue(null); };
  const submit = async () => {
    const p = phraseIssue(words);
    if (p.kind !== 'ok') { setIssue(p); setShake(n => n + 1); if (p.kind === 'notInList') setCursor(p.index); return; }
    setBusy(true);
    try {
      if (await recoverPhrase(words)) { setWords(Array(PHRASE_WORDS).fill('')); setResult('confirmed'); }
      else { setIssue({ kind: 'other' }); setShake(n => n + 1); }
    } catch { setIssue({ kind: 'checksum' }); setShake(n => n + 1); }
    finally { setBusy(false); }
  };

  return (
    <Screen>
      <PhraseView
        d={{ words, cursor, slots: phraseSlots(words, cursor), issue, shake, suggestions: phraseSuggestions(words[cursor] ?? '').filter(w => w !== words[cursor]), result, busy, n: PHRASE_WORDS }}
        a={{
          close: () => (router.canGoBack() ? router.back() : panel()),
          focus: setCursor, type, pick, submit: () => { void submit(); },
          without: () => { setWords(Array(PHRASE_WORDS).fill('')); setResult('without'); },
          file: () => router.push('/vault-recover' as Href),
          confirmBond: () => router.replace('/provider/phone/confirm' as Href),
          panel,
        }} />
    </Screen>
  );
}
