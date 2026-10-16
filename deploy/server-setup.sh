#!/bin/bash
# Serverda BIR MARTA ishga tushiriladi:   sudo bash server-setup.sh markaz-nomi.duckdns.org
# Nima qiladi: Docker (yo'q bo'lsa) o'rnatadi, /opt/markaz va .env yaratadi (tasodifiy kalitlar bilan),
# nginx saytini sozlaydi va certbot bilan HTTPS oladi. Mavjud saytlarga (masalan Taskflow) tegmaydi.
set -euo pipefail
DOMAIN="${1:?Domen kerak: sudo bash server-setup.sh markaz-nomi.duckdns.org}"
APP=/opt/markaz
[ "$(id -u)" = 0 ] || { echo "root (sudo) bilan ishga tushiring"; exit 1; }

command -v docker >/dev/null || { curl -fsSL https://get.docker.com | sh; }
docker compose version >/dev/null

mkdir -p "$APP/data" "$APP/backups" "$APP/deploy/nginx"
cd "$APP"

if [ ! -f .env ]; then
  SECRET=$(python3 -c "import secrets;print(secrets.token_urlsafe(64))")
  DBPASS=$(python3 -c "import secrets;print(secrets.token_hex(24))")
  ADMINPATH=$(python3 -c "import secrets;print('boshqaruv-'+secrets.token_hex(4)+'/')")
  cat > .env <<ENV
DJANGO_DEBUG=0
DJANGO_SECRET_KEY=$SECRET
DJANGO_ALLOWED_HOSTS=$DOMAIN
DJANGO_CSRF_TRUSTED_ORIGINS=https://$DOMAIN
DJANGO_ADMIN_URL=$ADMINPATH
CORS_ALLOWED_ORIGINS=https://$DOMAIN
DJANGO_SSL_REDIRECT=1
POSTGRES_DB=markaz
POSTGRES_USER=markaz
POSTGRES_PASSWORD=$DBPASS
DATABASE_URL=postgres://markaz:$DBPASS@db:5432/markaz
JWT_ACCESS_MINUTES=15
JWT_REFRESH_DAYS=1
JWT_REMEMBER_DAYS=30
AXES_FAILURE_LIMIT=5
LOG_LEVEL=INFO
ENV
  chmod 600 .env
  echo ".env yaratildi. Django admin manzili: https://$DOMAIN/$ADMINPATH"
else
  echo ".env mavjud — tegilmadi"
fi

# nginx: avval HTTP sayt, keyin certbot HTTPS qo'shadi
apt-get install -y -q nginx certbot python3-certbot-nginx >/dev/null
cat > /etc/nginx/sites-available/markaz <<NGINX
limit_req_zone \$binary_remote_addr zone=markaz_login:10m rate=5r/m;
server {
    listen 80;
    server_name $DOMAIN;
    client_max_body_size 2m;
    server_tokens off;
    location = /api/auth/login/ {
        limit_req zone=markaz_login burst=5 nodelay;
        proxy_pass http://127.0.0.1:8001;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
    location / {
        proxy_pass http://127.0.0.1:8001;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/markaz /etc/nginx/sites-enabled/markaz
nginx -t && systemctl reload nginx
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect

echo
echo "Tayyor. Endi GitHub'da Deploy workflow'ni ishga tushiring (yoki main ga push qiling)."
