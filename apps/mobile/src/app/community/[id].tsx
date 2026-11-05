import { useLocalSearchParams } from 'expo-router';
import { useT } from '../../i18n';
import { useStore } from '../../state/store';
import { useTheme } from '../../theme/ThemeProvider';
import { BackHeader } from '../../ui/Controls';
import { RealCommunity } from '../../ui/RealCommunity';
import { Screen } from '../../ui/Screen';
import { T } from '../../ui/T';

/** Comunidade (FUN-008): avisos e os grupos e canais que ela reúne, pelo estado real do grupo. */
export default function Community() {
  const { c } = useTheme();
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const chat = useStore().chats.find(x => x.id === id && x.group);
  if (!chat) return <Screen><BackHeader /><T size={15} color={c.ink2} align="center">{t('community.notFound')}</T></Screen>;
  return <RealCommunity chat={chat} />;
}
