/** Caminho absoluto do site respeitando o `base` (GitHub Pages em subpasta). `#âncora` e URLs externas passam direto. */
export const url = (p: string) => (p.startsWith('/') ? import.meta.env.BASE_URL.replace(/\/$/, '') + p : p);
