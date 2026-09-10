#!/usr/bin/env bash
# Run as sudo bash app/deploy/recover-sectors.sh from the existing VPS.
set -Eeuo pipefail
umask 077
cd /opt/constructora

compose() {
  docker compose --env-file frontend.env -f compose.yaml \
    -f app/deploy/compose.backend.yaml -f app/deploy/compose.frontend.yaml "$@"
}

recovery_backup_dir=""
trap 'printf "Recuperación detenida. No se continuó después del error. Respaldo: %s\n" "$recovery_backup_dir" >&2' ERR

# Build first: a failed download/build must not alter the running database.
compose build api frontend

recovery_backup_dir="$(mktemp -d /opt/constructora/sector-recovery.XXXXXXXX)"
compose exec -T mysql sh -c \
  'MYSQL_PWD="$MYSQL_PASSWORD" mysqldump --no-tablespaces --single-transaction --quick --skip-lock-tables --set-gtid-purged=OFF -u"$MYSQL_USER" "$MYSQL_DATABASE"' \
  | gzip > "$recovery_backup_dir/database.sql.gz"
gzip -t "$recovery_backup_dir/database.sql.gz"
gzip -cd "$recovery_backup_dir/database.sql.gz" | tail -n 20 | grep -q -- '-- Dump completed on'
printf 'Respaldo verificado: %s/database.sql.gz\n' "$recovery_backup_dir"

# Retry only missing schema operations; never stamp past a failed migration.
compose run --rm --no-deps api alembic upgrade head
compose run --rm --no-deps api python -m app.db.verify_schema

# Only activate the new containers after the real level queries have passed.
compose up -d --force-recreate --wait --wait-timeout 180 api frontend
compose exec -T api python -m app.db.verify_schema
curl --fail --show-error --silent --retry 5 --retry-connrefused --max-time 10 \
  http://127.0.0.1:8080/api/health/ready
printf '\nRECUPERACION_OK. Actualiza Obrixapy con Ctrl+F5.\n'
