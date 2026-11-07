/**
 * Controles de direção do texto (bidi): U+202A–U+202E (LRE, RLE, PDF, LRO, RLO) e U+2066–U+2069
 * (LRI, RLI, FSI, PDI). Num nome ou descrição vindos de outro aparelho, invertem o texto na tela e
 * deixam "Ana‮lapyap" parecer outra coisa (auditoria 2026-11-06, B-07). Só esses saem: ZWJ/ZWNJ
 * (emoji compostos, escritas indianas e árabes) e o resto do Unicode ficam como estão.
 * Usar só na leitura/exibição: assinaturas continuam sobre os bytes originais.
 */
const BIDI_CONTROLS = /[‪-‮⁦-⁩]/g;

export const stripBidi = (s: string) => s.replace(BIDI_CONTROLS, '');
