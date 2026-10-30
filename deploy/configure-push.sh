#!/usr/bin/env bash
# Generate the site's VAPID key pair without printing the private key.
set -Eeuo pipefail
umask 077
[[ ${EUID} -eq 0 ]] || { echo 'Ejecuta este script con sudo'; exit 1; }
push_dir=/etc/constructora/push
private_key=$push_dir/vapid-private.pem
public_key=$push_dir/vapid-public.txt
install -d -m 750 -o root -g 10001 "$push_dir"
if [[ ! -f $private_key ]]; then
  openssl ecparam -name prime256v1 -genkey -noout -out "$private_key"
fi
public_value=$(openssl ec -in "$private_key" -pubout -outform DER 2>/dev/null | tail -c 65 | base64 -w0 | tr '+/' '-_' | tr -d '=')
[[ ${#public_value} -ge 80 ]] || { echo 'No se pudo derivar la clave pública'; exit 1; }
printf '%s\n' "$public_value" > "$public_key"
chown root:10001 "$private_key"
chmod 640 "$private_key"
chown root:root "$public_key"
chmod 644 "$public_key"
echo 'PUSH_KEYS_OK: claves VAPID instaladas; la clave privada no se mostró.'
