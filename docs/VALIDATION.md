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

### Matriz de compatibilidad del adaptador

| Host | Validación |
| --- | --- |
| DSH `0.2.1-alpha.2`, pi-ai `1.0.2` | Prueba contra las fuentes reales del adaptador, con HTTP simulado: ocho streams aislados, entrada directa y preparada, orden usage/finish e IDs únicos. |
| Versiones posteriores | Admitidas por las dependencias, sujetas a la API de snapshots. Ejecutar `test:host` contra cada versión antes de declararla validada. |
| DSH Desktop/Web + Google + Argon | Requiere validación manual con cuenta elegible; las pruebas del parser no demuestran disponibilidad remota. |

Para probar un checkout de DSH con sus dependencias instaladas, sin los mocks del adaptador:

```sh
DSH_SOURCE=/ruta/deepseek-harness npm run test:host
```

La prueba resuelve los módulos del host mediante sus propios paths de TypeScript y usa pi-ai instalado en el plugin. No inicia Desktop ni consume cuota. Las APIs alpha posteriores que hayan cambiado los paths o el adaptador deben investigarse, no declararse compatibles por el número de versión.

### Regresión de subagentes

Probar 1, 2, 4 y 8 hijos con la misma herramienta de delegación, finalizaciones fuera de orden y continuación del padre. Cancelar un hijo en cola y otro transmitiendo: sus hermanos deben terminar. Probar `spawn` y `fork` si están disponibles. El evento `request-admitted` mide la espera inicial (cola, compatibilidad y autenticación). Los escenarios 429, renovación compartida, presupuesto y timeout se reproducen con respuestas simuladas.

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

El switch controla logs del transporte de inferencia y del catálogo de modelos, no los logs generales del host ni las peticiones independientes de cuotas, búsqueda o OAuth. La última actividad estadística funciona siempre. El informe excluye `finishMessage`, que puede contener datos privados; herramienta y ubicación del esquema pueden revelar nombres propios del proyecto, por lo que debe revisarse antes de compartirlo.

## Catálogo dinámico y variantes

1. Comprobar una entrada por modelo/versión, sin Low/Medium/High separados en el listado.
2. Elegir dos esfuerzos disponibles y enviar solicitudes. Con logs activados, verificar `model-resolved`, `effort` y `wireModel`: cambiar el esfuerzo debe cambiar la ruta/configuración, no solo la interfaz.
3. Comprobar que Pro con solo Low/High no ofrece Medium. Para una ruta base sin niveles anunciados, no inventar un menú de variantes.
4. Cambiar de cuenta y verificar fecha/origen y catálogo correspondiente, sin reapariciones del catálogo anterior por respuestas tardías.
5. Probar **Actualizar modelos**; comprobar el resultado real y el contador de entradas incompatibles. Esperar un refresco periódico de 15 minutos sin reconectar.
6. Reiniciar con caché válida y un fallo de red; comprobar que se informa el respaldo. No usarlo después de 24 horas ni después de retirar autorización/cuenta.
7. Verificar una selección antigua con sufijo: sigue resolviéndose si Google ofrece la ruta, pero no crea un duplicado en el listado. Volver a elegir el modelo base para cambiar libremente de esfuerzo.
8. Validar retirada de modelos, descubrimiento de nuevas versiones y rotación entre cuentas con respuestas simuladas, sin provocar agotamiento real de cuota.

Las pruebas automatizadas cubren nuevas versiones ficticias, agrupación, alias, límites incompletos, caché, invalidación, cancelación, respuestas tardías y selección por cuenta. La API interna puede cambiar sus metadatos; las pruebas no sustituyen comprobar el selector y las rutas contra DSH/Google reales.

## Limitaciones

### Regresión de `MALFORMED_FUNCTION_CALL`

Comparar `adapter-tools`, `request-start` y `request-built` con el mismo requestId. El primero cuenta las declaraciones recibidas del host; el segundo, las herramientas activas del transcript; el tercero, las declaraciones del envelope final. En pi-ai 1.x, las herramientas ya no llegan en `context.tools`: están en mensajes de sistema como `toolsAdded`/`toolsRemoved`. El plugin 0.2.2 recupera ese catálogo y el prompt con las utilidades oficiales. No promociona herramientas diferidas por su cuenta. Si DSH ya entrega cero herramientas, revisar la presentación/habilitación del agente. `mode=NONE` solo se usa con un catálogo efectivo vacío.

Prueba real realizada con Gemini 3.8 Flash High: una llamada a `list_directory_files` declarada sobre un directorio sintético, sin ejecutar su contenido, seguida de una continuación con resultado sintético. Ambas finalizaron correctamente. La consulta real del catálogo devolvió 1 048 576 de contexto y 65 536 de salida. Falta verificar el catálogo completo del agente desde la interfaz de DSH Desktop.

Tras instalar 0.2.2, reiniciar DSH, pulsar **Actualizar modelos** y comprobar el detalle de capacidades. La caché v1 se invalida, no se reinterpreta como metadatos confirmados. Una capacidad ausente debe mostrarse como desconocida/respaldo y no rebajar valores conocidos de otras variantes.

En sesiones nuevas con `gemini-3.8-flash` y effort High, si están disponibles, repetir el mismo prompt con herramientas básicas, con cada MCP por separado y con el catálogo completo. Verificar una llamada válida, su resultado y una segunda llamada en la misma conversación. Repetir con Claude si está disponible.

El error de generación conserva el `finishMessage` del backend cuando existe; puede contener argumentos generados, por lo que debe revisarse y redactarse antes de compartirlo. Las estadísticas solo guardan modelo, motivo, tipo de diagnóstico y cantidad de herramientas, no ese mensaje ni el esquema.

La conversión usa `parameters` del protocolo interno: transforma `oneOf` en `anyOf` (sin exclusividad), convierte uniones con `null` a `nullable` y resuelve referencias JSON Pointer locales. Referencias externas o recursivas y composiciones como `allOf` producen un error previo al envío con la herramienta y ubicación afectadas. No se eliminan herramientas ni se reintenta una generación mal formada automáticamente.

Un catálogo sintético de 135 herramientas verifica la conversión en tests; no prueba límites del backend ni confirma que un error de generación concreto esté resuelto en Google.

- El servicio Google usado es interno y puede cambiar sin aviso.
- La disponibilidad de modelos depende de cuenta y cuota. Las familias aún no compatibles se contabilizan, pero no se publican; no existe una lista cerrada de versiones.
- Las tres herramientas se registran mediante `@deepseek-ai/dsh-tools`. Su disponibilidad para un agente depende de sus políticas y del modo de presentación del host (nativo o ejecución de código).
- Las estadísticas son de la instancia actual y se reinician al recargar el plugin.
