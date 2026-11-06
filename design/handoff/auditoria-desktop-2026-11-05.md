# Auditoria do Piu Desktop × design oficial (05/11/2026)

Comparação de `apps/desktop` com `design/handoff/design/Piu Desktop.dc.html`, a seção "Piu Desktop" do README e as referências em `design/handoff/reference/desktop/`. Legenda: ✅ real · ⚠️ parcial · 🕒 "em breve" na tela · ❌ ausente.

## Já real
Identidade (frase no cofre do sistema), estado cifrado, nó LNNP na rede local, conversas com o núcleo do celular (1:1, grupos e canais locais), vínculo com o celular por QR (wss com certificado fixado), notificação nativa, segurança da tela, carteira só leitura + envio pedido ao celular, backup (exportar e mostrar frase), atalhos ⌘K/⌘,/⌘I, preferências de tema, texto, densidade, animações, Enter envia, retransmissão e rede local. Todo método do preload tem implementação no processo principal.

## P0 — tira os "em breve" mais visíveis, usando núcleo que já existe
1. Bloquear, silenciar, mensagens temporárias e "digitando" (`messenger.blocked`, `expireSec`, `sendTyping`; prefs por conversa; lista de bloqueados em Privacidade) — 3–4 d.
2. QR do perfil (`RealQr` já existe) — 0,5 d.
3. Badge no Dock, Não perturbe e tipos de aviso (grupos, canais, carteira, emergência) — 1,5 d.
4. Sistema: iniciar com a sessão e ícone na barra de menus/bandeja (fechar a janela continua recebendo) — 1,5 d.
5. Gestão de grupos e canais (expor `updateGroup/addGroupMembers/removeGroupMember/setGroupRole/leaveGroup` por IPC; painel de detalhes; sair) — 2–3 d.
6. Vínculo com o celular: reconexão automática sem novo QR e "digitando" vindo do celular — 2 d (combinar com o lado do celular).

## P1 — carteira e privacidade
7. Movimentações (`fetchLunesHistory`) — 1,5 d.
8. Endereço derivado da frase + envio com chave própria (`walletKey`, `walletTransfer`) — 3–4 d + revisão de segurança.
9. Enviar LUNES no formato do design (contatos, 1/5/10/25, taxa) e botão de moeda na conversa (`paymentRequest`) — 2 d.
10. Atraso aleatório, igualar tamanho, confirmação de leitura, quem me encontra — 1,5 d.
11. Bloqueio ao suspender/inativo com Touch ID, e Touch ID antes de mostrar a frase — 2 d.
12. Restaurar backup a partir de arquivo `.piu` — 1 d.
13. Idiomas: portar `mobile/src/i18n/core.ts`, extrair ~250 textos, 11 dicionários — 4–6 d.

## P2 — infraestrutura pesada ou dependência externa
14. Bluetooth LE (noble no processo principal) — 5–8 d, risco alto.
15. Atualizações assinadas (`electron-updater` + verificação de assinatura) — 3 d.
16. Mídia e arquivos (anexos, cache, baixar automaticamente, limpar) — 4–5 d.
17. Créditos de rede reais, Converter, ≈ R$ — 3 d quando houver backend.
18. Multi-aparelho (Aparelhos) — bloqueado pela regra 1.1 (chave por aparelho).
19. Banda para retransmitir; LoRa fica no piu-node — 2 d.
20. Pequenos: corretor ortográfico real, selo "Verificado" persistente, prazo de guarda ajustável, "Manter conectado" como escolha real — ~1,5 d.

## Dívida de honestidade da tela
"Créditos de rede" (Wallet.tsx:158-164) e "Ninguém bloqueado" (Settings.tsx:202) mostram valores fixos sem aviso de "em breve": marcar enquanto não houver backend.
