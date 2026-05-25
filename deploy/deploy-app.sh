#!/bin/bash
# =================================================
# Clona o projeto, instala dependências e inicia
# Executar APÓS install-vps.sh estar pronto
# =================================================
set -e

APP_DIR="/opt/oasis-solar"
REPO_URL="${REPO_URL:-}"  # exportar antes: export REPO_URL=https://github.com/SEU/REPO.git

if [ -z "$REPO_URL" ]; then
  echo "❌ Variável REPO_URL não definida. Execute:"
  echo "   export REPO_URL=https://github.com/SEU/REPO.git"
  echo "   bash deploy-app.sh"
  exit 1
fi

# Lê credenciais do banco geradas pelo install-vps.sh
if [ ! -f /root/oasis-credenciais/db.txt ]; then
  echo "❌ Credenciais do banco não encontradas. Rode install-vps.sh primeiro."
  exit 1
fi
source /root/oasis-credenciais/db.txt

# JWT secret
JWT_SECRET=$(openssl rand -base64 48)

echo ""
echo "🚀 Deploy do OASIS SOLAR"
echo "========================"
echo ""

# 1) Clonar/atualizar repositório
if [ -d "$APP_DIR/.git" ]; then
  echo "📥 Atualizando repositório existente em $APP_DIR..."
  cd "$APP_DIR"
  git pull origin main
else
  echo "📥 Clonando repositório em $APP_DIR..."
  rm -rf "$APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi

# 2) Criar .env de produção
echo ""
echo "🔐 Criando .env de produção..."
cat > "$APP_DIR/server/.env" <<EOF
PORT=3001
NODE_ENV=production
DATABASE_URL=$DATABASE_URL
JWT_SECRET=$JWT_SECRET
JWT_EXPIRES_IN=7d
CORS_ORIGIN=http://localhost:3001
UPLOAD_DIR=uploads
UPLOAD_MAX_BYTES=10485760
EOF
chmod 600 "$APP_DIR/server/.env"
echo "   ✓ /opt/oasis-solar/server/.env"

# 3) Instalar dependências de produção
echo ""
echo "📦 Instalando dependências (npm install)..."
cd "$APP_DIR/server"
npm install --omit=dev --no-audit --no-fund

# 4) Gerar Prisma client e aplicar schema
echo ""
echo "🗄️  Aplicando schema no banco..."
npx prisma generate
npx prisma db push --accept-data-loss

# 5) Rodar seeds
echo ""
echo "🌱 Populando banco com dados reais..."
node prisma/seed.js              # cria usuários
echo ""
node prisma/seed-real.js         # cria as 7 usinas iniciais
echo ""
node prisma/seed-geracao.js      # cria 5 usinas com SKIDs + 104 lançamentos 2026
echo ""
node prisma/seed-geracao-2025.js # 60 lançamentos 2025

# 6) Iniciar com PM2
echo ""
echo "▶️  Iniciando o servidor com PM2..."
pm2 delete oasis-solar 2>/dev/null || true
pm2 start "$APP_DIR/server/src/index.js" --name oasis-solar --time
pm2 save
pm2 startup systemd -u root --hp /root | tail -1 | bash || true

echo ""
echo "✅ APP NO AR (porta 3001)"
echo ""
echo "Próximo passo (HTTPS):"
echo "   bash setup-nginx.sh"
