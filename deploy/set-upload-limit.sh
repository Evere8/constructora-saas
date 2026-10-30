#!/usr/bin/env bash
# Only the known Constructora virtual host. 10 MiB file + multipart overhead.
set -Eeuo pipefail
umask 077
[[ ${EUID} -eq 0 ]] || { echo 'Ejecuta este script con sudo'; exit 1; }
site=/etc/nginx/sites-available/obrixapy-app
[[ -f $site && -d /opt/constructora ]] || { echo 'No se encontró el sitio esperado'; exit 1; }
count=$(grep -Ec '^[[:space:]]*client_max_body_size[[:space:]]+(10M|11M|52M);[[:space:]]*$' "$site" || true)
[[ $count == 1 ]] || { echo 'Configuración distinta a la esperada: no se cambió Nginx'; exit 1; }
nginx -t
limit_backup=$(mktemp -d /opt/constructora/nginx-limit.XXXXXXXX)
cp -p "$site" "$limit_backup/obrixapy-app.conf"
sed -i -E 's/^([[:space:]]*)client_max_body_size[[:space:]]+(10M|11M|52M);[[:space:]]*$/\1client_max_body_size 11M;/' "$site"
if nginx -t; then
  systemctl reload nginx
  echo "LIMITE_OK: archivo máximo 10 MiB, petición 11 MiB. Respaldo: $limit_backup"
else
  cp -p "$limit_backup/obrixapy-app.conf" "$site"
  echo 'Se recuperó la configuración anterior. Nginx no se recargó.' >&2
  exit 1
fi
