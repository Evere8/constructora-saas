# Despliegue del frontend de Obrixapy

El frontend se compila con Node.js 24 LTS y se sirve desde un contenedor Nginx no
privilegiado. El contenedor publica solamente `127.0.0.1:8080`; el Nginx del VPS
es el único punto de entrada público.

## 1. DNS

En el proveedor del dominio, crear el registro:

| Tipo | Nombre | Contenido | TTL |
|---|---|---|---|
| A | `app` | `179.199.139.81` | `300` o automático |

No continuar con Certbot hasta que:

```bash
getent hosts app.obrixapy.online
```

devuelva `179.199.139.81`.

## 2. Actualizar el repositorio

En el VPS:

```bash
cd /opt/constructora/app
git pull --ff-only origin main
```

## 3. Variables de construcción

Desde `/opt/constructora`:

```bash
sudo install -m 600 app/deploy/frontend.env.example frontend.env
sudo nano frontend.env
```

Completar solamente en el VPS:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

La clave publishable está diseñada para el navegador. Nunca colocar
`service_role`, secret keys, contraseñas de MySQL ni tokens privados.

## 4. Construir y arrancar

```bash
cd /opt/constructora
sudo docker compose --env-file frontend.env \
  -f compose.yaml \
  -f app/deploy/compose.backend.yaml \
  -f app/deploy/compose.frontend.yaml \
  build frontend

sudo docker compose --env-file frontend.env \
  -f compose.yaml \
  -f app/deploy/compose.backend.yaml \
  -f app/deploy/compose.frontend.yaml \
  up -d frontend

sudo docker compose --env-file frontend.env \
  -f compose.yaml \
  -f app/deploy/compose.backend.yaml \
  -f app/deploy/compose.frontend.yaml \
  ps

curl -fsS http://127.0.0.1:8080/healthz
```

La última orden debe responder `ok`.

## 5. Nginx del VPS

```bash
sudo install -m 644 \
  /opt/constructora/app/deploy/nginx/obrixapy-app.conf \
  /etc/nginx/sites-available/obrixapy-app

sudo ln -sfn \
  /etc/nginx/sites-available/obrixapy-app \
  /etc/nginx/sites-enabled/obrixapy-app

sudo nginx -t
sudo systemctl reload nginx

curl -fsS -H 'Host: app.obrixapy.online' http://127.0.0.1/healthz
```

## 6. HTTPS

Cuando el DNS ya apunte al VPS:

```bash
sudo certbot --nginx \
  -d app.obrixapy.online \
  --redirect

sudo nginx -t
sudo systemctl reload nginx
curl -fsS https://app.obrixapy.online/healthz
```

## 7. CORS de la API

Editar `/opt/constructora/app.env` y añadir el origen exacto sin barra final,
preservando cualquier origen ya existente:

```dotenv
CORS_ORIGINS=https://app.obrixapy.online
```

Después recrear únicamente la API:

```bash
cd /opt/constructora
sudo docker compose \
  -f compose.yaml \
  -f app/deploy/compose.backend.yaml \
  up -d --force-recreate api
```

## 8. Supabase Auth

En Supabase, abrir **Authentication → URL Configuration** y definir:

- **Site URL:** `https://app.obrixapy.online`
- **Redirect URL de producción:** `https://app.obrixapy.online/restablecer`
- **Redirect URL local opcional:** `http://localhost:5173/restablecer`

Usar rutas exactas en producción.

## 9. Validación final

```bash
curl -fsS https://api.obrixapy.online/api/health/ready
curl -fsS https://app.obrixapy.online/healthz
curl -I https://app.obrixapy.online/login
```

Luego validar en el navegador:

1. Inicio de sesión.
2. Recuperación y restablecimiento de contraseña.
3. Consulta de `/api/v1/auth/me`.
4. Selector de empresa.
5. Cierre de sesión.
