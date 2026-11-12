/**
 * Release só com arm64-v8a (ver "Tamanho do APK" em docs/distribuicao/checklist.md).
 * O `buildArchs` do app.json vira `reactNativeArchitectures` no gradle.properties, mas um
 * `-PreactNativeArchitectures=...` na linha de comando vence esse valor: foi assim que a 0.1.4 saiu
 * com lib/x86_64. Duas travas, venha a lista de onde vier:
 *  1. Depois do plugin do React Native (que põe a lista no defaultConfig.ndk.abiFilters), troca a lista
 *     por só arm64-v8a em todo build que não seja só de debug. Não dá para pôr abiFilters no buildType
 *     release: o Gradle soma as listas do defaultConfig e do buildType.
 *  2. No release, tira do APK as .so de outras ABIs. Sozinha não basta: as .so com pickFirst do React
 *     Native (libc++_shared, libfbjni...) passam por cima do exclude.
 * Debug não muda (emulador x86_64 continua funcionando no debug).
 */
const MARK = '// piu: release só com arm64-v8a';
const OUTRAS_ABIS = ['armeabi', 'armeabi-v7a', 'x86', 'x86_64', 'mips', 'mips64', 'riscv64'];

const BLOCO = `
${MARK}
def piuSoDebug = !gradle.startParameter.taskNames.isEmpty() && gradle.startParameter.taskNames.every { it.toLowerCase().contains('debug') }
androidComponents {
    finalizeDsl { ext ->
        if (!piuSoDebug) {
            ext.defaultConfig.ndk.abiFilters.clear()
            ext.defaultConfig.ndk.abiFilters.add('arm64-v8a')
        }
    }
    onVariants(selector().withBuildType('release')) { variant ->
        variant.packaging.jniLibs.excludes.addAll([${OUTRAS_ABIS.map(a => `'**/${a}/*.so'`).join(', ')}])
    }
}
`;

/** Acrescenta a trava no fim do `app/build.gradle`; não repete se já estiver lá. */
function addReleaseAbiLock(gradle) {
  if (gradle.includes(MARK)) return gradle;
  return gradle + BLOCO;
}

module.exports = { addReleaseAbiLock, MARK, OUTRAS_ABIS };
