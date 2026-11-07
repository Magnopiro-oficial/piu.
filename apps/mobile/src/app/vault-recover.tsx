import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { useT } from '../i18n';
import { BackupError, openBackup, parseBackupHeader } from '../lib/backupFile';
import { pickBackupFile } from '../lib/migrationIO';
import { usePreventCapture } from '../lib/screenCapture';
import { isValidPhrase, PHRASE_WORDS } from '../protocol';
import { useKeys } from '../state/keys';
import { useStore } from '../state/store';
import { fontFamily } from '../theme/fonts';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { BackHeader } from '../ui/Controls';
import { Icon } from '../ui/Icon';
import { PhraseInput } from '../ui/PhraseInput';
import { Screen } from '../ui/Screen';
import { StepHeader } from '../ui/StepHeader';
import { T } from '../ui/T';

/**
 * A cópia da frase protegida pela biometria ficou ilegível (o sistema a invalida quando a biometria
 * muda ou o bloqueio de tela sai — B-01, docs/seguranca/biometria-cofre.md). As conversas seguem
 * funcionando; para revelar, assinar e transferir, a pessoa confirma a frase de novo (papel ou arquivo
 * de backup). Só a frase DESTA identidade é aceita: nada de trocar de identidade por aqui, nem aviso
 * de troca de aparelho para os contatos.
 */
export default function VaultRecover() {
  const { c } = useTheme();
  const t = useT();
  const { showToast } = useStore();
  const { recoverPhrase } = useKeys();
  usePreventCapture('vault-recover');
  const [mode, setMode] = useState<'phrase' | 'file'>('phrase');
  const [words, setWords] = useState<string[]>(Array(PHRASE_WORDS).fill(''));
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const valid = isValidPhrase(words);
  const canGo = !busy && (mode === 'phrase' ? valid : !!file && !!pw);

  const choose = async () => {
    setErr(null);
    try {
      const f = await pickBackupFile();
      if (!f) return;
      parseBackupHeader(f.text);
      setFile(f);
    } catch { setFile(null); setErr(t('restore.err.format')); }
  };

  const go = async () => {
    setErr(null); setBusy(true);
    try {
      const phrase = mode === 'phrase' ? words : (await openBackup(file!.text, pw)).phrase;
      if (!(await recoverPhrase(phrase))) { setErr(t('vaultRecover.other')); return; }
      setPw(''); setWords(Array(PHRASE_WORDS).fill(''));
      router.back();
      showToast({ icon: 'key', title: t('vaultRecover.done'), body: t('vaultRecover.done.body') });
    } catch (e) {
      setErr(e instanceof BackupError && e.code === 'AUTH' ? t('restore.err.auth') : mode === 'file' ? t('restore.err.open') : t('restore.err.vault'));
    } finally { setBusy(false); }
  };

  return (
    <Screen>
      <BackHeader />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <StepHeader step={t('vaultRecover.step')} title={t('vaultRecover.title')} sub={t('vaultRecover.sub')} />
        <View style={{ marginHorizontal: 20, padding: 14, borderRadius: 18, backgroundColor: c.bg2, flexDirection: 'row', gap: 12 }}>
          <Icon name="lock" size={20} w={300} />
          <T size={13} lh={1.45} color={c.ink2} style={{ flex: 1 }}>{t('vaultRecover.chatsOk')}</T>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 14, marginHorizontal: 20 }}>
          <Button label={t('vaultRecover.byPhrase')} variant={mode === 'phrase' ? undefined : 'outline'} height={42} fontSize={13.5} style={{ flex: 1 }} onPress={() => { setMode('phrase'); setErr(null); }} />
          <Button label={t('vaultRecover.byFile')} variant={mode === 'file' ? undefined : 'outline'} height={42} fontSize={13.5} style={{ flex: 1 }} onPress={() => { setMode('file'); setErr(null); }} />
        </View>
        {mode === 'phrase' ? (
          <View style={{ marginTop: 14, marginHorizontal: 20 }}>
            <PhraseInput words={words} onChange={w => { setWords(w); setErr(null); }} />
          </View>
        ) : (
          <View style={{ marginTop: 14, marginHorizontal: 20, padding: 14, borderRadius: 20, backgroundColor: c.bg2, gap: 10 }}>
            <T size={13.5} w={file ? 600 : 400} color={file ? c.ink : c.ink2} mono={!!file} numberOfLines={1}>{file ? file.name : t('restore.noFile')}</T>
            <Button label={file ? t('restore.chooseOther') : t('restore.chooseFile')} variant="outline" height={44} disabled={busy} onPress={() => { void choose(); }} />
            {file && (
              <TextInput value={pw} onChangeText={v => { setPw(v); setErr(null); }} placeholder={t('backup.pw.label')} placeholderTextColor={c.ink3} accessibilityLabel={t('backup.pw.label')}
                secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="password" editable={!busy}
                style={{ height: 48, paddingHorizontal: 14, borderRadius: 14, backgroundColor: c.bg, color: c.ink, fontSize: 15, fontFamily: fontFamily(500) }} />
            )}
          </View>
        )}
        {err && <T size={13} accessibilityRole="alert" style={{ paddingTop: 12, paddingHorizontal: 24 }}>{err}</T>}
        <View style={{ paddingTop: 22, paddingHorizontal: 20 }}>
          <Button label={busy ? t('restore.wait') : t('common.continue')} disabled={!canGo} onPress={() => { void go(); }} />
        </View>
      </ScrollView>
    </Screen>
  );
}
