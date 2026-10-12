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
const MUTATING = new Set(['login', 'logout', 'activate'])

function rpc(method: string, args?: Record<string, unknown>): Promise<any> {
  const url = `${PREFIX}/${method}`
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 15000)
  const mutating = MUTATING.has(method)
  return fetch(url, {
    method: mutating ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json' },
    body: mutating ? JSON.stringify(args ?? {}) : undefined,
    signal: controller.signal,
  })
    .then((r) => r.json().catch(() => ({})).then((body) => {
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
      return body
    }))
    .finally(() => window.clearTimeout(timeout))
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
  const pollRef = React.useRef<number | null>(null)
  const activeRef = React.useRef(true)

  const load = React.useCallback(() => {
    rpc('status').then((body) => {
      if (activeRef.current) { setAccounts(body.accounts ?? []); setError('') }
    }).catch(() => { if (activeRef.current) setError('Could not reach the host.') })
  }, [])

  React.useEffect(() => {
    activeRef.current = true
    load()
    const timer = window.setInterval(load, 5000)
    return () => {
      activeRef.current = false
      window.clearInterval(timer)
      if (pollRef.current !== null) window.clearInterval(pollRef.current)
    }
  }, [load])

  const startLogin = React.useCallback(() => {
    if (busy) return
    setBusy(true); setError('')
    rpc('login').then((res) => {
      if (res.authorizationUrl) window.open(res.authorizationUrl, '_blank')
      const loginId: string = res.loginId
      if (pollRef.current !== null) window.clearInterval(pollRef.current)
      pollRef.current = window.setInterval(() => {
        fetch(`${PREFIX}/poll?loginId=${encodeURIComponent(loginId)}`)
          .then((r) => r.json())
          .then((st: LoginStatus) => {
            if (!activeRef.current) return
            if (st.kind === 'succeeded') {
              if (pollRef.current !== null) window.clearInterval(pollRef.current)
              pollRef.current = null; setBusy(false); load()
            } else if (st.kind === 'failed' || st.kind === 'cancelled') {
              if (pollRef.current !== null) window.clearInterval(pollRef.current)
              pollRef.current = null; setBusy(false)
              setError(st.kind === 'failed' ? st.message : 'Login cancelled.')
            }
          })
          .catch(() => undefined)
      }, 2000)
    }).catch((e: Error) => { setBusy(false); setError(e.message) })
  }, [busy, load])

  const logout = React.useCallback((accountId?: string) => {
    if (!window.confirm(accountId ? 'Remove this Antigravity account from this device?' : 'Disconnect all Antigravity accounts?')) return
    rpc('logout', accountId ? { accountId } : {}).then(() => load()).catch((e: Error) => setError(e.message))
  }, [load])

  const activate = React.useCallback((accountId: string) => {
    rpc('activate', { accountId }).then(() => load()).catch((e: Error) => setError(e.message))
  }, [load])

  const showQuota = React.useCallback(() => {
    setQuotaLoading(true)
    rpc('quota').then((b) => { setQuota(b.report ?? '') }).catch((e: Error) => setError(e.message)).finally(() => setQuotaLoading(false))
  }, [])

  if (accounts === null) {
    return <div className="agy-page"><p className="agy-note">Loading…</p></div>
  }

  const rows: React.ReactElement[] = []
  if (accounts.length === 0) {
    rows.push(<Row key="empty" title="No accounts" desc="Sign in with your Google account to use Antigravity (Gemini / Claude / GPT-OSS) models." controls={<Button onClick={startLogin} disabled={busy}>{busy ? 'Opening browser…' : 'Sign in'}</Button>} />)
  } else {
    for (const a of accounts) {
      const pill = a.active
        ? <span className="agy-pill agy-pill--ok">active</span>
        : a.rateLimited ? <span className="agy-pill agy-pill--warn">rate-limited</span> : null
      const controls = (
        <>
          {pill}
          {!a.active ? <Button onClick={() => activate(a.id)}>Make active</Button> : null}
          <Button onClick={startLogin} disabled={busy}>Add</Button>
          <Button danger onClick={() => logout(a.id)}>Remove</Button>
        </>
      )
      const state = [a.enabled ? null : 'disabled', a.rateLimited ? 'rate-limited' : null, a.coolingDown ? 'cooling down' : null].filter(Boolean).join(' · ')
      rows.push(<Row key={a.id} title={a.email ?? a.id.slice(0, 8)} desc={state || undefined} controls={controls} />)
    }
    rows.push(<Row key="add" title="Add another account" controls={<Button onClick={startLogin} disabled={busy}>{busy ? 'Opening browser…' : 'Sign in'}</Button>} />)
    rows.push(<Row key="all" title="Manage" controls={<Button onClick={showQuota} disabled={quotaLoading}>{quotaLoading ? 'Loading…' : 'Show quota'}</Button>} />)
    rows.push(<Row key="disconnect" title="Disconnect" controls={<Button danger onClick={() => logout(undefined)}>Disconnect all</Button>} />)
  }

  return (
    <div className="agy-page">
      <div className="agy-list">{rows}</div>
      {error ? <p className="agy-error" role="alert">{error}</p> : null}
      {quota ? <pre className="agy-quota">{quota}</pre> : null}
      <p className="agy-note">Tokens and account data are stored only on this device, under your Harness home directory.</p>
    </div>
  )
}

function BundleConfig(props: { view?: string }): React.ReactElement {
  if (props.view === 'summary') return <span>Sign in with Google to use Antigravity models.</span>
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
