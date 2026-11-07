# Piu · Telas novas — Modo nó no celular + Desktop

Abra localmente: `npx serve design` → `Piu 9 Modo no celular.dc.html` e `Piu 10 Desktop telas novas.dc.html`.
Cada tela tem um id visível (M1, M2b, D3e…) igual ao `id` e ao `data-screen-label` no HTML. Os estilos estão todos inline: copie os valores direto do arquivo.

## Tokens (iguais ao app atual)
- Claro: bg #ffffff · bg2 #f3f3f1 · bg3 #e6e6e3 · side #f8f8f6 · ink #0c0c0c · ink2 #5f5f5c · ink3 #9b9b97 · line rgba(0,0,0,.07) · line2 rgba(0,0,0,.16) · scrim rgba(0,0,0,.28)
- Fonte: Geist (texto) e Geist Mono (rótulos, números técnicos). Ícones: Material Symbols Rounded.
- Celular 390×844. Janela Desktop 1280×820 (barra macOS de 40 px, Linux de 46 px).

---

## Celular · Modo nó

| Id | Tela | Estado | Entra por | Ações |
|---|---|---|---|---|
| M1 | Ativar “Do celular” | padrão | Provider → Adicionar → Do celular | Continuar → M2 · Agora não |
| M1e | Faltam requisitos | erro | M1 quando algum requisito falha | Liberar espaço · Fazer backup · Continuar desabilitado (opacity .25) |
| M2 | Pagar caução | padrão | M1 | Segurar para assinar → M2b |
| M2b | Conferindo no validador | carregando | M2 assinado | Fechar (continua em segundo plano) → M3v ao terminar |
| M2e1 | Saldo insuficiente | erro | M2 com saldo < caução + taxa | Receber LUNES (abre Receber da carteira) · Pedir a um contato |
| M2e2 | Validador não respondeu | erro | M2b após 2 min sem resposta | Tentar de novo (reaproveita a assinatura) · Cancelar |
| M3 | Painel do nó | padrão | Lista do Provider (substitui o “em breve”) | Pedir aval → M4 · Sair do modo nó → M6 |
| M3v | Primeiro dia, sem avais | vazio | logo após M2b | Pedir aval |
| M3e | Certificado não renovado | erro | sem validador no dia | Tentar agora |
| M4 | Pedir aval | padrão | M3 | Escolher 1 contato elegível · Enviar pedido |
| M4v | Ninguém pode avalizar | vazio | M4 sem contatos elegíveis | Verificar alguém por perto · Convidar |
| M5 | Pedido de aval recebido | padrão | notificação ou cartão na conversa | Segurar para avalizar · Recusar (sem motivo) |
| M5e | Pedido não vale mais | erro | expirado / cancelado / caução de quem pediu não conferida | Abrir conversa · Fechar |
| M6 | Sair e pedir a caução | padrão | M3 | Segurar para sair → M6b · Continuar como nó |
| M6b | Caução a caminho | padrão | M6 assinado | Voltar a ser nó (cancela a devolução, os dias zeram) |
| M6e | Devolução pausada | erro | prazo vencido sem conferência final | Tentar agora · Ver no diagnóstico |

Regras usadas no desenho (confirmar com a implementação): caução de 100 LUNES + taxa de 0,01 · 3 avais · 7 dias seguidos com certificado · aval vale 90 dias · pedido expira em 3 dias · só avalizam contatos verificados pessoalmente com modo nó há mais de 7 dias · caução volta 7 dias depois da saída · dados: só Bluetooth/Wi-Fi local, até 200 MB/dia · pausa com bateria em 30%.

Barra de 7 dias (M3): 7 traços de 6 px, gap de 4 px. Feito = cor cheia. Hoje = cheio e pulsando (piuBreath) até o certificado sair. Futuro = 22% de opacidade. Em erro (M3e): o cartão passa de ink para bg2 com contorno de 1,5 px e o traço de hoje fica vazado.

## Desktop

| Id | Tela | Estado | Entra por | Ações |
|---|---|---|---|---|
| D1 | Piu bloqueado · macOS | padrão | suspender / inativo / ⌘L | Touch ID · Usar a senha do Mac |
| D1e | Bloqueado · Linux · senha errada | erro | senha incorreta | Campo com shake e contorno de 2 px; mostra quantas tentativas restam |
| D1x | Muitas tentativas | erro | 5ª senha errada | Contagem regressiva; espera de 30 s → 1 min → 2 min |
| D2 | Contatos bloqueados | padrão | Privacidade → Contatos bloqueados | Buscar · Desbloquear (usa o diálogo `unblock:` que já existe) · 2 chaves |
| D2v | Ninguém bloqueado | vazio | lista vazia | — |
| D2e | Desbloqueio não sincronizou | erro | outro aparelho fora de alcance | Tentar |
| D3 | Atualização pronta | padrão | Sistema → Atualizar = Perguntar; aviso no fim da lista + ponto no ícone de Ajustes | Depois · Reiniciar e atualizar |
| D3b | Baixando pela malha | carregando | Sistema → Atualizações durante o download | — |
| D3e | Assinatura não confere | erro | pacote inválido (apagado, nada instalado) | Fechar · Baixar de outra fonte |
| D4 | Armazenamento | padrão | clicar na barra de 1,2 GB em Conversas | Limpar mídia por conversa · 2 limites |
| D4e | Disco quase cheio | erro | menos de 1 GB livre | Limpar (mostra o total antes de confirmar) |
| D4v | Depois de limpar | vazio | após limpar uma conversa | Toast “409 MB liberados” |

Bloqueio: esconde nomes e conteúdo (inclusive nas notificações), mostra só a contagem de mensagens novas. O rodapé avisa que o Piu continua recebendo e repassando pela malha.

---

## Animações (valores exatos)

### Segurar para assinar (M2, M5, M6)
- Botão de 58 px de altura, raio de 29, fundo ink. Ícone `fingerprint` 22 px + texto.
- Ao pressionar (`pointerdown`): uma camada `rgba(255,255,255,.22)` cresce em largura de 0 a 100% com **`width .9s linear`**. Texto: “Continue segurando…”.
- Soltar ou sair do botão antes de 0,9 s cancela: a largura volta a 0 com **`width .3s cubic-bezier(.2,.85,.3,1)`** e o texto original volta.
- Aos 0,9 s: assina. O ícone vira `check` e o texto vira “Caução assinada” / “Aval enviado a Lia” / “Saída assinada”. No app real, avança para a próxima tela (M2b / fecha M5 com toast / M6b). O protótipo só reseta depois de 2,2 s para dar para testar de novo.
- Usar `touch-action:none` e `user-select:none`. É o mesmo gesto e o mesmo tempo da carteira (0,9 s).

### Keyframes
```css
@keyframes piuSpin{to{transform:rotate(360deg)}}
@keyframes piuBreath{0%,100%{opacity:1}50%{opacity:.3}}
@keyframes piuRingS{from{transform:scale(1);opacity:.6}to{transform:scale(2.2);opacity:0}}   /* Desktop: scale(2.4), opacity .55 */
@keyframes piuShake{0%,100%{transform:none}20%{transform:translateX(-8px)}40%{transform:translateX(7px)}60%{transform:translateX(-5px)}80%{transform:translateX(3px)}}
@media (prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;animation-iteration-count:1!important}}
```

| Onde | Animação |
|---|---|
| M2b anel de 96 px (borda de 2 px, topo em ink) | piuSpin 1.1s linear infinite |
| Spinner de 22 px das etapas (M2b), 18 px (D3b) | piuSpin .9s linear infinite |
| Traço de hoje (M3, M3v), ponto da etapa atual (M6b), ícone sync (D2e) | piuBreath 1.8s ease-in-out infinite |
| Ponto “Repassando” (M3, M3v), ponto do rodapé do bloqueio (D1, D1e) | piuRingS 2s ease-out infinite |
| Botão Touch ID de 72 px (D1) | piuRingS 2.4s ease-out infinite |
| Campo de senha errada (D1e) | piuShake .45s ease-in-out, uma vez a cada erro |

### Transições de tela (usar as que já existem)
- Celular, push: `piuPush .36s cubic-bezier(.2,.85,.3,1)` (PiuApp).
- Desktop, diálogo (D3, unblock): `piuDialog` do Piu Desktop (scale .92 + translateY 10 px → normal).
- Desktop, troca de página nos Ajustes: `piuPgA/piuPgB` do Piu Desktop.

### Anéis de progresso estáticos
- M6b: `conic-gradient(ink 0 X%, bg3 0)` em 168 px, miolo de 148 px. X = dias passados / 7. Ao trocar de valor, animar 0,6 s ease-out.
- D1x: mesmo padrão em 92 px / 80 px, X = tempo restante / espera total, atualizado a cada segundo.

## Observações
- Só o tema claro foi desenhado. O escuro usa os mesmos tokens escuros do app atual.
- Nenhuma cor nova: os erros usam ícone preenchido, peso maior e inversão ink/bg, como o resto do Piu.
