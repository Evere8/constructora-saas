# Contrato de API para el frontend

## Conexión

- Producción: `https://api.obrixapy.online/api`
- Autenticación: `Authorization: Bearer <Supabase access_token>`
- Formato: JSON
- Zona horaria de fechas: ISO 8601; mostrar en la zona local del usuario.
- El frontend no accede directamente a tablas de Supabase ni a MySQL.

Ante un `401`, refrescar una sola vez la sesión de Supabase y repetir la petición.
Si vuelve a fallar, cerrar la sesión. Un `403` es falta de acceso empresarial y no
debe provocar reintentos. Los errores normales usan `{"detail":"mensaje"}`.

## Identidad y navegación

| Método | Ruta | Uso |
|---|---|---|
| GET | `/v1/auth/me` | Perfil, estado, administrador de plataforma y membresías |

`/v1/auth/me` devuelve `memberships[]` con `company_id`, nombre, slug, estado,
rol y estado de membresía. La constructora activa se elige siempre de esa lista.

## Administración de plataforma

Solo disponible cuando `is_platform_admin` es verdadero.

| Método | Ruta |
|---|---|
| GET, POST | `/v1/platform/plans` |
| PATCH | `/v1/platform/plans/{plan_id}` |
| GET, POST | `/v1/platform/companies` |
| POST | `/v1/platform/companies/onboard` |
| GET, PATCH | `/v1/platform/companies/{company_id}` |
| GET, POST | `/v1/platform/companies/{company_id}/memberships` |
| PATCH | `/v1/platform/memberships/{membership_id}` |

## Obras

| Método | Ruta | Filtros o cuerpo principal |
|---|---|---|
| GET, POST | `/v1/companies/{company_id}/projects` | `status`, `search`, `limit`, `offset` |
| GET, PATCH | `/v1/companies/{company_id}/projects/{project_id}` | Datos de la obra |
| GET, POST | `/v1/companies/{company_id}/projects/{project_id}/levels` | Niveles |
| PATCH | `/v1/companies/{company_id}/projects/{project_id}/levels/{level_id}` | Nivel |
| GET, POST | `/v1/companies/{company_id}/projects/{project_id}/tasks` | `status`, `task_type`, `assigned_user_id`, `level_id`, paginación |
| PATCH | `/v1/companies/{company_id}/projects/{project_id}/tasks/{task_id}` | Tarea |

Estados de obra: `active`, `inactive`, `completed`, `archived`.

Tipos de tarea: `work`, `transport`. Estados: `pending`, `in_progress`, `review`,
`completed`, `cancelled`. Prioridades: `low`, `normal`, `high`, `urgent`.

## Checklist

| Método | Ruta | Uso |
|---|---|---|
| GET, POST | `/v1/companies/{company_id}/projects/{project_id}/checklist` | Lista o crea controles |
| PATCH | `/v1/companies/{company_id}/projects/{project_id}/checklist/{item_id}` | Modifica un control |
| GET | `/v1/companies/{company_id}/projects/{project_id}/checklist/progress` | Resumen y porcentaje |
| GET, POST | `/v1/companies/{company_id}/projects/{project_id}/checklist/{item_id}/evidence` | Lista o agrega foto, PDF u observación |
| GET | `/v1/companies/{company_id}/projects/{project_id}/checklist/{item_id}/evidence/{evidence_id}/file` | Descarga autenticada |

Cada control nuevo se crea desde una tarea y envía su `task_id`. Los controles
anteriores sin tarea siguen siendo visibles para poder reasignarlos. Filtros de
checklist: `task_id`, `status`, `process_stage`, `assigned_user_id`, `limit`,
`offset`. Estados: `pending`, `in_progress`, `blocked`, `completed`,
`not_applicable`. La evidencia usa `multipart/form-data`, admite JPG, PNG, WEBP
o PDF y tiene un máximo de 10 MB por archivo.

## Roles

| Rol | Capacidades del MVP |
|---|---|
| `platform_admin` | Administración global; sin acceso operativo a empresas |
| `owner`, `admin`, `engineer` | Administran obras y trabajo |
| `supervisor` | Administra niveles, tareas y checklist |
| `warehouse` | Lectura actual; inventario cuando su API esté disponible |
| `worker`, `transport` | Solo actualizan estados de tareas o controles propios |
| `viewer` | Solo lectura |

La UI puede ocultar acciones que el rol no permite, pero FastAPI es siempre la
autoridad final. Nunca derivar permisos de `user_metadata` de Supabase.

`POST /v1/platform/companies/onboard` recibe nombre, slug, plan, estado,
`owner_email` y `owner_full_name`. Devuelve la constructora y la membresía del
propietario. Si el usuario todavía no existe en Supabase, el backend envía la
invitación; ninguna clave secreta se entrega al navegador.

## Paginación y estados de interfaz

Las listas paginadas devuelven `items`, `total`, `limit` y `offset`. Cada pantalla
debe implementar carga, vacío, error, reintento y actualización optimista solo
cuando sea segura. Después de una mutación, invalidar las consultas relacionadas.

## Funciones todavía sin API

No inventar endpoints ni usar datos simulados en producción para inventario,
planos, documentación/OCR, herramientas, personal, reportes o notificaciones. Mostrar estas
secciones como `Próximamente` hasta que el contrato del backend se publique.
