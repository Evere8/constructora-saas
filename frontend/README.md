# Frontend de Obrixapy

Frontend web responsive de **Obrixapy**, un SaaS multiempresa para la gestión de
constructoras y obras. Construido siguiendo `docs/EMERGENT_FRONTEND.md`,
`docs/FRONTEND_API_CONTRACT.md` y `docs/ARCHITECTURE.md`.

- Autenticación: **Supabase** (solo identidad).
- Datos de negocio: **API FastAPI** de Obrixapy (`https://api.obrixapy.online/api`).
- Sin acceso directo a tablas de Supabase ni a MySQL desde el navegador.

## Tecnología

- React 18 + Vite + TypeScript (modo estricto).
- React Router para navegación.
- TanStack Query para estado de servidor, caché e invalidaciones.
- `@supabase/supabase-js` únicamente para autenticación.
- Tailwind CSS + componentes accesibles basados en shadcn/ui + lucide-react.
- React Hook Form + Zod para formularios y validación.
- Vitest + Testing Library para pruebas.
- Dependencias con versiones fijadas y `package-lock.json` comprometido.

## Requisitos

- Node.js 20+
- npm 10+

## Instalación

```bash
cd frontend
npm install
cp .env.example .env.local   # completa con los valores reales (no se versiona)
npm run dev
```

La app queda disponible en `http://localhost:5173`.

## Variables de entorno

Se definen en `frontend/.env.local` (nunca se sube al repositorio). Ver
`frontend/.env.example`.

| Variable | Descripción |
|---|---|
| `VITE_APP_NAME` | Nombre visible de la aplicación (`Obrixapy`). |
| `VITE_API_BASE_URL` | Base de la API FastAPI. Producción: `https://api.obrixapy.online/api`. |
| `VITE_SUPABASE_URL` | Project URL de Supabase. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Clave **publishable** de Supabase (puede vivir en el navegador). |

> Nunca uses `service_role`, secret keys ni credenciales de MySQL en el frontend.

## Comandos

| Comando | Descripción |
|---|---|
| `npm run dev` | Servidor de desarrollo con recarga. |
| `npm run build` | Type-check (`tsc -b`) + build de producción a `dist/`. |
| `npm run preview` | Sirve el build de producción. |
| `npm run lint` | ESLint sobre todo el proyecto. |
| `npm run test` | Pruebas con Vitest. |

## Estructura

```text
src/
  auth/            AuthProvider (Supabase), useMe, permisos y capacidades
  components/
    layout/        Sidebar, navegación inferior móvil, selector de constructora
    common/        Estados de carga/vacío/error, ComingSoon
    ui/            Componentes shadcn/ui (button, card, dialog, select, ...)
  context/         CompanyProvider (constructora activa por membresía)
  lib/
    api/           Clientes tipados por recurso (auth, projects, checklist, platform)
    http.ts        Cliente HTTP central (Bearer, 401 refresh+retry, mapeo de errores)
    labels.ts      Etiquetas y variantes de estado en español
  pages/           Pantallas (login, obras, detalle de obra, plataforma, perfil, ...)
  routes/          Guards de rutas (sesión, cuenta activa, rutas públicas)
  test/            Setup de Vitest
```

## Autenticación y autorización

1. Login con correo/contraseña vía `signInWithPassword`.
2. La sesión se persiste y refresca con el cliente oficial de Supabase.
3. Se escucha `onAuthStateChange` y al cerrar sesión se limpia todo el caché.
4. Cada petición a FastAPI envía `Authorization: Bearer <access_token>`.
5. Al iniciar se consulta `/v1/auth/me`; roles y permisos provienen de ahí (MySQL),
   nunca de `user_metadata`.
6. Ante `401` se refresca una vez y se reintenta; si vuelve a fallar, se cierra sesión.
7. `403` se trata como cuenta sin acceso / empresa inactiva (sin reintentos).

Los roles solo ocultan o deshabilitan acciones en la UI; **FastAPI es la autoridad
final** y los `403` se manejan de forma explícita.

## Rutas implementadas

| Ruta | Pantalla |
|---|---|
| `/login` | Inicio de sesión. |
| `/recuperar` | Solicitud de recuperación de contraseña. |
| `/restablecer` | Definir nueva contraseña (enlace de Supabase). |
| `/` | Resumen (dashboard con métricas y accesos rápidos). |
| `/obras` | Lista, búsqueda, filtros, alta y edición de obras. |
| `/obras/:id` | Detalle de obra con pestañas Resumen, Niveles, Tareas y Checklist. |
| `/tareas` | Selector de obra para gestionar tareas. |
| `/checklist` | Selector de obra para gestionar checklist. |
| `/plataforma` | Panel de plataforma: empresas, planes y membresías (solo platform admin). |
| `/perfil` | Perfil, estado de sesión y membresías. |
| `/mas` | Menú adicional (móvil). |
| `/inventario`, `/planos`, `/elongaciones`, `/personal`, `/reportes`, `/configuracion` | `Próximamente`. |

## Despliegue

1. `npm run build` genera `dist/` (estático).
2. Servir `dist/` con cualquier hosting estático o Nginx.
3. Configuración posterior (cuando exista URL pública):
   - Añadir la URL a las **Redirect URLs** en Supabase Auth.
   - Añadir la URL a `CORS_ORIGINS` en `/opt/constructora/app.env` y recrear el
     contenedor de la API.
   - Probar login, refresh, cambio de empresa y cierre de sesión.

## Limitaciones y `Próximamente`

Estos módulos **no tienen endpoint publicado** en el contrato actual, por lo que se
muestran como `Próximamente` sin datos simulados:

- Inventario, Planos, Archivos, Personal, Elongaciones, Reportes, Notificaciones.
- Pestañas de obra deshabilitadas: Planos, Inventario, Personal, Archivos, Reportes,
  Historial.
- Acciones rápidas sin API: **Escanear QR** y **Registrar movimiento**.

Otras notas:

- "Mis tareas" y "Checklist" a nivel global funcionan seleccionando una obra, ya que
  el contrato expone estos recursos por proyecto.
- La asignación de responsables no ofrece selector de usuarios porque aún no existe un
  endpoint para listarlos.
