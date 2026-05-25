#!/bin/bash
# =================================================
# Configura Nginx como reverse proxy + HTTPS
# =================================================
# Uso: bash setup-nginx.sh DOMINIO_OU_IP [EMAIL_ADMIN]
# Exemplo: bash setup-nginx.sh oasis.meudominio.com.br admin@meudominio.com.br
# Sem domínio (usa IP): bash setup-nginx.sh 123.45.67.89
# =================================================
set -e

DOMAIN="${1:-}"
EMAIL="${2:-admin@example.com}"

if [ -z "$DOMAIN" ]; then
  echo "Uso: bash setup-nginx.sh DOMINIO_OU_IP [EMAIL_ADMIN]"
  exit 1
fi

echo ""
echo "🌐 Configurando Nginx para: $DOMAIN"
echo "===================================="

# 1) Cria configuração do site
cat > /etc/nginx/sites-available/oasis-solar <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    # Tamanho máximo de upload (CSV, fotos)
    client_max_body_size 20M;

    # Proxy reverso para Node.js na porta 3001
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;

        # WebSocket (Socket.IO) — essencial para o real-time
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";

        # Headers padrão
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        # Tempos limites maiores para uploads/PDFs
        proxy_read_timeout 90s;
        proxy_send_timeout 90s;
    }
}
EOF

# 2) Ativa o site
ln -sf /etc/nginx/sites-available/oasis-solar /etc/nginx/sites-enabled/oasis-solar
# Remove default que escuta em todas as conexões
rm -f /etc/nginx/sites-enabled/default

# 3) Testa e recarrega Nginx
nginx -t
systemctl reload nginx
echo "   ✓ Nginx configurado e recarregado"

# 4) HTTPS via Let's Encrypt (só se for um domínio real, não IP)
if [[ "$DOMAIN" =~ ^[0-9.]+$ ]]; then
  echo ""
  echo "⚠️  $DOMAIN parece ser um IP. HTTPS via Let's Encrypt só funciona com domínio."
  echo "   Acesse: http://$DOMAIN"
else
  echo ""
  echo "🔒 Provisionando certificado HTTPS via Let's Encrypt..."
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email "$EMAIL" --redirect || {
    echo "⚠️  Certbot falhou. O DNS de $DOMAIN deve apontar para este servidor antes de tentar de novo."
    echo "   Para retentar: certbot --nginx -d $DOMAIN"
    exit 0
  }
  echo "   ✓ HTTPS ativo: https://$DOMAIN"
fi

echo ""
echo "✅ NGINX CONFIGURADO"
echo ""
echo "Acesse:"
if [[ "$DOMAIN" =~ ^[0-9.]+$ ]]; then
  echo "   http://$DOMAIN/login.html"
else
  echo "   https://$DOMAIN/login.html"
fi
echo ""
echo "Login admin padrão:"
echo "   admin@oasis.local / admin123"
echo "   ⚠️  TROQUE essa senha imediatamente pelo painel /Usuarios"
