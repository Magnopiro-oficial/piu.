import { getRandomValues } from 'expo-crypto';

/**
 * O Hermes (motor JS do React Native) não tem `crypto.getRandomValues`, que as bibliotecas de
 * criptografia (@noble) usam para gerar chaves e nonces. Aqui ele passa a vir do gerador seguro
 * do sistema (expo-crypto). No navegador já existe e nada muda. Importar antes de qualquer uso.
 */
const g = globalThis as { crypto?: { getRandomValues?: unknown } };
if (typeof g.crypto?.getRandomValues !== 'function') {
  g.crypto = { ...(g.crypto ?? {}), getRandomValues };
}
