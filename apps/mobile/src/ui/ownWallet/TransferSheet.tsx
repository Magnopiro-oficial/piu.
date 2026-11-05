import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '../../i18n';
import { useTheme } from '../../theme/ThemeProvider';

/** Formulário da carteira: área rolável e limitada, acima do teclado, sem alterar as outras folhas. */
export function TransferSheet({ onClose, label, children }: { onClose: () => void; label: string; children: ReactNode }) {
  const { c, reduceMotion } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  return (
    <Modal transparent visible animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1 }}>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('sheet.close', { label: label.toLowerCase() })}
          style={{ position: 'absolute', inset: 0, backgroundColor: c.scrim }} />
        <KeyboardAvoidingView pointerEvents="box-none" behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <View accessibilityViewIsModal accessibilityLabel={label} style={{ maxHeight: '92%', backgroundColor: c.bg, borderTopLeftRadius: 30, borderTopRightRadius: 30, overflow: 'hidden' }}>
            <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
              contentContainerStyle={{ paddingTop: 10, paddingHorizontal: 20, paddingBottom: Math.max(insets.bottom, 16) + 16, gap: 18 }}>
              <View style={{ alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: c.bg3 }} />
              {children}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
