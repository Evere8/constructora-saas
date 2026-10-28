# Carpetas de obra en Drive: configuración operativa separada

Los archivos de **Carpetas y documentos de la obra** no se guardan de forma
permanente en `app_uploads`. Se cargan a Drive mediante un remoto cifrado de
rclone con rutas opacas (ID de constructora/obra/archivo); MySQL conserva el
nombre, la carpeta lógica, el tamaño original y el SHA-256. Antes de subir,
se prueba compresión gzip sin pérdidas: se guarda comprimido **solo si ahorra
al menos 1 KiB y 5 %**; si no, por ejemplo un DWG ya comprimido, se guarda
íntegro con su peso. La descarga restaura los bytes originales y verifica
su tamaño y hash. El tamaño guardado y la codificación quedan registrados.
Los planos PDF interactivos existentes **no se migran ni se borran**: conservan
su almacenamiento local, anotaciones y versiones actuales. Las carpetas nuevas
no modifican el sistema de respaldos de `docs/BACKUPS_GOOGLE_DRIVE.md`.

El Drive de respaldo `gdrive-crypt:` y `/root/.config/rclone/rclone.conf` no
se montan ni se comparten con la API. No utilice el directorio `Backups` como
destino operativo. La función queda en modo no configurado (HTTP 503 al subir)
hasta crear un remoto independiente. El límite actual es 10 MB por archivo;
se admiten extensiones arbitrarias, pero siempre se descargan como adjunto,
nunca se ejecutan dentro de la aplicación.

## Alta en el VPS, únicamente para Constructora

1. Antes de desplegar el nuevo código, cree un respaldo verificado de MySQL y
   confirme los servicios activos de `constructora`. No reinicie ni cambie otros
   proyectos del mismo servidor.
2. Configure un OAuth de Google Drive independiente y una ubicación exclusiva
   `Obrixapy/ProjectFiles`. Puede ser la misma cuenta propietaria, pero use otro
   archivo de configuración y, preferentemente, otro cliente/permiso OAuth.
   Cree un remoto `gdrive-docs` y un remoto `project-docs` de tipo `crypt` cuyo
   origen sea `gdrive-docs:Obrixapy/ProjectFiles`. El cifrado estándar de
   nombres y contenido debe permanecer activo. Guarde contraseña y salt fuera
   del VPS.
3. Inicie una sesión con túnel OAuth desde PowerShell:

   ```powershell
   ssh -L 53682:127.0.0.1:53682 everadmin@179.199.139.81
   ```

4. En el VPS:

   ```bash
   sudo install -d -m 750 -o root -g 10001 /etc/constructora
   sudo touch /etc/constructora/drive-rclone.conf
   sudo chmod 640 /etc/constructora/drive-rclone.conf
   sudo RCLONE_CONFIG=/etc/constructora/drive-rclone.conf rclone config
   sudo chown root:10001 /etc/constructora/drive-rclone.conf
   sudo rclone --config /etc/constructora/drive-rclone.conf mkdir project-docs:obrixapy/project-files
   sudo rclone --config /etc/constructora/drive-rclone.conf lsd project-docs:
   ```

   Nunca imprima `rclone config show` en una terminal compartida. La API corre
   como UID/GID 10001 y solo recibe lectura del config operativo.
5. Compruebe que el remoto operativo permite subir/leer un archivo de prueba
   y quite *solamente ese archivo de prueba* tras verificar su contenido. No
   borre ninguna ruta del respaldo. Para activar el montaje, añada
   `-f app/deploy/compose.drive-documents.yaml` **al final** de los archivos
   Compose usados para `api` en los comandos de build, migración y `up`. Ejemplo
   de estructura (ajuste rutas según la instalación real):

   ```bash
   cd /opt/constructora
   sudo docker compose --env-file frontend.env \
     -f compose.yaml \
     -f app/deploy/compose.backend.yaml \
     -f app/deploy/compose.frontend.yaml \
     -f app/deploy/compose.drive-documents.yaml \
     config --quiet
   ```

   No agregue este último archivo si todavía no existe el remoto o el archivo
   `/etc/constructora/drive-rclone.conf`: el montaje opcional fallará. Después
   de migrar, reconstruya y recree solo `api frontend`, y verifique
   `/api/health/ready` y `/healthz`.

## Archivo de obras completadas/inactivas

Un propietario o administrador dispone de un botón **Marcar inactiva**, con
confirmación, en cada obra activa. La acción se audita y puede revertirse con
**Reactivar obra**. Un ingeniero no puede inactivarla mediante el formulario
ni mediante la API; crear una obra inactiva directamente tampoco está
permitido. El cambio de estado **no borra, mueve ni recomprime** archivos.

La compresión condicional descrita arriba se aplica a **nuevos documentos de
carpetas operativas en Drive**, sean de una obra activa, inactiva o completada.
No se aplica retroactivamente a archivos ya cargados, ni al volumen local de
planos PDF interactivos, versiones y anotaciones del VPS. Comprimir ese volumen
sin un proceso verificado de restauración podría romper enlaces y copias de
seguridad. Primero se necesita un inventario de originales, prueba de
integridad/restauración y una política de retención aprobada. No interprete
`Inactiva` o `Completada` como autorización para borrar planos existentes.
