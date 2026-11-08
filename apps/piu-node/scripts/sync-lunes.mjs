// Copia o cliente da Lunes Mainnet e o núcleo da carteira do app (apps/mobile/src/lib) para src/lunes/,
// com imports `.js`. Mesmo motivo de sync-protocol.mjs: o piu-node compila e roda sozinho (Linux/OpenWrt,
// app desktop), sem o projeto Expo. A fonte da verdade é a do app; test/lunes.test.ts acusa cópia
// desatualizada.
//
// O que o nó faz com cada cópia (a chave da carteira fica SÓ no celular; o nó nunca a tem):
// - xxhash, ss58, lunesRpc: ler saldo, nonce, taxa, validar sem enviar, enviar e procurar no bloco.
// - extrinsic: montar o call e o contexto de assinatura, e DECODIFICAR o extrinsic que o celular devolve
//   (conferir call, assinante, era, nonce) antes de enviar.
// - walletKey: só `verifyWalletSignature` (sr25519) na conferência; a derivação da chave existe no
//   arquivo porque é cópia fiel, mas nenhuma rota a chama (os testes usam para simular o celular).
// - lunesHistory (+ walletCore, que ela importa): histórico do endereço no indexador público.
// - carryGateway: papel de gateway (transações assinadas que chegam pela malha → Mainnet; pacotes selados
//   → caixa do validador), docs/carteira/transacoes-pela-malha.md. Usa protocol/carry (sync-protocol.mjs).
// Uso: node scripts/sync-lunes.mjs          → atualiza a cópia
//      node scripts/sync-lunes.mjs --check  → só confere (código 1 se estiver diferente)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const SRC = join(here, '../../mobile/src/lib');
export const DST = join(here, '../src/lunes');
/** Nada de react-native nesses módulos. */
export const I18N_SRC = join(here, '../../mobile/src/i18n');
export const I18N_DST = join(here, '../src/i18n');
// pt-BR do app junta dicionários de subpastas (Piu 11 "modo nó", Piu 13 "Pontos" e "Conectar ao computador", chamada de voz, LoRa e Mapa da rede): vêm junto.
export const I18N_FILES = ['core', 'pt-BR', 'piu11/pt-BR', 'pontos/pt-BR', 'linkDesktop/pt-BR', 'call/pt-BR', 'lora/pt-BR', 'map/pt-BR'];
export const FILES = ['xxhash', 'ss58', 'lunesRpc', 'walletKey', 'extrinsic', 'walletCore', 'lunesHistory', 'carryGateway'];

/**
 * Ajustes de import (o comportamento é idêntico): o tipo `IconName` vem da UI do app, que não existe
 * aqui; no nó ele vira `string` (só rotula o ícone de uma linha do histórico). `../protocol/phrase` é a
 * cópia de src/protocol (sync-protocol.mjs). Se a fonte mudar e um ajuste não se aplicar mais, o
 * script avisa em vez de gerar uma cópia que não compila.
 */
const IMPORT_PATCHES = {
  walletCore: [["from '../i18n/core';", "from '../i18n/core.js';"], ["import type { IconName } from '../ui/Icon';", "type IconName = string; // no app: import type { IconName } from '../ui/Icon'"]],
  lunesHistory: [["import type { IconName } from '../ui/Icon';", "type IconName = string; // no app: import type { IconName } from '../ui/Icon'"]],
  walletKey: [["from '../protocol/phrase';", "from '../protocol/phrase.js';"]],
  carryGateway: [["from '../protocol/carry';", "from '../protocol/carry.js';"], ["from '../protocol/keys';", "from '../protocol/keys.js';"]],
};

export function generate(name) {
  let src = readFileSync(join(SRC, `${name}.ts`), 'utf8');
  for (const [from, to] of IMPORT_PATCHES[name] ?? []) {
    if (src.includes(from)) src = src.replace(from, to);
    else if (!src.includes(to)) throw new Error(`Ajuste de import não se aplica mais em ${name}.ts: revise IMPORT_PATCHES.`);
  }
  const body = src.replace(/(from\s+'\.\/[A-Za-z0-9-]+)'/g, "$1.js'");
  return `// GERADO por scripts/sync-lunes.mjs a partir de apps/mobile/src/lib/${name}.ts. Não edite aqui.\n${body}`;
}

/** Núcleo puro de textos usado por walletCore; sem hooks React nem módulos Expo. */
export function generateI18n(name) {
  const src = readFileSync(join(I18N_SRC, `${name}.ts`), 'utf8');
  // Imports relativos ganham `.js` (ESM do Node), inclusive os de subpasta (`./piu11/pt-BR`).
  const body = src.replace(/(from\s+'\.\/[A-Za-z0-9/-]+)'/g, "$1.js'");
  return `// GERADO por scripts/sync-lunes.mjs a partir de apps/mobile/src/i18n/${name}.ts. Não edite aqui.\n${body}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  if (!existsSync(SRC)) {
    console.error(`Fonte não encontrada: ${SRC}`);
    process.exit(check ? 0 : 1);
  }
  let stale = 0;
  mkdirSync(DST, { recursive: true });
  for (const f of FILES) {
    const out = generate(f);
    const path = join(DST, `${f}.ts`);
    const cur = existsSync(path) ? readFileSync(path, 'utf8') : '';
    if (cur === out) continue;
    stale++;
    if (check) console.error(`Desatualizado: src/lunes/${f}.ts`);
    else writeFileSync(path, out);
  }
  if (!check) mkdirSync(I18N_DST, { recursive: true });
  for (const f of I18N_FILES) {
    const out = generateI18n(f);
    const path = join(I18N_DST, `${f}.ts`);
    const cur = existsSync(path) ? readFileSync(path, 'utf8') : '';
    if (cur === out) continue;
    stale++;
    if (check) console.error(`Desatualizado: src/i18n/${f}.ts`);
    else { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, out); }
  }
  if (check && stale) process.exit(1);
  console.log(check ? 'Cliente da Lunes em dia.' : `Cliente da Lunes sincronizado (${stale} arquivo(s) atualizado(s)).`);
}
