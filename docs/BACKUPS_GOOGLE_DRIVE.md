# Respaldos de MySQL en Google Drive

## Objetivo

El respaldo de producción sigue la regla 3-2-1 de forma inicial:

- MySQL activo en el volumen Docker del VPS.
- Copia comprimida local durante 7 días.
- Copia cifrada en Google Drive durante 30 días.
- Archivos privados de `app_uploads` incluidos en un archivo TAR cifrado por rclone.

Google Drive no es la base activa. El respaldo se genera con `mysqldump`, se valida,
se comprime, se cifra en el VPS mediante un remoto `crypt` de rclone y después se
sube a Drive. El mismo proceso empaqueta fotos, planos y documentos desde el volumen
privado. La tarea falla si algún archivo está truncado o no aparece en el remoto.

## Requisitos de seguridad

- Usar una cuenta de Google controlada por el propietario del SaaS.
- Crear un OAuth Client ID propio de tipo Desktop en Google Cloud. No depender del
  Client ID compartido de rclone, porque se retira durante 2026.
- Elegir el alcance `drive.file` si la cuenta se utilizará solo para estos respaldos.
- Configurar un remoto base llamado `gdrive` y un remoto cifrado llamado
  `gdrive-crypt` que envuelva `gdrive:Obrixapy/Backups`.
- Guardar fuera del VPS el Client ID, el Client Secret, la contraseña y el salt del
  remoto cifrado. Sin la contraseña y el salt no se puede reconstruir el acceso.
- Mantener `/root/.config/rclone/rclone.conf` con permisos `0600`.

Documentación de referencia:

- [Google Drive en rclone](https://rclone.org/drive/)
- [Cifrado del lado del cliente con rclone crypt](https://rclone.org/crypt/)

## 1. Autorizar Google Drive desde el VPS

Instalar rclone:

```bash
sudo apt update
sudo apt install -y rclone
```

Para que el navegador de Windows pueda completar OAuth, abrir una sesión SSH con
un túnel local desde PowerShell:

```powershell
ssh -L 53682:127.0.0.1:53682 -o ServerAliveInterval=30 -o ServerAliveCountMax=3 everadmin@179.199.139.81
```

Ya dentro del VPS:

```bash
sudo rclone config
```

Crear primero `gdrive`:

1. Seleccionar `New remote` y nombrarlo `gdrive`.
2. Seleccionar el almacenamiento `drive`.
3. Introducir el Client ID y Client Secret propios.
4. Elegir por nombre el alcance `drive.file`.
5. No usar Service Account ni Shared Drive.
6. Aceptar autenticación por navegador. Copiar en el navegador de Windows la URL
   local que muestre rclone y autorizar la cuenta.

Comprobar el remoto base:

```bash
sudo rclone lsd gdrive:
```

Volver a `sudo rclone config` y crear `gdrive-crypt`:

1. Seleccionar el tipo `crypt`.
2. Usar `gdrive:Obrixapy/Backups` como remoto subyacente.
3. Activar cifrado estándar de nombres y cifrado de directorios.
4. Generar una contraseña fuerte y un salt fuerte.
5. Guardar ambos valores en un gestor de contraseñas fuera del VPS.

Comprobar el remoto cifrado sin subir secretos:

```bash
sudo rclone mkdir gdrive-crypt:obrixapy/mysql
sudo rclone mkdir gdrive-crypt:obrixapy/uploads
sudo rclone lsd gdrive-crypt:
sudo chmod 600 /root/.config/rclone/rclone.conf
```

## 2. Instalar la tarea diaria

Ejecutar desde `/opt/constructora/app` después de desplegar este código:

```bash
sudo install -d -m 700 /etc/constructora /var/backups/constructora/mysql /var/backups/constructora/uploads
sudo install -m 600 deploy/backup/backup.env.example /etc/constructora/backup.env
sudo install -m 644 deploy/backup/constructora-backup.service /etc/systemd/system/constructora-backup.service
sudo install -m 644 deploy/backup/constructora-backup.timer /etc/systemd/system/constructora-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now constructora-backup.timer
sudo systemctl start constructora-backup.service
```

La ejecución diaria está programada para las 03:15 UTC, con un retraso aleatorio
máximo de 15 minutos. `Persistent=true` hace que systemd recupere una ejecución
perdida cuando el servidor vuelve a encenderse.

## 3. Verificar el respaldo

```bash
sudo systemctl status constructora-backup.service --no-pager
sudo journalctl -u constructora-backup.service -n 100 --no-pager
sudo ls -lh /var/backups/constructora/mysql
sudo rclone lsl gdrive-crypt:obrixapy/mysql
sudo rclone lsl gdrive-crypt:obrixapy/uploads
sudo systemctl list-timers constructora-backup.timer --no-pager
```

El log correcto termina con `BACKUP_OK`.

## 4. Prueba de restauración

Un respaldo no se considera confiable hasta completar una restauración de prueba.
Nunca restaurar primero sobre la base de producción.

1. Descargar una copia a un directorio temporal.
2. Verificar SHA-256 y gzip.
3. Crear una base MySQL temporal.
4. Importar el SQL y comprobar tablas y conteos.
5. Eliminar la base temporal solo después de documentar el resultado.

```bash
sudo install -d -m 700 /var/backups/constructora/restore-test
sudo rclone copy gdrive-crypt:obrixapy/mysql /var/backups/constructora/restore-test --max-age 48h
sudo rclone copy gdrive-crypt:obrixapy/uploads /var/backups/constructora/restore-test --max-age 48h
cd /var/backups/constructora/restore-test
sudo sha256sum -c constructora_mysql_*.sql.gz.sha256
sudo gzip -t constructora_mysql_*.sql.gz
sudo tar -tzf constructora_uploads_*.tar.gz >/dev/null
```

La creación e importación de la base temporal debe ejecutarse de forma asistida,
porque una selección incorrecta del destino podría sobrescribir datos.

## Operación recomendada

- Revisar diariamente que el timer esté activo.
- Revisar semanalmente que Drive tenga archivos recientes.
- Hacer una restauración de prueba mensual.
- Descargar una copia de `rclone.conf` cifrada y guardarla fuera del VPS cada vez
  que cambie la configuración.
