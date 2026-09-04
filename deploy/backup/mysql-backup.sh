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
: "${UPLOADS_BACKUP_DIR:=/var/backups/constructora/uploads}"
: "${RCLONE_DESTINATION:?Debe configurar RCLONE_DESTINATION}"
: "${RCLONE_UPLOADS_DESTINATION:=${RCLONE_DESTINATION%/mysql}/uploads}"
: "${LOCAL_RETENTION_DAYS:=7}"
: "${REMOTE_RETENTION_DAYS:=30}"

for command_name in docker gzip tar sha256sum rclone flock; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Falta el comando requerido: $command_name" >&2
    exit 1
  fi
done

install -d -m 0700 "$BACKUP_DIR"
install -d -m 0700 "$UPLOADS_BACKUP_DIR"
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
uploads_filename="constructora_uploads_${timestamp}.tar.gz"
uploads_archive="$UPLOADS_BACKUP_DIR/$uploads_filename"
uploads_partial="$uploads_archive.partial"
uploads_checksum="$uploads_archive.sha256"
remote_uploads_root="${RCLONE_UPLOADS_DESTINATION%/}"

cleanup() {
  rm -f "$partial" "$uploads_partial"
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

docker compose -f "$COMPOSE_PRIMARY" -f "$COMPOSE_BACKEND" exec -T api python -c \
  'import sys, tarfile; archive = tarfile.open(fileobj=sys.stdout.buffer, mode="w|gz"); archive.add("/data/uploads", arcname="uploads"); archive.close()' \
  >"$uploads_partial"

tar -tzf "$uploads_partial" >/dev/null
mv "$uploads_partial" "$uploads_archive"
(
  cd "$UPLOADS_BACKUP_DIR"
  sha256sum "$uploads_filename" >"$uploads_filename.sha256"
)

rclone copyto "$uploads_archive" "$remote_uploads_root/$uploads_filename" \
  --checksum --retries 3
rclone copyto "$uploads_checksum" "$remote_uploads_root/$uploads_filename.sha256" \
  --checksum --retries 3

if ! rclone lsf "$remote_uploads_root" --files-only --include "$uploads_filename" \
  | grep -Fxq "$uploads_filename"; then
  echo "El respaldo de archivos no aparece en el destino remoto" >&2
  exit 1
fi

find "$BACKUP_DIR" -maxdepth 1 -type f \
  \( -name 'constructora_mysql_*.sql.gz' -o -name 'constructora_mysql_*.sql.gz.sha256' \) \
  -mtime "+$LOCAL_RETENTION_DAYS" -delete

find "$UPLOADS_BACKUP_DIR" -maxdepth 1 -type f \
  \( -name 'constructora_uploads_*.tar.gz' -o -name 'constructora_uploads_*.tar.gz.sha256' \) \
  -mtime "+$LOCAL_RETENTION_DAYS" -delete

rclone delete "$remote_root" \
  --min-age "${REMOTE_RETENTION_DAYS}d" \
  --include 'constructora_mysql_*.sql.gz' \
  --include 'constructora_mysql_*.sql.gz.sha256'
rclone rmdirs "$remote_root" --leave-root

rclone delete "$remote_uploads_root" \
  --min-age "${REMOTE_RETENTION_DAYS}d" \
  --include 'constructora_uploads_*.tar.gz' \
  --include 'constructora_uploads_*.tar.gz.sha256'
rclone rmdirs "$remote_uploads_root" --leave-root

echo "BACKUP_OK database=$filename uploads=$uploads_filename destination=$remote_root"
