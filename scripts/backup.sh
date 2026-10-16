#!/bin/sh
# Kunlik zaxira: docker compose exec -T db pg_dump. Cron: 0 2 * * * /opt/markaz/scripts/backup.sh
set -e
DIR="${BACKUP_DIR:-./backups}"; mkdir -p "$DIR"
docker compose -f docker-compose.prod.yml exec -T db pg_dump -U "${POSTGRES_USER:-markaz}" "${POSTGRES_DB:-markaz}" | gzip > "$DIR/markaz-$(date +%F).sql.gz"
find "$DIR" -name 'markaz-*.sql.gz' -mtime +30 -delete
