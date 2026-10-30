# Drive operativo: documentos y carpetas de obra

Los archivos nuevos de **Carpetas y documentos de la obra** se guardan en Drive,
no permanentemente en el volumen del VPS. MySQL conserva carpetas, nombres,
permisos, tamaños y hash. Los archivos se transmiten por la API; puede haber
buffer temporal durante la transferencia, pero no un segundo almacén permanente.

No hay un límite fijo de tamaño impuesto por la aplicación para esta sección.
Se admiten PDF, imágenes, DWG/AutoCAD, planillas y otras extensiones. El máximo
práctico depende del espacio temporal libre, la conexión y la cuota del Drive.
Los temporales se eliminan al terminar y no constituyen un almacén permanente.
La descarga es un adjunto: nunca ejecuta HTML o scripts. La carga lee nuevamente
el objeto desde Drive antes de confirmar su registro; la descarga verifica tamaño
y SHA-256 del original sin cargar el archivo entero en memoria.

## Separación de los respaldos

La API NO recibe el remoto de respaldo `gdrive:`/`gdrive-crypt:` ni
`/root/.config/rclone/rclone.conf`. Esos remotos están prohibidos en el servicio.
Se puede usar la misma cuenta de Google, pero con una configuración operativa
independiente y una carpeta exclusiva. No copie las credenciales del respaldo
ni use `Backups` como almacén de documentos activos.

## Configuración, una sola vez

Si ya existe `/etc/constructora/drive-rclone.conf`, no lo sobrescriba ni copie
a ciegas: compruebe con su administrador que es el archivo **operativo** anterior.
Conserve una copia privada y configure la ruta nueva indicada abajo. Nunca
comparta tokens, contraseñas ni la salida de `rclone config show`.

1. En una segunda ventana PowerShell, abra un túnel SSH:

   ```powershell
   ssh -L 53682:127.0.0.1:53682 root@179.199.139.81
   ```

2. En esa sesión del VPS, compruebe `rclone version`. Si falta, instale el
   paquete con `sudo apt-get update` y `sudo apt-get install rclone`.
   No ejecute una actualización general de Ubuntu.

3. Prepare SOLO este directorio nuevo. No cambie permisos del directorio de
   respaldos:

   ```bash
   sudo install -d -m 755 /etc/constructora
   sudo install -d -m 700 -o 10001 -g 10001 /etc/constructora/project-docs
   sudo rclone --config /etc/constructora/project-docs/rclone.conf config
   ```

4. En el asistente de rclone:
   - `n` → remoto nuevo `gdrive-docs`.
   - Tipo `drive` (Google Drive). No use números de menú: varían por versión.
   - Si no tiene cliente OAuth propio, deje esos campos vacíos.
   - Permiso `drive.file` para los archivos creados por esta conexión.
   - Mantenga el túnel abierto. En autenticación con navegador elija `y`;
     abra en su PC la URL local que indique rclone y autorice la cuenta correcta.
     No publique esa URL ni el token.
   - Confirme el remoto. No seleccione una unidad compartida si no la utiliza.
   - Cree otro remoto `project-docs`, tipo `crypt`.
   - Destino: `gdrive-docs:Obrixapy/ProjectFiles`.
   - Cifrado de nombres: `standard`; cifrado de directorios: activado.
   - Genere y guarde contraseña y salt en un gestor seguro, fuera del VPS.
     Perderlos impide recuperar los documentos. Termine con `q`.

5. Permita que la API renueve sus tokens sin abrir el archivo a otros usuarios:

   ```bash
   sudo chown 10001:10001 /etc/constructora/project-docs/rclone.conf
   sudo chmod 600 /etc/constructora/project-docs/rclone.conf
   sudo chmod 700 /etc/constructora/project-docs
   ```

   El montaje es de **un directorio dedicado escribible**, no de un archivo
   solo lectura: OAuth necesita actualizar tokens y reemplazar el archivo
   atómicamente. No cifre interactivamente todo el config con una clave que el
   contenedor no pueda obtener; el acceso se protege con permisos del sistema,
   y los objetos remotos con `crypt`.

6. El script `deploy/update-operations.sh` detecta este archivo, añade
   `compose.drive-documents.yaml` y ejecuta una prueba real de escritura,
   lectura idéntica y borrado **de un único objeto temporal**. Si la prueba
   falla, se detiene antes de pausar la aplicación o migrar la base.

   Si la aplicación ya está actualizada, active solamente el montaje operativo:

   ```bash
   cd /opt/constructora
   docker compose --project-name constructora --env-file frontend.env \
     -f compose.yaml -f app/deploy/compose.backend.yaml \
     -f app/deploy/compose.frontend.yaml -f app/deploy/compose.drive-documents.yaml \
     run --rm --no-deps -T api python -m app.services.verify_project_drive
   ```

   Debe mostrar `DRIVE_OK`. SOLO entonces:

   ```bash
   docker compose --project-name constructora --env-file frontend.env \
     -f compose.yaml -f app/deploy/compose.backend.yaml \
     -f app/deploy/compose.frontend.yaml -f app/deploy/compose.drive-documents.yaml \
     up -d --no-deps --force-recreate --wait api
   ```

7. Pruebe desde Planos: carpeta → subcarpeta → subir un archivo de prueba →
   descargarlo y abrirlo. La prueba real de Google/VPS es obligatoria: las
   pruebas del repositorio usan un almacén aislado, no sus credenciales.

## Inactivación y compresión reversible

Solo propietario/administrador puede **Marcar inactiva**, con confirmación y
auditoría, o **Reactivar obra**. El formulario no permite saltarse esa acción.

Al inactivar, la interfaz recorre los archivos uno por uno. Prueba gzip sin
pérdidas y lo conserva únicamente si ahorra al menos 1 KiB y 5 %. Si no mejora
(por ejemplo un DWG ya comprimido), mantiene exactamente el archivo original.
No hay conversión de AutoCAD ni pérdida de capas/calidad.

Los archivos locales anteriores permanecen en su proveedor local; los documentos
de carpetas permanecen en Drive. Se incluyen versiones de planos, documentos de
rubros, adjuntos de puntos, evidencias y archivos de elongaciones, incluidos
los exports referenciados por esos registros. No se borra información de MySQL,
checklists, geometría, nombres ni estructura de carpetas.

Antes de sustituir un original se verifica que la copia reconstruye los mismos
bytes. Solo después se actualiza el índice. Los lectores temporales se limpian
incluso si falla una vista previa. Una referencia auxiliar conserva la lectura
para trabajos que hubieran empezado antes del archivado local.

Si se cierra la pestaña, el archivado puede quedar pendiente: al entrar a la obra
inactiva aparece **Reanudar compresión**. Cada archivo ya comprobado se salta.
Un fallo mantiene el original. No se archivan automáticamente las completadas.
Reactivar recupera el acceso normal; la descompresión para lectura es transparente.

Los documentos nuevos de carpetas también usan compresión condicional al subir,
sin cambiar el original descargado.

## Copias y recuperación

Conserve por separado:
- respaldo MySQL (índice y referencias);
- respaldo del volumen de archivos locales;
- copia segura de la configuración y claves del Drive operativo;
- una copia independiente de los objetos operativos de Drive.

El respaldo local de despliegue **no descarga todo Drive**. No equivale a una
segunda copia del almacén remoto. Configure esa política de copias antes de
usar Drive como única ubicación de documentos críticos.

Después de archivar no vuelva a código anterior que desconozca
`packed:v1:`/`drive:v1:`. No ejecute downgrade automático. Recuperar una versión
antigua exige coordinar base, volumen y objetos remotos, además de conservar
los registros nuevos.

Referencias oficiales: [configuración remota](https://rclone.org/remote_setup/),
[Google Drive y scopes](https://rclone.org/drive/),
[archivo de configuración y tokens](https://rclone.org/docs/#config-config-file).
