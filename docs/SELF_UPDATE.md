# Package self-update

This updates **dsh-agy itself**, not the available model catalog. The catalog's
`refresh-models` action remains separate. No credentials or account files are replaced.

## Defaults and trusted source

Self-update defaults to disabled, with **no registry configured** and no network
traffic. The package does not declare a published release source. Its GitHub remote
is not proof of an npm release, so the plugin does not guess a registry/release,
download another plugin, or fall back to a GitHub archive.

Only configure an HTTPS npm registry origin after verifying that its `dsh-agy`
package is controlled by the intended publisher. Choosing a registry grants it
permission to supply executable code. SHA512 verifies consistency with registry
metadata, not publisher authenticity. Redirects and cross-origin tarballs are
rejected. Registry authentication and path-based registries are unsupported.

Deployment options in the plugin configuration:

- `autoUpdateEnabled`: false by default.
- `autoUpdateIntervalMs`: 21600000 (six hours); range 60000–604800000.
- `updateRegistryOrigin`: empty by default; HTTPS origin only.

The settings page can save mode, interval and origin. These overrides persist in
`$DSH_HOME/dsh-agy/update-config.json` (default `~/.dsh/dsh-agy`), atomically, with
mode 0600. Persisted overrides take precedence over deployment defaults. Reads do
not create the file. Invalid persisted configuration falls back to deployment
defaults. Opening update settings pauses automatic installation for that process;
the saved automatic mode resumes on the next Harness start. The first automatic
check occurs after the configured interval, not immediately on startup.

## RPC contract

All routes use the existing Harness `connection.requestRejection` trust gate and
return JSON with `Cache-Control: no-store`:

| Method | Route under `/_dsh/dsh-agy` | Body / behavior |
| --- | --- | --- |
| GET | `/update/status` | No network; pauses automatic installation for this process. |
| POST | `/update/check` | Checks metadata only; never downloads/install payload. |
| POST | `/update/config` | Partial `{ enabled, intervalMs, registryOrigin }`; validates and persists. |
| POST | `/update/install` | Requires `{ "confirm": true }`; explicit manual installation even when automatic mode is off. |

All successful calls return the same status shape: configuration fields plus
`runningVersion`, `diskVersion`, `latest`, `available`, `pendingRestart`,
`configured`, `installAllowed`, `pausedForSettings`, `lastCheckAt`, `lastError`.
Operation failures appear as `lastError` in that shape; invalid input is HTTP 400.
Status/check timestamps are session-local; only configuration persists.

## Installation safety and limits

Installation is permitted only in a real package directory under the Harness
`profiles` root, matching the reference plugin's guard. Development copies cannot
self-install, but can check a configured source. Package identity must be
`dsh-agy`; only strictly newer stable `x.y.z` versions are accepted. npm metadata
must include SHA512 integrity and a same-origin tarball. Metadata is limited to
1 MiB, downloads to 8 MiB, decompression to 32 MiB, each request to 60 seconds.

Archives must contain the host/client bundles, manifest and Cordis patch. Only the
current package's explicitly distributed files are writable. Traversal, duplicate
paths, links, nonstandard TAR extensions (including PAX/GNU), invalid checksums,
symlink targets and mismatched package identity/version are rejected before writes.
Dependencies and peer dependencies must remain unchanged; updates requiring new
dependencies need manual installation. No shell, npm commands or lifecycle scripts
are executed. Some otherwise valid npm archives therefore require manual install.

An exclusive `update.lock` serializes package writes across processes; unique backup
directories in the plugin state directory retain replaced files. Replacement uses
per-file atomic rename (manifest last), rechecks package identity/version under
the lock to prevent racing downgrades, and restores original files on caught write failures. The
whole package is **not** crash-atomic: a process kill/power failure may require
manual recovery from the backup. A stale lock after a crash must be removed only
after verifying no updater is running. There is no automatic restart, automatic
rollback after restarting, or backup pruning. Restart Harness after installation.
Do not run several Harness processes updating the same package with different
`DSH_HOME` values.
