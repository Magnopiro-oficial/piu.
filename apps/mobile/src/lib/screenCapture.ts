import { usePreventScreenCapture } from 'expo-screen-capture';
import { Platform } from 'react-native';

/** Bloqueia prints e gravação de tela enquanto a tela estiver aberta. Na web não existe: não faz nada. */
export const usePreventCapture: (key: string) => void = Platform.OS === 'web' ? () => {} : usePreventScreenCapture;
