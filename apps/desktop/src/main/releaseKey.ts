/**
 * Chave pública OpenPGP do projeto, FIXADA no app, que confere o `SHA256SUMS.txt.asc` dos releases
 * (scripts/sign-release.sh assina com a chave de docs/distribuicao/piu-release.fpr).
 *
 * AINDA VAZIA: a Lunes não publicou a chave. Enquanto estiver vazia, o Piu encontra versões novas mas
 * NÃO baixa nem instala nada ("verificação indisponível"): só abre a página da versão no navegador.
 *
 * Para ligar: `gpg --armor --export <impressão digital>` em RELEASE_KEY_ARMORED e as 40 letras/números
 * da impressão digital (a mesma do piu-release.fpr) em RELEASE_KEY_FPR. As duas precisam bater
 * (updater.ts confere), então trocar só uma não aceita outra chave.
 */
export const RELEASE_KEY_FPR = '';
export const RELEASE_KEY_ARMORED = '';
