// Piu Desktop · Carteira (Enviar/Receber) — lógica extraída 1:1 de design/Piu Desktop.dc.html.
// Framework-agnóstico: porte para o componente da sua stack mantendo valores e tempos.

export const PEOPLE = [
  { id: 'marina', ini: 'MA', name: 'Marina Alves' },
  { id: 'ana', ini: 'AC', name: 'Ana Costa' },
  { id: 'pedro', ini: 'PL', name: 'Pedro Lima' },
  { id: 'joao', ini: 'JS', name: 'João Souza' },
];
export const QUICK_AMOUNTS = [1, 5, 10, 25];
export const BASE_BALANCE = 58.4;
export const FEE = '0,01 LUNES';
export const ADDRESS_SHORT = 'lunes:7f3a91c2…a912c19e';

export const initialWalletState = () => ({
  wSheet: null,        // null | 'send' | 'receive'
  sendTo: 'marina',
  sendAmt: '5',
  sendDone: false,
  sent: [],            // [{ to, amt, status: 'na malha' | '' }]
  balT: null,          // valor animado do saldo (null = mostra o real)
  hideBal: localStorage.getItem('piu.hideBal') === '1',
});

export const fmt = n => n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
export const balance = s => BASE_BALANCE - s.sent.reduce((a, x) => a + x.amt, 0);
export const parseAmt = v => parseFloat(String(v).replace(',', '.')) || 0;
export const sanitizeAmt = v => v.replace(/[^0-9,\.]/g, '');

export function sendModel(s) {
  const bal = balance(s), amt = parseAmt(s.sendAmt), ok = amt > 0 && amt <= bal;
  const to = PEOPLE.find(p => p.id === s.sendTo) || PEOPLE[0];
  return {
    title: s.wSheet === 'receive' ? 'Receber LUNES' : s.sendDone ? 'Enviado' : 'Enviar LUNES',
    payees: PEOPLE.map((p, i) => ({ ...p, first: p.name.split(' ')[0], selected: p.id === s.sendTo,
      animation: `piuPop .45s ${0.1 + i * 0.05}s cubic-bezier(.2,.9,.3,1.5) both` })),
    quick: QUICK_AMOUNTS.map(n => ({ n, active: amt === n })),
    toName: to.name,
    available: s.hideBal ? '••••' : fmt(bal),
    error: amt > bal,                       // "Valor maior que o saldo disponível"
    buttonOpacity: ok ? 1 : 0.35,
    ok, amt,
    sentLabel: `${fmt(amt)} LUNES para ${to.name}`,
  };
}

// Confirmar envio: tempos exatos do protótipo.
export function confirmSend(get, set, animateBalance) {
  const s = get(), m = sendModel(s);
  if (!m.ok) return;
  const prev = balance(s);
  set({ sendDone: true, sent: [{ to: m.toName, amt: m.amt, status: 'na malha' }, ...s.sent] });
  setTimeout(() => animateBalance(prev), 50);
  setTimeout(() => set({ sent: get().sent.map((x, i) => i === 0 ? { ...x, status: '' } : x) }), 2600);
}

// Contagem do saldo: 1100ms, easeOutQuart.
export function animateBalance(from, target, onFrame) {
  const start = performance.now(), f = from ?? 0;
  let raf;
  const tick = now => {
    const p = Math.min(1, (now - start) / 1100), e = 1 - Math.pow(1 - p, 4);
    onFrame(p < 1 ? f + (target - f) * e : null);
    if (p < 1) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

// Partículas do sucesso (14).
export const burst = Array.from({ length: 14 }, (_, i) => {
  const a = i / 14 * Math.PI * 2, r = 80 + (i % 3) * 22;
  return { x: Math.round(Math.cos(a) * r) + 'px', y: Math.round(Math.sin(a) * r) + 'px', delay: (i % 4) * 0.03 + 's' };
});

// QR visual do protótipo (29×29). Receber usa seed = qrSeed + 23 (qrSeed inicial = 1 → seed 24).
// Em produção, troque `on` pela matriz de uma lib QR real (versão 3, ECC H) e mantenha
// raio, cores, centro vazio 11–17 e o atraso em onda.
export function qrCells(seed = 24) {
  let x = seed * 7919 + 17;
  const rnd = () => (x = (x * 9301 + 49297) % 233280) / 233280;
  const N = 29, cells = [];
  const finder = (r, c) => {
    for (const [R, C] of [[0, 0], [0, N - 7], [N - 7, 0]]) {
      const i = r - R, j = c - C;
      if (i >= 0 && i < 7 && j >= 0 && j < 7)
        return (i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4)) ? 1 : 0;
      if (i >= -1 && i <= 7 && j >= -1 && j <= 7) return 0;
    }
    return -1;
  };
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const f = finder(r, c);
    let on;
    if (f >= 0) on = f === 1;
    else if (r >= 11 && r <= 17 && c >= 11 && c <= 17) on = false;   // espaço do ícone
    else on = rnd() > 0.52;
    const d = Math.round(Math.hypot(r - 14, c - 14) * 28);          // onda do centro
    cells.push({
      background: on ? '#0c0c0c' : 'transparent',
      borderRadius: f >= 0 ? '1px' : '2px',
      animation: on ? `piuQr .35s ${d}ms cubic-bezier(.2,.9,.3,1.5) both` : 'none',
    });
  }
  return cells;
}

/* CSS necessário (copie para o app):
@keyframes piuQr{from{transform:scale(0);opacity:0}to{transform:none;opacity:1}}
@keyframes piuPop{0%{transform:scale(.4);opacity:0}70%{transform:scale(1.14);opacity:1}100%{transform:scale(1)}}
@keyframes piuSide{from{transform:translateX(40px);opacity:0}to{transform:none;opacity:1}}
@keyframes piuUp{from{transform:translateY(16px);opacity:0}to{transform:none;opacity:1}}
@keyframes piuRingL{from{transform:scale(.6);opacity:.5}to{transform:scale(3.2);opacity:0}}
@keyframes piuBurst{0%{transform:translate(0,0) scale(1);opacity:1}100%{transform:translate(var(--x),var(--y)) scale(0);opacity:0}}
@keyframes piuMsgIn{from{opacity:0;transform:translateY(14px) scale(.85)}to{opacity:1;transform:none}}
@keyframes piuBreath{0%,100%{opacity:1}50%{opacity:.3}}
*/
