#!/bin/bash
# =================================================
# OASIS SOLAR — Setup automatizado no VPS Ubuntu
# =================================================
# Executar como root: bash install-vps.sh
# Ou via SSH: ssh root@SEU_IP "bash -s" < install-vps.sh
# =================================================
set -e  # para no primeiro erro

echo ""
echo "🌞 OASIS SOLAR — Instalação automatizada"
echo "========================================"
echo ""

# 1) Sistema atualizado
echo "📦 Atualizando o sistema..."
apt update -qq
apt upgrade -y -qq

# 2) Pacotes essenciais
echo ""
echo "📦 Instalando pacotes essenciais..."
apt install -y -qq curl wget gnupg2 ca-certificates lsb-release \
                   build-essential git ufw nginx software-properties-common

# Garante que o Nginx está habilitado e ativo (caso a instalação não tenha iniciado)
systemctl enable nginx >/dev/null 2>&1 || true
systemctl start nginx >/dev/null 2>&1 || true

# 3) Node.js 20 LTS via NodeSource
echo ""
echo "📦 Instalando Node.js 20..."
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y -qq nodejs
fi
NODE_VER=$(node --version)
echo "   ✓ Node $NODE_VER"

# 4) PostgreSQL 16
echo ""
echo "📦 Instalando PostgreSQL..."
if ! command -v psql &> /dev/null; then
  apt install -y -qq postgresql postgresql-contrib
  systemctl enable postgresql
  systemctl start postgresql
fi
PG_VER=$(psql --version | awk '{print $3}')
echo "   ✓ PostgreSQL $PG_VER"

# 5) PM2 (process manager)
echo ""
echo "📦 Instalando PM2..."
if ! command -v pm2 &> /dev/null; then
  npm install -g pm2
fi
echo "   ✓ PM2 $(pm2 --version)"

# 6) Certbot (Let's Encrypt)
echo ""
echo "📦 Instalando Certbot..."
apt install -y -qq certbot python3-certbot-nginx

# 7) Firewall
echo ""
echo "🔥 Configurando firewall (UFW)..."
ufw --force enable
ufw allow OpenSSH
ufw allow 'Nginx Full'
echo "   ✓ Portas abertas: SSH (22), HTTP (80), HTTPS (443)"

# 8) Criar usuário do banco e database
echo ""
echo "🗄️  Configurando banco PostgreSQL..."
DB_USER="oasis"
DB_PASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)
DB_NAME="oasis_solar"

# Cria role e database se não existirem (idempotente)
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS' CREATEDB;"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"

echo "   ✓ Banco: $DB_NAME"
echo "   ✓ Usuário: $DB_USER"
echo ""
echo "🔑 GUARDE A SENHA DO BANCO (vai no .env):"
echo "   $DB_PASS"
echo ""
echo "📋 String de conexão:"
echo "   DATABASE_URL=\"postgresql://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME?schema=public\""
echo ""

# Salva as credenciais em arquivo seguro
mkdir -p /root/oasis-credenciais
chmod 700 /root/oasis-credenciais
cat > /root/oasis-credenciais/db.txt <<EOF
DB_USER=$DB_USER
DB_PASS=$DB_PASS
DB_NAME=$DB_NAME
DATABASE_URL=postgresql://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME?schema=public
EOF
chmod 600 /root/oasis-credenciais/db.txt
echo "   ↪ Credenciais salvas em /root/oasis-credenciais/db.txt"

echo ""
echo "✅ INSTALAÇÃO BASE CONCLUÍDA"
echo ""
echo "Próximo passo:"
echo "   bash deploy-app.sh"
