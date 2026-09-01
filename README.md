# Constructora SaaS — Backend

Backend inicial para el SaaS de constructoras. Está preparado para:

- FastAPI como API HTTPS.
- MySQL 8.4 como base principal y multiempresa.
- Supabase únicamente como proveedor de identidad.
- JWT de Supabase verificados mediante JWKS público.
- Roles y permisos almacenados en MySQL, nunca en `user_metadata`.
- Docker Compose sin publicar MySQL en Internet.
- Perfil autenticado vinculado a `app_users`.
- Panel de plataforma para administrar planes, constructoras y membresías.
- Auditoría de operaciones administrativas.

## Estructura

```text
backend/
  app/
    api/          Endpoints y dependencias HTTP
    core/         Configuración y autenticación
    db/           Motor, sesiones y modelos
    services/     Reglas de negocio
  alembic/        Migraciones MySQL
  tests/          Pruebas automáticas
deploy/
  compose.backend.yaml
docs/
  ARCHITECTURE.md
```

## Variables requeridas

El contenedor recibe las variables MySQL del archivo privado `/opt/constructora/mysql.env`.
Copiar `.env.example` como `/opt/constructora/app.env` y completar solo en el VPS:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY` (solo si se usan funciones administrativas)
- `CORS_ORIGINS`

Nunca subir esos archivos a GitHub.

## Ejecución en el VPS

Desde `/opt/constructora`:

```bash
sudo docker compose -f compose.yaml -f app/deploy/compose.backend.yaml up -d --build
sudo docker compose -f compose.yaml -f app/deploy/compose.backend.yaml exec api alembic upgrade head
curl http://127.0.0.1:8000/api/health/ready
```

La API queda enlazada solo a `127.0.0.1:8000`. Caddy será el único servicio público.

## API disponible

- `GET /api/v1/auth/me`: perfil MySQL, estado, permiso de plataforma y membresías.
- `GET/POST/PATCH /api/v1/platform/plans`: administración de planes.
- `GET/POST/PATCH /api/v1/platform/companies`: constructoras y sus estados.
- `GET/POST /api/v1/platform/companies/{id}/memberships`: usuarios y roles.
- `PATCH /api/v1/platform/memberships/{id}`: rol o estado de una membresía.

Las rutas `/platform` requieren `is_platform_admin = 1`. La migración
`0002_seed_plans` carga los planes Inicial, Profesional y Empresa.

## Seguridad

- No se publica `3306`.
- El frontend nunca recibe la contraseña de MySQL ni la clave secreta de Supabase.
- Cada consulta empresarial debe filtrar por `company_id` obtenido de la membresía.
- El campo `sub` del JWT se vincula con `app_users.supabase_user_id`.
- `user_metadata` no se usa para autorizar roles.
