# OASIS SOLAR

Sistema de gestão de usinas fotovoltaicas com **persistência em banco**, **multi-usuário com perfis**, **upload de arquivos** e **atualizações em tempo real via WebSocket**.

## Arquitetura

```
oasis-solar/
├── server/                 # Node.js + Express + Prisma + Socket.IO
│   ├── src/
│   │   ├── index.js              # Express + WebSocket
│   │   ├── realtime.js           # Socket.IO + broadcast
│   │   ├── db.js                 # Cliente Prisma
│   │   ├── routes/               # auth, usinas, lancamentos, manutencoes,
│   │   │                         # financeiro, notificacoes, dashboard,
│   │   │                         # relatorio, admin
│   │   ├── middleware/           # auth, requireRole
│   │   └── lib/                  # env, http, jwt, schemas, csv, upload
│   ├── prisma/
│   │   ├── schema.prisma         # Dev — SQLite
│   │   ├── schema.postgres.prisma  # Prod — PostgreSQL (copiar antes do deploy)
│   │   ├── migrations/
│   │   └── seed.js
│   └── uploads/                  # Arquivos enviados (volume persistente)
├── client/                 # Frontend HTML + JS puro (sem framework)
│   ├── login.html / login.js
│   ├── index.html
│   ├── app.js                    # Lógica principal
│   ├── api.js                    # Wrapper fetch
│   ├── utils.js
│   └── styles.css
├── Dockerfile
├── .dockerignore
├── railway.json
├── Procfile
└── README.md
```

## Stack

- **Backend:** Node.js 20+, Express 4, Prisma ORM 5, Socket.IO 4
- **Banco:** SQLite (dev) / PostgreSQL (prod)
- **Auth:** JWT em cookie httpOnly + bcrypt
- **Real-time:** Socket.IO com auth via cookie
- **Upload:** Multer (disco) + parser CSV (csv-parse)
- **PDF:** PDFKit (server-side)
- **Validação:** Zod
- **Frontend:** Vanilla JS + Chart.js + Font Awesome

## Endpoints principais (REST)

| Verbo | Rota | Descrição |
|---|---|---|
| POST | `/api/auth/login` | Login com email + senha |
| POST | `/api/auth/logout` | Logout (limpa cookie) |
| GET  | `/api/auth/me` | Usuário autenticado |
| GET/POST/PUT/DELETE | `/api/usinas[/​:id]` | CRUD de usinas (com skids + previsões) |
| GET/POST/PUT/DELETE | `/api/lancamentos[/​:id]` | CRUD lançamentos + filtros |
| POST | `/api/lancamentos/importar` | Importação CSV em lote |
| POST | `/api/lancamentos/importar/preview` | Preview do CSV sem persistir |
| GET/POST/PUT/PATCH/DELETE | `/api/manutencoes[/​:id]` | CRUD + status Kanban + arquivos |
| GET/POST/PUT/DELETE | `/api/financeiro[/​:id]` | CRUD financeiro |
| GET  | `/api/financeiro/sumario` | KPIs agregados |
| GET  | `/api/notificacoes` | Lista (global + do usuário) |
| PATCH | `/api/notificacoes/:id/lida` | Marca como lida |
| POST | `/api/notificacoes/marcar-todas-lidas` | Bulk |
| GET  | `/api/dashboard/kpis` | Agregador para a home |
| GET  | `/api/relatorio/pdf` | Relatório mensal em PDF |
| GET  | `/api/admin/usuarios` | Gestão de usuários (ADMIN) |
| GET  | `/api/admin/audit` | Audit log (ADMIN) |
| GET  | `/api/admin/stats` | Estatísticas gerais (ADMIN) |
| GET  | `/api/admin/exportar/{lancamentos,financeiro}.csv` | Exportações CSV |

## Eventos Socket.IO (real-time broadcast)

Quando um usuário cria/edita/deleta, todos os outros conectados recebem:

- `usina:created` · `usina:updated` · `usina:deleted`
- `lancamento:created` · `lancamento:updated` · `lancamento:deleted` · `lancamento:batch`
- `manutencao:created` · `manutencao:updated` · `manutencao:deleted`
- `financeiro:created` · `financeiro:updated` · `financeiro:deleted`
- `notificacao:created` (broadcast global ou direcionado por userId)

## Perfis e permissões

| Perfil | Pode | Não pode |
|---|---|---|
| **ADMIN** | tudo | — |
| **TECNICO** | CRUD de usinas, lançamentos, manutenções, financeiro, importação CSV | excluir usina, gerenciar usuários, audit log |
| **VISUALIZADOR** | ver dashboards, listas, exportar CSV/PDF | qualquer mutação |

---

## 🚀 Desenvolvimento local

### Pré-requisitos
- Node.js 20+ e npm

### Setup
```bash
cd server
cp .env.example .env
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Abra `http://localhost:3001/login.html`

### Credenciais de dev (criadas pelo seed)
```
ADMIN:        admin@oasis.local      / admin123
TECNICO:      tecnico@oasis.local    / tecnico123
VISUALIZADOR: view@oasis.local       / view123
```

### Scripts npm úteis
```bash
npm run dev          # Hot-reload (--watch)
npm run start        # Sem hot-reload (produção)
npm run db:migrate   # Cria/aplica migrations (dev)
npm run db:seed      # Repopula dados de exemplo
npm run db:studio    # Abre Prisma Studio (UI do banco)
npm run db:reset     # CUIDADO: apaga tudo e refaz seed
```

---

## ☁️ Deploy no Railway

### Passo 1 — Trocar SQLite por PostgreSQL no schema
```bash
cd server/prisma
cp schema.postgres.prisma schema.prisma  # sobrescreve
rm -rf migrations dev.db dev.db-journal
```

### Passo 2 — Subir no Railway
1. Crie um projeto novo em [railway.app](https://railway.app)
2. Adicione o serviço **PostgreSQL** (gera `DATABASE_URL` automaticamente)
3. Adicione um serviço de **Deploy from GitHub** apontando para o repo
4. Configure as variáveis de ambiente do serviço web:
   ```
   NODE_ENV=production
   JWT_SECRET=<rode: openssl rand -base64 32>
   CORS_ORIGIN=https://seu-dominio.up.railway.app
   ```
5. O Railway detecta o `Dockerfile` ou `Procfile` e faz o deploy
6. Migrations são aplicadas automaticamente no startup (`prisma migrate deploy`)

### Passo 3 — Primeiro acesso
- O seed **NÃO** roda automaticamente em produção (proteção).
- Após o deploy, conecte-se via `npm run db:seed` localmente apontando para `DATABASE_URL` do Railway, **OU** crie o admin via console:
  ```bash
  railway run --service=oasis-solar node server/prisma/seed.js
  ```
- Faça login com `admin@oasis.local / admin123` e **troque a senha imediatamente** pelo painel admin.

### Volume persistente para uploads
- Railway: adicione um **Volume** montado em `/app/server/uploads`
- Render: configure um **Persistent Disk** no mesmo path
- Sem volume, fotos de manutenção são perdidas a cada restart

---

## 🐳 Deploy via Docker (genérico)

```bash
# Build
docker build -t oasis-solar .

# Run (PostgreSQL externo)
docker run -d \
  -p 3001:3001 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/oasis" \
  -e JWT_SECRET="seu-segredo-aleatorio-longo" \
  -e CORS_ORIGIN="https://seudominio.com" \
  -e NODE_ENV=production \
  -v oasis-uploads:/app/server/uploads \
  --name oasis-solar \
  oasis-solar
```

---

## 🧪 Testes

Scripts de smoke test no diretório `server/`:

```bash
node test-api.js       # CRUD Usinas + Lançamentos (52 asserts)
node smoke-test.js     # Endpoints Manutenções, Financeiro, Notificações, Dashboard
node smoke-final.js    # Fase D — Admin, audit, PDF, exportações, frontend (18 asserts)
node socket-test.js    # Real-time end-to-end
```

Total: **90+ asserts cobrindo todo o backend.**

---

## Segurança

- Senhas com **bcrypt cost 10**
- JWT em cookie **httpOnly + sameSite=lax** (`secure: true` em produção)
- Validação Zod em **todos** os payloads
- Audit log de login/logout e mutações em recursos sensíveis
- Mensagens de erro genéricas no login (não revela se email existe)
- CORS restrito por env var
- Foreign keys com cascade no banco

## Limitações conhecidas

- **Senhas fracas** no seed de dev — apropriadas só para localhost; troque em prod
- **SQLite** sem suporte real a múltiplas escritas concorrentes — use PostgreSQL em prod
- **Uploads** ainda em disco local — para multi-instância migre para S3/R2 (próxima iteração)
- **Sem reset de senha por email** ainda — só admin pode redefinir
- **Frontend SPA simples** — sem rotas reais; tudo navega via JS

## Próximas iterações

- [ ] Reset de senha por email (Resend / SendGrid)
- [ ] Upload de avatares dos usuários
- [ ] Migrar uploads para R2/S3
- [ ] Painel admin no frontend (lista de usuários, audit log)
- [ ] Filtros avançados no dashboard (multi-usina)
- [ ] Importação CSV de usinas
- [ ] Notificações automáticas (geração abaixo do previsto, manutenção vencida)
- [ ] Modo escuro
