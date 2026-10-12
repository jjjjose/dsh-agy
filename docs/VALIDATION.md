# Verificación en DeepSeek Harness

Los tests usan respuestas y cuentas simuladas. No sustituyen la prueba contra una instalación real de DSH y Google.

## Comprobaciones locales

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
npm run smoke
```

## Comprobación Desktop / Web

1. Instalar la carpeta `dsh-agy` desde **Plugins → Add plugin** y reiniciar DSH.
2. Abrir **Plugins → Google Antigravity** y comprobar el botón de conexión.
3. Autorizar Google; comprobar enlace alternativo si el navegador bloquea la apertura.
4. Comprobar estado de la cuenta y modelos en el selector.
5. Enviar un prompt breve y verificar texto incremental.
6. Probar una conversación con herramientas y una continuación posterior.
7. Probar un modelo Gemini y, si la cuenta tiene acceso, uno Claude con razonamiento.
8. Cancelar una generación y comprobar que no sigue transmitiendo.
9. Reiniciar DSH: la cuenta debe permanecer conectada.
10. Añadir otra cuenta; cambiar la activa y actualizar modelos/cuotas.
11. Desconectar una cuenta y luego todas; comprobar que las credenciales gestionadas se retiran.
12. Recargar/desactivar el plugin y comprobar que no duplica páginas, rutas ni proveedores.

No provocar límites agotando cuota: validar la rotación con respuestas simuladas. No incluir tokens, URLs completas de autorización/callback ni prompts privados en capturas o informes.

## Logs de diagnóstico

1. Verificar que el switch está apagado en una instalación sin preferencias guardadas.
2. Activarlo, enviar un prompt y comprobar inicio, HTTP, finalización y duración bajo el mismo `requestId`.
3. Reproducir un fallo o cancelar una generación; revisar motivo y etapa sin contenido privado.
4. Pulsar **Copiar logs** y comprobar el informe y la confirmación. Si el portapapeles está bloqueado, copiar manualmente el texto seleccionado.
5. Apagar el switch: conservar el historial, pero no añadir entradas al enviar otra solicitud.
6. Limpiar el historial y verificar que continúa vacío con el registro apagado.
7. Reiniciar DSH: conservar la preferencia de activación, pero no las entradas anteriores. El arranque puede añadir entradas nuevas si el registro estaba activado.
8. Salir de la página: detener la consulta periódica del panel sin detener el registro del servidor.

El switch solo controla la generación de logs del transporte de inferencia, no los logs generales del host ni las peticiones independientes de cuotas, búsqueda o OAuth. La última actividad estadística funciona siempre. El informe excluye `finishMessage`, que puede contener datos privados; herramienta y ubicación del esquema pueden revelar nombres propios del proyecto, por lo que debe revisarse antes de compartirlo.

## Limitaciones

### Regresión de `MALFORMED_FUNCTION_CALL`

En sesiones nuevas con `gemini-3.8-flash-high`, repetir el mismo prompt con herramientas básicas, con cada MCP por separado y con el catálogo completo. Verificar una llamada válida, su resultado y una segunda llamada en la misma conversación. Repetir con Claude si está disponible.

El error de generación conserva el `finishMessage` del backend cuando existe; puede contener argumentos generados, por lo que debe revisarse y redactarse antes de compartirlo. Las estadísticas solo guardan modelo, motivo, tipo de diagnóstico y cantidad de herramientas, no ese mensaje ni el esquema.

La conversión usa `parameters` del protocolo interno: transforma `oneOf` en `anyOf` (sin exclusividad), convierte uniones con `null` a `nullable` y resuelve referencias JSON Pointer locales. Referencias externas o recursivas y composiciones como `allOf` producen un error previo al envío con la herramienta y ubicación afectadas. No se eliminan herramientas ni se reintenta una generación mal formada automáticamente.

Un catálogo sintético de 135 herramientas verifica la conversión en tests; no prueba límites del backend ni confirma que un error de generación concreto esté resuelto en Google.

- El servicio Google usado es interno y puede cambiar sin aviso.
- La disponibilidad de modelos depende de cuenta y cuota, no de aparecer en el catálogo mantenido.
- Las tres herramientas se registran mediante `@deepseek-ai/dsh-tools`. Su disponibilidad para un agente depende de sus políticas y del modo de presentación del host (nativo o ejecución de código).
- Las estadísticas son de la instancia actual y se reinician al recargar el plugin.
