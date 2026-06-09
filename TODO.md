# Skylight – Backlog de features

## 1. Menu lateral na tela principal com controles da página Control

**Objetivo:** Expor os controles do Control diretamente na display, sem precisar abrir outra aba.

**Comportamento:**
- O menu aparece ao arrastar/hover o mouse na borda **esquerda** da tela
- Animação de slide-in suave (transform translateX)
- Botão de **pin** (📌) no cabeçalho do menu para fixá-lo aberto durante edições
- Quando fixado, o canvas da display se recompõe com margem para não sobrepor o menu
- Quando solto (não fixado), fecha ao mover o mouse para fora

**Arquivos relevantes:**
- `web/src/display/Display.tsx` – montar o painel overlay
- `web/src/control/Control.tsx` – reutilizar os componentes de controle (Section, Row, Slider, etc.)
- `web/src/styles/` – adicionar CSS para o drawer lateral

**Critérios de aceite:**
- [ ] Drawer desliza ao entrar na zona de 24 px da esquerda
- [ ] Botão pin visível no topo do drawer; estado persiste via localStorage
- [ ] Drawer fechado não afeta a performance do canvas
- [ ] Funciona em modo fullscreen (projector)

---

## 2. Campo de digitação no controle Radius

**Objetivo:** Permitir clicar no valor atual do Radius e digitar um número exato, além do slider.

**Comportamento:**
- O valor numérico ao lado do slider Radius vira um `<input type="number">` inline ao clicar
- Aceita valores com casas decimais (ex: `2.5`)
- Confirma ao pressionar Enter ou ao perder o foco (blur)
- Rola de volta para o slider se o usuário pressionar Escape
- Valida o intervalo (0.5 – 200 mi) e descarta valores fora do range

**Arquivos relevantes:**
- `web/src/control/components.tsx` – componente `Slider` (adicionar modo editable-value)
- `web/src/control/Control.tsx` – seção Radius

**Critérios de aceite:**
- [ ] Click no número abre `<input>` sem mover o slider
- [ ] Enter/blur aplica o patch `{ radiusMiles: value }` via WebSocket
- [ ] Escape descarta a edição
- [ ] Input some e volta ao label após confirmação

---

## 3. Exibir o Radius na tela principal (display)

**Objetivo:** Mostrar o valor atual de `radiusMiles` na display, junto com as outras infos do HUD.

**Opções de implementação (escolher uma):**
- **A – HUD text:** adicionar `r {cfg.radiusMiles}mi` ao texto de status que já existe no canto (já está no HEAD, confirmar visibilidade)
- **B – Ring label:** exibir o raio em milhas como label dentro do anel de range mais externo do renderer
- **C – Ambos:** HUD + label no anel

**Arquivos relevantes:**
- `web/src/display/Display.tsx` – HUD overlay (opção A)
- `web/src/display/renderer.ts` – `drawRangeRings()` (opção B)

**Critérios de aceite:**
- [ ] Valor atualiza em tempo real quando mudado no Control
- [ ] Não sobrepõe informações existentes
- [ ] Legível com qualquer tema (ambient / telemetry / focus)
