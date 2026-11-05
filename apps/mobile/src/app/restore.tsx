import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { RESTORE_OPTS } from '../data/settings';
import { BackupError, openBackup, parseBackupHeader } from '../lib/backupFile';
import { useT } from '../i18n';
import { pickBackupFile } from '../lib/migrationIO';
import { requestDeviceChangeNotice, requestSessionRotation, stashRestoredData } from '../lib/migrationState';
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
 * - Nos dois casos as sessões antigas saem e os contatos recebem um aviso assinado de troca de aparelho.
 * - Outro aparelho: a transferência (QR + código de 4 palavras) acontece na tela seguinte.
 */
/** Erro do arquivo de backup no idioma em uso: o código vem de lib/backupFile.ts; a mensagem pt-BR fica lá. */
function backupErr(e: unknown, t: ReturnType<typeof useT>): string {
  if (!(e instanceof BackupError)) return (e as Error).message;
  return e.code === 'AUTH' ? t('restore.err.auth') : e.code === 'CONTENT' ? t('restore.err.content') : e.code === 'PASSWORD' ? t('restore.err.password') : t('restore.err.format');
}

export default function Restore() {
  const { c } = useTheme();
  const t = useT();
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
  const hint = !filled ? t('restore.words', { n: words.filter(Boolean).length, total: PHRASE_WORDS })
    : unknown ? t('restore.unknownWords', { count: unknown })
      : valid ? t('restore.phraseOk') : t('restore.phraseInvalid');
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
      setErr(backupErr(e, t));
    }
  };

  const go = async () => {
    setErr(null);
    if (restoreMode === 'device') { router.push('/migrate'); return; }
    setBusy(true);
    try {
      if (restoreMode === 'phrase') {
        await restore(words);
        // O pedido do aviso vem antes: a rotação remonta o mensageiro, que assina e distribui.
        await requestDeviceChangeNotice('phrase');
        await requestSessionRotation('restaurado pela frase');
        router.push('/migrate');
        return;
      }
      if (!file) return;
      setProgress(0);
      const content = await openBackup(file.text, pw, { onProgress: setProgress });
      await restore(content.phrase);
      if (content.data && Object.keys(content.data).length) await stashRestoredData(content.data);
      // O pedido do aviso vem antes: a rotação remonta o mensageiro, que assina e distribui.
      await requestDeviceChangeNotice('file');
      await requestSessionRotation('restaurado do arquivo');
      setPw('');
      router.push({ pathname: '/migrate', params: { file: file.name, hist: content.data ? String(Object.keys(content.data).length) : '0' } });
    } catch (e) {
      setErr(e instanceof BackupError ? backupErr(e, t) : restoreMode === 'file' ? t('restore.err.open') : t('restore.err.vault'));
    } finally { setBusy(false); }
  };

  return (
    <Screen>
      <BackHeader />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <StepHeader step={t('restore.step')} title={t('restore.title')} sub={t('restore.sub')} />
        <View accessibilityRole="radiogroup" accessibilityLabel={t('restore.how')} style={{ paddingHorizontal: 20, gap: 10 }}>
          {RESTORE_OPTS.map(([k, icon, title, desc]) => <OptionCard key={k} icon={icon} title={t(title)} desc={t(desc)} on={restoreMode === k} onPress={() => { setRestoreMode(k); setErr(null); }} />)}
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
            <T size={13} lh={1.45} color={c.ink2} style={{ flex: 1 }}>{t('restore.device.hint')}</T>
          </View>
        )}
        {restoreMode === 'file' && (
          <View style={{ marginTop: 14, marginHorizontal: 20, padding: 14, borderRadius: 20, backgroundColor: c.bg2, gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Icon name="sd_card" size={22} w={300} />
              <T size={13.5} w={file ? 600 : 400} color={file ? c.ink : c.ink2} mono={!!file} numberOfLines={1} style={{ flex: 1 }}>{file ? file.name : t('restore.noFile')}</T>
            </View>
            <Button label={file ? t('restore.chooseOther') : t('restore.chooseFile')} variant="outline" height={44} disabled={busy} onPress={() => { void choose(); }} />
            {file && (
              <TextInput value={pw} onChangeText={v => { setPw(v); setErr(null); }} placeholder={t('backup.pw.label')} placeholderTextColor={c.ink3} accessibilityLabel={t('backup.pw.label')}
                secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="password" editable={!busy} onSubmitEditing={() => { if (canGo) void go(); }}
                style={{ height: 48, paddingHorizontal: 14, borderRadius: 14, backgroundColor: c.bg, color: c.ink, fontSize: 15, fontFamily: fontFamily(500) }} />
            )}
            {busy && <T size={12.5} color={c.ink2} accessibilityLiveRegion="polite">{t('restore.opening')} {Math.round(progress * 100)}%</T>}
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
