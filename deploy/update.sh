#!/bin/bash
# =================================================
# Atualiza a aplicação (puxa do GitHub e reinicia)
# Use sempre que enviar mudanças ao repositório.
# =================================================
set -e

APP_DIR="/opt/oasis-solar"
cd "$APP_DIR"

echo "🔄 git pull..."
git pull origin main

echo "📦 npm install (incremental)..."
cd "$APP_DIR/server"
npm install --omit=dev --no-audit --no-fund

echo "🗄️  Aplicando alterações de schema (se houver)..."
npx prisma generate
npx prisma db push --accept-data-loss

echo "▶️  Reiniciando..."
pm2 restart oasis-solar

echo "✅ Update concluído"
pm2 logs oasis-solar --lines 20 --nostream
