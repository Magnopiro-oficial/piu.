/**
 * Assinatura de release do Android (ver docs/distribuicao/checklist.md, item 1).
 * A chave fica fora do repositório; o build lê o caminho e a senha de variáveis de ambiente:
 *   PIU_RELEASE_STORE_FILE      caminho do .jks (ex.: ~/piu-release-key/piu-release.jks)
 *   PIU_RELEASE_STORE_PASSWORD  senha do arquivo
 *   PIU_RELEASE_KEY_ALIAS       apelido da chave (padrão: piu)
 *   PIU_RELEASE_KEY_PASSWORD    senha da chave (padrão: a do arquivo, como no PKCS12)
 * Sem PIU_RELEASE_STORE_FILE, o release continua com a chave de debug (só para testes locais).
 */
const MARK = '// piu: assinatura de release';

const RELEASE_CONFIG = `        release { ${MARK}
            def piuStore = System.getenv('PIU_RELEASE_STORE_FILE')
            if (piuStore) {
                storeFile file(piuStore)
                storePassword System.getenv('PIU_RELEASE_STORE_PASSWORD')
                keyAlias System.getenv('PIU_RELEASE_KEY_ALIAS') ?: 'piu'
                keyPassword System.getenv('PIU_RELEASE_KEY_PASSWORD') ?: System.getenv('PIU_RELEASE_STORE_PASSWORD')
            }
        }
`;

/** Acrescenta `signingConfigs.release` e faz o tipo release usá-la quando a chave foi informada. */
function addReleaseSigning(gradle) {
  if (gradle.includes(MARK)) return gradle;
  const configs = /(signingConfigs \{\n\s+debug \{[\s\S]*?\n\s{8}\}\n)/;
  if (!configs.test(gradle)) throw new Error('releaseSigning: bloco signingConfigs.debug não encontrado no app/build.gradle');
  const release = /(buildTypes \{[\s\S]*?release \{[\s\S]*?)signingConfig signingConfigs\.debug/;
  if (!release.test(gradle)) throw new Error('releaseSigning: signingConfigs do tipo release não encontrado no app/build.gradle');
  return gradle
    .replace(configs, `$1${RELEASE_CONFIG}`)
    .replace(release, "$1signingConfig System.getenv('PIU_RELEASE_STORE_FILE') ? signingConfigs.release : signingConfigs.debug");
}

module.exports = { addReleaseSigning, MARK };
