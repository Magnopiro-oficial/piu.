// App mobile · Carteira — lógica extraída 1:1 de design/PiuApp.dc.html.

export const PEOPLE = [['marina', 'MA', 'Marina'], ['ana', 'AC', 'Ana'], ['pedro', 'PL', 'Pedro'], ['joao', 'JS', 'João']];
export const QUICK = [1, 5, 10];                 // rótulo: `${n} LUNES`
export const WALLET_ACTIONS = [
  { icon: 'arrow_upward', label: 'Enviar', sheet: 'send' },
  { icon: 'arrow_downward', label: 'Receber', sheet: 'receive' },
  { icon: 'person_add', label: 'Convidar', route: 'invite' },
].map((x, i) => ({ ...x, animation: `piuPop .5s cubic-bezier(.2,.9,.3,1.4) ${(0.32 + i * 0.07).toFixed(2)}s both` }));

export const initial = { walletSheet: null, sendTo: 'marina', sendAmt: '5', sent: [], holdPct: 0, holdHint: false, recvSeed: 1,
  payFly: false, payStage: 0, payClosing: false, balShown: null, freshTx: false };

export const fmt = n => n.toFixed(2).replace('.', ',');
export const balance = s => 58.4 - s.sent.reduce((a, x) => a + x.amt, 0);
export const parseAmt = v => parseFloat(String(v).replace(',', '.')) || 0;

// Contagem do saldo (entrada: 0→saldo em 950ms; após pagamento: antigo→novo em 1300ms)
export function countBal(from, to, ms, onFrame) {
  const t0 = performance.now(); let raf;
  const tick = now => { const p = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - p, 4);
    onFrame(p >= 1 ? null : from + (to - from) * e); if (p < 1) raf = requestAnimationFrame(tick); };
  raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
}

// Segurar para assinar: 900ms
export function holdDown(get, set, startPay) {
  const s = get(), amt = parseAmt(s.sendAmt); if (!(amt > 0 && amt <= balance(s)) || s.payFly) return;
  const t0 = performance.now();
  const tick = now => { const q = Math.min(1, (now - t0) / 900); set({ holdPct: q, holdHint: false });
    if (q >= 1) startPay(); else window.__holdRaf = requestAnimationFrame(tick); };
  window.__holdRaf = requestAnimationFrame(tick);
}
export function holdUp(get, set) { if (get().payFly) return; cancelAnimationFrame(window.__holdRaf); if (get().holdPct > 0) set({ holdPct: 0, holdHint: true }); }
export const holdVisual = p => ({
  fillWidth: (p * 100).toFixed(1) + '%', scale: p > 0 ? 1 - p * 0.03 : 1, fingerprintWeight: Math.round(400 + p * 300),
  label: p > 0 ? 'Assinando…' : 'Segure para assinar e enviar',
});

// Linha do tempo da cena
export function startPay(get, set, timers) {
  const s = get(), amt = parseAmt(s.sendAmt), old = balance(s);
  const name = (PEOPLE.find(p => p[0] === s.sendTo) || PEOPLE[0])[2];
  set({ payFly: true, payStage: 0, payClosing: false, holdPct: 0, holdHint: false, balShown: old, freshTx: false, payAmt: amt, payTo: s.sendTo,
    sent: [{ to: name, amt }, ...s.sent] });
  const T = (ms, o) => timers.push(setTimeout(() => set(o), ms));
  T(420, { payCover: true }); T(760, { walletSheet: null });
  [1150, 1700, 2690, 3130, 3520, 3800].forEach((ms, i) => T(ms, { payStage: i + 1 }));
}
export const payStatus = to => ['Assinando com a chave deste aparelho', 'Assinado · Ed25519', 'Saindo pelo Bluetooth',
  'Salto 1 de 3 · Wi-Fi Direct', 'Salto 2 de 3 · Wi-Fi Mesh', 'Salto 3 de 3 · Bluetooth', 'Entregue a ' + to];
export function closePay(get, set, timers, onBal) {
  const to = balance(get()), from = get().balShown ?? to;
  set({ payClosing: true });   // íris fecha .52s
  timers.push(setTimeout(() => { set({ payFly: false, payClosing: false, freshTx: true }); countBal(from, to, 1300, onBal); }, 520));
}

// Elementos da cena
export const ROUTE_POINTS = '195,700 88,575 300,455 110,335 195,205';
export const NODES = [
  { x: 81, y: 568, label: '7F·A2', via: 'Wi-Fi Direct', pop: 2.2, lit: 2.69 },
  { x: 293, y: 448, label: 'C2·19', via: 'Wi-Fi Mesh', pop: 2.28, lit: 3.13, alignRight: true },
  { x: 103, y: 328, label: '88·E0', via: 'Bluetooth', pop: 2.36, lit: 3.52 },
];
export const rings = [0, 0.14, 0.28].map(d => `piuRingS 1.1s ease-out ${(3.8 + d).toFixed(2)}s forwards`);
export const sparks = Array.from({ length: 16 }, (_, i) => { const sz = i % 3 === 0 ? 6 : 4;
  return { a: (i * 22.5 + (i % 2 ? 7 : -5)) + 'deg', d: -(64 + (i % 4) * 16) + 'px', size: sz + 'px', off: -sz / 2 + 'px' }; });
export const trail = [[0.15, 0.12, 0.62, 0], [0.1, 0.22, 0.74, 0], [0.05, 0.38, 0.86, 0], [0, 1, 1, 1]].map(([d, op, sc, main]) => ({
  delay: (2.4 + d).toFixed(2) + 's', out: (3.8 + d).toFixed(2) + 's', opacity: op, scale: sc, showLetter: !!main,
  glow: main ? '0 0 0 6px color-mix(in oklab,var(--invink) 18%,transparent), 0 0 30px 4px color-mix(in oklab,var(--invink) 55%,transparent)' : 'none' }));
export const receiptRows = to => [['Rota', 'Você → 3 nós → ' + to], ['Tempo na malha', '1,4 s'], ['Taxa', '0,01 LUNES'],
  ['Liquidação', 'quando um gateway alcançar a Mainnet'], ['tx', '9f2c…a01b']];

// QR do Receber (29×29). Tocar: recvSeed+1.
export function qrCells(seed = 1) {
  let x = seed * 7919 + 17; const rnd = () => (x = (x * 9301 + 49297) % 233280) / 233280;
  const N = 29, cells = [];
  const finder = (r, c) => { for (const [R, C] of [[0, 0], [0, N - 7], [N - 7, 0]]) { const i = r - R, j = c - C;
    if (i >= 0 && i < 7 && j >= 0 && j < 7) return (i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4)) ? 1 : 0;
    if (i >= -1 && i <= 7 && j >= -1 && j <= 7) return 0; } return -1; };
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const f = finder(r, c); let on;
    if (f >= 0) on = f === 1; else if (r >= 11 && r <= 17 && c >= 11 && c <= 17) on = false; else on = rnd() > 0.52;
    const d = 120 + Math.round(Math.hypot(r - 14, c - 14) * 28);
    cells.push({ background: on ? '#0c0c0c' : 'transparent', borderRadius: f >= 0 ? '1px' : '2px',
      animation: on ? `${seed % 2 ? 'piuQr' : 'piuQrB'} .35s ${seed > 1 ? d - 120 : d}ms cubic-bezier(.2,.9,.3,1.5) both` : 'none' });
  }
  return cells;
}

/* Keyframes (copiar):
@keyframes piuSheet{from{transform:translateY(100%)}to{transform:none}}
@keyframes piuFade{from{opacity:0}to{opacity:1}}
@keyframes piuPop{0%{transform:scale(.4);opacity:0}70%{transform:scale(1.14);opacity:1}100%{transform:scale(1)}}
@keyframes piuBump{0%{transform:scale(1)}35%{transform:scale(.8)}70%{transform:scale(1.14)}100%{transform:scale(1)}}
@keyframes piuRing{from{transform:scale(1);opacity:.5}to{transform:scale(6);opacity:0}}
@keyframes piuRingS{from{transform:scale(1);opacity:.6}to{transform:scale(2.2);opacity:0}}
@keyframes piuBreath{0%,100%{opacity:1}50%{opacity:.3}}
@keyframes piuUp{from{transform:translateY(16px);opacity:0}to{transform:none;opacity:1}}
@keyframes piuShrinkInv{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes piuCoin{from{transform:rotateY(0)}to{transform:rotateY(720deg)}}
@keyframes piuQr{from{transform:scale(0);opacity:0}to{transform:none;opacity:1}}
@keyframes piuQrB{from{transform:scale(0);opacity:0}to{transform:none;opacity:1}}
@keyframes piuScan{0%{top:0%;opacity:0}10%{opacity:1}90%{opacity:1}100%{top:100%;opacity:0}}
@keyframes piuIrisIn{from{clip-path:circle(0px at 50% 93%)}to{clip-path:circle(150% at 50% 93%)}}
@keyframes piuIrisOut{from{clip-path:circle(150% at 50% 24%)}to{clip-path:circle(0px at 50% 24%)}}
@keyframes piuDraw{to{stroke-dashoffset:0}}
@keyframes piuScanY{from{transform:translateY(-4px)}to{transform:translateY(94px)}}
@keyframes piuOutUp{to{opacity:0;transform:translateY(-40px) scale(.9);filter:blur(6px)}}
@keyframes piuOutSoft{to{opacity:0;transform:scale(1.05);filter:blur(8px)}}
@keyframes piuFadeOut{to{opacity:0}}
@keyframes piuType{from{width:0}to{width:27ch}}
@keyframes piuCoinFly{0%{transform:translate(195px,700px)}20.9%{transform:translate(88px,575px)}51.8%{transform:translate(300px,455px)}80.3%{transform:translate(110px,335px)}100%{transform:translate(195px,205px)}}
@keyframes piuLit{to{background:var(--invink);box-shadow:0 0 0 6px color-mix(in oklab,var(--invink) 20%,transparent)}}
@keyframes piuSpark{from{transform:rotate(var(--a)) translateY(0) scale(1);opacity:1}to{transform:rotate(var(--a)) translateY(var(--d)) scale(.2);opacity:0}}
@keyframes piuToCoin{to{transform:translateY(208px) scale(.1);opacity:0}}
@keyframes piuCardIn{from{opacity:0;transform:perspective(900px) translateY(26px) rotateX(16deg) scale(.96)}to{opacity:1;transform:none}}
@keyframes piuShine{from{transform:translateX(-140%) skewX(-18deg)}to{transform:translateX(380%) skewX(-18deg)}}
@keyframes piuRowFresh{0%{opacity:0;transform:translateY(-14px);background:color-mix(in oklab,var(--ink) 10%,transparent)}22%{opacity:1;transform:none}100%{background:transparent}}
@keyframes piuTab{from{opacity:0;transform:translateY(16px) scale(.985)}to{opacity:1;transform:none}}
*/
