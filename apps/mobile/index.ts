/**
 * Entrada do app. A ordem importa: a cripto do Hermes antes de tudo, a tarefa sem tela `PiuCore`
 * (core/headless.ts) registrada antes de existir qualquer tela, e só depois o expo-router.
 */
import './src/lib/cryptoPolyfill';
import './src/core/headless';
import 'expo-router/entry';
