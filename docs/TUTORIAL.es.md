# Google Antigravity en DeepSeek Harness

Guía de instalación y primeros pasos para `dsh-agy`. El objetivo de compatibilidad actual es **DSH 0.2.1-alpha.2**; las pruebas locales no sustituyen la validación en Desktop.

## 1. Requisitos

- DeepSeek Harness instalado.
- Una cuenta Google con acceso a Antigravity. Los modelos y límites dependen de esa cuenta.
- Acceso a Internet y un navegador para autorizar Google.
- Si DSH informa que no encuentra `pnpm`, instala ese gestor siguiendo sus instrucciones oficiales y reinicia DSH.

No necesitas copiar tokens de OpenCode ni configurar una clave de API de Google.

## 2. Instalar en Desktop

1. Abre **Plugins → Añadir plugin** en DeepSeek Harness Desktop.
2. En el campo de paquete o dirección introduce `https://github.com/jjjjose/dsh-agy`. Para probar cambios locales aún no publicados, utiliza la carpeta local. En este equipo:

   ```text
   /Users/ign/Documents/projects/dsh-agy
   ```

3. Espera a que finalice la instalación.
4. **Cierra completamente DSH y vuelve a abrirlo.** Refrescar la vista no recarga necesariamente el servidor del plugin.
5. Abre la ficha **Google Antigravity**.

La carpeta incluye `package.json`, `cordis.patch.yml` y los bundles compilados `lib/index.js` y `lib/client.js`. Instala la raíz del paquete, no `src/` ni `lib/`.

Una instalación por ruta local puede quedar enlazada a esa carpeta: no la muevas ni borres mientras la utilices. No uses comandos CLI para modificar el perfil `desktop`, que administra la aplicación.

**Distribución:** el repositorio oficial es [jjjjose/dsh-agy](https://github.com/jjjjose/dsh-agy). La instalación desde GitHub solo incluye cambios ya publicados allí. No se ha confirmado una publicación npm; no presupongas que instalar por nombre descarga este mismo paquete.

## 3. Conectar Google

1. En la ficha del plugin, pulsa **Conectar con Google**.
2. Completa la autorización en el navegador y elige la cuenta que tiene acceso a Antigravity.
3. Si no se abre el navegador, utiliza el enlace alternativo mostrado por el plugin.
4. Espera a que la cuenta aparezca conectada en la ficha.

El callback es local y usa el puerto `51121`. Haz la autorización en el mismo equipo que ejecuta DSH. No compartas la URL de autorización o callback. Puedes cancelar la autorización desde el plugin y volver a intentarlo.

## 4. Elegir modelo y comprobar herramientas

1. Abre una conversación y selecciona el proveedor **Google Antigravity**.
2. Elige un modelo disponible para tu cuenta.
3. Envía primero un mensaje corto, por ejemplo «Hola».
4. Después pregunta «¿Qué archivos hay en este proyecto?». Comprueba que aparecen llamadas a herramientas como `working_directory` o `glob`, sus resultados y una respuesta final.
5. Continúa la conversación para comprobar que el historial de herramientas funciona.

Que un modelo aparezca en el catálogo de respaldo no garantiza que Google permita usarlo. Usa **Actualizar modelos** para consultar el catálogo de tu cuenta. La identidad que el modelo diga tener en su texto no es una verificación independiente del modelo servido.

## 5. Cuentas, cuotas y actividad

- **Conectar otra cuenta:** repite el flujo de Google y selecciona una cuenta diferente.
- **Activar:** selecciona la cuenta preferida desde su fila.
- **Eliminar:** retira una cuenta de este plugin.
- **Desconectar todas:** retira todas las cuentas gestionadas por el plugin.
- **Consultar cuotas:** consulta los límites comunicados por Google. Cuando están disponibles, se conservan las ventanas de cinco horas y semanal por separado; un resultado alternativo por modelo no equivale a ambas ventanas.
- **Consultar actividad:** muestra solicitudes completadas, límites y errores de esta instancia. Se reinicia al recargar el plugin.

Las cuentas no disponibles no deben usarse como respaldo indiscriminado. Si todas están limitadas, espera a que se recupere cuota; no añadas cuentas solo para eludir restricciones del servicio.

## 6. Herramientas del agente

El plugin registra `antigravity_quota`, `antigravity_stats` y `google_search` en DSH. Su visibilidad depende de las políticas del agente y del modo de herramientas del host.

Ejemplos:

- «Consulta la cuota de Antigravity».
- «Muestra las estadísticas de Antigravity».
- «Busca documentación oficial sobre TypeScript y cita las fuentes».

`google_search` usa una petición separada a Google y puede consumir cuota. No sustituye automáticamente el proveedor de `web_search` de DSH ni modifica sus credenciales.

## 7. Actualizar una instalación local

La instalación local ejecuta los archivos de `lib/`, no TypeScript directamente. Si recibes cambios en el código fuente, construye desde la raíz:

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
npm run smoke
```

Después reinicia DSH. Si DSH instaló una copia en lugar de un enlace, vuelve a instalar la carpeta actualizada desde Plugins. No borres las cuentas para actualizar el código.

Si recibes la carpeta con `lib/` ya regenerado, no necesitas compilarla para instalar. La disponibilidad y condiciones de la actualización automática se documentan en la guía de instalación; no confundas actualizar el catálogo de modelos con actualizar el código del plugin.

## 8. Solución de problemas

| Problema | Qué comprobar |
| --- | --- |
| Incompatible con DSH | Verifica versión del host y dependencias declaradas. No ignores la advertencia ni elimines restricciones para forzar la carga. |
| No aparece la página o el botón | Instala la raíz del paquete y reinicia completamente DSH. Comprueba que lo instalaste en la aplicación/perfil que estás usando. |
| No se abre Google | Usa el enlace alternativo; comprueba el bloqueo de ventanas del navegador. |
| Puerto `51121` ocupado | Cancela otros intentos de autorización y cierra el proceso de login anterior antes de reintentar. |
| Autorización agotada o revocada | Repite la conexión. Si la cuenta quedó revocada, elimínala del plugin y autorízala de nuevo. |
| No aparecen modelos | Comprueba el estado conectado y pulsa Actualizar modelos; verifica acceso de la cuenta, red y región. |
| `PI_AI_ERROR` | Es genérico: repite el caso y abre Consultar actividad. Copia «Último fallo» si aparece, el modelo y el prompt mínimo que lo reproduce. |
| Responde texto pero falla al explorar archivos | Prueba el flujo de herramientas tras instalar los bundles más recientes. Un éxito de texto no valida llamadas de herramientas. |
| Funciona Codex pero no Antigravity | Acota el fallo al proveedor o su conversión; no implica por sí solo que la cuenta Google o el motor DSH estén dañados. |
| Cuota agotada | Consulta la ventana y su reinicio. Evita repetir peticiones que consuman cuota innecesariamente. |
| Tras actualizar sigue igual | Comprueba qué carpeta instalaste, que sus bundles estén actualizados y que reiniciaste DSH. |

## 9. Informar un fallo

Incluye versión de DSH, sistema operativo, forma de instalación, modelo, último diagnóstico y pasos mínimos. Indica si ocurre en una conversación nueva o solo con historial, y si falla texto, herramientas o ambos.

Un archivo de sesión puede contener prompts, rutas y contenido privado. Comparte solo los eventos necesarios y elimina datos sensibles. Nunca publiques `accounts.json`, tokens, cabeceras Authorization ni URLs completas de OAuth.

## 10. Desinstalar y gestionar datos

Para dejar de usar el plugin, desinstálalo desde **Plugins** y reinicia DSH. Si también quieres desconectar las cuentas, usa **Desconectar todas** antes de desinstalar. Desinstalar el paquete no debe interpretarse como borrado garantizado de sus datos.

El almacenamiento del plugin vive en `$DSH_HOME/dsh-agy/`, por defecto `~/.dsh/dsh-agy/`. No modifica automáticamente tokens de OpenCode ni la configuración de otros proveedores. No borres todo `~/.dsh`: contiene también sesiones y ajustes de DSH.

## Más documentación

- [Instalación y actualización](INSTALL.md)
- [Lista de validación en DSH real](VALIDATION.md)
- [Arquitectura del plugin](ARCHITECTURE.md)
