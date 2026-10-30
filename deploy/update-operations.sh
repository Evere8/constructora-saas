#!/usr/bin/env bash
# Constructora only. Run AFTER a clean fast-forward of main, as root.
# Does not pull code, modify nginx, restart MySQL or touch other Compose projects.
set -Eeuo pipefail
umask 077

if [[ ${EUID} -ne 0 ]]; then
  echo 'Ejecuta con sudo bash /opt/constructora/app/deploy/update-operations.sh' >&2
  exit 1
fi
cd /opt/constructora/app
[[ $(pwd -P) == /opt/constructora/app ]] || { echo 'Ruta inesperada'; exit 1; }
git_task=(git -c safe.directory=/opt/constructora/app)
[[ $("${git_task[@]}" branch --show-current) == main ]] || { echo 'Debe estar en main'; exit 1; }
[[ -z $("${git_task[@]}" status --porcelain) ]] || { echo 'Hay cambios locales; no se sobrescribirán'; exit 1; }
case "$("${git_task[@]}" remote get-url origin)" in
  git@github.com:Evere8/constructora-saas.git|https://github.com/Evere8/constructora-saas.git) ;;
  *) echo 'Repositorio inesperado; detenido' >&2; exit 1 ;;
esac
release_commit=$("${git_task[@]}" rev-parse HEAD)
cd /opt/constructora
compose_task=(docker compose --project-name constructora --env-file frontend.env
  -f compose.yaml -f app/deploy/compose.backend.yaml -f app/deploy/compose.frontend.yaml)
drive_enabled=0
if [[ -f /etc/constructora/project-docs/rclone.conf ]]; then
  compose_task+=(-f app/deploy/compose.drive-documents.yaml)
  drive_enabled=1
elif [[ -f /etc/constructora/drive-rclone.conf ]]; then
  echo 'Existe una configuración Drive antigua: revisa docs/DRIVE_DOCUMENTOS_OPERATIVOS.md antes de continuar.' >&2
  exit 1
fi
"${compose_task[@]}" config --quiet
for service in api frontend mysql; do
  actual_project=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "constructora-$service")
  [[ $actual_project == constructora ]] || { echo "Contenedor ajeno: $service"; exit 1; }
done
[[ $(docker inspect --format '{{.State.Running}}' constructora-api) == true ]] || { echo 'La API debe estar activa antes del respaldo'; exit 1; }
api_image=$(docker inspect --format '{{.Image}}' constructora-api)
frontend_image=$(docker inspect --format '{{.Image}}' constructora-frontend)
[[ $api_image == sha256:* && $frontend_image == sha256:* ]] || exit 1
upload_mb=$(docker exec constructora-api du -sm /data/uploads | awk '{print $1}')
free_mb=$(df -Pm /opt/constructora | awk 'NR==2 {print $4}')
[[ $upload_mb =~ ^[0-9]+$ && $free_mb =~ ^[0-9]+$ ]] || exit 1
(( free_mb > upload_mb + 2048 )) || { echo 'Se necesita espacio para respaldos y al menos 2 GB libres para compilar'; exit 1; }
release_backup=$(mktemp -d /opt/constructora/operations-release.XXXXXXXX)
release_tag="pre-$(basename "$release_backup")"
docker image tag "$api_image" "constructora-api:$release_tag"
docker image tag "$frontend_image" "constructora-frontend:$release_tag"
printf 'commit_nuevo=%s\napi_anterior=%s\nfrontend_anterior=%s\n' "$release_commit" "$api_image" "$frontend_image" > "$release_backup/release.txt"
tar -czf "$release_backup/configuration.tar.gz" compose.yaml frontend.env app.env mysql.env

api_paused=0
containers_recreated=0
on_failure() {
  local result=$?
  (( result != 0 )) || result=130
  trap - ERR INT TERM
  if [[ $api_paused == 1 && $containers_recreated == 0 ]]; then
    docker start constructora-api >/dev/null || true
    echo 'Se intentó volver a iniciar la API anterior; revisa su estado.' >&2
  fi
  echo "ACTUALIZACION_DETENIDA. Respaldo conservado: $release_backup" >&2
  echo 'No ejecutes downgrade, down -v, prune ni restaures la base sin revisar el error.' >&2
  exit "${result:-1}"
}
trap on_failure ERR INT TERM

echo 'Construyendo API y frontend; la versión actual sigue funcionando…'
"${compose_task[@]}" build api frontend
if [[ $drive_enabled == 1 ]]; then
  "${compose_task[@]}" run --rm --no-deps -T api python -m app.services.verify_project_drive
fi

echo 'Pausa breve SOLO de Constructora para respaldar datos y archivos de forma consistente.'
api_paused=1
"${compose_task[@]}" stop --timeout 30 api
"${compose_task[@]}" exec -T mysql sh -c \
  'MYSQL_PWD="$MYSQL_PASSWORD" mysqldump --no-tablespaces --single-transaction --quick --skip-lock-tables --set-gtid-purged=OFF -u"$MYSQL_USER" "$MYSQL_DATABASE"' \
  | gzip > "$release_backup/database.sql.gz"
gzip -t "$release_backup/database.sql.gz"
gzip -cd "$release_backup/database.sql.gz" | tail -n 20 | grep -q -- '-- Dump completed on'
docker run --rm --network none --volumes-from constructora-api:ro --entrypoint tar \
  "$api_image" -C /data/uploads -czf - . > "$release_backup/uploads.tar.gz"
gzip -t "$release_backup/uploads.tar.gz"
tar -tzf "$release_backup/uploads.tar.gz" >/dev/null
sha256sum "$release_backup/database.sql.gz" "$release_backup/uploads.tar.gz" "$release_backup/configuration.tar.gz" > "$release_backup/SHA256SUMS"
echo "RESPALDO_OK: $release_backup"

"${compose_task[@]}" run --rm --no-deps -T api alembic upgrade head
"${compose_task[@]}" run --rm --no-deps -T api alembic current
"${compose_task[@]}" run --rm --no-deps -T api python -m app.db.verify_schema
containers_recreated=1
"${compose_task[@]}" up -d --no-deps --force-recreate --wait --wait-timeout 180 api frontend
api_paused=0
curl -fsS --max-time 15 http://127.0.0.1:8000/api/health/ready
curl -fsS --max-time 15 http://127.0.0.1:8080/healthz
"${compose_task[@]}" ps
trap - ERR INT TERM
echo "ACTUALIZACION_OK commit=$release_commit respaldo=$release_backup"
if [[ $drive_enabled == 0 ]]; then
  echo 'Drive operativo pendiente: las carpetas están disponibles; las subidas se habilitan al completar docs/DRIVE_DOCUMENTOS_OPERATIVOS.md.'
fi
echo 'No se modificó Nginx ni se reinició MySQL ni otro proyecto del servidor.'
