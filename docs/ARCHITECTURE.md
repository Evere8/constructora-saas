# Arquitectura inicial

## Flujo de autenticación

1. El frontend inicia sesión con Supabase Auth usando la clave publicable.
2. Supabase entrega un access token JWT.
3. El frontend envía `Authorization: Bearer <token>` a FastAPI.
4. FastAPI verifica firma, emisor, audiencia y vencimiento usando JWKS.
5. El `sub` se vincula con `app_users.supabase_user_id`.
6. Roles, empresa activa y permisos se consultan siempre en MySQL.

La clave secreta o `service_role` solo puede residir en el VPS y se reservará para altas, bloqueos y tareas administrativas de Auth.

## Aislamiento multiempresa

Todas las tablas operativas contienen `company_id`. La API obtiene la empresa desde una membresía activa y nunca acepta un `company_id` del frontend sin validarlo.

## Autorización implementada

- El JWT solo demuestra identidad; no concede acceso empresarial por sí mismo.
- `app_users.status` debe ser `active` para utilizar la API.
- `is_platform_admin` habilita únicamente las rutas globales `/api/v1/platform`.
- El administrador de plataforma no puede operar rutas de una constructora ni
  saltarse una membresía. Un futuro acceso de soporte deberá ser temporal y auditado.
- Cada membresía guarda su propio rol y estado por constructora.
- El alta de una constructora crea su propietario en MySQL y, si la identidad no
  existe, usa Supabase Auth Admin desde el backend para enviar una invitación.
- Crear o modificar planes, constructoras y membresías genera un `activity_log`.
- Crear o modificar obras, niveles y tareas genera un `activity_log`.
- Los roles no se toman de `user_metadata`, porque el usuario puede modificarlo.

## Operaciones de obra implementadas

- Listado paginado y filtrado de obras por constructora.
- Alta y modificación de obras con control de fechas y códigos únicos por empresa.
- Niveles ordenables y únicos dentro de cada obra.
- Tareas de trabajo o transporte filtrables por estado, nivel y responsable, con inicio,
  fecha límite y ubicación dentro de la obra.
- Validación de que nivel, obra y responsable pertenecen a la misma constructora.
- Roles `owner`, `admin`, `engineer` y `supervisor` administran el trabajo.
- Roles `worker` y `transport` solo cambian el estado de tareas propias.
- El cronograma ordena por inicio planificado y permite detectar atrasos contra la fecha límite.

## Almacenamiento

- Archivos activos: disco privado del VPS, fuera del repositorio.
- Metadatos y permisos: MySQL.
- Entrega: endpoint autenticado o URL temporal generada por la API.
- Google Drive: copia cifrada y respaldo; no base principal de archivos activos.

## Checklist implementado

- Puntos de control vinculados siempre a constructora y obra.
- Etapa del proceso, responsable, vencimiento y estados operativos.
- Resumen de avance que excluye elementos marcados como no aplicables.
- Supervisores administran controles; trabajadores asignados solo actualizan su estado.
- Cambios importantes registrados en la auditoría de la constructora.

## Alertas operativas implementadas

- Cada tarea puede declarar herramientas o materiales requeridos y vincularlos al inventario.
- La disponibilidad se contrasta con el estado, cantidad y ubicación actual del recurso.
- Al consultar las notificaciones, la API sincroniza tareas y controles vencidos o próximos
  a 48 horas, tareas sin responsable, recursos faltantes y equipos en mantenimiento.
- Las alertas se deduplican por constructora y cada usuario conserva su propio estado de
  lectura o descarte. Trabajadores y transportistas solo ven avisos asignados a ellos.
- El dashboard y la campana del encabezado actualizan esta información periódicamente.

## Reportes implementados

- Resumen general de obras, tareas, controles, inventario y personal.
- Filtros por período, obra y responsable.
- Avance y atrasos agrupados por obra y por persona.
- Conteo de controles bloqueados, tareas sin responsable y recursos en riesgo.
- Exportación CSV del resultado filtrado.

## Módulos previstos

- Plataforma: constructoras, planes, activación y superadministración.
- Obras: activas, inactivas, niveles, cronograma y avance.
- Planos: PDF vectorial, versiones, anotaciones y exportación.
- Checklist: estados, responsables, evidencia y resumen.
- Tareas: trabajo y transporte, ubicación, personal y materiales requeridos.
- Inventario: máquinas, herramientas, materiales y movimientos diarios.
- Alertas: vencimientos y faltantes para tareas de las próximas 48 horas.
- Elongaciones: PDF/foto, revisión humana y generación de Excel.
- Auditoría: actividad, actor, fecha y entidad modificada.
