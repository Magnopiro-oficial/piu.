import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, Share, View } from 'react-native';
import { hasStoreLinks, inviteLink, inviteShareText } from '../../lib/inviteLink';
import { APP_SCHEME, STORE_LINKS, useInviter } from '../../lib/inviter';
import { useMyCard } from '../../state/messaging';
import { useStore } from '../../state/store';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../../ui/Button';
import { BackHeader } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { Screen } from '../../ui/Screen';
import { T } from '../../ui/T';

/**
 * Enviar o convite de longe: o link `piu://invite/accept?c=…` com o seu cartão de contato assinado
 * (uso único, 24 h), pelo compartilhamento do sistema. Os links das lojas vêm de
 * `expo.extra.storeLinks` (app.json); vazios, o texto leva só o convite.
 */
export default function ShareInvite() {
  const { c } = useTheme();
  const { identity, showToast } = useStore();
  const { name, words } = useInviter();
  const [card] = useMyCard(identity);
  const link = card ? inviteLink(card, APP_SCHEME) : '';
  const message = link ? inviteShareText({ name, link, store: STORE_LINKS }) : '';
  const stores = hasStoreLinks(STORE_LINKS);

  const share = async () => {
    if (!message) return;
    try { await Share.share({ message }); }
    catch { showToast({ icon: 'error', title: 'Não foi possível compartilhar', body: 'Copie o link e envie por onde preferir.' }); }
  };
  const copy = async () => {
    if (!link) return;
    await Clipboard.setStringAsync(link);
    showToast({ icon: 'content_copy', title: 'Link copiado', body: 'Envie só para a pessoa que você quer convidar. Vale uma vez, por 24 h.' });
  };

  return (
    <Screen>
      <BackHeader title="Enviar convite" />
      <ScrollView contentContainerStyle={{ paddingTop: 4, paddingHorizontal: 20, paddingBottom: 32, gap: 14 }}>
        <View style={{ borderRadius: 22, backgroundColor: c.bg2 }}>
          <Step n={1} title="Envie o link">
            <T size={12} mono lh={1.5} color={c.ink2} numberOfLines={3} selectable>{link || 'Preparando o convite…'}</T>
            <T size={12.5} lh={1.4} color={c.ink2}>Leva o seu nome e as suas chaves públicas, assinados. Uso único: o primeiro que abrir vira seu contato. Para outra pessoa, volte e gere um novo código.</T>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button label="Compartilhar" height={44} fontSize={14} style={{ flex: 1, paddingHorizontal: 4 }} disabled={!message} onPress={share} left={<Icon name="upload" size={18} color={c.invink} />} />
              <Button label="Copiar link" variant="outline" height={44} fontSize={14} style={{ flex: 1, paddingHorizontal: 4 }} disabled={!link} onPress={copy} left={<Icon name="content_copy" size={18} />} />
            </View>
          </Step>
          <View style={{ height: 1, backgroundColor: c.line, marginHorizontal: 16 }} />
          <Step n={2} title="Confiram este código">
            <View accessibilityLabel={'Código de segurança: ' + words.join(', ')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {words.map((w, i) => (
                <View key={`${w}-${i}`} style={{ width: '48.5%', flexGrow: 1, height: 40, borderRadius: 12, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
                  <T size={17} w={650} ls={-0.02}>{w}</T>
                </View>
              ))}
            </View>
            <T size={12.5} lh={1.4} color={c.ink2}>Vem da sua chave. Ao abrir o convite, a outra pessoa vê as mesmas 4 palavras. Confiram por uma ligação ou pessoalmente; se forem diferentes, ela não deve aceitar.</T>
          </Step>
        </View>

        <View style={{ paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2, flexDirection: 'row', gap: 10 }}>
          <Icon name="install_mobile" size={17} />
          <T size={12.5} lh={1.45} color={c.ink2} style={{ flex: 1 }}>
            {stores
              ? 'A mensagem também leva o link da loja, para quem ainda não tem o Piu instalar antes de abrir o convite.'
              : 'Quem recebe precisa ter o Piu instalado para abrir o convite. Os links da App Store e do Google Play entram nesta mensagem quando o app for publicado nas lojas.'}
          </T>
        </View>

        <Button label="Voltar ao convite" variant="soft" height={52} onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 14, padding: 16 }}>
      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}><T size={12} w={600} color={c.invink}>{n}</T></View>
      <View style={{ flex: 1, gap: 8, minWidth: 0 }}>
        <T size={14.5} w={600}>{title}</T>
        {children}
      </View>
    </View>
  );
}
