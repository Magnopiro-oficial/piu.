// Tokens do Piu (docs/design-spec.md). Monocromático: ênfase = inverter (ink de fundo, invink de texto).
export const palettes = {
  light: {
    bg: '#FFFFFF', bg2: '#F3F3F1', bg3: '#E6E6E3', bub: '#F3F3F1',
    ink: '#0C0C0C', ink2: '#5F5F5C', ink3: '#9B9B97', invink: '#FFFFFF',
    line: 'rgba(0,0,0,0.07)', line2: 'rgba(0,0,0,0.16)', dot: 'rgba(0,0,0,0.055)',
    knob: '#FFFFFF', scrim: 'rgba(0,0,0,0.32)',
    // Estado de um rádio (desenho Piu 17): só no ponto e no aviso da linha; o resto segue monocromático.
    ok: '#1F9D55', warn: '#9A5A00', warnbg: 'rgba(196,120,0,0.11)', err: '#CF3328', errbg: 'rgba(207,51,40,0.09)',
    // Mapa da rede (Piu 18): fundo dos anéis de alcance de cada canal.
    reach: 'rgba(0,0,0,0.045)',
  },
  dark: {
    bg: '#0A0A0A', bg2: '#171717', bg3: '#262626', bub: '#1A1A1A',
    ink: '#F4F4F2', ink2: '#A2A29E', ink3: '#6C6C69', invink: '#0A0A0A',
    line: 'rgba(255,255,255,0.08)', line2: 'rgba(255,255,255,0.18)', dot: 'rgba(255,255,255,0.06)',
    knob: '#8C8C88', scrim: 'rgba(0,0,0,0.60)',
    ok: '#4CC38A', warn: '#F2B545', warnbg: 'rgba(242,181,69,0.13)', err: '#FF6A5C', errbg: 'rgba(255,106,92,0.14)',
    reach: 'rgba(255,255,255,0.05)',
  },
} as const;

export type Scheme = keyof typeof palettes;
export type Colors = { [K in keyof typeof palettes.light]: string };

/** Curvas de movimento do design (cubic-bezier) para o Animated. */
export const curves = {
  out: [0.2, 0.9, 0.3, 1] as const,
  pop: [0.2, 0.9, 0.3, 1.4] as const,
  msg: [0.2, 0.9, 0.3, 1.2] as const,
};
