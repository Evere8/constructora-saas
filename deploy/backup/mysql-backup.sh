#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

readonly BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-/etc/constructora/backup.env}"

if [[ ! -r "$BACKUP_ENV_FILE" ]]; then
  echo "No se puede leer la configuración: $BACKUP_ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$BACKUP_ENV_FILE"
set +a

: "${PROJECT_DIR:=/opt/constructora}"
: "${COMPOSE_PRIMARY:=compose.yaml}"
: "${COMPOSE_BACKEND:=app/deploy/compose.backend.yaml}"
: "${BACKUP_DIR:=/var/backups/constructora/mysql}"
: "${RCLONE_DESTINATION:?Debe configurar RCLONE_DESTINATION}"
: "${LOCAL_RETENTION_DAYS:=7}"
: "${REMOTE_RETENTION_DAYS:=30}"

for command_name in docker gzip sha256sum rclone flock; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Falta el comando requerido: $command_name" >&2
    exit 1
  fi
done

install -d -m 0700 "$BACKUP_DIR"
exec 9>"$BACKUP_DIR/.backup.lock"
if ! flock -n 9; then
  echo "Ya hay otro respaldo en ejecución" >&2
  exit 0
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
filename="constructora_mysql_${timestamp}.sql.gz"
archive="$BACKUP_DIR/$filename"
partial="$archive.partial"
checksum="$archive.sha256"
remote_root="${RCLONE_DESTINATION%/}"

cleanup() {
  rm -f "$partial"
}
trap cleanup EXIT

cd "$PROJECT_DIR"

docker compose -f "$COMPOSE_PRIMARY" -f "$COMPOSE_BACKEND" exec -T mysql sh -lc \
  'MYSQL_PWD="$MYSQL_PASSWORD" mysqldump --no-tablespaces --single-transaction --quick --skip-lock-tables -u"$MYSQL_USER" "$MYSQL_DATABASE"' \
  | gzip -9 >"$partial"

gzip -t "$partial"
if ! gzip -cd "$partial" | tail -n 20 | grep -q -- '-- Dump completed on'; then
  echo "El respaldo no contiene la marca final de mysqldump" >&2
  exit 1
fi

mv "$partial" "$archive"
(
  cd "$BACKUP_DIR"
  sha256sum "$filename" >"$filename.sha256"
)

rclone copyto "$archive" "$remote_root/$filename" --checksum --retries 3
rclone copyto "$checksum" "$remote_root/$filename.sha256" --checksum --retries 3

if ! rclone lsf "$remote_root" --files-only --include "$filename" | grep -Fxq "$filename"; then
  echo "El archivo no aparece en el destino remoto después de subirlo" >&2
  exit 1
fi

find "$BACKUP_DIR" -maxdepth 1 -type f \
  \( -name 'constructora_mysql_*.sql.gz' -o -name 'constructora_mysql_*.sql.gz.sha256' \) \
  -mtime "+$LOCAL_RETENTION_DAYS" -delete

rclone delete "$remote_root" \
  --min-age "${REMOTE_RETENTION_DAYS}d" \
  --include 'constructora_mysql_*.sql.gz' \
  --include 'constructora_mysql_*.sql.gz.sha256'
rclone rmdirs "$remote_root" --leave-root

echo "BACKUP_OK file=$filename destination=$remote_root"
