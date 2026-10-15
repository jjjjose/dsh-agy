# dsh-agy — Google Antigravity para DeepSeek Harness

**Google Antigravity (Cloud Code Assist) LLM provider plugin for [DeepSeek Harness](https://github.com/deepseek-ai).**

Sign in with your Google account and use the models from your **Antigravity Coding Plan** — Gemini, Claude, and GPT-OSS — as a first-class provider inside DeepSeek Harness (Desktop or Web UI). Works on **Windows, macOS, and Linux** with zero manual OAuth setup: the Google application identity is embedded, so you never have to create your own client or edit a config file.

> Status: developer preview. It talks to Google's internal Cloud Code Assist endpoints, exactly like the Antigravity IDE does.

---

## Features

- **One-click Google login** — OAuth (PKCE) through a localhost callback; no client id/secret to configure.
- **Multi-account + rotation** — add several Google accounts; requests rotate automatically using health scoring, a token bucket, and sticky selection. Rate-limited (429) accounts cool down and the request retries on the next account.
- **Streaming inference** — native `v1internal:streamGenerateContent?alt=sse` transport that surfaces text, thinking, and tool-call blocks, preserving Gemini thought signatures.
- **Dynamic model catalog** — discover compatible new versions from your account's `fetchAvailableModels`, with one entry per model and variants chosen via the Harness effort selector. Refreshes every 15 minutes.
- **Quota view** — see your dual-window (5h + weekly) usage per account from the plugin settings page.
- **Settings UI** — a plugin page inside the Harness plugin manager to sign in, switch/remove accounts, and check quota.
- **Windows-first** — no dependence on a macOS `.app` bundle; headers identify the real host platform.

## Install

### Requisitos

- **DeepSeek Harness 0.2.1-alpha.2 o una versión superior compatible**. Las dependencias admiten versiones posteriores; el adaptador comprueba la API de snapshots al cargar. Las APIs alpha pueden cambiar: consulta la matriz de validación antes de actualizar.
- El host debe proporcionar **`@earendil-works/pi-ai` 1.x** (validado con 1.0.2); el transporte consume su formato de transcript, no los campos antiguos de contexto.
- Cuenta Google con acceso a **Antigravity** e Internet para autorizarla.
- `pnpm` disponible para el instalador de plugins de DSH. Si el instalador no lo encuentra, instala pnpm siguiendo su documentación y reinicia DSH.

No necesitas una API key, copiar tokens de OpenCode ni crear un cliente OAuth propio. La disponibilidad de modelos depende de tu cuenta. Estado: **developer preview**; la compatibilidad de ejecución se debe comprobar en tu DSH.

### DeepSeek Harness Desktop — recomendado

1. Abre **Plugins → Añadir plugin / Add plugin**.
2. Introduce la dirección del repositorio:

   ```text
   https://github.com/jjjjose/dsh-agy
   ```

   Para probar cambios locales aún no publicados en GitHub, introduce la **ruta absoluta de la carpeta raíz**, no `src/` ni `lib/`. En este equipo:

   ```text
   /Users/ign/Documents/projects/dsh-agy
   ```

3. Espera a que termine la instalación.
4. **Cierra completamente DSH y vuelve a abrirlo**. Refrescar la página no basta para recargar el servidor del plugin.
5. Abre **Plugins → Google Antigravity** y pulsa **Conectar con Google**.
6. Autoriza la cuenta en el navegador. Si no se abre, utiliza el enlace alternativo mostrado en el plugin.
7. Cuando la cuenta aparezca conectada, selecciona **Google Antigravity** y un modelo en el selector de la conversación.

Los bundles de `lib/` se incluyen en el paquete: **no necesitas compilar para instalar una copia ya construida**. Una instalación por carpeta puede quedar enlazada a ella; no la muevas ni borres mientras la uses.

**Repositorio oficial:** [jjjjose/dsh-agy](https://github.com/jjjjose/dsh-agy). La instalación desde GitHub usa lo que esté publicado allí, no los cambios pendientes de tu copia local. No se ha confirmado una publicación npm: no instales por nombre hasta verificarla.

### Web / CLI — no usar para el perfil Desktop

Si ya tienes el comando `dsh`, instala en el mismo perfil que utilizas para Web. Sustituye la ruta por la de tu copia:

```sh
dsh plugin --profile web add https://github.com/jjjjose/dsh-agy
```

Reinicia el proceso DSH de ese perfil. También puedes usar **Plugins → Añadir plugin** desde su interfaz Web.

El perfil `desktop` lo administra la aplicación: **instala y desinstala desde Desktop, no con `dsh plugin --profile desktop`**. Los comandos anteriores no instalan DSH ni publican el paquete.

Para desarrollo o instalación por copia local:

```sh
git clone https://github.com/jjjjose/dsh-agy.git
cd dsh-agy
```

Instala esa carpeta desde Desktop, o pasa su ruta absoluta a `dsh plugin --profile web add`. No requiere compilación si el repositorio incluye los bundles actualizados.

### Primera prueba: texto y herramientas

1. Envía «Hola» y comprueba la respuesta incremental.
2. Pregunta «¿Qué archivos hay en este proyecto?» y comprueba llamadas como `working_directory` o `glob`, resultados y respuesta final.
3. Continúa la conversación para verificar el historial de herramientas.

Una respuesta de texto correcta no demuestra que las herramientas funcionen. [Lista completa de validación](docs/VALIDATION.md).

### Cuentas y herramientas del agente

En la ficha del plugin puedes conectar otra cuenta, activar una cuenta, eliminarla o **Desconectar todas**. También encontrarás **Consultar cuotas**, **Actualizar modelos** y **Consultar actividad**.

| Herramienta registrada | Uso |
| --- | --- |
| `antigravity_quota` | Consultar límites de Google; ventanas de cinco horas y semanal cuando el servicio las informa. |
| `antigravity_stats` | Consultar actividad de la instancia actual, sin tokens. |
| `google_search` | Buscar y analizar URLs mediante una petición independiente a Google, con fuentes. |

Ejemplos: «Consulta la cuota de Antigravity» o «Busca la documentación oficial de TypeScript y cita las fuentes». DSH decide la exposición según la política y modo de herramientas del agente. El plugin **no cambia tu agente predeterminado ni sustituye automáticamente `web_search`**; búsqueda y generación pueden consumir cuota.

### Logs de diagnóstico

En **Plugins → Google Antigravity**, activa **Activar logs de diagnóstico**, reproduce el problema y pulsa **Copiar logs**. El panel se actualiza cada tres segundos mientras el registro esté activado y la página esté abierta. **Limpiar** vacía el historial; **Actualizar** permite consultarlo manualmente incluso con el registro apagado.

El informe contiene hora, `requestId`, modelo, effort, ruta real resuelta, cantidad de herramientas, estados HTTP, reintentos/rotaciones, duración, etapa del fallo y `finishReason`. También registra actualización y respaldo del catálogo. Los errores de conversión incluyen herramienta y ubicación del esquema. No contiene tokens, cabeceras, prompts, argumentos, respuestas ni `finishMessage`. Los nombres de herramientas y campos del esquema pueden ser propios de tu proyecto: revisa el informe antes de compartirlo.

El registro está desactivado por defecto y guarda como máximo **200 entradas en memoria**. Apagarlo detiene la captura sin borrar el historial. La preferencia se guarda en `diagnostics-config.json` dentro del directorio de estado del plugin (`DSH_HOME/dsh-agy`, o `~/.dsh/dsh-agy`); las entradas nunca se guardan en disco y se pierden al recargar el plugin. Las estadísticas de **Consultar actividad** funcionan independientemente del switch.

Si el navegador no permite copiar, el panel selecciona el informe para copiarlo manualmente. Tras instalar los cambios, reinicia completamente DSH.

### Actualización y reinstalación

**Actualizar modelos** actualiza el catálogo, no el código del plugin. Para la actualización automática configurable del paquete, consulta [configuración y límites de seguridad](docs/SELF_UPDATE.md). No configura por sí sola un origen de publicación confiable ni implica que ya exista una versión descargable.

Si actualizas el código fuente de una copia local, ejecuta desde su raíz:

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
npm run smoke
```

Reinicia DSH después. Si instaló una copia en vez de un enlace, reinstala la carpeta actualizada. No borres las cuentas para actualizar el código.

### Desinstalar

En Desktop, desinstala desde **Plugins** y reinicia DSH. Para retirar también las cuentas gestionadas, pulsa **Desconectar todas** antes de desinstalar. Desinstalar no garantiza borrar los datos persistentes.

Solo para el perfil CLI/Web:

```sh
dsh plugin --profile web remove dsh-agy
```

### Errores frecuentes

| Síntoma | Qué hacer |
| --- | --- |
| Incompatible con DSH | Comprueba versión del host y del paquete; no ignores la advertencia para forzar la carga. |
| No aparece el botón | Instala la raíz del paquete y reinicia completamente DSH; comprueba aplicación/perfil. |
| Google no se abre | Usa el enlace alternativo y verifica el bloqueo de ventanas. |
| Callback `51121` ocupado | Cancela otros intentos de autorización antes de reintentar. |
| Cuenta revocada | Elimínala del plugin y vuelve a autorizarla. |
| Faltan modelos | Comprueba la conexión y pulsa Actualizar modelos; revisa acceso de la cuenta y red. |
| `PI_AI_ERROR` | Activa los logs de diagnóstico, reproduce el fallo y pulsa Copiar logs; incluye modelo y pasos mínimos. Consultar actividad también muestra el último fallo. |
| Texto funciona, herramientas fallan | Comprueba que instalaste los bundles más recientes y reproduce una llamada de herramientas. |
| Tras actualizar sigue igual | Verifica carpeta instalada, bundles regenerados y reinicio de DSH. |

Para reportar errores, incluye versión de DSH, sistema operativo y forma de instalación. **No compartas tokens, `accounts.json`, cabeceras Authorization ni URLs completas de OAuth.** Los archivos de sesión pueden incluir prompts, rutas y datos privados.

Más detalles: [tutorial en español](docs/TUTORIAL.es.md), [instalación](docs/INSTALL.md) y [validación](docs/VALIDATION.md).

### Modelos dinámicos y effort

**Gemini 4 Argon:** el parser reconoce IDs versionados y alias Gemini con nombre `Gemini 4 Argon`; conserva la ruta, los esfuerzos y los límites anunciados por Google. La página muestra motivos de exclusión para hasta 100 entradas de la última consulta. Esto no añade modelos que Google no haya devuelto. Según la [documentación oficial](https://antigravity.google/docs/models), Argon requiere Ultra o Enterprise elegible y no está disponible en el antiguo Antigravity IDE. La disponibilidad a través del transporte interno de este plugin debe verificarse con la cuenta; reconocer el catálogo no demuestra acceso a inferencia.

El selector muestra una sola entrada por versión: por ejemplo **Gemini 3.8 Flash**, **Gemini 3.1 Pro**, **Claude Sonnet 4.6** o **GPT-OSS 120B**. No hay una lista cerrada de versiones: se incorporan las nuevas versiones compatibles anunciadas por Google y se retiran las ausentes después de una actualización válida.

Selecciona Low, Medium o High —solo los disponibles— desde **effort** en la conversación. El plugin traduce modelo + effort al ID de inferencia real. En Claude, las rutas de razonamiento utilizan presupuestos de tokens limitados por el máximo de salida. Si existe una ruta Off, es también la predeterminada: DSH representa Off omitiendo `reasoning`. En modelos sin Off se prefiere Medium, después High y luego los demás niveles disponibles. No se sustituye silenciosamente un modelo ni se reduce el effort al rotar cuentas.

El catálogo se consulta al iniciar, al cambiar de cuenta, cada **15 minutos** y mediante **Actualizar modelos**. La página informa origen (Google/caché), fecha, cantidad de modelos/variantes y entradas no compatibles. El refresco usa credenciales de la cuenta sin consumir el presupuesto local de solicitudes de inferencia.

Una caché por cuenta/proyecto en `$DSH_HOME/dsh-agy/model-catalogs/` permite respaldo ante errores de red durante un máximo de **24 horas**. Solo guarda metadatos normalizados, no credenciales ni la respuesta completa de Google. Errores de autorización en el descubrimiento y cuentas desconectadas/revocadas invalidan el respaldo correspondiente. Una respuesta válida sin modelos compatibles deja el catálogo vacío; no resucita modelos retirados.

Los IDs antiguos con sufijos siguen resolviéndose internamente si su ruta continúa disponible, pero están ocultos en el listado. Para cambiar de variante en una conversación antigua, vuelve a seleccionar la entrada base del modelo. No se modifican sesiones guardadas.

**Capacidades dinámicas:** `fetchAvailableModels` informa `maxTokens` como contexto y `maxOutputTokens` como salida. Consulta real de Gemini 3.8 Flash: **1 048 576 de contexto y 65 536 de salida**. La página muestra esos límites por variante y su origen (Google/caché/respaldo). No se necesita una lista fija de versiones ni otra consulta por modelo para esos campos.

**Metadatos incompletos:** no se inventan esfuerzos Gemini a partir de un simple `supportsThinking`; se usan variantes explícitas, niveles declarados o la ruta compartida conocida. Sin niveles declarados, una ruta base conserva el comportamiento predeterminado del backend. Se conservan datos confirmados de la misma cuenta/ruta hasta 24 horas desde su verificación original. Si siguen sin existir, los valores operativos 32 768/8 192 se etiquetan como **desconocidos/respaldo**, no como límites anunciados. Una variante sin metadatos no reduce los límites conocidos de las otras. Si difieren, DSH muestra el menor límite conocido del grupo y la solicitud aplica el de su ruta; el host no cambia la ventana del selector al elegir effort. Las imágenes solo se anuncian cuando Google declara su soporte. Las familias o modalidades todavía no compatibles no se publican y se contabilizan en la página.

La caché v1 se invalida automáticamente: sus valores sintetizados no se reutilizan como capacidades confirmadas. Después de actualizar a 0.2.2, pulsa **Actualizar modelos** para reconstruirla.

## How it works

DeepSeek Harness lets plugins register custom LLM providers through its `llm` service. This plugin registers a **pi-ai adapter** whose transport is Google's Cloud Code Assist API, plus an OAuth login flow stored in the Harness credential store. The account pool lives in a plugin-owned file, and the active account is mirrored into the credential service.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the module layout and data flow.

## Configuration

The plugin works with defaults. Advanced options (set in your profile's plugin config) are credential **references**, never secret values:

| Key | Default | Purpose |
| --- | --- | --- |
| `oauthCredentialEnv` | `GOOGLE_ANTIGRAVITY_OAUTH_CREDENTIAL` | Credential reference that mirrors the active account. |
| `oauthClientConfigRef` | `GOOGLE_ANTIGRAVITY_OAUTH_CLIENT_CONFIG` | Optional override: a JSON `{ clientId, clientSecret }` stored here replaces the embedded Google client. |
| `displayName` | `Google Antigravity` | Provider display name. |
| `streamIdleTimeoutMs` | `300000` | Idle timeout for a streaming response. |
| `maxConcurrentRequests` | `4` | Máximo de generaciones simultáneas por instancia del plugin; las demás esperan en orden FIFO. |
| `requestQueueTimeoutMs` | `60000` | Máxima espera de admisión, autenticación y presupuesto inicial. Cancelar un subagente retira su espera sin cancelar renovaciones OAuth compartidas. |
| `maxRequestImageBytes` / `requestImagePixelBudget` / `requestImageMaxBytes` | see defaults | Image request budgets. |

Account tokens are stored only on this device, under `$DSH_HOME/dsh-agy/accounts.json` (default `~/.dsh/dsh-agy/`), with `0600` permissions.

## Security notes

- Tokens never leave your machine except to call Google's endpoints.
- The settings RPC is gated by the Harness trust boundary (`connection.requestRejection`) and never returns token values — only account metadata and login state.
- The embedded Google client is public application identity (as shipped in the Antigravity IDE). A deployment can override it via the `oauthClientConfigRef` credential.

## Development

```bash
npm install            # legacy-peer-deps via .npmrc; @deepseek-ai/* are host-provided
npm run typecheck      # tsc --noEmit for host + client
npm test               # vitest unit tests (pure logic: auth, rotation, models, transport, storage)
npm run build          # esbuild -> lib/index.js (ESM) + lib/client.js (wrapped client bundle)
npm run smoke          # structural check that lib/ is loadable by the Harness
```

`lib/` is committed so end users install with zero build. Re-run `npm run build && npm run smoke` after changing `src/`.

## Limitations & risks

- **Internal API**: relies on Google's `v1internal` Cloud Code Assist endpoints, which can change without notice.
- **Embedded client**: Google may rotate or revoke the embedded OAuth client; set the `oauthClientConfigRef` override if that happens.
- **Model-callable tools**: `antigravity_quota`, `antigravity_stats` and `google_search` are registered with the official DSH `tools` service. Quota and runtime activity also appear in the settings UI. Search has an authenticated RPC (`POST /_dsh/dsh-agy/search`). Tool visibility depends on the agent's tool policy and the host presentation mode.
- **Version drift**: the plugin builds against the Harness `@deepseek-ai/*` API surface used by the reference plugins; if your DSH version changes those shapes, update `types/dsh-modules.d.ts` and re-run `npm run typecheck`.



## License

Historial de versiones: [CHANGELOG.md](CHANGELOG.md).

[MIT](./LICENSE)
# Package self-update

Optional automatic **plugin** updates are disabled until a trusted npm HTTPS
registry origin is explicitly configured. The settings page provides status,
check-only, confirmed installation, and persistent mode/interval controls.
See [self-update configuration and safety limits](docs/SELF_UPDATE.md).
