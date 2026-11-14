# HLA Consenso · NGSengine × AlloSeq Assign

Aplicativo web (100% no navegador) para a etapa **pós-análise** da tipagem HLA por NGS:
compara o resultado do **NGSengine** (export TARR em XML) com o do **AlloSeq Assign**
(relatórios Excel), associa métricas de qualidade a cada tipagem, registra a decisão do
analista em cada divergência e gera os arquivos **SISHLA** e **REDOME** no mesmo layout do
`ngsengine_to_sishla_report`.

Nenhum arquivo sai do computador: tudo é lido e processado no navegador. As decisões ficam
salvas no `localStorage`, por corrida, e podem ser exportadas e importadas como JSON.

## Publicar no GitHub Pages

1. Crie um repositório (pode ser privado, se o seu plano do GitHub permitir Pages privado) e
   envie o conteúdo desta pasta (`index.html`, `css/`, `js/`, `.nojekyll`).
2. No repositório, abra **Settings → Pages → Build and deployment → Deploy from a branch**,
   escolha a branch `main` e a pasta `/ (root)`.
3. Em cerca de 1 minuto, o app fica disponível em `https://<usuario>.github.io/<repositorio>/`.

Também funciona offline: basta abrir o `index.html` direto no Chrome ou no Edge.
Não há dependências externas (nem CDN).

## Fluxo

1. **Arraste os arquivos:** `*_tarr.xml` (ou um `.zip` com ele), os `*_report_assign.xlsx`
   (p1, p2…) e, se quiser, o CSV IL_DMR.
2. **Placa:** mapa amostra × locus. Cor e ícone mostram a situação da comparação, e os
   marcadores mostram a decisão (`auto`, `E`, `A`, `M`, `✕`, `!` = pendente) e os alertas de QC.
3. **Revisão:** as pendências vêm agrupadas por locus e situação. Dá para decidir um grupo
   inteiro de uma vez ou abrir uma tipagem por vez.
4. **Painel da tipagem:** genótipos lado a lado (em verde, os pares presentes nos dois
   softwares), a prévia exata do que será liberado por cada opção, as métricas de qualidade
   contra os limites, o status de revisão no NGSengine, os alelos anotados e as edições.
   Atalhos: `E` NGSengine, `A` Assign, `M` manual, `X` não liberar, `J`/`K` navegar,
   `P` próxima pendente, `Ctrl+Z` desfazer.
5. **Qualidade:** gráficos da placa e os limites de QC, editáveis e recalculados na hora.
6. **Exportar:** checklist de conferência, pacote `.zip` (SISHLA, REDOME, informações
   adicionais, relatório comparativo e sessão) e relatório de conferência para imprimir ou
   salvar em PDF.

## Regras

**Comparação.** Do lado do NGSengine, usa `ConclusiveTypingResult/Typing/GLString`
(`|` separa genótipos, `+` separa os alelos, `/` separa as alternativas). Do lado do Assign,
usa a aba *Ambiguities* (genótipos `X + Y` separados por `/`). Os dois viram conjuntos de
pares, reduzidos a 3 campos e comparados:

| Situação | Critério |
|---|---|
| Concordante | conjuntos de genótipos idênticos |
| Concordante no 1º genótipo | mesmo genótipo principal; as listas de ambiguidade diferem |
| Concordância parcial | há genótipos em comum, mas também alternativas exclusivas |
| Concordante só em 2 campos | nenhum par em comum em 3 campos, mas há em 2 campos |
| Divergente | nenhum par em comum |
| Só NGSengine / Só Assign | apenas um software tipou o locus |

- Hemizigoto (`DRB3*02:02:01`) equivale a homozigoto (`DRB3*02:02:01+DRB3*02:02:01`).
- Por padrão, alternativas com alelo nulo (N) são ignoradas na comparação. Há uma opção para
  desligar isso.

**Liberação automática.** É feita só quando a comparação é concordante (ou concordante no 1º
genótipo), o locus está **Approved** no NGSengine e não há alerta vermelho de QC (essa última
condição é configurável). Todo o resto fica pendente para o analista.

**Tipagem liberada.**
- *NGSengine:* a mesma do app atual, ou seja, `TypingResult/NMDPCodes` (allele_1/allele_2)
  reduzidos a 3 campos quando têm 4.
- *Assign:* os alelos da aba *Summary* com o prefixo do locus. Atenção: podem vir com sufixo
  G, como `DPB1*02:01:02G`.
- *Manual:* o que o analista digitar.

Pendentes e "não liberar" saem em branco nos arquivos.

**Exportação.** Mesmo layout do `ngsengine_to_sishla_report`:
- SISHLA: 4 linhas vazias e colunas `NN_aleloXX_HLA-*_sishla`.
- REDOME: data e todos os locos; com IL_DMR, inclui `00_DMR` e `Patient`.
- Separador `;`.
- As amostras que contêm `1044736` são excluídas (configurável).

## Diferenças em relação ao app Python atual

- A redução para 3 campos é feita por truncamento, preservando o sufixo de expressão
  (`A*24:02:01:02L` → `A*24:02:01L`). Isso equivale à redução *exon* do py-ard para alelos
  isolados, que é o caso dos NMDPCodes.
- A API MAC do NMDP (códigos com `?`) é opcional, acionada por um botão no painel. Se o
  servidor do NMDP bloquear chamadas feitas por páginas web, a GLString é copiada para a
  área de transferência para ser codificada à parte.

## Estrutura

```
index.html        interface
css/style.css     estilos (tema claro/escuro)
js/arquivos.js    leitor de ZIP/XLSX e gerador de ZIP (sem bibliotecas)
js/core.js        leitura do TARR e do Assign, comparação, QC e exportação (testável no Node)
js/app.js         interface: placa, painel de decisão, revisão em lote, gráficos, exportação
```

Os testes de bancada ficam em `teste/` e usam `node` e `playwright`; não fazem parte do site.
