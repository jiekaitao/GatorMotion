#!/bin/bash
# Initialize SSL certificates for the first time.
# Usage: ./init-ssl.sh
#
# 1. Generates a temporary self-signed cert so Nginx can start
# 2. Starts Nginx
# 3. Runs certbot to get a real Let's Encrypt certificate
# 4. Reloads Nginx with the real cert

set -euo pipefail

if [ ! -f .env ]; then
  echo "ERROR: .env file not found. Copy .env.example to .env and fill in your values."
  exit 1
fi

source .env

if [ -z "${DOMAIN:-}" ] || [ -z "${CERTBOT_EMAIL:-}" ]; then
  echo "ERROR: DOMAIN and CERTBOT_EMAIL must be set in .env"
  exit 1
fi

CERT_DIR="certbot-conf"

echo "=== Step 1: Generate temporary self-signed certificate ==="
docker compose run --rm --entrypoint "" certbot sh -c "
  mkdir -p /etc/letsencrypt/live/${DOMAIN} &&
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout /etc/letsencrypt/live/${DOMAIN}/privkey.pem \
    -out /etc/letsencrypt/live/${DOMAIN}/fullchain.pem \
    -subj '/CN=localhost'
"

echo "=== Step 2: Start Nginx ==="
docker compose up -d nginx

echo "=== Step 3: Request Let's Encrypt certificate ==="
docker compose run --rm certbot certonly \
  --webroot \
  --webroot-path /var/www/certbot \
  --email "${CERTBOT_EMAIL}" \
  --agree-tos \
  --no-eff-email \
  -d "${DOMAIN}"

echo "=== Step 4: Reload Nginx with real certificate ==="
docker compose exec nginx nginx -s reload

echo ""
echo "=== SSL setup complete! ==="
echo "Your site should now be available at https://${DOMAIN}"
echo ""
echo "To start all services: docker compose up -d"
