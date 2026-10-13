# Changelog

## Unreleased

## 0.2.2 — 2026-10-12

### Corregido

- Compatibilidad con `pi-ai 1.0.2`: recuperar herramientas activas y prompt desde los mensajes de sistema del transcript. El formato anterior leía campos que el host ya había normalizado, enviando cero declaraciones aunque DSH entregase herramientas.
- Resolver adiciones, eliminaciones, reemplazos y secciones de sistema con las utilidades oficiales de pi-ai. Retirar la promoción de herramientas diferidas: su admisión corresponde a DSH.
- Leer `maxTokens` de Antigravity como contexto y `maxOutputTokens` como salida. Consulta real: Gemini 3.8 Flash anuncia 1 048 576 de contexto y 65 536 de salida.
- Conservar límites por ruta/variante y su procedencia. Una variante con metadatos ausentes no rebaja las capacidades conocidas de sus hermanas; los límites desconocidos se identifican como respaldo operativo.
- Caché v2: invalidar la caché antigua que persistía límites artificiales y preservar datos confirmados solo durante 24 horas desde su verificación original.
- Agrupar alias de agente con nombres inequívocos de Google y ocultar rutas tiered internas, manteniendo el descubrimiento de versiones sin una lista fija.

### Añadido y validación

- Detalle de contexto, salida y modalidades por variante en la página del plugin. Validación de máximo de salida contra la ruta elegida.
- Correlación entre `adapter-tools`, `request-start` y `request-built` mediante el mismo requestId, sin cabeceras ni contenido privado.
- Regresión con la normalización real de `Models.streamSimple` de pi-ai 1.x. Prueba contra Google real con Gemini 3.8 Flash High: llamada válida a herramienta sintética y continuación tras su resultado. No sustituye validar el catálogo completo del agente en DSH Desktop.

## 0.2.1 — 2026-10-12

### Corregido

- Herramientas entregadas a Antigravity con `deferLoading`: enviarlas explícitamente en el catálogo nativo, sin modificar solicitudes congeladas ni cargar herramientas ajenas a la solicitud. Nuevo evento seguro `adapter-tools` para distinguir catálogo ausente de herramientas filtradas.
- Desactivar llamadas de función (`NONE`) cuando la solicitud no contiene herramientas declaradas, aunque el prompt o el historial mencione herramientas.

## 0.2.0 — 2026-10-12

### Añadido

- Catálogo dinámico por cuenta/proyecto: descubre nuevas versiones compatibles, actualiza cada 15 minutos y conserva un respaldo normalizado en disco de hasta 24 horas ante errores de red.
- Estado del catálogo en la interfaz: origen, fecha, modelos, variantes y entradas no compatibles. El refresco manual devuelve su resultado real.
- Diagnóstico del catálogo y de la ruta de inferencia resuelta según effort, sin credenciales.
- Switch de logs de diagnóstico seguro con preferencia persistente, historial en memoria de hasta 200 entradas, actualización periódica, copiado y limpieza desde la página del plugin.
- Eventos correlacionados por solicitud: inicio, HTTP, red, reintentos, rotación, conversión de esquemas, finalización y cancelación; sin credenciales ni contenido de conversaciones.

### Corregido

- Una entrada por modelo/versión en el selector; variantes disponibles elegidas mediante el effort nativo de DSH y traducidas al ID real de Antigravity. IDs anteriores conservados como alias internos ocultos.
- Validación de modelo/effort contra la cuenta que envía la solicitud, incluida la rotación, sin sustituir modelos ni bajar el esfuerzo silenciosamente. Respuestas tardías de otra cuenta no reemplazan el catálogo activo.
- Esquemas de herramientas: conservar alternativas de `oneOf` mediante `anyOf`, normalizar uniones anulables y resolver referencias locales antes de eliminar definiciones. La conversión no modifica el catálogo original.
- Informar herramienta y ubicación para referencias no resolubles, recursión y composiciones que no pueden representarse de forma segura, en lugar de eliminar sus restricciones silenciosamente.
- Incluir `finishMessage` del backend en el error de generación (limitado a 1000 caracteres), sin persistirlo en las estadísticas. Los diagnósticos de conversión y finalización incluyen la cantidad de herramientas.

### Validación y límites

- Pruebas con un catálogo sintético de 135 herramientas para Gemini y Claude; no equivalen a una reproducción contra Google real.
- Se conserva el campo protobuf `parameters`; no se presupone que Cloud Code Assist admita `parametersJsonSchema`.
- `oneOf` se aproxima con `anyOf`: conserva las alternativas, pero no la exclusividad. La validación original de entradas sigue siendo responsabilidad del host.

## 0.1.1 — 2026-10-12

### Añadido

- Actualización del paquete configurable: estado, comprobación, confirmación manual e intervalo automático persistente. Desactivada hasta configurar un registro npm HTTPS confiable.
- Diagnóstico del motivo de finalización de Antigravity en la actividad del plugin.
- Tutorial en español y guía de instalación, herramientas, actualización y solución de errores en el README.
- Metadatos del repositorio oficial `jjjjose/dsh-agy`.

### Corregido

- Dependencias del host dirigidas a DSH `0.2.1-alpha.2`, en lugar del RC antiguo.
- Conversión de herramientas a `functionDeclarations[].parameters`, con normalización de esquemas para Antigravity.
- Manejo de llamadas paralelas, resultados, firmas y turnos de herramientas interrumpidos.
- Conservación del motivo de error de generación en lugar de perderlo tras una respuesta vacía.

### Validación y límites

- Pruebas automatizadas, TypeScript, build y smoke; no equivalen a una validación completa en DSH Desktop con Google real.
- La actualización automática usa un registro npm configurado, no el repositorio GitHub. Las copias locales requieren actualización manual.
- API interna de Google: disponibilidad y comportamiento pueden cambiar.

## 0.1.0

- Versión inicial de desarrollo: proveedor Google Antigravity para DSH, OAuth, cuentas, catálogo, streaming, cuotas, búsqueda y configuración del plugin.
