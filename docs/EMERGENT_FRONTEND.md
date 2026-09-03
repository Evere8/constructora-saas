# Encargo para Emergent: frontend MVP de Obrixapy

## Prompt listo para usar

Construye el frontend web responsive de **Obrixapy**, un SaaS multiempresa para
gestión de constructoras y obras. Trabaja en este mismo repositorio, únicamente
dentro de `frontend/`, y conserva intactos `backend/`, `deploy/` y las migraciones.

Antes de programar, lee `docs/FRONTEND_API_CONTRACT.md`, `docs/ARCHITECTURE.md` y
`README.md`. No inventes rutas de API. Si una función no tiene endpoint publicado,
muéstrala como `Próximamente` y no uses datos simulados fuera de pruebas o Storybook.

### Tecnología

- React con Vite y TypeScript estricto.
- React Router para navegación.
- TanStack Query para estado de servidor, caché e invalidaciones.
- `@supabase/supabase-js` para autenticación únicamente.
- Tailwind CSS y componentes accesibles basados en shadcn/ui.
- React Hook Form y Zod para formularios.
- Vitest y Testing Library.
- Dependencias con versiones fijadas y lockfile comprometido.

No uses Supabase Data API, tablas públicas, `service_role`, secret keys ni
credenciales de MySQL. Todos los datos de negocio deben pasar por FastAPI.

### Variables

Usa `frontend/.env.example`. Nunca comprometas `.env`, `.env.local` ni secretos.

- `VITE_API_BASE_URL=https://api.obrixapy.online/api`
- `VITE_SUPABASE_URL=<Project URL>`
- `VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key>`
- `VITE_APP_NAME=Obrixapy`

### Autenticación

1. Crear un cliente Supabase único.
2. Iniciar sesión con correo y contraseña mediante `signInWithPassword`.
3. Persistir y refrescar la sesión con el cliente oficial.
4. Escuchar `onAuthStateChange` y limpiar todo el caché al cerrar sesión.
5. Enviar `session.access_token` como Bearer a FastAPI.
6. Al iniciar, llamar a `/v1/auth/me` y usar ese resultado para permisos.
7. Ante `401`, ejecutar un solo refresh y repetir una vez; si falla, cerrar sesión.
8. Tratar `403` como cuenta sin acceso, bloqueada o empresa inactiva.

La clave publicable puede estar en el navegador. Nunca exponer una clave secreta.
Los roles vienen de MySQL a través de `/v1/auth/me`, no de `user_metadata`.

### Diseño y navegación

Interfaz en español, profesional, limpia y adecuada para obra. Evita una estética
genérica de panel financiero. Prioriza legibilidad, botones grandes en móvil,
contraste AA, navegación por teclado y estados visibles.

Escritorio:

- Barra lateral: Resumen, Obras, Tareas, Checklist, Inventario, Planos,
  Elongaciones, Personal, Reportes y Configuración.
- Selector de constructora arriba, basado solo en membresías activas.
- Menú adicional `Plataforma` para administradores globales.

Móvil:

- Navegación inferior: Inicio, Obras, Mis tareas, Checklist y Más.
- Accesos rápidos: Mis tareas, Escanear QR, Registrar movimiento, Abrir obra y
  Cierre diario. Las acciones sin API deben indicar `Próximamente`.

Cada obra tendrá pestañas: Resumen, Niveles, Tareas, Checklist, Planos,
Inventario, Personal, Archivos, Reportes e Historial. Implementar ahora las cuatro
primeras y dejar las demás claramente deshabilitadas.

### Pantallas del MVP

1. Login y recuperación de contraseña con Supabase.
2. Estado de acceso pendiente/bloqueado y cierre de sesión.
3. Selector de constructora y resumen de la membresía activa.
4. Lista, búsqueda, filtros, alta y edición de obras.
5. Detalle de obra con resumen, niveles, tareas y checklist.
6. Alta y edición de niveles según rol.
7. Lista, filtros, alta y edición de tareas; cambio rápido de estado.
8. Checklist agrupado por etapa, filtros y barra de avance.
9. Panel de plataforma: planes, empresas y membresías.
10. Perfil con nombre, correo, rol, empresa y estado de sesión.

### Reglas de permisos en UI

- `platform_admin`: panel global y soporte.
- `owner`, `admin`, `engineer`: edición de obras y trabajo.
- `supervisor`: niveles, tareas y checklist.
- `worker`, `transport`: únicamente estado de elementos asignados.
- `warehouse` y `viewer`: lectura en el MVP actual.

Ocultar o deshabilitar acciones no permitidas, pero mostrar una explicación breve.
No confiar en esta ocultación como seguridad: manejar correctamente los `403`.

### Calidad y criterios de aceptación

- Sin secretos ni credenciales reales en Git.
- Sin llamadas de negocio directas a Supabase.
- Cliente HTTP tipado centralizado y sin `fetch` dispersos en componentes.
- Manejo uniforme de `401`, `403`, `404`, `409`, `422` y errores de red.
- Carga, vacío y error en todas las listas.
- Diseño funcional desde 360 px hasta escritorio ancho.
- Formularios con validación equivalente al contrato de FastAPI.
- Pruebas de login, guard de rutas, cliente HTTP, selector de empresa y permisos.
- `npm run lint`, `npm run test` y `npm run build` deben pasar.
- README del frontend con instalación, variables, comandos y despliegue.

### Entrega en GitHub

Crear una rama `emergent/frontend-mvp`. Hacer commits pequeños y abrir un PR hacia
`main`; no fusionarlo automáticamente. El PR debe incluir capturas de escritorio
y móvil, resultados de pruebas y una lista de rutas implementadas.

## Configuración posterior al despliegue

Cuando el frontend tenga una URL pública:

1. Añadirla a las Redirect URLs permitidas en Supabase Auth.
2. Añadirla a `CORS_ORIGINS` en `/opt/constructora/app.env`.
3. Recrear el contenedor API.
4. Probar login, refresh, cambio de empresa y cierre de sesión.

La guía oficial actual de Supabase para React utiliza Vite, el cliente
`@supabase/supabase-js`, Project URL y publishable key. La aplicación debe seguir
ese modelo y evitar depender del OpenAPI anónimo de Supabase; Obrixapy usa su propio
contrato FastAPI.
