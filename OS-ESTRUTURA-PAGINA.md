# Estrutura da página — Ordens de Serviço (OS) em Manutenção

Documento de referência da divisão/estrutura da nova aba **OS** dentro da seção
**Manutenção**, com base no protótipo aprovado (`client/os-preview.html`) e no
schema de dados de origem (`os-schema.json`, anexado pelo usuário).

Serve como guia para a integração real (model Prisma + rotas + `app.js`).

---

## 1. Hierarquia de dados (fonte: `os-schema.json`)

```
OS (Ordem de Serviço)
├─ numero                    "OS-2188-2025"
├─ data_emissao              date
├─ avaliacao                 string|number|null
├─ gerado_por                string
├─ responsavel               string
├─ duracao_estimada_total    "HH:MM:SS"
├─ notas                     string|null
├─ empresa.nome
├─ planta { nome, cliente, uf, potencia_mwp }   → mapeia para Usina no OASIS
├─ assinaturas { aceite_por, validado_por, realizado_por }
└─ ativos[]                  (Ativo)
   ├─ codigo                 "FL-PCA2-MV4-INV01"
   ├─ descricao              "INVERSOR 01"
   ├─ tipo                   INVERSOR | TRANSFORMADOR | QGBT | ESTRUTURA FIXA |
   │                         MÓDULO | ESTAÇÃO SOLARIMÉTRICA | SUBESTAÇÃO | CIRCUITO AUXILIAR
   ├─ localizacao             "FORTLEV / PEDRO CANÁRIO 2 (ES) / MV 04"
   ├─ prioridade              Baixa|Média|Alta|Crítica
   ├─ classificacao_1/2, centro_custo, codigo_barras
   └─ tarefas[]               (Tarefa)
      ├─ descricao            "MANUTENÇÃO PROGRAMADA MENSAL (INVERSORES)"
      ├─ data_agendada, data_hora_inicio, data_hora_fim
      ├─ tipo_tarefa          Preventiva mensal|trimestral|anual|Corretiva|Preditiva|Inspeção
      ├─ prioridade, trigger  "Data Cada 1 Meses"
      ├─ duracao_estimada, tempo_execucao, tempo_parada_ativo
      ├─ classificacao_1/2
      └─ subtarefas[]         (Subtarefa = item de checklist)
         ├─ ordem, grupo      "Inversor", "Transformador"...
         ├─ descricao
         ├─ tipo_resposta     status | texto_livre | medicao | foto
         ├─ status            aprovou | alerta | falhou | null
         ├─ valor_medido      (quando tipo_resposta = medicao)
         ├─ observacao
         └─ anexos[]          (Anexo)
            ├─ url, legenda, timestamp
            ├─ geolocalizacao { endereco, lat, lng }
            └─ selo_nota      "Nota: PC 2"
```

**Mapeamento para o schema Prisma atual do OASIS:**
`planta.nome` ⇄ `Usina.nome` (já existe) — os demais níveis (`Ativo`, `Tarefa`,
`Subtarefa`, `Anexo`) são novos e precisarão de 4 models relacionados a um novo
model `OS`, com `usinaId` como FK.

---

## 2. Divisão visual da página (2 estados, sem reload)

A aba OS vive dentro de `sec-manutencao`, ao lado do Kanban existente, via um
**tabbar interno** (`Kanban` | `Ordens de Serviço (OS)`). O Kanban atual não é
alterado.

```
sec-manutencao
├─ sec-bar (título + botão "Nova OS")
├─ tabbar interno
│   ├─ tabKanban   → mostra o Kanban atual (inalterado)
│   └─ tabOS       → mostra os blocos abaixo
│
├─ [ESTADO 1] viewList — Lista de OS
│   ├─ fbar (filtros): Usina | Status (sem pendências/alertas/falhas) | Ano
│   └─ os-grid → cards (1 por OS)
│       ├─ os-num (numero) + os-pill (status geral: ok/alerta/falhou)
│       ├─ planta.nome
│       ├─ meta: data_emissao, responsavel, contagem de ativos
│       └─ os-counts: chips Aprovou / Alerta / Falhou (agregado de todas subtarefas)
│
└─ [ESTADO 2] viewDetail — Relatório da OS (aberto ao clicar num card)
    ├─ os-back (voltar à lista)
    ├─ detail-actions: botão "Imprimir / Exportar PDF" (window.print(), CSS @media print pronto)
    └─ os-detail (repRoot)
        ├─ rep-header: logo/empresa + planta/cliente/UF + numero + data + avaliação
        ├─ meta-table: gerado_por, responsavel, duracao_estimada_total, notas
        ├─ N× ativo-block (1 por item de ativos[])
        │   ├─ section-title "Ativo"
        │   ├─ ativo-fields: descricao+codigo, tipo, localizacao, prioridade
        │   └─ N× bloco de tarefa (1 por item de tarefas[])
        │       ├─ section-title "Tarefa programada"
        │       ├─ tarefa-header: descricao, data_agendada, tipo_tarefa,
        │       │   início→fim, prioridade, duração estimada, trigger,
        │       │   tempo_execucao, classificacao_1, tempo_parada_ativo
        │       ├─ table.subtasks: Grupo | Descrição (+observação) | Resultado
        │       │   (badge colorido por status: aprovou=verde, alerta=amarelo, falhou=vermelho;
        │       │    ou valor_medido em negrito; ou ícone de foto)
        │       └─ anexos-grid (se houver anexos nas subtarefas): card por anexo
        │           com legenda, timestamp, geolocalização, selo_nota
        └─ signatures: 3 colunas (aceite_por | validado_por | realizado_por)
```

---

## 3. Regras de UI já validadas no protótipo

- **Status geral do card** = pior status entre todas as subtarefas da OS
  (`falhou` > `alerta` > `ok`), calculado em `piorStatus()`.
- **Contagem de chips** (aprovou/alerta/falhou) é feita apenas sobre
  subtarefas com `tipo_resposta === 'status'` (`contarStatus()`).
- Datas em `YYYY-MM-DD` → exibidas `DD/MM/AAAA` (`fmtData`); datetime
  `YYYY-MM-DDTHH:mm` → `DD/MM/AAAA HH:mm` (`fmtDataHora`).
- Layout do relatório é **imprimível** (`@media print` já esconde banner,
  sidebar, botões de ação e a lista, deixando só o relatório em A4).
- Campos ausentes/opcionais sempre renderizam `—` (nunca `undefined`/`null` cru).

---

## 4. O que falta para a integração real (próxima etapa, após aprovação)

1. **Prisma**: novos models `OS`, `OSAtivo`, `OSTarefa`, `OSSubtarefa`, `OSAnexo`
   (FKs em cascata) + `usinaId` em `OS` ligando à `Usina` existente.
2. **Rotas** (`server/src/routes/os.js`): CRUD de OS + upload de anexos
   (reaproveitar `multer` de `upload.js`) + filtro por usina/status/ano
   (respeitando `aplicarFiltroUsinas`, igual às demais rotas).
3. **Permissões**: nova seção `os` em `permissoes.js` (ver/editar) igual ao
   padrão das outras abas.
4. **Notificações**: notificar admin ao criar/editar OS (padrão `notificar.js`).
5. **Frontend**: portar `os-preview.html` para dentro de `sec-manutencao` no
   `index.html`/`app.js` real, trocando `mockOS` por fetch em `/api/os`.
6. **PDF real**: o botão já usa `window.print()` (funciona sem backend); se
   quiser PDF gerado no servidor (como o Financeiro), replicar padrão do
   `pdfkit` em `relatorio.js`.

---

## 5. Arquivos de referência

- Protótipo: `client/os-preview.html` (+ `preview-static-server.js` para rodar local)
- Schema fonte: `C:\Users\Eduardo Motta\Downloads\files_extracted\os-schema.json`
- Template original (Fracttal/AEVO): `os-template.html`, `os-example-data.json`, `README.md`
  (mesma pasta `files_extracted`)
