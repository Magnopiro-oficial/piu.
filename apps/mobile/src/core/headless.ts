/**
 * Registro da tarefa sem tela `PiuCore` (core/coreTask.ts). Importado pela entrada do app (index.ts)
 * antes do expo-router: a tarefa existe antes de qualquer tela e o PiuRelayService pode iniciá-la com
 * o app fechado. Só no Android (o serviço é de lá; a web não tem Headless JS).
 */
import { AppRegistry, Platform } from 'react-native';
import { CORE_TASK, coreTask } from './coreTask';
import { bootCore, untilStopped } from '.';

if (Platform.OS === 'android') AppRegistry.registerHeadlessTask(CORE_TASK, () => coreTask({ boot: bootCore, untilStopped }));
