# Como ler um `.dc.html`

Cada arquivo de design é **um componente React** escrito num formato de template. Não é HTML estático: valores, listas e condições são resolvidos em tempo de execução pelo `support.js`. **Não copie o markup "como está" lendo só o template** — os valores entre `{{ }}` vêm da classe `Component` no fim do arquivo.

## Estrutura do arquivo
```
<x-dc>
  <helmet> fontes, @keyframes, variáveis de tema (--bg, --ink…) </helmet>
  …template…
</x-dc>
<script type="text/x-dc" data-dc-script data-props="{…props…}">
  class Component extends DCLogic { state; renderVals(){ return {…} } …métodos… }
</script>
```

## Sintaxe → equivalente React
| Template | React/JSX |
|---|---|
| `{{ chat.name }}` | `{chat.name}` (sempre um caminho; nunca expressão) |
| `style="padding:12px;background:var(--bg2)"` | `style={{padding:12, background:'var(--bg2)'}}` — **todo estilo é inline**; não há CSS de classes |
| `style="width:{{ keyPct }}"` | `style={{width: keyPct}}` — valor calculado em `renderVals()` |
| `style-hover="background:var(--bg2)"` | estado `:hover` (idem `style-active`, `style-focus`) |
| `onClick="{{ goChats }}"` | `onClick={goChats}` (handler definido em `renderVals()`) |
| `<sc-for list="{{ items }}" as="i">…</sc-for>` | `{items.map(i => …)}` (`$index` = índice) |
| `<sc-if value="{{ isChat }}">…</sc-if>` | `{isChat && …}` |
| `<dc-import name="PiuApp" start="chats">` | `<PiuApp start="chats" />` (outro arquivo `.dc.html`) |
| `ref="{{ scrollRef }}"` | `ref={scrollRef}` |
| `hint-*` | só placeholder de carregamento — **ignore** |

## Onde está cada coisa
- **Cores/tema**: variáveis CSS no `<style>` do `<helmet>` (`--bg`, `--bg2`, `--ink`…) e trocadas por tema no componente raiz. Tabela consolidada no README.
- **Animações**: `@keyframes` no `<helmet>` (extraídos em `docs/animations/*.css`) + a propriedade `animation:` inline em cada elemento. Muitas `animation:` são strings calculadas em `renderVals()` (ex.: `appAnim`, `splashAnim`, `m.anim`) — procure o nome da variável na classe para ver duração, curva e atraso exatos.
- **Fluxo/estado**: `state` inicial em `initState()`/`init()`; navegação em `go()`, `jumpTo()`, `openChat()`; temporizadores (`setTimeout`) definem a coreografia das animações em sequência (ex.: `boot()` → splash 2,6 s → `piuSplashOut` 420 ms → `piuReveal` 500 ms).
- **Textos**: em PT-BR direto no template; no Desktop, `L(k)` traz o dicionário de idiomas.

## Referência visual exata
Não dependa só da leitura do código: gere as imagens e vídeos de referência com `tools/capture.mjs` (ver README → "Referências renderizadas") e compare sua implementação tela a tela.
