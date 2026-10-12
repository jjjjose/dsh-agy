/**
 * Plugin settings page (client half). Registers into the Harness
 * `plugins.bundle.config` slot and talks to the host over HTTP RPC at
 * `/_dsh/dsh-agy/*`. Classic JSX so the bundle only needs `require('react')`.
 */
import * as React from 'react'

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
const MUTATING = new Set(['login', 'logout', 'activate', 'cancel-login', 'refresh-models'])

async function rpc<T>(method: string, args?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const query = !MUTATING.has(method) && args ? `?${new URLSearchParams(Object.entries(args).map(([key, value]) => [key, String(value)]))}` : ''
  const url = `${PREFIX}/${method}${query}`
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) controller.abort()
  const timeout = window.setTimeout(() => controller.abort(), method === 'quota' ? 60000 : 15000)
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
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
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
    rpc<{ accounts: Array<{ accountId: string; success: number; rateLimits: number; errors: number }> }>('stats', undefined, lifetimeRef.current?.signal)
      .then((result) => {
        if (activeRef.current) setActivity(result.accounts.map((entry) => `${entry.accountId.slice(0, 8)}: ${entry.success} completadas · ${entry.rateLimits} límites · ${entry.errors} errores`).join('\n') || 'Sin actividad en esta instancia.')
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

function BundleConfig(props: { view?: string }): React.ReactElement {
  if (props.view === 'summary') return <span>Conecta tu cuenta de Google para utilizar los modelos de Antigravity.</span>
  return <AntigravityPage />
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
