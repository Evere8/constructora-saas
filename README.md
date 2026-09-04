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
- Gestión operativa de obras, niveles y tareas con aislamiento multiempresa.
- Checklist dentro de cada tarea, con responsables, etapas, vencimientos y porcentaje de avance.
- Evidencias privadas de checklist mediante fotos, PDF y observaciones, aisladas por constructora.
- Planos privados por obra con versiones y anotaciones auditadas.
- Documentación técnica desde PDF o fotografía, OCR local, revisión humana y exportación Excel.
- Inventario de máquinas, herramientas y materiales con movimientos entre depósito y obras.
- Personal de la constructora con invitaciones, roles y asignación a tareas y controles.
- Reporte consolidado de obras, avance, inventario y personal.
- CI automático para lint y pruebas del backend.
- Respaldo diario cifrado de MySQL y archivos privados hacia Google Drive mediante rclone.
- Contrato y encargo versionado para generar el frontend con Emergent.

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
  BACKUPS_GOOGLE_DRIVE.md
  EMERGENT_FRONTEND.md
  FRONTEND_API_CONTRACT.md
  SAAS_ROADMAP.md
```

## Variables requeridas

El contenedor recibe las variables MySQL del archivo privado `/opt/constructora/mysql.env`.
Copiar `.env.example` como `/opt/constructora/app.env` y completar solo en el VPS:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY` (solo si se usan funciones administrativas)
- `SUPABASE_INVITE_REDIRECT_URL` (por ejemplo, `https://app.obrixapy.online/restablecer`)
- `CORS_ORIGINS`
- `DOCUMENT_MAX_BYTES` y `OCR_MAX_PDF_PAGES` (límites del procesamiento local)

Nunca subir esos archivos a GitHub.

## Ejecución en el VPS

Desde `/opt/constructora`:

```bash
sudo docker compose -f compose.yaml -f app/deploy/compose.backend.yaml up -d --build
sudo docker compose -f compose.yaml -f app/deploy/compose.backend.yaml exec api alembic upgrade head
curl http://127.0.0.1:8000/api/health/ready
```

La API queda enlazada solo a `127.0.0.1:8000`. Nginx es el único servicio público.

## Operación y frontend

- `docs/BACKUPS_GOOGLE_DRIVE.md`: configuración y verificación del respaldo.
- `docs/EMERGENT_FRONTEND.md`: prompt y criterios para que Emergent genere el MVP.
- `docs/FRONTEND_API_CONTRACT.md`: rutas, autenticación y permisos del cliente.
- `docs/SAAS_ROADMAP.md`: módulos terminados y orden de implementación restante.

## API disponible

- `GET /api/v1/auth/me`: perfil MySQL, estado, permiso de plataforma y membresías.
- `GET/POST/PATCH /api/v1/platform/plans`: administración de planes.
- `GET/POST/PATCH /api/v1/platform/companies`: constructoras y sus estados.
- `POST /api/v1/platform/companies/onboard`: crea la constructora, asigna su
  propietario e invita su cuenta por correo cuando todavía no existe.
- `GET/POST /api/v1/platform/companies/{id}/memberships`: usuarios y roles.
- `PATCH /api/v1/platform/memberships/{id}`: rol o estado de una membresía.
- `GET/POST/PATCH /api/v1/companies/{company_id}/projects`: obras de la constructora.
- `GET/POST/PATCH /api/v1/companies/{company_id}/projects/{project_id}/levels`: niveles.
- `GET/POST/PATCH /api/v1/companies/{company_id}/projects/{project_id}/tasks`: tareas.
- `GET/POST/PATCH /api/v1/companies/{company_id}/projects/{project_id}/checklist`: controles.
- `GET /api/v1/companies/{company_id}/projects/{project_id}/checklist/progress`: avance.
- `GET/POST /api/v1/companies/{company_id}/projects/{project_id}/checklist/{item_id}/evidence`: evidencias.
- `GET /api/v1/companies/{company_id}/projects/{project_id}/checklist/{item_id}/evidence/{evidence_id}/file`: descarga autenticada.
- `GET/POST /api/v1/companies/{company_id}/projects/{project_id}/plans`: planos privados y sus versiones.
- `GET/POST /api/v1/companies/{company_id}/projects/{project_id}/documents`: PDF/fotos, OCR y filas revisables.
- `GET /api/v1/companies/{company_id}/projects/{project_id}/documents/{job_id}/excel`: Excel generado.
- `GET/POST/PATCH /api/v1/companies/{company_id}/inventory`: herramientas y movimientos.
- `GET/POST/PATCH /api/v1/companies/{company_id}/members`: personal empresarial.
- `GET /api/v1/companies/{company_id}/reports/overview`: indicadores consolidados.
- `GET/PATCH /api/v1/companies/{company_id}/settings`: configuración general de la constructora.

Las rutas `/platform` requieren `is_platform_admin = 1`. La migración
`0002_seed_plans` carga los planes Inicial, Profesional y Empresa.

Las rutas operativas obtienen la constructora desde la URL y comprueban una
membresía activa en cada petición. El administrador de plataforma no puede entrar
en rutas empresariales; un futuro modo de soporte deberá ser explícito y auditado.
Los trabajadores y transportistas solamente pueden actualizar el estado de tareas
que tengan asignadas.

## Seguridad

- No se publica `3306`.
- El frontend nunca recibe la contraseña de MySQL ni la clave secreta de Supabase.
- Las evidencias, planos y documentos se guardan fuera del directorio público y se descargan solo por la API autenticada.
- El OCR usa Poppler y Tesseract dentro del contenedor; no envía documentos a servicios externos.
- Cada consulta empresarial debe filtrar por `company_id` obtenido de la membresía.
- El campo `sub` del JWT se vincula con `app_users.supabase_user_id`.
- `user_metadata` no se usa para autorizar roles.
