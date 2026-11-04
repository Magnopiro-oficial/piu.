import { useLocalSearchParams } from 'expo-router';
import { useStore } from '../../state/store';
import { useTheme } from '../../theme/ThemeProvider';
import { BackHeader } from '../../ui/Controls';
import { RealGroupInfo } from '../../ui/RealGroupInfo';
import { Screen } from '../../ui/Screen';
import { T } from '../../ui/T';

/**
 * Dados do grupo ou canal (FUN-006/007): convite, permissões, membros, papéis e troca de chave ao
 * remover alguém. Tudo vem do estado real do grupo no mensageiro (RealGroupInfo).
 */
export default function GroupInfo() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const chat = useStore().chats.find(x => x.id === id && x.group);
  if (!chat) return <Screen><BackHeader /><T size={15} color={c.ink2} align="center">Grupo não encontrado.</T></Screen>;
  return <RealGroupInfo chat={chat} />;
}
