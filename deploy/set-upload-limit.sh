#!/usr/bin/env bash
# Only the known Constructora virtual host. Stream operational Drive uploads.
set -Eeuo pipefail
umask 077
[[ ${EUID} -eq 0 ]] || { echo 'Ejecuta este script con sudo'; exit 1; }
site=/etc/nginx/sites-available/obrixapy-app
[[ -f $site && -d /opt/constructora ]] || { echo 'No se encontró el sitio esperado'; exit 1; }
count=$(grep -Ec '^[[:space:]]*client_max_body_size[[:space:]]+(0|10M|11M|52M);([[:space:]]*#.*)?$' "$site" || true)
[[ $count == 1 ]] || { echo 'Configuración distinta a la esperada: no se cambió Nginx'; exit 1; }
read_count=$(grep -Ec '^[[:space:]]*proxy_read_timeout[[:space:]]+(60s|21600s);[[:space:]]*$' "$site" || true)
send_count=$(grep -Ec '^[[:space:]]*proxy_send_timeout[[:space:]]+(60s|21600s);[[:space:]]*$' "$site" || true)
[[ $read_count == 1 && $send_count == 1 ]] || { echo 'Timeouts distintos a los esperados: no se cambió Nginx'; exit 1; }
nginx -t
limit_backup=$(mktemp -d /opt/constructora/nginx-limit.XXXXXXXX)
cp -p "$site" "$limit_backup/obrixapy-app.conf"
sed -i -E 's/^([[:space:]]*)client_max_body_size[[:space:]]+(0|10M|11M|52M);([[:space:]]*#.*)?$/\1client_max_body_size 0; # operational Drive uploads have no fixed size cap/' "$site"
sed -i -E 's/^([[:space:]]*)proxy_read_timeout[[:space:]]+(60s|21600s);[[:space:]]*$/\1proxy_read_timeout 21600s;/' "$site"
sed -i -E 's/^([[:space:]]*)proxy_send_timeout[[:space:]]+(60s|21600s);[[:space:]]*$/\1proxy_send_timeout 21600s;/' "$site"
if ! grep -Eq '^[[:space:]]*proxy_request_buffering[[:space:]]+off;' "$site"; then
  proto_count=$(grep -Ec '^[[:space:]]*proxy_set_header[[:space:]]+X-Forwarded-Proto[[:space:]]+\$scheme;' "$site" || true)
  [[ $proto_count == 1 ]] || { cp -p "$limit_backup/obrixapy-app.conf" "$site"; echo 'No se encontró el bloque proxy esperado'; exit 1; }
  sed -i '/proxy_set_header X-Forwarded-Proto \$scheme;/a\        proxy_request_buffering off;' "$site"
fi
if nginx -t; then
  systemctl reload nginx
  echo "SUBIDAS_DRIVE_OK: sin límite fijo de Nginx y con transferencia extendida. Respaldo: $limit_backup"
else
  cp -p "$limit_backup/obrixapy-app.conf" "$site"
  echo 'Se recuperó la configuración anterior. Nginx no se recargó.' >&2
  exit 1
fi
