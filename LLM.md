# OASIS SOLAR — Contexto para LLM

> Sistema completo de gestão de usinas fotovoltaicas em produção no VPS Hostinger.
> Este documento resume o projeto para servir de contexto a outra LLM continuar o trabalho.

---

## 🎯 O que é

Sistema web multi-usuário para gestão de parque fotovoltaico com:
- Lançamento e acompanhamento de geração (mensal e por SKID)
- Cadastro de usinas, SKIDs e previsões
- Manutenções em Kanban (drag-drop) com vencimento e alertas
- Financeiro (Receitas / Despesas / Financiamento) com CSV import
- Fit Energia — relatórios de faturamento (PDF e Excel) com comparativo geração vs faturamento
- Comparativo entre usinas
- Relatórios PDF (geração e financeiro)
- Notificações em tempo real (Socket.IO) para admins
- Painel de admin de usuários com permissões granulares por aba
- Mobile responsivo (sidebar drawer + tabelas com scroll)

**Usuário do projeto:** Eduardo Motta (email `eduardoolimot@gmail.com`).
**Idioma:** Português brasileiro (todas as UIs, mensagens e commits).

---

## 🏗️ Stack técnica

| Camada | Tecnologia |
|---|---|
| Backend | Node.js 20+ · Express 4 · ESM (import/export) |
| ORM | Prisma 5 (schema.prisma) |
| Banco | PostgreSQL (produção) / SQLite (dev local — atualmente sem Postgres local) |
| Realtime | Socket.IO 4 (cookie httpOnly auth) |
| Auth | JWT em cookie httpOnly + bcrypt (senhas) |
| Upload | Multer (multipart) |
| PDF | pdfkit (gera relatórios) · pdf-parse v2.4.5 (lê PDFs Fit) |
| Excel | xlsx (SheetJS) |
| Validação | Zod (schemas em `server/src/lib/schemas.js`) |
| Frontend | HTML/CSS/JS puro (sem framework) · Chart.js 4 · Font Awesome 6 |
| Deploy | VPS Ubuntu (Hostinger) · Nginx (proxy 80→3001) · PM2 (auto-restart) |

---

## 📁 Estrutura do projeto

```
oasis-solar/
├── server/                       # Backend Node.js
│   ├── src/
│   │   ├── index.js              # Boot Express + Socket.IO + jobs
│   │   ├── realtime.js           # Socket.IO handlers
│   │   ├── db.js                 # Cliente Prisma
│   │   ├── routes/
│   │   │   ├── auth.js           # /api/auth (login/logout/me)
│   │   │   ├── usinas.js         # /api/usinas
│   │   │   ├── lancamentos.js    # /api/lancamentos + import CSV
│   │   │   ├── manutencoes.js    # /api/manutencoes + upload arquivos
│   │   │   ├── financeiro.js     # /api/financeiro + import CSV
│   │   │   ├── notificacoes.js   # /api/notificacoes
│   │   │   ├── dashboard.js      # /api/dashboard/kpis (agregador)
│   │   │   ├── relatorio.js      # PDFs (geração + financeiro)
│   │   │   ├── admin.js          # /api/admin (usuários + audit)
│   │   │   └── fit.js            # /api/fit (Fit Energia)
│   │   ├── middleware/auth.js    # requireAuth + requireRole
│   │   ├── lib/
│   │   │   ├── env.js            # Validação Zod das env vars
│   │   │   ├── http.js           # asyncRoute, errorHandler
│   │   │   ├── jwt.js            # sign/verify + cookie opts
│   │   │   ├── schemas.js        # Todos schemas Zod
│   │   │   ├── upload.js         # Multer configs
│   │   │   ├── csv.js            # Parser CSV lançamentos
│   │   │   ├── csv-fin.js        # Parser CSV financeiro
│   │   │   ├── fit-parser.js     # Parser PDF Fit
│   │   │   ├── fit-excel-parser.js # Parser XLSX Fit
│   │   │   ├── fit-valor.js      # Busca valor cat Fit do Financeiro
│   │   │   ├── notificar.js      # notificarAdmins/notificarUsuario
│   │   │   ├── access.js         # Filtro por usinas acessíveis
│   │   │   ├── permissoes.js     # Defaults por role + calc final
│   │   │   ├── degradacao.js     # Fator de degradação módulos FV
│   │   │   └── ...
│   │   └── jobs/
│   │       └── manutencao-vencimento.js  # Cron 5min alertas venc.
│   ├── prisma/
│   │   ├── schema.prisma         # Modelos (Postgres)
│   │   ├── seed.js               # Usuários iniciais
│   │   ├── seed-real.js          # 7 usinas reais
│   │   ├── seed-geracao.js       # Lançamentos 2026
│   │   ├── seed-geracao-2025.js  # Lançamentos 2025
│   │   └── wipe-financeiro.js    # Script para limpar financeiro
│   ├── package.json
│   └── .env                      # DATABASE_URL, JWT_SECRET, etc
├── client/                       # Frontend estático (servido pelo Express)
│   ├── login.html + login.js
│   ├── index.html                # Layout com sidebar + seções
│   ├── app.js                    # Toda a lógica (grande)
│   ├── api.js                    # Wrapper fetch (cookie automático)
│   ├── utils.js                  # Helpers ($, toast, formatação)
│   └── styles.css                # CSS com media queries mobile
├── deploy/                       # Scripts do VPS
│   ├── install-vps.sh            # Instalação inicial
│   ├── deploy-app.sh             # Deploy do app
│   ├── setup-nginx.sh            # Nginx + HTTPS
│   └── update.sh                 # git pull + npm i + prisma push + pm2 restart
├── Dockerfile / railway.json / Procfile
├── README.md / DEPLOY.md
└── LLM.md                        # ESTE arquivo
```

---

## 🗄️ Modelo de dados (Prisma)

Modelos principais em `server/prisma/schema.prisma`:

- **User**: id, email, senhaHash, nome, role (`ADMIN`|`TECNICO`|`VISUALIZADOR`), ativo, permissoes[], acessos[]
- **UsinaAccess**: `(userId, usinaId)` — restringe visibilidade
- **UserPermission**: `(userId, secao)` com `podeVer`/`podeEditar` — sobrepõe defaults do role
- **Usina**: nome, kwp, inicio, local, módulos + inversores (achatado), skids[], previsoes[]
- **Skid**: nome, kwp, previsoes[] (por SKID)
- **Previsao**: usinaId, skidId?, mes, gen, irrad, pr
- **Lancamento**: usinaId, skidId?, periodo (YYYY-MM), geracao, irrad, pr, disp
- **Manutencao**: tipo (`prev`|`corr`|`pred`|`plan`), status (`plan`|`exec`|`ok`), titulo, data, **vencimento**, vencimentoNotificado, arquivos[]
- **Arquivo**: anexo de manutencao (imagem/PDF)
- **Financeiro**: tipo (`rec`|`des`|`fin`), data, cat (string livre), val, st (`pg`|`pend`|`prev`)
- **Notificacao**: userId?, titulo, body, tipo, lida
- **AuditLog**: userId, acao, recurso, recursoId, payload
- **FitEnergia**: usinaId, skidId?, periodo, geracaoKwh, valorFaturado, tarifa, distribuidora, beneficiarios, arquivoNome

---

## 🔐 Regras de acesso (importante)

1. **Auth** por cookie httpOnly com JWT. Middleware `requireAuth` popula `req.user` com `permissoes` (mapa `{ secao: {ver, editar} }`).
2. **Roles com defaults**:
   - ADMIN → tudo
   - TECNICO → tudo exceto `usuarios`
   - VISUALIZADOR → apenas leitura, sem `usuarios`/`importar`
3. **UserPermission** sobrescreve defaults por seção. Sem registro → usa default do role.
4. **UsinaAccess**: se usuário não-ADMIN tem 0 acessos → vê tudo. Se tem 1+ → só vê os listados.
5. Helpers backend: `aplicarFiltroUsinas(where, req)` e `exigirAcessoUsina(usinaId, req)` em `lib/access.js`.

---

## 🍪 Cookie de auth (armadilha comum)

Em HTTP puro (sem HTTPS), cookies com `secure: true` são silenciosamente descartados pelo browser → o `POST /login` retorna 200 mas o próximo `GET /me` falha → loop de login.

Fix aplicado em `lib/jwt.js`: `authCookieOptions()` detecta se `CORS_ORIGIN` começa com `https://` para decidir `secure`. Sempre `sameSite: 'lax'`. Override via env `COOKIE_SECURE=true|false`.

`CORS_ORIGIN` no VPS deve ser o URL público real (ex: `http://IP_DO_VPS`) — NÃO `localhost`.

---

## 🚀 Deploy no VPS

Sistema rodando em **VPS Hostinger Ubuntu** com:
- Node 20, Postgres 16 (local no VPS), Nginx, PM2, Certbot
- App em `/opt/oasis-solar` (clone git)
- PM2 processo `oasis-solar` na porta 3001, Nginx faz proxy 80→3001
- `.env` em `/opt/oasis-solar/server/.env` com `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGIN`, etc
- Credenciais do banco geradas em `/root/oasis-credenciais/db.txt`

**Fluxo de deploy de novas mudanças:**
1. PC: `git push` para GitHub
2. VPS: `cd /opt/oasis-solar && bash deploy/update.sh` (faz git pull + npm install + prisma db push + pm2 restart)

**Sistema atualmente ONLINE** — usuário fez login `admin@oasis.local / admin123` (deve trocar senha).

---

## 💡 Features implementadas (todas em produção)

### Painel Principal (Dashboard)
- 5 KPIs (Geração, Disponibilidade, Tempo Operação, PR, Yield kWh/kWp)
- 4 gráficos: Geração Mensal×Prevista (com irradiação eixo secundário), Pizza por Usina, Irradiação Prev×Real, **Yield horizontal por usina**
- Tabela Mês×Mês e Desempenho por Usina
- Filtros: ano, mês, usina, SKID
- **SKID filter respeita escopo** — quando seleciona SKID, todas as previsões/kWp/yield usam o SKID específico

### Cadastro de Usinas
- Modal com abas: Dados Gerais, Componentes, Previsão Mensal, SKIDs
- **Auto-preenchimento**: se há SKIDs com previsão, a previsão da usina = soma da geração + média de irrad/PR (botão "Calcular dos SKIDs" ou automático ao entrar na aba)

### Lançamentos
- CRUD + editar registro (form reaproveitado, título muda)
- Import CSV (formato modelo com meses)
- Filtros: usina, ano, mês

### Manutenções (Kanban)
- 3 colunas: Planejadas / Em Execução / Concluídas
- Drag-and-drop entre colunas
- **Data de vencimento** com job cron 5min que notifica admins + responsável
- Cards vencidos com borda vermelha + badge

### Financeiro
- 3 tipos: Receita, Despesa, **Financiamento** (tipo próprio, cor roxa)
- 5 KPIs (Rec, Des, Fin, Líquido Op, Líquido Total)
- Filtros: usina, ano, mês, tipo, **multi-categoria** (dropdown com checkboxes)
- Import CSV planilha modelo (ITEM=Receita/Despesas/Financiamento)
- Criar categorias novas inline (botão +)
- Gráficos: Receitas vs Despesas por mês + Categorias em doughnut

### Fit Energia
- Botões "Carregar PDF" e "Carregar Excel"
- **Regra**: Geração vem do arquivo (Excel/PDF), **Valor sempre vem do Financeiro (categoria `Fit`)** — busca por `contains: 'fit'` case-insensitive
- Preview editável linha a linha (Excel) ou campos (PDF)
- Parser PDF robusto (aceita v1 e v2 do pdf-parse, com fallback em várias resoluções)
- Tabela comparativa: Geração Fit × Geração Usina (medida), com diferença destacada
- Gráfico barras lado a lado por mês

### Comparativo
- Chips clicáveis por usina (state.comparativo.conhecidas evita re-adicionar desmarcadas)
- Cards de KPIs por usina com destaque no melhor
- **vs Previsto proporcional aos meses com dados**
- Toggle linha/barra no gráfico
- Botão exportar PNG

### Relatório
- 2 abas internas: Geração e Financeiro
- PDF Geração: header azul, KPIs do mês, tabela Prev×Real (Geração/Irrad/PR), histórico de manutenções
- **PDF Financeiro completo** replica página do módulo: 5 KPIs, tabelas de categorias (Receitas/Despesas/Financiamento com %), distribuição mensal (se anual), extrato completo paginado

### Notificações
- Sino no topbar com dot indicando não-lidas
- Real-time via Socket.IO (`emitToUser` por admin)
- **Notificações automáticas**: qualquer mutation (create/update/delete) em usina/lancamento/manutenção/financeiro/fit → todos os admins recebem com nome do autor e timestamp
- Helper `notificarAdmins({ titulo, body, tipo, exceto })` em `lib/notificar.js`

### Usuários (ADMIN)
- CRUD com senha padrão `1234` se não informada
- Seleção de usinas acessíveis (checklist)
- **Matriz de permissões** (Seção × Ver × Editar) com defaults do role visíveis

### Mobile responsivo
- Sidebar vira drawer com hambúrguer
- KPIs empilham
- Tabelas com scroll horizontal
- Modais tela cheia
- Media queries em `styles.css`

---

## 🔧 Pontos de atenção conhecidos

1. **Dev local não funciona** — schema é Postgres, DATABASE_URL local está SQLite. Não iniciei preview server. Testes são feitos direto no VPS após `git push` + `bash deploy/update.sh`.

2. **pdf-parse v2**: mudou API. Fix em `fit-parser.js` — função `resolvePdfParse()` tenta 5 formatos de export. Erros claros se buffer vazio ou PDF só de imagem.

3. **Prisma + null em unique composta**: não aceita `null` no `where` composto. Solução: `findFirst` + `create` manual em vez de `upsert`. Usado em Lancamento (usinaId, skidId, periodo) e FitEnergia.

4. **cwd reset entre calls do Bash tool**: após `cd`, o próximo comando volta pro cwd anterior. Usar caminhos absolutos ou encadear com `&&`.

5. **PM2 mostra "online" mas porta vazia**: crash silencioso após boot. Fix: `pm2 delete oasis-solar && pm2 start ...` (não basta `restart`).

6. **`sed -n '10,20p'` mostra o arquivo — CONFIRMADO fix do pdf-parse aplicado no VPS** (linha `import * as PdfParseLib` presente).

7. **Nginx no VPS Hostinger**: template vem com Traefik ocupando porta 80. Usuário removeu tudo (Coolify + Docker) e instalou Nginx puro. Guardado em `deploy/setup-nginx.sh`.

8. **CORS_ORIGIN**: usuário rodou fix que detecta IP público via `curl ifconfig.me` e coloca no `.env`. Sem HTTPS, cookies com `secure: true` quebram.

---

## 📝 Convenções

- **Commits em português** com prefixo `feat/fix/chore(escopo)`, ex: `feat(fit): upload Excel com preview`
- **User-facing text sempre em pt-BR**
- **Tarefas rastreadas** via TaskCreate/TaskUpdate ao longo da conversa
- **Após cada feature**: instruir usuário a fazer `git push` no PC e `bash deploy/update.sh` no VPS
- **Nunca commitar sem push** — foi problema real que quebrou produção (fix ficou no PC do usuário, GitHub e VPS ficaram com versão antiga)

---

## 🔨 Últimas mudanças (contexto imediato)

Últimas features entregues, em ordem:

1. **Fit Excel + regra Financeiro** — parser XLSX, valor SEMPRE puxa da categoria Fit do Financeiro (helper `buscarValorFitFinanceiro`), preview mostra origens (Geração=Excel, Valor=Financeiro)
2. **Fit PDF robusto** — `resolvePdfParse()` tenta 5 formatos, aceita `data.text`/`data.pages[]`/`data.content`/string
3. **Auto-preenchimento previsão** — usina.previsão = soma dos SKIDs.gen, média irrad/PR
4. **Dashboard respeita SKID** — helpers `previsoesParaUsina(u)` e `kwpEfetivo(u)`
5. **Fit Energia com SKID/ano/mês** no modal antes do upload
6. **Permissões granulares** por seção com matriz Ver/Editar
7. **Mobile responsivo** completo
8. **Financeiro** com tipo Financiamento, filtro mês, multi-categoria, editar lançamento
9. **Notificações automáticas** para admins em toda mutation
10. **Vencimento de manutenção** com job cron

## Feature pedida em aberto (última mensagem do usuário)

Usuário pediu:
> "em manutenção montar uma aba para OS (ordem de serviço) que deve seguir o padrão do arquivo em anexo como referência"
>
> "Antes de subir a atualização no github, gostaria de gerar um arquivo em html para testar a nova funcionalidade"

Anexo: `C:\Users\Eduardo Motta\Downloads\files.zip` — ainda não foi extraído.

**Próximos passos sugeridos:**
1. Extrair o zip e ler o padrão de OS
2. Criar um `client/os-preview.html` standalone (sem backend) com dados mockados para o usuário aprovar
3. Após aprovação, integrar de verdade nas rotas + banco (novo model `OS` ou estender `Manutencao`)

---

## 🧪 Como testar / rodar

- **Produção**: `http://IP_DO_VPS/login.html` — credenciais `admin@oasis.local` (usuário deve ter trocado a senha)
- **Update production**: no VPS `cd /opt/oasis-solar && bash deploy/update.sh`
- **Ver logs**: `pm2 logs oasis-solar --lines 30 --nostream`
- **Reset limpo**: `pm2 delete oasis-solar && cd /opt/oasis-solar/server && pm2 start src/index.js --name oasis-solar --time`

---

## 📞 Comunicação com o usuário

- Linguagem: **português brasileiro informal-profissional**
- Ao terminar uma feature: mostrar **resumo do que mudou** + **como testar** + **comandos exatos** para push/deploy
- Usar emojis moderadamente (✅ ❌ 🚀 🎯 🐛 🔧)
- Usuário testa direto no VPS (sem dev local funcional)
- Se algo dá erro em produção, pedir `pm2 logs` para diagnóstico

---

**Fim do contexto.**
