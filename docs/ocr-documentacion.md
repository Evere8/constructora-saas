# Lectura de planos y mediciones

El lector prioriza el texto SHX original de AutoCAD, incluidas etiquetas inclinadas
y verticales, antes de usar OCR. La longitud, S y Elong se conservan tal como están
en el plano. Las cotas y alturas de las losas no se convierten en elongaciones.

Los PDF escaneados y los manuscritos usan la API de OpenAI con salida estructurada,
una vista general y recortes de detalle. En mediciones los recortes abarcan todo el
ancho para poder relacionar una anotación con el extremo opuesto del mismo cable.
Un guion separa lecturas; una posición ilegible queda vacía. No se completa por
tolerancia ni por secuencia. La API limita el número de solicitudes por archivo.

## Activar en el VPS

1. Crear una clave de API en https://platform.openai.com/api-keys y habilitar saldo
   de API en el proyecto. La sesión de ChatGPT no se usa como credencial de API.
2. En la sesión existente `everadmin`, ejecutar:

   ```bash
   cd /opt/constructora/app && git pull --ff-only origin main &&
   cd /opt/constructora && sudo python3 app/deploy/configure-ocr.py
   ```

   El asistente pide la clave de forma oculta, prueba acceso al modelo y la guarda
   únicamente en `/opt/constructora/app.env`. No imprimir ni compartir ese archivo.
   El modelo por defecto es `gpt-5.4`, configurable; la prueba consume una petición
   pequeña de API. Si falla la clave, saldo o modelo, no modifica la configuración.
3. Aplicar las imágenes nuevas:

   ```bash
   cd /opt/constructora && sudo bash app/deploy/recover-sectors.sh
   ```

   Este comando existente crea un respaldo, verifica migraciones y esquema y
   reconstruye API/frontend. Esta actualización del lector no añade migraciones.

## Trabajos ya cargados

1. Documentación → Abrir asistente → Plano → **Releer plano completo**. Se conservan
   valores anteriores y mediciones; las diferencias aparecen como conflictos.
2. Corregir diferencias y **Agregar teoría faltante** cuando corresponda. Clasificar
   grupos usando la selección múltiple. **Revisar todas las teorías** requiere que
   los grupos estén clasificados y sus conflictos revisados individualmente.
3. Excel teórico → **Aprobar teoría**. Se mantienen las fórmulas de la plantilla.
4. Mediciones → **Releer mediciones guardadas**, o subir el nuevo escaneo. No hace
   falta crear otro trabajo ni volver a subir archivos existentes.
5. Conciliación → **Comparar con el escaneo**. Corregir valores pendientes, comprobar
   sobrantes/Labels desconocidos/asociaciones dudosas y registrar su resolución.
6. Aprobar mediciones y resultado final; descargar la nueva versión Excel.

Las medidas manuales y las revisadas no se reemplazan silenciosamente al releer.
Una lectura distinta aparece como alternativa. Los Excel anteriores permanecen
inmutables. Solo owner/admin/engineer pueden aprobar y resolver observaciones.

## Alcance de la comprobación

El plano AutoCAD adjuntado el 10/09/2026 contiene 28 rótulos SHX completos, frente
a los 15 candidatos de la lectura OCR reproducida. La extracción SHX se prueba con
el original en el entorno de desarrollo; el repositorio no incluye ese plano.
La integración manuscrita tiene pruebas de contrato, errores, ordinales y revisión.
Su precisión real debe verificarse con el escaneo y la clave del proyecto activada:
ningún OCR garantiza el 100% de caracteres manuscritos y asociaciones correctas.

Documentación oficial: https://developers.openai.com/api/docs/guides/structured-outputs
y https://developers.openai.com/api/docs/models/gpt-5.4.
