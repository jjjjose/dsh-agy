# Changelog

## Unreleased

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
