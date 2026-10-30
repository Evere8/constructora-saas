# Entrega de operaciones · 30 de octubre de 2026

## Alcance revisado

La revisión contrasta los pedidos escritos y las capturas disponibles. Las pruebas
de componentes reproducen eventos táctiles y de lápiz, pantallas de tablet y móvil,
y datos sintéticos. No sustituyen una prueba en la tablet física ni una conexión
real a su cuenta de Google. No se ha entrado al VPS para desplegar.

| Pedido | Resultado implementado y verificación |
|---|---|
| Tareas asignadas visibles | Acceso naranja, texto negro, icono blanco y contador en resumen, menú lateral y navegación móvil. Consulta limitada al usuario/empresa; listado directo de tareas asignadas y acción de estado. Prueba API de contador y separación de usuarios. |
| Checklist predeterminado por color/tipo | Opción en Configurar checklist; guarda la plantilla del color para puntos nuevos, siempre sin checks marcados, sin cambiar puntos anteriores. Pruebas de interfaz y API. |
| Renombrar tipos y colores | Lapicito junto a cada opción; nombre, color y pasos editables. El usuario puede crear/eliminar colores con controles de permisos. |
| Herramientas por obra y depósito | El tablero aparece primero y el alta debajo. Arrastrar con dedo/lápiz/ratón o usar el selector pide un responsable y crea una tarea. La herramienta permanece en su casilla, con aviso rojo de destino/responsable, hasta completar el traslado; recién entonces cambia su ubicación y queda el movimiento. Mantiene historial diario y solicitud de reposición. |
| Permiso de movimientos | Propietario/administrador o miembro habilitado expresamente. Validación en API, no solo ocultación del botón. No permite saltar reubicaciones en tránsito ni mover herramientas retiradas/en mantenimiento. |
| Tareas/actividades por fecha | Solo propietario e ingeniero ven la planificación y la vista global. Autocompleta actividades anteriores, restaura herramientas, permite sumar requisitos, elegir obra/responsable y crea una tarea notificada. Muestra estado vivo, cantidad de personas, verificación, borrador, registro e historial. |
| Verificación de herramientas | Usa exclusivamente un registro de inventario de la misma fecha operativa de Paraguay. Si falta, permite guardar y muestra Verificación incompleta; al registrar movimientos se recalcula. Señala faltantes por nombre/cantidad. Incluye materiales. |
| Definir actividad | Nombre autocompletable y requisitos elegidos del inventario, con cantidades. Al elegir una anterior carga sus herramientas y permite añadir más. La definición se conserva y puede editarse; los informes guardan su descripción/requisitos históricos. |
| Obras activas/completadas/inactivas | Tres accesos con conteos, búsqueda y paginación. Botón Marcar inactiva, confirmación y Reactivar obra solo para administrador/propietario; no se puede eludir por otro formulario. |
| Comprimir obras inactivas | Proceso reanudable de un archivo por vez, compresión sin pérdidas solo si reduce tamaño, comprobación por bytes/hash, conservación de DWG u otros archivos que no mejoran. Acceso transparente al original y vistas previas. Los errores no reemplazan el original. |
| Carpetas y subcarpetas | Árbol lógico por empresa/obra, subida en carpeta elegida, listado paginado y descarga de cualquier extensión sin límite fijo de la aplicación. Transfiere por archivo temporal, verifica tamaño y SHA-256 y lo elimina al terminar. Objetos en Drive operativo separado; configuración real requerida. |
| Tablet y PDF interactivo | Mover es la herramienta inicial; el PDF solo se desplaza en ese modo. Lápiz/dedo usan la herramienta seleccionada, borrador, trazo recto, texto, color y grosor. Las herramientas funcionan en pantalla completa; el plano de niveles también incluye borrador. |
| Aplicación instalable y avisos | Manifest, iconos, service worker y botón Instalar. Suscripción Web Push por usuario/empresa. Las tareas, actividades y traslados nuevos avisan y ofrecen Recibido/En proceso; al abrir cambian a la empresa correcta. |
| Ventana del punto | Se abre junto al punto, se arrastra desde título/zona vacía con lápiz y dispone de X accesible. Controles explícitos de desplazamiento para pantallas pequeñas. Probado en navegador táctil. |
| Persistencia de anotaciones | Guardado en API, cola local por usuario/empresa/obra/rubro, reintento al recuperar conexión y tras recargar. UUID idempotente evita duplicados; trazos largos se dividen conservando todos sus puntos. Pruebas de caída de red, recarga y respuesta tardía. |
| Eliminar punto/rubro/función | Se mantienen eliminación confirmada y permisos, incluidos rubros predeterminados y función PDF añadida. Quitar una función oculta el acceso sin eliminar sus documentos; eliminar rubro/punto solicita confirmación. |
| Obra → sector → nivel en tareas | Selectores dependientes y validación de pertenencia en API; se mantienen tareas diarias, sin el antiguo bloque inferior de predeterminadas de obra. |
| Resúmenes por sector y menú | Resumen/listados por sector bajo selección y navegación lateral compacta con animación CSS sin cambiar el ancho del contenido principal. Se mantiene el contraste del visor y cierre de checklist de niveles. |

### Qué significa guardar

- Arrastrar una herramienta crea una solicitud después de elegir al responsable.
  No cambia la ubicación hasta que ese responsable marca la tarea **Terminada**.
  **Registrar inventario de hoy** conserva además la fotografía diaria usada en
  la verificación de actividades, incluso cuando no hubo cambios.
- Las actividades se guardan como borrador y luego se registran como informe.
  Un informe no se reescribe; la verificación se calcula con el último inventario
  de esa misma fecha, no con un inventario de ayer ni de otro día.
- La verificación comprueba disponibilidad; no constituye una reserva exclusiva
  de herramientas entre actividades. Los materiales se trasladan por lote
  completo: registre lotes separados si los repartirá entre obras.
- Las marcas del PDF se envían automáticamente. Si ve **marcas pendientes**, no
  dé el envío por completado; reintente. La copia local permite recuperarlas en
  ese navegador, pero hasta confirmarse no están disponibles en otro dispositivo.
- Las notas del punto se confirman con **Guardar nota**. Las posiciones y
  checklists se guardan al realizar la acción.

## Pruebas reproducibles

Frontend: `npm ci`, `npm test -- --run`, `npm run lint`, `npm run build`.
Resultado de esta entrega: **77 pruebas aprobadas**, compilación de producción
correcta y cero errores de lint (quedan cuatro advertencias históricas de Fast
Refresh). El navegador Chromium no pudo descargarse en este entorno restringido;
la prueba física final se hace después del despliegue.
Backend: `uv sync --all-extras --frozen`, `uv run ruff check app tests alembic`,
`uv run pytest -q -rs`. Resultado: **146 pruebas aprobadas y 6 omitidas**; las
seis omitidas requieren un MySQL 8.4 aislado.
El workflow MySQL migration recovery usa MySQL 8.4 aislado y ejecuta las seis
pruebas adicionales que se omiten cuando no existe un servidor de pruebas.

Migración destino: **0019_inventory_relocation_warehouse**. Comprueba además todas las
columnas mapeadas con `python -m app.db.verify_schema`. No cambie manualmente
`alembic_version` ni use `stamp` para saltar migraciones.

## Publicar en el VPS paso a paso

Hágalo en un momento sin carga de PDFs/OCR ni edición de usuarios. El script
compila antes de una pausa breve de la API para obtener un respaldo consistente.
No reinicia MySQL, no borra volúmenes y no toca los otros proyectos.

### 1. Entrar desde Windows PowerShell

```powershell
ssh root@179.199.139.81
```

Introduzca la frase de su llave SSH cuando la pida. No se muestra al escribirla
y no debe enviarla al chat. Continúe cuando vea `root@srv1947254:~#`.

### 2. Comprobar la carpeta y los cambios locales

```bash
cd /opt/constructora/app
pwd
git -c safe.directory=/opt/constructora/app status --short
git -c safe.directory=/opt/constructora/app branch --show-current
git -c safe.directory=/opt/constructora/app log -1 --oneline
```

Debe mostrar `/opt/constructora/app`, rama `main` y ninguna línea de archivos
modificados. Si hay cambios o una rama diferente, deténgase: no los descarte.

### 3. Descargar la versión publicada

```bash
git -c safe.directory=/opt/constructora/app pull --ff-only origin main
git -c safe.directory=/opt/constructora/app log -1 --oneline
```

Si Git muestra un error, no continúe. No hace falta descargar un ZIP ni subir
los archivos uno por uno.

### 4. Configurar Drive si quiere habilitar las nuevas subidas

Complete [DRIVE_DOCUMENTOS_OPERATIVOS.md](DRIVE_DOCUMENTOS_OPERATIVOS.md).
La conexión de respaldo no se reutiliza silenciosamente como almacén activo.
Si omite este paso, el resto de módulos puede desplegarse, pero la aplicación
avisará que **las subidas de carpetas a Drive están pendientes de configuración**.

### 5. Crear las claves privadas de notificaciones

```bash
sudo bash /opt/constructora/app/deploy/configure-push.sh
```

Debe terminar con `PUSH_KEYS_OK`. La clave privada queda en
`/etc/constructora/push`, no se imprime y no se guarda en Git.

### 6. Habilitar subidas grandes solo en el sitio de Obrixapy

```bash
sudo bash /opt/constructora/app/deploy/set-upload-limit.sh
```

Hace una copia previa, valida con `nginx -t`, elimina el límite fijo del sitio
`obrixapy-app`, desactiva el buffering de la petición y amplía el tiempo de
transferencia. No cambia otros sitios ni reinicia el servidor.

### 7. Ejecutar respaldo, compilación, migración y actualización

```bash
sudo bash /opt/constructora/app/deploy/update-operations.sh
```

No cierre SSH. El script:

1. Valida ruta, repositorio, rama, contenedores y espacio libre.
2. Conserva las imágenes anteriores y los archivos de configuración privados.
3. Compila únicamente `api frontend`; si hay Drive, prueba lectura/escritura.
4. Pausa solo la API de Constructora y respalda MySQL **y los archivos locales**.
5. Verifica gzip, listado del tar y sumas; ejecuta migración y verifica esquema.
6. Recrea solo `api frontend`, espera salud y comprueba endpoints locales.

Resultado esperado: `RESPALDO_OK`, `0019_inventory_relocation_warehouse (head)`,
`SCHEMA_OK` y `ACTUALIZACION_OK`. Conserve la ruta
`/opt/constructora/operations-release.XXXXXXXX` que realmente imprima el script;
no escriba literalmente las X. Los archivos quedan privados y no se eliminan.
El respaldo local de esta entrega no descarga todo el almacén de Google Drive.

### 8. Comprobar el servicio público

```bash
curl -fsS https://app.obrixapy.online/healthz
curl -fsS http://127.0.0.1:8000/api/health/ready
sudo docker exec constructora-api alembic current
sudo grep -n "client_max_body_size" /etc/nginx/sites-available/obrixapy-app
```

Debe devolver `ok`, `{"status":"ready","database":"mysql"}`,
`0019_inventory_relocation_warehouse (head)` y `client_max_body_size 0`.
En Windows recargue con Ctrl+F5. En la tablet cierre y vuelva a abrir la pestaña.

### 9. Aceptación funcional en su instalación

- Instale Obrixapy desde el botón **Instalar**, active avisos y asigne una tarea a
  un usuario de prueba. Compruebe contador, notificación y botones Recibido/En proceso.
- Arrastre una herramienta a otra obra, elija responsable y confirme que permanece
  en origen con aviso rojo hasta que la tarea de traslado se marque Terminada.
- Guarde actividades antes de registrar inventario: deben quedar incompletas.
  Registre movimientos de hoy y vuelva a actividades: debe aparecer disponibilidad/faltantes.
- Pruebe un usuario sin permiso de movimientos y luego habilite ese permiso desde Personal.
- En una obra de prueba: crear carpeta/subcarpeta, subir y descargar PDF y DWG.
- En tablet: Mover → Lápiz → Trazo recto → Borrador → Punto; arrastrar la ventana
  por una zona vacía, cerrar X, pantalla completa y recargar tras confirmar guardado.
- Inactive una obra de prueba como administrador, espere archivo completo,
  descargue/abra sus documentos y reactívela. No use una obra crítica para la primera prueba.

## Si aparece un error

Deténgase y conserve el mensaje y la ruta del respaldo. No ejecute `down -v`,
`prune`, borrados de carpetas, restauraciones ni downgrade de Alembic.
El script intenta reanudar la API anterior si falla antes de recrear contenedores.
Después de recrearlos, requiere revisar el error; no realiza un rollback de datos automático.

Para diagnóstico limitado a Constructora:

```bash
docker logs --tail 80 constructora-api
docker logs --tail 80 constructora-frontend
docker ps --filter name=constructora
```

No comparta `.env`, configuraciones rclone, dumps ni credenciales. Un rollback
posterior al archivado requiere versión compatible o restauración coordinada de
base y archivos: el código viejo no conoce las referencias comprimidas nuevas.
