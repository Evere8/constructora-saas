# Obrixapy - Lector de elongaciones y Excel final (especificación V2)

## 1. Estado y alcance

Esta especificación define la siguiente versión del flujo de Documentación para listas de
elongaciones. No describe un OCR genérico: modela el proceso técnico real indicado por el
usuario y separa expresamente los datos teóricos del plano de las mediciones reales de obra.

El objetivo es completar este recorrido dentro de una obra y, cuando corresponda, de un nivel:

1. Cargar plano PDF, plantilla Excel, obra, nivel y responsable.
2. Detectar rótulos de tendones en alta resolución.
3. Clasificar cada rótulo como Banda o Distribuido, con corrección manual.
4. Extraer `Label`, longitud, cantidad `S` y elongación calculada.
5. Revisar los resultados sobre el plano.
6. Generar el Excel teórico conservando fórmulas.
7. Cargar una o varias fotografías o páginas escaneadas con mediciones manuscritas.
8. Relacionar las mediciones por `Label` y validar que su cantidad coincida con `S`.
9. Obtener la aprobación de un ingeniero o administrador autorizado.
10. Generar un Excel final versionado, con tolerancias y trazabilidad.

Fuera de alcance de esta iteración:

- Interpretar DWG nativo.
- Aprobar automáticamente manuscritos de baja confianza.
- Reemplazar al revisor técnico.
- Enviar planos o fotografías a un proveedor externo sin configuración y autorización explícitas.
- Desplegar a producción o fusionar cambios como parte de la implementación local.

## 2. Fuentes revisadas

Los archivos de análisis no deben incorporarse al repositorio; pueden contener documentación
privada de obra. Si no están disponibles en una sesión futura, el usuario debe volver a adjuntarlos.

| Archivo | Uso | SHA-256 |
|---|---|---|
| `Pasos para leer listas de elongaciones (1).pdf` | Regla funcional paso a paso | `f91fdf4cde4ac8179606f8e328b1dc69221ccd694effdd054f0b46608653b02e` |
| `260220-PP-P1-097-CAB (1).pdf` | Plano A0 real, una página, rotación 90 grados | `921504309cd0b533719629bc147e48d1de3f5449cf48c3f28458283cd6d4117d` |
| `EJEMPLO DE LISTA DE ELONGACIONES (1).xlsx` | Referencia de estructura, fórmulas y estilo | `b1e5bd52ea280d7c85324e04c9f5628cabcc1beebdcebfa3ad36453af1e487e4` |
| `625f1034-573e-4cba-9d87-6ece965f83b6.jpg` | Foto real con valores manuscritos | `542f9d820159f2018beee50a549bd8f43fa63da9111f2a770446d44fba64da85` |

## 3. Reglas de negocio no negociables

### 3.1 Registro teórico

Un rótulo de plano representa un grupo de tendones. Ejemplo:

```text
Tendon 8;S=2;L11.880;Elong=7.9
```

Se normaliza así:

| Campo | Valor normalizado | Unidad |
|---|---:|---|
| `label` | `T8` | identificador |
| `label_number` | `8` | entero para orden natural |
| `strand_count` | `2` | cantidad de tendones (`S`) |
| `length_m` | `11.880` | metros |
| `calculated_elongation_cm` | `7.9` | centímetros |

También se conserva el texto original, la página, las coordenadas normalizadas y la confianza de
cada campo. Solo se acepta como candidato automático un bloque que contenga los cuatro conceptos
semánticos: Tendón, `S`, `L` y `Elong`. Los números aislados del plano, la leyenda, las fechas y la
carátula no son filas de elongaciones.

`label` se normaliza siempre como `T` seguido del número sin ceros agregados. La presentación puede
mostrar además el texto original `Tendon N`, pero la unión entre plano, fotografía y Excel utiliza
el `label` normalizado.

### 3.2 Bandas y Distribuidos

La clasificación almacenada admite `band`, `distributed` y `unknown` durante la revisión.
`unknown` nunca puede llegar a la aprobación teórica.

El sistema propone una clase por posición, orientación y agrupamiento geométrico, pero no debe
deducirla solo porque una línea contenga o no la palabra “banda”: los rótulos reales normalmente no
incluyen esa palabra. El visor debe permitir:

- corregir la clase de un registro;
- seleccionar varios registros y clasificarlos juntos;
- dibujar o ajustar zonas de Bandas y Distribuidos para reclasificar;
- filtrar los candidatos dudosos o aún no clasificados.

En el Excel final, `band` se escribe bajo `BANDAS` y `distributed` bajo `DISTRIBUIDOS`.

### 3.3 Una medición por tendón físico

`S` no es un dato decorativo. Si un grupo tiene `S=4`, debe producir cuatro filas de medición,
ordenadas `1..4`, aunque `Label`, longitud y cantidad se muestren combinados en el Excel.

Por lo tanto, una sola columna `measured_elongation` en el registro de grupo es insuficiente. Las
mediciones reales son entidades hijas. Nunca se deben truncar, duplicar ni completar valores para
forzar una coincidencia.

Ejemplo:

```text
T321; S=4; calculada=5.6
medidas manuscritas: 4.8 - 4.0 - 4.5 - 4.5
```

Resultado: cuatro mediciones con ordinales 1, 2, 3 y 4 vinculadas a `T321`.

### 3.4 Decimales y unidades

- Se admiten coma o punto decimal en OCR y entrada manual.
- Se normaliza a `Decimal`; no se utiliza `float` para persistencia ni reglas de tolerancia.
- Longitud: metros, hasta tres decimales.
- Elongación calculada, máxima, mínima y medida: centímetros, hasta tres decimales.
- Un guion entre números manuscritos es un separador de lista, no una resta ni un intervalo.
- Valores negativos, `S <= 0`, longitudes nulas o rótulos incompletos quedan sin resolver.

### 3.5 Fórmulas y tolerancia

Las columnas `Max.` y `Min.` deben seguir siendo fórmulas de Excel. El backend no debe exportar sus
resultados como números fijos.

La plantilla es la fuente de la regla de fórmula. El importador detecta una fórmula canónica válida
por sección, la traduce a cada fila nueva y verifica que la referencia termine apuntando a la celda
`Calculada` de esa misma fila. En la plantilla analizada, la regla dominante es:

```excel
Max. = Hn+(Hn*0.07)
Min. = Hn-(Hn*0.07)
```

Esto representa una tolerancia de 7 %. El valor guardado en el trabajo debe coincidir con la regla
detectada. No se permite que la API diga 5 % mientras el archivo calcula 7 %. Una tolerancia editable
solo es válida si la plantilla posee una celda o nombre definido para ese parámetro, o si el usuario
autoriza convertir coherentemente todas las fórmulas a una celda visible de tolerancia.

La tolerancia indica estado, no validez automática:

- `within`: `Min. <= Medida <= Max.`;
- `outside`: la medida está fuera del intervalo;
- `missing`: todavía no existe medición;
- `unresolved`: OCR o asociación sin confirmar.

Una medida fuera de tolerancia puede ser aprobada únicamente por un revisor autorizado y con una
observación obligatoria. Debe conservar el marcado de advertencia en el Excel final.

### 3.6 Revisión humana y aprobación

- Todo registro teórico debe ser revisado antes del Excel teórico.
- Toda lectura manuscrita de baja confianza debe permanecer pendiente.
- El sistema propone; el ingeniero valida.
- Supervisor puede cargar y corregir, pero no realizar la aprobación técnica final.
- La aprobación final exige que todos los grupos estén clasificados, que cada grupo tenga exactamente
  `S` mediciones, que no haya conflictos de OCR y que las excepciones tengan justificación.
- Cada corrección y aprobación guarda actor, fecha y valores anterior/nuevo en la auditoría.

## 4. Hallazgos de los archivos reales

### 4.1 Plano PDF

El plano de prueba es A0, está marcado con rotación de 90 grados y contiene rótulos muy pequeños. Los
rótulos teóricos observados siguen el patrón semántico `Tendon N;S=n;Lx.xxx;Elong=x.x`.

Ejemplos útiles para pruebas de regresión, que deben confirmarse contra el recorte antes de formar un
golden fixture:

- `T200`, `S=3`, `L=30.104`, `Elong=18.6`;
- `T203`, `S=6`, `L=31.496`, `Elong=20.6`;
- `T224`, `S=1`, `L=23.766`, `Elong=15.6`;
- `T262`, `S=2`, `L=62.846`, `Elong=33.5`.

Los números de la carátula y las leyendas demuestran por qué no sirve tomar “los primeros tres
números” de cada línea.

### 4.2 Foto manuscrita

La foto necesita orientación, corrección de perspectiva y lectura por sectores. Los rótulos impresos
resaltados en rosa funcionan como anclas. Junto a ellos aparecen listas manuscritas como `11,3-10,8`
o `24,5-24,6`; cada número corresponde a una fila física del grupo, no a un rango.

La segmentación por color puede ayudar a encontrar anclas, pero no puede ser requisito: otras obras
pueden usar otro resaltador o no usarlo.

### 4.3 Plantilla Excel

La plantilla tiene una hoja `Hoja1`, rango usado `A5:S212`, tabla visible principal `A:K`, columnas
`E:G` ocultas y dos secciones:

| Sección | Labels | Filas físicas según `S` |
|---|---:|---:|
| BANDAS | 15 | 68 |
| DISTRIBUIDOS | 16 | 29 |

La sección Distribuidos repite el ítem 2 y termina en 28 aunque contiene 29 filas. Además se
detectaron 20 fórmulas `Max./Min.` faltantes o apuntando a otra fila, y 9 anomalías adicionales en
columnas auxiliares: 29 desviaciones en total. Las columnas auxiliares `L:N` también aparecen visibles
aunque duplican límites usados por el formato condicional.

Decisión: este archivo es una referencia válida de presentación y de la regla dominante, pero no es
una fuente de datos ni de fórmulas celda por celda. El generador debe reconstruir numeración y cuerpo,
validar/trasladar la fórmula canónica y ocultar o eliminar auxiliares visibles.

### 4.4 Implementación actual

La versión actual no satisface este proceso:

- `extract_text` acepta cualquier PDF con 30 caracteres; en el A0 encuentra la carátula y no activa
  OCR aunque falten todos los rótulos.
- `parse_elongation_rows` toma los primeros tres números sin leer `Tendon`, `S`, `L` ni `Elong`.
  Con el plano real genera 7 falsos positivos de leyendas y fechas, y cero rótulos correctos.
- La confianza está fijada artificialmente en `0.6500`.
- La clase se decide buscando la palabra `band` en la misma línea.
- Solo se carga un archivo y no existe plantilla, etapa teórica ni cargas de medición asociadas.
- `ElongationItem` permite una sola medida por `Label`; no representa `S` medidas.
- No hay página/coordenadas para mostrar el resultado sobre el plano.
- El OCR bloquea la solicitud HTTP.
- Cualquier editor puede marcar una fila aprobada y puede exportar aunque existan pendientes.
- El XLSX actual es una cuadrícula básica sin plantilla, secciones, fórmulas, tolerancia, formato,
  múltiples medidas, historial ni control de aprobación.

## 5. Modelo de datos V2

La migración debe ser aditiva y conservar trabajos existentes. No se eliminan datos de producción.

### 5.1 `elongation_jobs`

Conservar la tabla y añadir como mínimo:

| Campo | Tipo/uso |
|---|---|
| `level_id` | FK opcional a nivel de obra |
| `responsible_user_id` | FK opcional a usuario responsable |
| `workflow_status` | estado V2 definido en la sección 6 |
| `template_mapping_json` | hoja, secciones, columnas, patrón de filas y fórmulas detectadas |
| `processing_summary_json` | conteos, advertencias, versión de motores y tiempos |
| `approved_by_user_id` / `approved_at` | aprobación final |
| `theory_approved_by_user_id` / `theory_approved_at` | aprobación teórica |
| `version_number` | versión lógica del trabajo |

`tolerance_percent` continúa como `Decimal`, pero debe derivarse o validarse contra la plantilla.

### 5.2 `elongation_job_files`

Almacena todos los archivos privados relacionados con el trabajo:

| Campo | Regla |
|---|---|
| `id`, `job_id` | UUID y FK |
| `kind` | `plan`, `template`, `measurement_scan`, `theoretical_export`, `final_export` |
| `version_number` | secuencia por tipo |
| `storage_key`, `original_filename`, `mime_type`, `size_bytes`, `sha256` | metadatos seguros |
| `page_count` | si aplica |
| `processing_status`, `error_message` | estado individual |
| `uploaded_by_user_id`, `created_at` | auditoría |

Restricción única sugerida: `(job_id, kind, version_number)`.

### 5.3 `elongation_items` como grupos teóricos

Conservar la tabla y su unicidad por trabajo/label, pero añadir:

- `label_number` para orden natural;
- `raw_label` y `raw_text`;
- `sort_order`;
- `field_confidence_json`;
- `theory_review_status` (`pending`, `approved`, `rejected`, `conflict`);
- `reviewed_by_user_id`, `reviewed_at`;
- `source_file_id`, `source_page` y `source_location_json` con `bbox` normalizado;
- clasificación temporal `unknown`.

`measured_elongation` queda solo por compatibilidad durante la migración y deja de ser la fuente de
verdad. Si contiene un valor legado, se migra como medición ordinal 1.

### 5.4 `elongation_measurements`

| Campo | Regla |
|---|---|
| `id`, `job_id`, `item_id` | UUID/FK |
| `ordinal` | 1..S, único por grupo |
| `measured_elongation` | Decimal en cm, nullable mientras falte |
| `raw_text` | lectura original |
| `confidence` | confianza real del candidato |
| `match_method` | `label_anchor`, `spatial`, `manual` |
| `review_status` | `pending`, `approved`, `rejected`, `conflict` |
| `override_reason` | obligatorio al aprobar fuera de tolerancia |
| `source_file_id`, `source_page`, `source_location_json` | trazabilidad del recorte |
| `reviewed_by_user_id`, `reviewed_at` | auditoría |

Restricción única: `(item_id, ordinal)`.

Max, Min y estado de tolerancia se calculan para la API con Decimal a partir de la misma regla
validada para Excel; no se duplican como datos editables.

### 5.5 `elongation_exports`

Guarda cada salida inmutable: `job_id`, `kind` (`theoretical`, `final`), `version_number`, archivo,
hash, `snapshot_json`, usuario y fecha. Descargar una versión anterior debe devolver exactamente el
archivo que fue aprobado, no regenerarlo con datos actuales.

## 6. Máquina de estados

Estados principales:

```text
draft
  -> queued_theory
  -> processing_theory
  -> theory_review
  -> theory_approved
  -> measurements_pending
  -> processing_measurements
  -> measurement_review
  -> ready_for_approval
  -> approved
  -> exported
```

Estados laterales: `failed_theory`, `failed_measurements`, `cancelled`.

Reglas:

- `POST` inicial responde con el trabajo en `queued_theory`; no mantiene abierta la solicitud durante
  el OCR.
- Un reintento parte del último archivo almacenado y no crea duplicados.
- Cambiar un dato teórico después de aprobar invalida mediciones, aprobación y exportaciones futuras;
  las versiones anteriores permanecen disponibles.
- Cambiar una medición después de aprobar crea una nueva versión pendiente de aprobación.
- `theoretical` solo se exporta desde `theory_approved` en adelante.
- `final` solo se exporta desde `approved` y genera una versión inmutable.

Para el MVP puede usarse `FastAPI BackgroundTasks` con una sesión de base nueva por tarea y límite de
concurrencia. Debe quedar una interfaz de cola separada para migrar luego a un worker persistente. Si
el proceso muere, los estados `queued_*`/`processing_*` deben poder reintentarse explícitamente.

## 7. API propuesta

Prefijo existente:

```text
/api/v1/companies/{company_id}/projects/{project_id}
```

Recurso nuevo (sin romper temporalmente los endpoints `/documents` existentes):

| Método | Ruta | Uso |
|---|---|---|
| `GET` | `/elongation-jobs` | Listar trabajos y resumen de avance |
| `POST` | `/elongation-jobs` | Crear con datos, plano y plantilla; devuelve 202 |
| `GET` | `/elongation-jobs/{job_id}` | Detalle, grupos, medidas, advertencias y archivos |
| `POST` | `/elongation-jobs/{job_id}/retry` | Reintentar la etapa fallida/idempotente |
| `PATCH` | `/elongation-jobs/{job_id}/items/{item_id}` | Corregir teoría/clase y revisión |
| `POST` | `/elongation-jobs/{job_id}/approve-theory` | Validar y aprobar teoría |
| `POST` | `/elongation-jobs/{job_id}/measurement-files` | Cargar uno o varios PDF/JPG/PNG/WEBP; 202 |
| `PATCH` | `/elongation-jobs/{job_id}/measurements/{measurement_id}` | Corregir, ordenar o revisar una medida |
| `POST` | `/elongation-jobs/{job_id}/approve-final` | Validación técnica final |
| `GET` | `/elongation-jobs/{job_id}/files/{file_id}` | Descarga autenticada de fuente/recorte/exportación |
| `GET` | `/elongation-jobs/{job_id}/exports/theoretical` | Obtener o generar Excel teórico versionado |
| `GET` | `/elongation-jobs/{job_id}/exports/final` | Descargar la versión final aprobada |

El `POST` inicial es multipart e incluye:

- `title`;
- `level_id` opcional;
- `responsible_user_id` opcional;
- `plan_version_id` o `plan_file` (exactamente uno);
- `template_file` XLSX obligatorio;
- no aceptar una tolerancia contradictoria con la plantilla.

El detalle debe devolver conteos `groups_total`, `groups_pending`, `measurements_expected`,
`measurements_detected`, `measurements_pending`, `outside_tolerance`, `unresolved_conflicts` y
`can_approve_*` con motivos legibles.

Los endpoints antiguos se mantienen durante esta iteración, se marcan como legacy y no son usados
por la interfaz V2. No se borran hasta contar con migración de datos y clientes.

## 8. Procesamiento teórico

### 8.1 Preflight

1. Verificar firma real, tamaño, número de páginas y límites de píxeles.
2. Aplicar rotación declarada por el PDF.
3. Registrar SHA-256 para idempotencia y no reprocesar la misma combinación plano/plantilla/motor.
4. Analizar la plantilla antes del OCR. Si faltan las dos secciones o columnas requeridas, marcar
   `template_invalid` con un error accionable.

### 8.2 Texto vectorial y OCR

`pdftotext` es una fuente complementaria, no un criterio de éxito por cantidad de caracteres.

1. Intentar texto con coordenadas (`pdftotext -bbox-layout` o PyMuPDF).
2. Contar registros semánticos completos, no caracteres totales.
3. Si la cobertura es nula, baja o contiene solo carátula/leyenda, renderizar la página.
4. Para planos grandes, renderizar a 300-400 DPI y dividir en mosaicos con solape; no enviar el A0
   completo y reducido a Tesseract.
5. Ejecutar una pasada de orientación y texto disperso para hallar candidatos `Tendon`.
6. Volver a leer cada recorte candidato con alta resolución y configuraciones de OCR específicas.
7. Agrupar tokens por proximidad y conservar sus cajas.

### 8.3 Parser semántico

El parser busca los campos por sus nombres, aunque haya espacios o saltos de línea:

- Tendón: `Tendon`, `Tendón` y confusiones OCR controladas;
- cantidad: token `S` seguido de `=` y entero;
- longitud: token `L` (con o sin `=`) y decimal;
- calculada: `Elong`, `Elongación` o variante controlada y decimal.

No se acepta una fila por tener solamente tres o cuatro números. El texto exacto de carátula,
leyendas y notas se debe usar como conjunto negativo de pruebas.

Cada campo obtiene una confianza propia. Propuesta de niveles:

- `>= 0.90`: candidato fuerte, igualmente pendiente de revisión humana;
- `0.70..0.8999`: revisar;
- `< 0.70`: sin resolver;
- cualquier campo faltante o dos lecturas incompatibles: `conflict`.

Los candidatos de mosaicos solapados se deduplican por `label`, cercanía geométrica y valores. Dos
tuplas distintas para el mismo `label` no se sobrescriben: se muestran como conflicto.

### 8.4 Clasificación y orden

La propuesta automática usa regiones/orientación/agrupamiento. Se ordena por sección y
`label_number`, no alfabéticamente, para evitar `T1, T10, T2`.

El visor muestra el PDF y rectángulos por estado. Seleccionar una fila centra y amplía el recorte;
seleccionar un rectángulo abre los cuatro campos editables y la clase.

## 9. Lectura de fotografías y escaneos

1. Aplicar orientación EXIF.
2. Detectar bordes de la hoja y corregir perspectiva; conservar siempre el original.
3. Crear variantes de contraste/escala de grises y una vista color para localizar resaltadores.
4. Hallar rótulos impresos `Tendon N...` o zonas resaltadas y usarlos como ancla de `Tn`.
5. Extraer recortes alrededor del ancla y separar texto impreso de escritura manual cuando sea posible.
6. Leer listas numéricas admitiendo coma/punto y separadores guion, espacio, barra o salto de línea.
7. Asociar por `label_anchor`; la cercanía espacial sin `Label` solo genera una sugerencia de baja
   confianza.
8. Crear hasta `S` ordinales sin truncar valores extra. Faltantes y sobrantes quedan visibles.
9. Comparar con Max/Min únicamente para marcar estado.
10. Presentar cada recorte y valor para confirmación del usuario.

Tesseract sigue siendo la primera lectura para texto impreso. La escritura manual real no puede
considerarse confiable solo porque Tesseract devolvió dígitos. Implementar una interfaz
`HandwritingProvider`:

- proveedor local/manual obligatorio y sin red;
- proveedor de visión opcional, deshabilitado por defecto;
- enviar, cuando se configure, solo recortes dudosos y nunca el plano completo;
- registrar proveedor, versión y confianza;
- no aprobar automáticamente ninguna respuesta externa.

## 10. Importación y generación del Excel

### 10.1 Seguridad de plantilla

- Aceptar únicamente `.xlsx`, no `.xlsm` ni `.xls`.
- Validar ZIP y partes OOXML requeridas.
- Rechazar macros, enlaces externos, rutas externas y archivos comprimidos con expansión excesiva.
- Cargar con fórmulas (`data_only=False`).
- Guardar el original privado e inmutable.

Para implementar preservación de fórmulas, estilos y combinaciones en Python se recomienda
`openpyxl` con una capa propia de validación OOXML. No se deben construir archivos XLSX mediante
concatenación manual de XML como hace la versión actual.

### 10.2 Descubrimiento de estructura

No depender de coordenadas fijas como `B15`. Normalizar texto (mayúsculas, acentos, espacios y
puntuación) y localizar:

- títulos `BANDAS` y `DISTRIBUIDOS`;
- columnas `Item`, `Label`, `Longitud (m)`, `Cantidad de tendones`;
- subcolumnas de `Elongación (cm)`: `Calculada`, `Max.`, `Elong. Medida`, `Min.`;
- filas prototipo, celdas combinadas, alturas, anchos, columnas ocultas, fórmulas y formato condicional.

Persistir el mapa resultante en `template_mapping_json` para que revisión y exportación utilicen la
misma interpretación.

### 10.3 Validación de fórmulas

1. Analizar solo fórmulas, nunca valores cacheados.
2. Convertir referencias relativas a un patrón canónico por columna/sección.
3. Elegir automáticamente la regla dominante únicamente si existe una mayoría clara y referencia
   la celda Calculada de su misma fila.
4. Mostrar advertencias de celdas heredadas rotas.
5. Bloquear si no existe una regla fiable; permitir que el usuario elija una fila semilla válida.
6. Al generar, traducir la regla canónica a todas las filas y verificar otra vez cada referencia.

La muestra permite reconocer la regla dominante de +/-7 %, pero sus celdas defectuosas no deben
copiarse como fuente individual.

### 10.4 Reconstrucción dinámica

1. Trabajar sobre una copia del XLSX original.
2. Preservar logo, encabezado, metadatos generales, estilos y dimensiones pertinentes.
3. Eliminar del cuerpo todos los valores del proyecto anterior.
4. Reconstruir `BANDAS` y `DISTRIBUIDOS` con el número real de filas.
5. Crear una fila lógica por cada tendón físico; si la plantilla representa una fila lógica con dos
   filas físicas combinadas, clonar ese bloque de forma consistente.
6. Reiniciar `Item` en 1 dentro de cada sección y numerar sin duplicados.
7. Combinar `Label`, longitud y cantidad sobre exactamente las `S` filas del grupo.
8. Repetir `Calculada` por cada fila de medición del grupo.
9. Insertar una fórmula propia de la fila en Max y Min.
10. En el Excel teórico dejar `Elong. Medida` vacía; en el final escribir una medida por ordinal.
11. Aplicar formato condicional: faltante en amarillo y fuera de tolerancia en rojo; no colorear una
    celda vacía como si fuera una medida inválida.
12. Ocultar auxiliares o reemplazar su uso; la hoja operativa debe mostrar solo las columnas previstas.
13. Fijar área de impresión en la tabla útil y solicitar recálculo completo al abrir.

Se conservan los formatos numéricos de la plantilla; como mínimo longitud muestra tres decimales,
calculada/medida permiten la precisión capturada y los límites pueden mostrar tres decimales.

### 10.5 Hojas de salida

- Hoja operativa: mantiene el nombre y apariencia principal de la plantilla.
- `Control OCR`: label, ordinal, valor, archivo/página/recorte, confianza, método de asociación,
  estado de revisión, tolerancia y observación.
- `Historial Obrixapy`: trabajo, versión, tipo, fecha, usuario y hashes de fuentes/salida.

Las dos hojas de control no reemplazan la auditoría en base de datos.

### 10.6 Verificación antes de guardar

- número de filas por grupo = `S`;
- ítems secuenciales sin duplicados;
- labels únicos por trabajo;
- ninguna clase `unknown`;
- todas las fórmulas Max/Min apuntan a Calculada de su propia fila;
- ninguna fórmula se exportó como valor fijo;
- final: cada fila tiene una medida aprobada o una excepción aprobada con comentario;
- no hay `#REF!`, referencias circulares ni fórmulas faltantes;
- hoja visual, columnas ocultas, celdas combinadas y área de impresión correctas;
- archivo reabierto exitosamente y hash registrado.

## 11. Interfaz de Documentación

Dentro de `Obra -> Documentación`, mostrar una tarjeta específica `Listas de elongaciones` y un
asistente, no una sola tabla genérica:

1. **Datos y fuentes**: nombre, nivel, responsable, plano existente o PDF, plantilla XLSX.
2. **Lectura teórica**: progreso en segundo plano y errores accionables.
3. **Revisión del plano**: visor con overlays, tabla, filtros y edición masiva de clase.
4. **Excel teórico**: resumen de plantilla/fórmulas, aprobación y descarga versionada.
5. **Mediciones reales**: carga múltiple de fotos/PDF y recortes detectados.
6. **Conciliación**: por Label, indicador `detectadas/S`, orden 1..S, confianza y tolerancia.
7. **Aprobación**: resumen de bloqueos y justificación de excepciones.
8. **Resultado**: Excel final, versiones y archivos fuente.

Requisitos de UX:

- no habilitar botones de aprobación/exportación si la API indica un bloqueo;
- actualizar estado por polling de TanStack Query mientras se procesa;
- conservar correcciones al cambiar de paso;
- en móvil usar tarjetas por Label y abrir visor/recorte en pantalla completa;
- mostrar `Banda`, `Distribuido` y `Sin clasificar` en español;
- mostrar unidades en cada campo;
- confirmar operaciones que invaliden una aprobación previa.

## 12. Permisos, auditoría y aislamiento

| Acción | Roles mínimos |
|---|---|
| Ver trabajo y fuentes | miembros autorizados de la constructora/obra |
| Crear, cargar y corregir | `owner`, `admin`, `engineer`, `supervisor` |
| Aprobar teoría/final o aceptar excepción | `owner`, `admin`, `engineer` |
| Descargar final aprobado | miembros con acceso de lectura a la obra |

Agregar capacidades frontend separadas `documents.edit`, `documents.approve` y `documents.export`.
La API valida siempre empresa, obra, estado y rol; ocultar un botón no es autorización.

Registrar como mínimo: creación, archivos, inicio/fin/error de procesamiento, corrección teórica,
clasificación, corrección/reorden de medida, aprobación, invalidación, excepción y exportación.

## 13. Archivos de código previstos

La implementación puede ajustar nombres, pero debe conservar separación de responsabilidades:

### Backend

- migración `0006_elongations_v2.py`;
- modelos y esquemas V2;
- `api/routes/elongations.py`;
- `services/elongations/template.py`;
- `services/elongations/theory.py`;
- `services/elongations/measurements.py`;
- `services/elongations/export.py`;
- `services/elongations/pipeline.py`;
- ampliación segura de `file_storage.py` para XLSX y múltiples fuentes;
- dependencias fijadas y lock actualizado (como mínimo una librería XLSX; Pillow/OpenCV solo si la
  implementación realmente las usa).

No convertir `document_processing.py` en otro archivo monolítico. Mantener adaptadores legacy o
delegarlo al servicio V2 hasta retirar las rutas antiguas.

### Frontend

- tipos y API V2;
- `ElongationJobsPanel`;
- `ElongationWizard`;
- `TheoryReviewStep` con visor/overlays;
- `MeasurementReviewStep`;
- `ElongationApprovalStep`;
- integración en `DocumentosTab` sin mezclar este flujo con Planos;
- pruebas de componentes, permisos, estados y payloads.

## 14. Pruebas obligatorias

### Backend unitario

- parser semántico con coma/punto, espacios, saltos y OCR controlado;
- ejemplo `Tendon 8;S=2;L11.880;Elong=7.9` produce exactamente `T8/2/11.880/7.9`;
- carátula, leyendas, fechas y notas del plano no producen filas;
- deduplicación de mosaicos y conflicto por mismo label/tupla distinta;
- orden natural de labels;
- separación de lista manuscrita por guiones;
- discrepancia entre lecturas y `S` bloquea aprobación;
- fuera de tolerancia exige observación;
- parser de plantilla localiza encabezados aunque cambien de fila;
- fórmulas faltantes o con referencia a otra fila se detectan;
- exportación mantiene fórmulas por fila y no valores cacheados;
- generación dinámica para `S=1`, `S=2` y `S=8`;
- XLSX reabre y no tiene errores de referencias;
- archivos maliciosos, macros, extensiones falsas y traversal se rechazan;
- multiempresa y permisos de aprobación.

### Backend integración

- crear trabajo -> procesar -> revisar -> aprobar teoría -> subir mediciones -> aprobar -> exportar;
- solicitudes inválidas no dejan archivos huérfanos;
- reintento por SHA no duplica grupos/medidas;
- modificar después de aprobar crea/invalida la versión correcta;
- una constructora no puede leer fuentes o Excel de otra.

### Frontend

- wizard y bloqueo de pasos;
- polling termina en éxito/error;
- corrección de campos y clasificación;
- conteo `detectadas/S`;
- permisos: supervisor corrige pero no aprueba;
- excepción fuera de tolerancia requiere comentario;
- descarga usa el nombre/versionado devuelto por la API;
- comportamiento móvil básico.

### Fixtures de aceptación

- Crear pequeños recortes anonimizados o sintéticos dentro de tests, no incorporar los archivos de
  obra completos al repositorio.
- Construir un golden JSON confirmado manualmente a partir de varios recortes del plano real.
- La prueba con el plano completo puede ser una prueba manual/privada y no parte de CI.
- Mantener separados casos de texto impreso y manuscrito.

## 15. Criterios de aceptación funcional

La V2 se considera terminada cuando:

1. Un usuario crea un trabajo con plano y plantilla dentro de una obra/nivel.
2. El proceso no confunde carátula/leyenda con tendones.
3. Cada candidato tiene recorte y ubicación visible.
4. Se revisan Bandas y Distribuidos antes de continuar.
5. La suma de filas del Excel teórico equivale a la suma de `S`.
6. Max y Min son fórmulas correctas de su propia fila.
7. Se pueden cargar varias fotos y conservar sus originales.
8. Cada Label muestra `medidas detectadas / S` y los conflictos.
9. Ningún dato de baja confianza se aprueba solo.
10. La aprobación técnica y las excepciones quedan auditadas.
11. El Excel final coincide con la estructura visual acordada, tiene medidas/tolerancia, se reabre sin
    errores y queda versionado.
12. Lint, pruebas backend/frontend y builds pasan.
13. No se expone ningún archivo privado ni se rompe compatibilidad con los trabajos existentes.

## 16. Orden de implementación para Terra

Trabajar en la rama local `codex/elongations-documentation-v2`, basada en `origin/main` en
`acdce79da265e28367e7fe42b1620353460c027c`.

1. Leer esta especificación y el código actual antes de editar.
2. Escribir primero pruebas de parser, modelo de S mediciones y preflight de plantilla.
3. Implementar migración/modelos/esquemas y la API, manteniendo rutas legacy.
4. Implementar lectura teórica semántica y procesamiento asíncrono/reintentable.
5. Implementar importador/generador XLSX y sus verificaciones.
6. Implementar carga, asociación y revisión de mediciones manuscritas.
7. Implementar asistente frontend y permisos.
8. Añadir pruebas integradas y actualizar contratos/documentación.
9. Ejecutar verificaciones completas.
10. Hacer commits pequeños y legibles; detenerse con la rama local lista.

No hacer push, PR, merge ni despliegue sin autorización posterior del usuario.

Comandos mínimos de verificación, adaptándolos a las herramientas ya fijadas por el repositorio:

```bash
cd backend
uv run ruff check .
uv run pytest

cd ../frontend
npm ci
npm run lint
npm run test -- --run
npm run build

cd ..
git status --short
git diff --check
```

Antes de solicitar publicación, informar migración creada, archivos cambiados, resultados exactos,
limitaciones de reconocimiento manuscrito y pasos manuales usados con los cuatro archivos privados.
