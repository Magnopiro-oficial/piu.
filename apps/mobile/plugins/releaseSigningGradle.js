/**
 * Assinatura de release do Android (ver docs/distribuicao/checklist.md, item 1).
 * A chave fica fora do repositório; o build lê o caminho e a senha de variáveis de ambiente:
 *   PIU_RELEASE_STORE_FILE      caminho do .jks (ex.: ~/piu-release-key/piu-release.jks)
 *   PIU_RELEASE_STORE_PASSWORD  senha do arquivo
 *   PIU_RELEASE_KEY_ALIAS       apelido da chave (padrão: piu)
 *   PIU_RELEASE_KEY_PASSWORD    senha da chave (padrão: a do arquivo, como no PKCS12)
 * Sem PIU_RELEASE_STORE_FILE ou a senha, qualquer tarefa de release do app FALHA (auditoria
 * 2026-11-06, M-03): um APK de release com a chave de debug pública permitiria a qualquer um
 * gerar um "Piu atualizado" que instala por cima e lê o cofre. Para um teste local consciente:
 *   ./gradlew assembleRelease -PallowDebugSignedRelease
 * Os builds de debug não mudam.
 */
const MARK = '// piu: assinatura de release';
const GUARD = '// piu: release sem a chave de release falha';

const GUARD_BLOCK = `            if (!(piuStore && System.getenv('PIU_RELEASE_STORE_PASSWORD')) && !project.hasProperty('allowDebugSignedRelease')) { ${GUARD}
                gradle.taskGraph.whenReady { g ->
                    if (g.allTasks.any { it.project == project && it.name.toLowerCase().contains('release') }) {
                        throw new GradleException('PIU_RELEASE_STORE_FILE/PIU_RELEASE_STORE_PASSWORD ausentes: o release não pode sair com a chave de debug. Teste local: -PallowDebugSignedRelease')
                    }
                }
            }
`;

const PIU_STORE = "            def piuStore = System.getenv('PIU_RELEASE_STORE_FILE')\n";

const RELEASE_CONFIG = `        release { ${MARK}
${PIU_STORE}${GUARD_BLOCK}            if (piuStore) {
                storeFile file(piuStore)
                storePassword System.getenv('PIU_RELEASE_STORE_PASSWORD')
                keyAlias System.getenv('PIU_RELEASE_KEY_ALIAS') ?: 'piu'
                keyPassword System.getenv('PIU_RELEASE_KEY_PASSWORD') ?: System.getenv('PIU_RELEASE_STORE_PASSWORD')
            }
        }
`;

/** Acrescenta `signingConfigs.release` e faz o tipo release usá-la; sem a chave, o release falha. */
function addReleaseSigning(gradle) {
  if (gradle.includes(GUARD)) return gradle;
  // Arquivo gerado pela versão anterior do plugin (sem a guarda): só acrescenta a guarda.
  if (gradle.includes(MARK)) {
    const at = gradle.indexOf(PIU_STORE, gradle.indexOf(MARK));
    if (at < 0) throw new Error('releaseSigning: bloco de release do Piu sem `def piuStore` no app/build.gradle');
    const end = at + PIU_STORE.length;
    return gradle.slice(0, end) + GUARD_BLOCK + gradle.slice(end);
  }
  const configs = /(signingConfigs \{\n\s+debug \{[\s\S]*?\n\s{8}\}\n)/;
  if (!configs.test(gradle)) throw new Error('releaseSigning: bloco signingConfigs.debug não encontrado no app/build.gradle');
  const release = /(buildTypes \{[\s\S]*?release \{[\s\S]*?)signingConfig signingConfigs\.debug/;
  if (!release.test(gradle)) throw new Error('releaseSigning: signingConfigs do tipo release não encontrado no app/build.gradle');
  return gradle
    .replace(configs, `$1${RELEASE_CONFIG}`)
    .replace(release, "$1signingConfig System.getenv('PIU_RELEASE_STORE_FILE') ? signingConfigs.release : signingConfigs.debug");
}

module.exports = { addReleaseSigning, MARK, GUARD };
