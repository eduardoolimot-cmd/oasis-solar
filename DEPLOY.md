# Deploy no VPS (Hostinger / Oracle Cloud / qualquer Ubuntu)

Este guia leva você do zero até o sistema **rodando em produção com HTTPS**.

## Pré-requisitos

- VPS Ubuntu 22.04 ou 24.04
- Acesso root via SSH
- O projeto no GitHub (público ou privado com SSH/HTTPS configurado)
- (Opcional) Um domínio com DNS apontando para o VPS

---

## Visão geral

```
[Você no PC] ──ssh──> [VPS Ubuntu]
                       ├─ Node.js 20
                       ├─ PostgreSQL 16
                       ├─ Nginx (proxy + HTTPS)
                       └─ PM2 (mantém o servidor sempre rodando)
```

Tudo é automatizado por 3 scripts em `deploy/`:

1. **`install-vps.sh`** — instala Node, Postgres, Nginx, PM2 e cria o banco
2. **`deploy-app.sh`** — clona do GitHub, instala deps, aplica schema, roda seeds, inicia PM2
3. **`setup-nginx.sh`** — configura proxy reverso + HTTPS via Let's Encrypt

---

## Passo 1 — Conectar no VPS

No Windows (PowerShell):
```powershell
ssh root@SEU_IP_DO_VPS
```

Quando pedir senha, cole a senha root (não aparece nada enquanto você digita — é normal).
Se for a primeira vez, digite `yes` para aceitar a fingerprint.

## Passo 2 — Instalar dependências

```bash
# Baixa o script direto do seu repositório
curl -O https://raw.githubusercontent.com/SEU_USER/SEU_REPO/main/deploy/install-vps.sh
chmod +x install-vps.sh
bash install-vps.sh
```

⚠️ **No fim, o script imprime a senha do banco de dados gerada.** Anote — fica salva também em `/root/oasis-credenciais/db.txt`.

## Passo 3 — Deploy da aplicação

```bash
# Aponta para o seu repositório
export REPO_URL=https://github.com/SEU_USER/SEU_REPO.git

curl -O https://raw.githubusercontent.com/SEU_USER/SEU_REPO/main/deploy/deploy-app.sh
chmod +x deploy-app.sh
bash deploy-app.sh
```

O script vai:
- Clonar em `/opt/oasis-solar`
- Criar `.env` de produção
- Instalar deps com `npm install`
- Aplicar schema com `prisma db push`
- Rodar os seeds (usuários + usinas + lançamentos reais)
- Iniciar com PM2 (auto-restart)

Teste com:
```bash
curl http://localhost:3001/api/health
```

## Passo 4 — Nginx + HTTPS

### Com domínio
```bash
curl -O https://raw.githubusercontent.com/SEU_USER/SEU_REPO/main/deploy/setup-nginx.sh
chmod +x setup-nginx.sh
bash setup-nginx.sh meudominio.com.br admin@meudominio.com.br
```

Antes de rodar com domínio, garanta que o DNS aponta para o IP do VPS (registro A).

### Sem domínio (só IP, sem HTTPS)
```bash
bash setup-nginx.sh SEU_IP_DO_VPS
```
Acesse pelo navegador: `http://SEU_IP_DO_VPS/login.html`

## Passo 5 — Primeiro acesso

```
URL:    https://seudominio.com.br/login.html  (ou http://IP)
Email:  admin@oasis.local
Senha:  admin123
```

🔒 **TROQUE a senha imediatamente** indo em **Usuários** no menu, editar admin, "Senha".

---

## Manutenção

### Ver status / logs
```bash
pm2 status                  # status do processo
pm2 logs oasis-solar        # logs em tempo real
pm2 restart oasis-solar     # reinicia
```

### Atualizar após push novo
```bash
cd /opt/oasis-solar
bash deploy/update.sh
```

### Backup do banco
```bash
sudo -u postgres pg_dump oasis_solar > backup-$(date +%Y-%m-%d).sql
```

### Renovar HTTPS (automático, mas para verificar)
```bash
certbot renew --dry-run
```

---

## Troubleshooting

| Sintoma | Solução |
|---|---|
| `502 Bad Gateway` | `pm2 logs oasis-solar` — provavelmente o app caiu, veja erro |
| Não conecta no banco | Veja credenciais em `/root/oasis-credenciais/db.txt` e edite `/opt/oasis-solar/server/.env` |
| Certbot falhou | DNS ainda não propagou — espere 10 min e rode `certbot --nginx -d DOMINIO` |
| WebSocket não conecta | Confirme que o Nginx tem `Upgrade` headers no proxy_pass (já vem certo no script) |
| Porta 3001 ocupada | `fuser -k 3001/tcp && pm2 restart oasis-solar` |
