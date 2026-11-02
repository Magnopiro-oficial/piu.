import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { RESTORE_OPTS } from '../data/settings';
import { BackupError, openBackup, parseBackupHeader } from '../lib/backupFile';
import { pickBackupFile } from '../lib/migrationIO';
import { requestSessionRotation, stashRestoredData } from '../lib/migrationState';
import { isValidPhrase, PHRASE_WORDS, WORDLIST } from '../protocol';
import { useKeys } from '../state/keys';
import { useSettings } from '../state/settings';
import { fontFamily } from '../theme/fonts';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { BackHeader } from '../ui/Controls';
import { Icon } from '../ui/Icon';
import { PhraseInput } from '../ui/PhraseInput';
import { Screen } from '../ui/Screen';
import { OptionCard } from '../ui/Settings';
import { StepHeader } from '../ui/StepHeader';
import { T } from '../ui/T';

/**
 * Restaurar: as chaves vêm de outro aparelho seu, da frase ou de um arquivo de backup. Sem servidor.
 * - Frase: recria as mesmas chaves.
 * - Arquivo: abre o `.piu` com a senha (scrypt + XChaCha20-Poly1305) e aplica a frase que está dentro.
 * - Outro aparelho: a transferência (QR + código de 4 palavras) acontece na tela seguinte.
 */
export default function Restore() {
  const { c } = useTheme();
  const { restoreMode, setRestoreMode } = useSettings();
  const { restore } = useKeys();
  const [words, setWords] = useState<string[]>(Array(PHRASE_WORDS).fill(''));
  const [err, setErr] = useState<string | null>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const filled = words.every(Boolean);
  const unknown = words.filter(w => w && !WORDLIST.includes(w)).length;
  const valid = isValidPhrase(words);
  const hint = !filled ? `${words.filter(Boolean).length} de ${PHRASE_WORDS} palavras`
    : unknown ? `${unknown} ${unknown > 1 ? 'palavras não estão' : 'palavra não está'} na lista`
      : valid ? 'Frase confere.' : 'As palavras não formam uma frase válida. Confira a ordem e cada palavra.';
  const canGo = !busy && (restoreMode === 'device' || (restoreMode === 'phrase' && valid) || (restoreMode === 'file' && !!file && !!pw));

  const choose = async () => {
    setErr(null);
    try {
      const f = await pickBackupFile();
      if (!f) return;
      parseBackupHeader(f.text); // recusa na hora o que não é backup do Piu
      setFile(f);
    } catch (e) {
      setFile(null);
      setErr((e as Error).message);
    }
  };

  const go = async () => {
    setErr(null);
    if (restoreMode === 'device') { router.push('/migrate'); return; }
    setBusy(true);
    try {
      if (restoreMode === 'phrase') {
        await restore(words);
        await requestSessionRotation('restaurado pela frase');
        router.push('/migrate');
        return;
      }
      if (!file) return;
      setProgress(0);
      const content = await openBackup(file.text, pw, { onProgress: setProgress });
      await restore(content.phrase);
      if (content.data && Object.keys(content.data).length) await stashRestoredData(content.data);
      await requestSessionRotation('restaurado do arquivo');
      setPw('');
      router.push({ pathname: '/migrate', params: { file: file.name, hist: content.data ? String(Object.keys(content.data).length) : '0' } });
    } catch (e) {
      setErr(e instanceof BackupError ? e.message : restoreMode === 'file' ? 'Não foi possível abrir o arquivo.' : 'Não foi possível guardar as chaves no cofre do aparelho.');
    } finally { setBusy(false); }
  };

  return (
    <Screen>
      <BackHeader />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <StepHeader step="RECUPERAR" title="Traga suas chaves para este aparelho." sub="Sem servidor: elas vêm de outro aparelho seu, da sua frase ou de um arquivo de backup." />
        <View accessibilityRole="radiogroup" accessibilityLabel="Como recuperar" style={{ paddingHorizontal: 20, gap: 10 }}>
          {RESTORE_OPTS.map(([k, icon, title, desc]) => <OptionCard key={k} icon={icon} title={title} desc={desc} on={restoreMode === k} onPress={() => { setRestoreMode(k); setErr(null); }} />)}
        </View>
        {restoreMode === 'phrase' && (
          <View style={{ marginTop: 14, marginHorizontal: 20, gap: 8 }}>
            <PhraseInput words={words} onChange={setWords} />
            <T size={13} color={valid ? c.ink : c.ink2} accessibilityLiveRegion="polite" style={{ paddingHorizontal: 4 }}>{hint}</T>
          </View>
        )}
        {restoreMode === 'device' && (
          <View style={{ marginTop: 14, marginHorizontal: 20, padding: 14, borderRadius: 18, backgroundColor: c.bg2, flexDirection: 'row', gap: 12 }}>
            <Icon name="phonelink_ring" size={20} w={300} />
            <T size={13} lh={1.45} color={c.ink2} style={{ flex: 1 }}>No aparelho antigo, abra o Piu em Perfil → Aparelhos → Adicionar aparelho. Os dois precisam estar lado a lado.</T>
          </View>
        )}
        {restoreMode === 'file' && (
          <View style={{ marginTop: 14, marginHorizontal: 20, padding: 14, borderRadius: 20, backgroundColor: c.bg2, gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Icon name="sd_card" size={22} w={300} />
              <T size={13.5} w={file ? 600 : 400} color={file ? c.ink : c.ink2} mono={!!file} numberOfLines={1} style={{ flex: 1 }}>{file ? file.name : 'Nenhum arquivo escolhido'}</T>
            </View>
            <Button label={file ? 'Escolher outro arquivo' : 'Escolher arquivo .piu'} variant="outline" height={44} disabled={busy} onPress={() => { void choose(); }} />
            {file && (
              <TextInput value={pw} onChangeText={t => { setPw(t); setErr(null); }} placeholder="Senha do arquivo" placeholderTextColor={c.ink3} accessibilityLabel="Senha do arquivo"
                secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="password" editable={!busy} onSubmitEditing={() => { if (canGo) void go(); }}
                style={{ height: 48, paddingHorizontal: 14, borderRadius: 14, backgroundColor: c.bg, color: c.ink, fontSize: 15, fontFamily: fontFamily(500) }} />
            )}
            {busy && <T size={12.5} color={c.ink2} accessibilityLiveRegion="polite">Abrindo o arquivo… {Math.round(progress * 100)}%</T>}
          </View>
        )}
        {err && <T size={13} accessibilityRole="alert" style={{ paddingTop: 12, paddingHorizontal: 24 }}>{err}</T>}
        <View style={{ paddingTop: 22, paddingHorizontal: 20 }}>
          <Button label={busy ? 'Aguarde…' : 'Continuar'} disabled={!canGo} onPress={() => { void go(); }} />
        </View>
      </ScrollView>
    </Screen>
  );
}
