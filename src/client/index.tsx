/**
 * Plugin settings page (client half). Registers into the Harness
 * `plugins.bundle.config` slot and talks to the host over HTTP RPC at
 * `/_dsh/dsh-agy/*`. Classic JSX so the bundle only needs `require('react')`.
 */
import * as React from 'react'
import type { UpdateStatus } from '../self-update.ts'

interface SlotsService {
  inject(name: string, factory: () => unknown): () => void
  register(descriptor: { name: string; key: string; label: () => string }, component: unknown): () => void
}

interface ClientContext {
  slots?: SlotsService
  effect?: <T>(fn: () => T | (() => void), key?: string) => T
  get?: <T>(name: string) => T | undefined
}

type AccountView = {
  id: string
  email?: string
  enabled: boolean
  active: boolean
  rateLimited: boolean
  coolingDown: boolean
}
type LoginStatus =
  | { kind: 'pending' }
  | { kind: 'succeeded'; email?: string }
  | { kind: 'failed'; message: string }
  | { kind: 'cancelled' }

const PREFIX = '/_dsh/dsh-agy'
const MUTATING = new Set(['login', 'logout', 'activate', 'cancel-login', 'refresh-models', 'update/check', 'update/install', 'update/config'])

async function rpc<T>(method: string, args?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const query = !MUTATING.has(method) && args ? `?${new URLSearchParams(Object.entries(args).map(([key, value]) => [key, String(value)]))}` : ''
  const url = `${PREFIX}/${method}${query}`
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) controller.abort()
  const timeout = window.setTimeout(() => controller.abort(), method.startsWith('update/') ? 150000 : method === 'quota' ? 60000 : 15000)
  const mutating = MUTATING.has(method)
  try {
    const response = await fetch(url, {
    method: mutating ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json' },
    body: mutating ? JSON.stringify(args ?? {}) : undefined,
    signal: controller.signal,
      cache: 'no-store',
    })
    const body = await response.json() as T & { error?: string }
    if (!response.ok) {
      if (response.status === 404 && method.startsWith('update/')) {
        throw new Error('El servidor no reconoce la ruta de actualización (HTTP 404). Cierra completamente DeepSeek Harness y vuelve a abrirlo. Si persiste, reinstala dsh-agy desde la carpeta actualizada: la interfaz y el servidor pueden ser de versiones diferentes.')
      }
      throw new Error(body.error || `HTTP ${response.status}`)
    }
    return body
  } finally {
    window.clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}

function Row(props: { title: string; desc?: React.ReactNode; controls?: React.ReactNode }): React.ReactElement {
  return (
    <div className="agy-row">
      <div className="agy-rowText">
        <div className="agy-rowTitle">{props.title}</div>
        {props.desc ? <div className="agy-rowDesc">{props.desc}</div> : null}
      </div>
      {props.controls ? <div className="agy-controls">{props.controls}</div> : null}
    </div>
  )
}

function Button(props: { onClick?: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }): React.ReactElement {
  const cls = 'agy-btn' + (props.danger ? ' agy-btn--danger' : '')
  return (
    <button type="button" className={cls} disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  )
}

function installStyles(): void {
  if (document.querySelector('style[data-plugin-css="dsh-agy"]')) return
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-agy'
  style.dataset.pluginCss = 'dsh-agy'
  style.textContent = `
    .agy-page { display: flex; flex-direction: column; width: 100%; max-width: 100%; gap: 12px; color: var(--dsw-alias-label-primary); }
    .agy-page, .agy-page * { box-sizing: border-box; }
    .agy-list { display: flex; flex-direction: column; width: 100%; }
    .agy-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; width: 100%; padding: 12px 2px; border-bottom: 0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.16)); }
    .agy-row:last-child { border-bottom: 0; }
    .agy-row:first-child { padding-top: 0; }
    .agy-rowText { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .agy-rowTitle { font-size: 13.5px; font-weight: 500; line-height: 20px; color: var(--dsw-alias-label-primary); }
    .agy-rowDesc { font-size: 11.5px; line-height: 16px; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }
    .agy-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-left: auto; }
    .agy-btn { appearance: none; font: inherit; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; height: 28px; border: 0.5px solid var(--dsw-alias-border-l3); color: var(--dsw-alias-label-primary); background: transparent; border-radius: 14px; padding: 0 10px; font-size: 12px; }
    .agy-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.08)); }
    .agy-btn:disabled { opacity: 0.4; cursor: default; }
    .agy-btn--danger { color: var(--dsw-alias-state-error-primary, #d92d20); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d92d20) 30%, transparent); }
    .agy-pill { display: inline-flex; align-items: center; gap: 6px; height: 28px; border-radius: 14px; padding: 0 10px; font-size: 12px; }
    .agy-pill--ok { color: var(--dsw-alias-state-success-primary, #087f5b); background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #087f5b) 10%, transparent); }
    .agy-pill--warn { color: var(--dsw-alias-state-error-primary, #d92d20); background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d92d20) 10%, transparent); }
    .agy-error { color: var(--dsw-alias-state-error-primary, #d92d20); font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
    .agy-note { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
    .agy-quota { width: 100%; margin: 0; font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--dsw-alias-label-secondary); }
    @media (max-width: 600px) { .agy-row { align-items: flex-start; } .agy-controls { margin-left: 0; } }
  `
  document.head.appendChild(style)
}

function AntigravityPage(): React.ReactElement {
  const [accounts, setAccounts] = React.useState<AccountView[] | null>(null)
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [quota, setQuota] = React.useState('')
  const [quotaLoading, setQuotaLoading] = React.useState(false)
  const [activity, setActivity] = React.useState('')
  const [authorizationUrl, setAuthorizationUrl] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const [actionBusy, setActionBusy] = React.useState(false)
  const loginRef = React.useRef<AbortController | null>(null)
  const loginIdRef = React.useRef<string | null>(null)
  const popupRef = React.useRef<Window | null>(null)
  const lifetimeRef = React.useRef<AbortController | null>(null)
  const loadingRef = React.useRef(false)
  const activeRef = React.useRef(true)

  const load = React.useCallback(async () => {
    if (loadingRef.current) return
    loadingRef.current = true
    try {
      const body = await rpc<{ accounts: AccountView[] }>('status', undefined, lifetimeRef.current?.signal)
      if (activeRef.current) setAccounts(body.accounts)
    } catch {
      if (activeRef.current) setError('No se pudo conectar con Harness. Comprueba la conexión y vuelve a intentarlo.')
    } finally {
      loadingRef.current = false
    }
  }, [])

  React.useEffect(() => {
    activeRef.current = true
    lifetimeRef.current = new AbortController()
    load()
    const timer = window.setInterval(load, 5000)
    return () => {
      activeRef.current = false
      window.clearInterval(timer)
      lifetimeRef.current?.abort()
      loginRef.current?.abort()
      popupRef.current?.close()
    }
  }, [load])

  const startLogin = React.useCallback(async () => {
    if (loginRef.current) return
    const controller = new AbortController()
    loginRef.current = controller
    // Open during the click, before any await, so browsers do not block OAuth.
    let popup: Window | null = null
    try {
      popup = window.open('about:blank', '_blank', 'popup,width=600,height=760')
      if (popup) { popup.opener = null; popup.document.title = 'Conectando con Google…' }
    } catch { popup?.close(); popup = null }
    popupRef.current = popup
    setBusy(true); setError(''); setNotice('Preparando la conexión con Google…'); setAuthorizationUrl('')
    let timedOut = false
    const deadline = window.setTimeout(() => { timedOut = true; controller.abort() }, 5 * 60 * 1000)
    try {
      const res = await rpc<{ loginId: string; authorizationUrl: string }>('login', undefined, controller.signal)
      loginIdRef.current = res.loginId
      if (controller.signal.aborted) return
      const url = new URL(res.authorizationUrl)
      if (!res.loginId || url.protocol !== 'https:') throw new Error('El servidor devolvió una autorización no válida.')
      setAuthorizationUrl(url.href)
      setNotice('Completa la autorización en Google. Si no se abrió la ventana, utiliza el enlace siguiente.')
      if (popup && !popup.closed) {
        try { popup.location.replace(url.href) } catch { /* The fallback link remains available. */ }
      }
      let failures = 0
      while (!controller.signal.aborted) {
        let status: LoginStatus
        try {
          status = await rpc<LoginStatus>('poll', { loginId: res.loginId }, controller.signal)
          failures = 0
        } catch (error) {
          if (controller.signal.aborted) break
          if (++failures >= 4) throw error
          setNotice('Conexión interrumpida; reintentando comprobar la autorización…')
          status = { kind: 'pending' }
        }
        if (controller.signal.aborted) break
        if (status.kind === 'succeeded') {
          setNotice(status.email ? `Cuenta conectada: ${status.email}` : 'Cuenta conectada correctamente.')
          setQuota('')
          await load()
          return
        }
        if (status.kind === 'failed') throw new Error(status.message)
        if (status.kind === 'cancelled') throw new Error('La autorización se ha cancelado.')
        if (status.kind !== 'pending') throw new Error('Respuesta de autorización no válida.')
        await new Promise<void>((resolve) => {
          const finish = () => { window.clearTimeout(timer); controller.signal.removeEventListener('abort', finish); resolve() }
          const timer = window.setTimeout(finish, 2000)
          controller.signal.addEventListener('abort', finish, { once: true })
        })
      }
    } catch (error) {
      if (activeRef.current && !controller.signal.aborted) {
        setNotice('')
        setError(error instanceof Error ? error.message : 'No se pudo conectar con Google.')
      }
    } finally {
      window.clearTimeout(deadline)
      if (controller.signal.aborted && loginIdRef.current) {
        void rpc('cancel-login', { loginId: loginIdRef.current }).catch(() => undefined)
      }
      popup?.close()
      if (loginRef.current === controller) {
        loginRef.current = null
        loginIdRef.current = null
        popupRef.current = null
        if (activeRef.current) {
          setBusy(false); setAuthorizationUrl('')
          if (controller.signal.aborted) setNotice(timedOut ? 'La autorización agotó el plazo de cinco minutos. Vuelve a conectar.' : 'Autorización cancelada.')
        }
      }
    }
  }, [load])

  const logout = React.useCallback((accountId?: string) => {
    if (actionBusy || !window.confirm(accountId ? '¿Eliminar esta cuenta de Antigravity de este dispositivo?' : '¿Desconectar todas las cuentas de Antigravity?')) return
    setActionBusy(true); setError('')
    rpc('logout', accountId ? { accountId } : {}, lifetimeRef.current?.signal).then(() => { if (activeRef.current) { setQuota(''); void load() } }).catch((e: Error) => { if (activeRef.current) setError(e.message) }).finally(() => { if (activeRef.current) setActionBusy(false) })
  }, [load, actionBusy])

  const activate = React.useCallback((accountId: string) => {
    if (actionBusy) return
    setActionBusy(true); setError('')
    rpc('activate', { accountId }, lifetimeRef.current?.signal).then(() => load()).catch((e: Error) => { if (activeRef.current) setError(e.message) }).finally(() => { if (activeRef.current) setActionBusy(false) })
  }, [load, actionBusy])

  const showQuota = React.useCallback(() => {
    setQuotaLoading(true); setError('')
    rpc<{ report: string }>('quota', undefined, lifetimeRef.current?.signal).then((b) => { if (activeRef.current) setQuota(b.report || 'No hay información de cuotas disponible.') }).catch((e: Error) => { if (activeRef.current) setError(e.message) }).finally(() => { if (activeRef.current) setQuotaLoading(false) })
  }, [])

  const showStats = React.useCallback(() => {
    rpc<{ lastDiagnostic?: { model: string; finishReason?: string; kind: string }; accounts: Array<{ accountId: string; success: number; rateLimits: number; errors: number }> }>('stats', undefined, lifetimeRef.current?.signal)
      .then((result) => {
        if (activeRef.current) setActivity([
          result.accounts.map((entry) => `${entry.accountId.slice(0, 8)}: ${entry.success} completadas · ${entry.rateLimits} límites · ${entry.errors} errores`).join('\n') || 'Sin actividad en esta instancia.',
          result.lastDiagnostic ? `Último fallo: ${result.lastDiagnostic.model} · ${result.lastDiagnostic.kind} · finishReason=${result.lastDiagnostic.finishReason ?? 'missing'}` : '',
        ].filter(Boolean).join('\n'))
      }).catch((error: Error) => { if (activeRef.current) setError(error.message) })
  }, [])

  const refreshModels = React.useCallback(() => {
    rpc('refresh-models', {}, lifetimeRef.current?.signal)
      .then(() => { if (activeRef.current) setNotice('Actualización de modelos solicitada. Comprueba el selector de modelos.') })
      .catch((error: Error) => { if (activeRef.current) setError(error.message) })
  }, [])

  if (accounts === null) {
    return <div className="agy-page"><p className="agy-note">Cargando cuentas…</p>{error ? <><p className="agy-error" role="alert">{error}</p><Button onClick={() => { setError(''); void load() }}>Reintentar</Button></> : null}</div>
  }

  const rows: React.ReactElement[] = []
  if (accounts.length === 0) {
    rows.push(<Row key="empty" title="Sin cuentas conectadas" desc="Conecta tu cuenta de Google para utilizar los modelos disponibles en tu plan de Antigravity." controls={<Button onClick={startLogin} disabled={busy}>{busy ? 'Esperando autorización…' : 'Conectar con Google'}</Button>} />)
  } else {
    for (const a of accounts) {
      const pill = a.active
         ? <span className="agy-pill agy-pill--ok">Activa</span>
        : null
      const controls = (
        <>
          {pill}
          {!a.active ? <Button onClick={() => activate(a.id)} disabled={actionBusy || busy || !a.enabled}>Activar</Button> : null}
          <Button danger onClick={() => logout(a.id)} disabled={actionBusy || busy}>Eliminar</Button>
        </>
      )
      const state = [a.enabled ? 'Habilitada' : 'Deshabilitada', a.rateLimited ? 'Límite de uso alcanzado' : null, a.coolingDown ? 'En espera de recuperación' : null].filter(Boolean).join(' · ')
      rows.push(<Row key={a.id} title={a.email ?? a.id.slice(0, 8)} desc={state || undefined} controls={controls} />)
    }
    rows.push(<Row key="add" title="Añadir otra cuenta" controls={<Button onClick={startLogin} disabled={busy || actionBusy}>{busy ? 'Esperando autorización…' : 'Conectar con Google'}</Button>} />)
    rows.push(<Row key="all" title="Cuotas de las cuentas" desc="Consulta las ventanas de uso y la disponibilidad informadas por Antigravity." controls={<Button onClick={showQuota} disabled={quotaLoading || actionBusy}>{quotaLoading ? 'Consultando…' : 'Consultar cuotas'}</Button>} />)
    rows.push(<Row key="models" title="Modelos disponibles" controls={<Button onClick={refreshModels} disabled={busy || actionBusy}>Actualizar modelos</Button>} />)
    rows.push(<Row key="stats" title="Actividad de esta instancia" controls={<Button onClick={showStats}>Consultar actividad</Button>} />)
    rows.push(<Row key="disconnect" title="Desconectar" controls={<Button danger onClick={() => logout(undefined)} disabled={actionBusy || busy}>Desconectar todas</Button>} />)
  }

  return (
    <div className="agy-page">
      <div className="agy-list">{rows}</div>
      {notice ? <p className="agy-note" role="status">{notice}</p> : null}
      {authorizationUrl ? <p className="agy-note"><a href={authorizationUrl} target="_blank" rel="noopener noreferrer">Abrir autorización de Google</a></p> : null}
      {busy ? <Button onClick={() => loginRef.current?.abort()}>Cancelar autorización</Button> : null}
      {error ? <p className="agy-error" role="alert">{error}</p> : null}
      {quota ? <pre className="agy-quota">{quota}</pre> : null}
      {activity ? <pre className="agy-quota">{activity}</pre> : null}
      <p className="agy-note">Los tokens y los datos de las cuentas se guardan en el dispositivo donde se ejecuta Harness. Si accedes de forma remota, la autorización debe completarse en un navegador de ese dispositivo.</p>
    </div>
  )
}

/** Package updates are independent of account login and model-catalog refresh. */
function PackageUpdates(): React.ReactElement {
  const [state, setState] = React.useState<UpdateStatus | null>(null)
  const [origin, setOrigin] = React.useState('')
  const [minutes, setMinutes] = React.useState('360')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const lifetime = React.useRef<AbortController | null>(null)
  const [loading, setLoading] = React.useState(true)
  React.useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    rpc<UpdateStatus>('update/status', undefined, controller.signal).then((result) => {
      if (!controller.signal.aborted) { setState(result); setOrigin(result.registryOrigin); setMinutes(String(result.intervalMs / 60000)) }
    }).catch((error: Error) => { if (!controller.signal.aborted) setError(error.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])
  const action = (method: string, body: Record<string, unknown> = {}) => {
    if (busy) return
    setBusy(true); setError('')
    rpc<UpdateStatus>(method, body, lifetime.current?.signal).then((result) => {
      if (!lifetime.current?.signal.aborted) {
        setState(result)
        setOrigin(result.registryOrigin)
        setMinutes(String(result.intervalMs / 60000))
      }
    }).catch((error: Error) => { if (!lifetime.current?.signal.aborted) setError(error.message) })
      .finally(() => { if (!lifetime.current?.signal.aborted) setBusy(false) })
  }
  return <div className="agy-page">
    <Row title="Actualización del plugin" desc={state ? `En ejecución: ${state.runningVersion} · Disco: ${state.diskVersion}${state.latest ? ` · Última versión: ${state.latest}` : ''}` : loading ? 'Consultando versión…' : 'No se pudo consultar la versión del servidor.'} controls={<Button disabled={loading || busy || (state !== null && !state.configured)} onClick={() => action(state ? 'update/check' : 'update/status')}>{state ? 'Comprobar actualización' : 'Reintentar conexión'}</Button>} />
    {state ? <>
      <p className="agy-note">{!state.configured ? 'Origen no configurado. No se descargará ningún paquete hasta que confirmes un registro npm HTTPS de confianza que publique dsh-agy.' : state.pendingRestart ? 'La versión del disco cambió. Reinicia Harness para aplicarla.' : state.available ? 'Hay una versión nueva disponible.' : state.lastCheckAt ? 'No hay una versión más reciente disponible.' : 'Aún no se ha comprobado el origen.'}</p>
      {!state.installAllowed ? <p className="agy-note">La instalación automática solo está permitida dentro de profiles de DSH; no se modifica una copia de desarrollo.</p> : null}
      <Row title="Modo de actualización" desc="Automático comprueba e instala en el intervalo elegido. Al abrir esta página se pausa la instalación automática hasta reiniciar Harness." controls={<Button disabled={busy} onClick={() => action('update/config', { enabled: !state.enabled })}>{state.enabled ? 'Desactivar automático' : 'Activar automático'}</Button>} />
      <Row title="Origen e intervalo" controls={<>
        <input aria-label="Registro npm HTTPS de confianza" placeholder="https://registro-de-confianza" value={origin} onChange={(event) => setOrigin(event.target.value)} disabled={busy} />
        <input aria-label="Intervalo en minutos" type="number" min="1" max="10080" value={minutes} onChange={(event) => setMinutes(event.target.value)} disabled={busy} />
        <Button disabled={busy} onClick={() => { if (origin !== state.registryOrigin && origin && !window.confirm(`¿Confías en ${origin} para descargar y ejecutar versiones de dsh-agy?`)) return; action('update/config', { registryOrigin: origin, intervalMs: Number(minutes) * 60000 }) }}>Guardar</Button>
      </>} />
      {state.available ? <Button disabled={busy || !state.installAllowed || state.pendingRestart} onClick={() => { if (window.confirm(`¿Instalar dsh-agy ${state.latest}? Se guardará una copia de seguridad. Será necesario reiniciar Harness.`)) action('update/install', { confirm: true }) }}>Instalar {state.latest}</Button> : null}
      {state.lastError ? <p className="agy-error" role="alert">Actualización no realizada: {state.lastError}. Se conserva la versión anterior; revisa el origen o instala manualmente.</p> : null}
    </> : null}
    {busy ? <p className="agy-note" role="status">Procesando actualización…</p> : null}
    {error ? <p className="agy-error" role="alert">{error}</p> : null}
  </div>
}

function BundleConfig(props: { view?: string }): React.ReactElement {
  if (props.view === 'summary') return <span>Conecta tu cuenta de Google para utilizar los modelos de Antigravity.</span>
  return <><AntigravityPage /><PackageUpdates /></>
}

export const inject = ['slots']

export async function apply(ctx: ClientContext): Promise<void> {
  installStyles()
  let slots = ctx.slots ?? ctx.get?.<SlotsService>('slots')
  for (let i = 0; slots === undefined && i < 60; i++) {
    await new Promise((resolve) => window.setTimeout(resolve, 300))
    slots = ctx.slots ?? ctx.get?.<SlotsService>('slots')
  }
  if (slots === undefined) {
    console.warn('[dsh-agy] slots service not ready; settings page not registered')
    return
  }
  const dispose = slots.inject('plugins.bundle.config', () =>
    slots!.register(
      { name: 'plugins.bundle.config', key: 'dsh-agy', label: () => 'Google Antigravity' },
      BundleConfig,
    ),
  )
  ctx.effect?.(() => () => { if (dispose) dispose() }, 'dsh-agy: settings slot')
}
