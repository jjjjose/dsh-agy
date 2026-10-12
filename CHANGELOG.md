# Changelog

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
