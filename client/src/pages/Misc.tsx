import { Link, useNavigate } from 'react-router-dom'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import AppLayout from '../layout/AppLayout'
import { Box, Field } from '../components/ui'
import { siteName } from '../data/mockData'
import { useAuth } from '../api/AuthContext'
import { api, hardwareApi } from '../api/client'
import InteractiveLoginPage from '../components/login/InteractiveLoginPage'
import { useToast } from '../components/Toast'

export { ImportPage } from './ImportPage'


export function AccountAssets() {
  const { user } = useAuth()
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const uid = user?.id
    if (!uid) {
      setLoading(false)
      return
    }
    api<{ rows: Record<string, unknown>[] }>(`/users/${uid}/assets`)
      .then((r) => setRows(r.rows || []))
      .catch(() => {
        // Fallback: assets assigned to current user via list filter is not available; show empty
        hardwareApi.list({ limit: 50 }).then((res) => {
          const mine = (res.rows || []).filter((a) => {
            const at = a.assigned_to as { id?: number; type?: string } | null
            return at && Number(at.id) === Number(uid) && at.type === 'user'
          })
          setRows(mine)
        }).catch(() => setRows([]))
      })
      .finally(() => setLoading(false))
  }, [user])

  return (
    <AppLayout title="My Assigned Assets">
      <Box title="Assets assigned to you">
        <table className="table table-striped">
          <thead><tr><th>Asset Tag</th><th>Name</th><th>Model</th><th>Status</th></tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="text-muted">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={4} className="text-muted">No assets assigned</td></tr>
            ) : rows.map((a) => (
              <tr key={String(a.id)}>
                <td><Link to={`/hardware/${a.id}`}>{String(a.asset_tag)}</Link></td>
                <td>{String(a.name || '')}</td>
                <td>{typeof a.model === 'object' && a.model ? String((a.model as { name?: string }).name || '') : String(a.model || '')}</td>
                <td>{typeof a.status === 'object' && a.status ? String((a.status as { name?: string }).name || '') : String(a.status || '')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
    </AppLayout>
  )
}

export function AccountRequested() {
  return (
    <AppLayout title="My Requested Assets">
      <Box title="Requests"><p className="text-muted">You have no pending asset requests.</p></Box>
    </AppLayout>
  )
}

export function AccountAccept() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [msg, setMsg] = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [activeId, setActiveId] = useState<number | null>(null)

  const load = () => api<{ rows: Record<string, unknown>[] }>('/account/accept').then((r) => setRows(r.rows)).catch(() => undefined)
  useEffect(() => { load() }, [])

  const startDraw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.strokeStyle = '#111'
    ctx.lineWidth = 2
    ctx.beginPath()
    const rect = c.getBoundingClientRect()
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top)
    const move = (ev: MouseEvent) => {
      ctx.lineTo(ev.clientX - rect.left, ev.clientY - rect.top)
      ctx.stroke()
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const accept = async (id: number) => {
    const signature = canvasRef.current?.toDataURL('image/png')
    await api(`/account/accept/${id}`, {
      method: 'POST',
      json: { asset_acceptance: 'accepted', signature_output: signature },
    })
    setMsg('Accepted')
    setActiveId(null)
    load()
  }

  const decline = async (id: number) => {
    await api(`/account/accept/${id}/decline`, { method: 'POST', json: { note: 'Declined by user' } })
    setMsg('Declined')
    load()
  }

  return (
    <AppLayout title="Accept Assets">
      {msg && <div className="callout callout-info"><p>{msg}</p></div>}
      <Box title="Pending Acceptance">
        <table className="table table-striped">
          <thead><tr><th>Asset</th><th>EULA / Signature</th><th></th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={3} className="text-muted">No pending acceptances</td></tr>}
            {rows.map((r) => (
              <tr key={String(r.id)}>
                <td>{String(r.asset_tag)} {String(r.asset_name || '')}</td>
                <td>
                  <button type="button" className="btn btn-xs btn-default" onClick={() => setActiveId(Number(r.id))}>Sign &amp; Accept</button>
                </td>
                <td>
                  <button type="button" className="btn btn-success btn-sm" onClick={() => accept(Number(r.id))}>Accept</button>{' '}
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => decline(Number(r.id))}>Decline</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
      {activeId && (
        <Box title="Signature" type="primary">
          <p>Draw your signature, then click Accept.</p>
          <canvas
            ref={canvasRef}
            width={480}
            height={160}
            style={{ border: '1px solid #ccc', background: '#fff', cursor: 'crosshair' }}
            onMouseDown={startDraw}
          />
          <div className="form-actions" style={{ marginTop: 16 }}>
            <button type="button" className="btn btn-theme" onClick={() => accept(activeId)}>Accept with Signature</button>
            <button type="button" className="btn btn-default" onClick={() => {
              const c = canvasRef.current
              if (c) c.getContext('2d')?.clearRect(0, 0, c.width, c.height)
            }}
            >Clear</button>
          </div>
        </Box>
      )}
    </AppLayout>
  )
}


export function AccountProfile() {
  const { user, refreshUser } = useAuth()
  const toast = useToast()
  const [firstName, setFirstName] = useState(String(user?.first_name || ''))
  const [lastName, setLastName] = useState(String(user?.last_name || ''))
  const [email, setEmail] = useState(String(user?.email || ''))
  const [phone, setPhone] = useState(String((user as { phone?: string } | null)?.phone || ''))
  const [error, setError] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setFirstName(String(user?.first_name || ''))
    setLastName(String(user?.last_name || ''))
    setEmail(String(user?.email || ''))
    setPhone(String((user as { phone?: string } | null)?.phone || ''))
  }, [user])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    setOkMsg('')
    try {
      await api('/account/profile', {
        method: 'PUT',
        json: { first_name: firstName.trim(), last_name: lastName.trim(), email: email.trim() || null, phone: phone.trim() || null },
      })
      await refreshUser()
      setOkMsg('Profile saved')
      toast.success('Profile saved')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppLayout title="Edit Profile">
      {error ? <div className="callout callout-danger"><p>{error}</p></div> : null}
      {okMsg ? <div className="callout callout-success"><p>{okMsg}</p></div> : null}
      <Box title="Profile" type="primary">
        <form className="form-horizontal" onSubmit={(e) => { void submit(e) }}>
          <Field label="First Name"><input className="form-control" value={firstName} onChange={(e) => setFirstName(e.target.value)} required /></Field>
          <Field label="Last Name"><input className="form-control" value={lastName} onChange={(e) => setLastName(e.target.value)} /></Field>
          <Field label="Email"><input className="form-control" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Phone"><input className="form-control" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          <div className="form-actions">
            <button type="submit" className="btn btn-theme" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </Box>
    </AppLayout>
  )
}

export function AccountPassword() {
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (password.length < 8) {
      setError('New password must be at least 8 characters')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    setBusy(true)
    setError('')
    setOkMsg('')
    try {
      await api('/account/password', {
        method: 'PUT',
        json: { current_password: current, password },
      })
      setCurrent('')
      setPassword('')
      setConfirm('')
      setOkMsg('Password updated')
      toast.success('Password updated')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppLayout title="Change Password">
      {error ? <div className="callout callout-danger"><p>{error}</p></div> : null}
      {okMsg ? <div className="callout callout-success"><p>{okMsg}</p></div> : null}
      <Box title="Password" type="primary">
        <form className="form-horizontal" onSubmit={(e) => { void submit(e) }}>
          <Field label="Current Password"><input type="password" className="form-control" value={current} onChange={(e) => setCurrent(e.target.value)} required /></Field>
          <Field label="New Password"><input type="password" className="form-control" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
          <Field label="Confirm"><input type="password" className="form-control" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></Field>
          <div className="form-actions">
            <button type="submit" className="btn btn-theme" disabled={busy}>{busy ? 'Updating…' : 'Update Password'}</button>
          </div>
        </form>
      </Box>
    </AppLayout>
  )
}

export function AccountApi() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [newToken, setNewToken] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => {
    setLoading(true)
    api<{ rows: Record<string, unknown>[] }>('/personal-access-tokens')
      .then((r) => setRows(r.rows || []))
      .catch((e: Error) => { setError(e.message); setRows([]) })
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const create = async () => {
    setBusy(true)
    setError('')
    setNewToken('')
    try {
      const res = await api<{ payload?: { token?: string }; token?: string }>('/personal-access-tokens', {
        method: 'POST',
        json: { name: name.trim() || 'API Token' },
      })
      setNewToken(String(res.payload?.token || res.token || ''))
      setName('')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (id: number) => {
    if (!confirm('Revoke this token?')) return
    await api(`/personal-access-tokens/${id}`, { method: 'DELETE' })
    load()
  }

  return (
    <AppLayout title="API Keys">
      {error ? <div className="callout callout-danger"><p>{error}</p></div> : null}
      {newToken ? (
        <div className="callout callout-success">
          <p>Copy this token now — it will not be shown again.</p>
          <code style={{ wordBreak: 'break-all' }}>{newToken}</code>
        </div>
      ) : null}
      <Box
        title="Personal Access Tokens"
        tools={(
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            <input
              className="form-control input-sm"
              style={{ width: 160, display: 'inline-block' }}
              placeholder="Token name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => { void create() }}>
              {busy ? 'Creating…' : 'Create Token'}
            </button>
          </span>
        )}
      >
        <table className="table table-striped">
          <thead><tr><th>Name</th><th>Created</th><th>Last used</th><th>Expires</th><th /></tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="text-muted">{loading ? 'Loading…' : 'No API tokens yet'}</td></tr>
            ) : rows.map((r) => (
              <tr key={String(r.id)}>
                <td>{String(r.name || '')}</td>
                <td>{String(r.created_at || '—')}</td>
                <td>{String(r.last_used_at || '—')}</td>
                <td>{String(r.expires_at || '—')}</td>
                <td>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => { void revoke(Number(r.id)) }}>Revoke</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
    </AppLayout>
  )
}

export function AdminHub() {
  const links = [
    { to: '/settings', label: 'General Settings', icon: 'fas fa-cog' },
    { to: '/settings/roles', label: 'Roles & permissions', icon: 'fas fa-user-shield-alt' },
    { to: '/settings/notifications', label: 'Notifications / emails', icon: 'fas fa-envelope' },
    { to: '/companies', label: 'Companies', icon: 'fas fa-building' },
    { to: '/fields', label: 'Custom Fields', icon: 'fas fa-list' },
    { to: '/statuslabels', label: 'Status Labels', icon: 'fas fa-flag' },
    { to: '/import', label: 'Import', icon: 'fas fa-file-import' },
    { to: '/reports', label: 'Reports', icon: 'fas fa-chart-bar' },
  ]
  return (
    <AppLayout title="Admin" backTo="/">
      <div className="row">
        {links.map((l) => (
          <div key={l.to} className="col-md-4" style={{ marginBottom: 15 }}>
            <Link to={l.to}>
              <div className="box box-default" style={{ padding: 20, textAlign: 'center' }}>
                <i className={l.icon} style={{ fontSize: 36, color: '#3c8dbc', marginBottom: 10 }} />
                <h4>{l.label}</h4>
              </div>
            </Link>
          </div>
        ))}
      </div>
    </AppLayout>
  )
}

export function RequestableItems() {
  return (
    <AppLayout title="Requestable Items">
      <Box title="Available to Request">
        <p className="text-muted">No requestable items configured.</p>
      </Box>
    </AppLayout>
  )
}

export function LoginPage() {
  const navigate = useNavigate()
  const { login } = useAuth()

  return (
    <InteractiveLoginPage
      onSubmit={async ({ email, password }) => {
        await login(email, password)
        let next = '/'
        try {
          next = sessionStorage.getItem('refex_login_next') || '/'
          sessionStorage.removeItem('refex_login_next')
        } catch { /* ignore */ }
        navigate(next.startsWith('/') ? next : '/')
      }}
    />
  )
}

export function SettingsGeneral() {
  const toast = useToast()
  const { can } = useAuth()
  const canEdit = can('settings.edit')
  const [site, setSite] = useState(siteName)
  const [currency, setCurrency] = useState('INR')
  const [dateFormat, setDateFormat] = useState('YYYY-MM-DD')
  const [fmcs, setFmcs] = useState(true)
  const [alertEmail, setAlertEmail] = useState('')
  const [error, setError] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [digestBusy, setDigestBusy] = useState(false)
  const [qrBusy, setQrBusy] = useState(false)
  const [tagMigrateBusy, setTagMigrateBusy] = useState(false)
  const [tagRegenBusy, setTagRegenBusy] = useState(false)
  const [schemaMigrateBusy, setSchemaMigrateBusy] = useState(false)
  const [spaceSeedBusy, setSpaceSeedBusy] = useState(false)
  const [migStatus, setMigStatus] = useState<{ pending: string[]; applied: string[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [saml, setSaml] = useState<{
    enabled?: boolean
    idp_configured?: boolean
    portal_fields?: Record<string, string>
    metadata_url?: string
  } | null>(null)

  useEffect(() => {
    api<Record<string, unknown>>('/settings')
      .then((s) => {
        setSite(String(s.site_name || siteName))
        setCurrency(String(s.default_currency || 'INR'))
        setDateFormat(String(s.date_display_format || 'YYYY-MM-DD'))
        setFmcs(Boolean(s.full_multiple_companies_support))
        setAlertEmail(String(s.alert_email || ''))
      })
      .catch(() => undefined)
      .finally(() => setLoading(false))
    api<{
      enabled?: boolean
      idp_configured?: boolean
      portal_fields?: Record<string, string>
      metadata_url?: string
    }>('/settings/saml')
      .then((s) => setSaml(s))
      .catch(() => setSaml(null))
    api<{ pending: string[]; applied: string[] }>('/settings/migrations')
      .then((s) => setMigStatus({ pending: s.pending || [], applied: s.applied || [] }))
      .catch(() => setMigStatus(null))
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    setOkMsg('')
    try {
      await api('/settings', {
        method: 'PUT',
        json: {
          site_name: site.trim() || siteName,
          default_currency: currency.trim() || 'INR',
          date_display_format: dateFormat,
          full_multiple_companies_support: fmcs,
          alert_email: alertEmail.trim() || null,
        },
      })
      setOkMsg('Settings saved')
      toast.success('Settings saved')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <AppLayout title="General Settings" backTo="/"><p className="text-muted">Loading…</p></AppLayout>
  }

  return (
    <AppLayout title="General Settings" backTo="/">
      {error ? <div className="callout callout-danger"><p>{error}</p></div> : null}
      {okMsg ? <div className="callout callout-success"><p>{okMsg}</p></div> : null}
      <Box title="Settings" type="primary">
        <form className="form-horizontal" onSubmit={(e) => { void submit(e) }}>
          <Field label="Site Name"><input className="form-control" value={site} onChange={(e) => setSite(e.target.value)} /></Field>
          <Field label="Default Currency"><input className="form-control" value={currency} onChange={(e) => setCurrency(e.target.value)} /></Field>
          <Field label="Date Format">
            <select className="form-control" value={dateFormat} onChange={(e) => setDateFormat(e.target.value)}>
              <option value="YYYY-MM-DD">YYYY-MM-DD</option>
              <option value="DD/MM/YYYY">DD/MM/YYYY</option>
              <option value="MM/DD/YYYY">MM/DD/YYYY</option>
            </select>
          </Field>
          <Field label="Alert Email">
            <input className="form-control" type="email" value={alertEmail} onChange={(e) => setAlertEmail(e.target.value)} />
            <span className="help-block">
              Fallback ops email. For recipients, categories, and IT Asset Manager mapping see{' '}
              <a href="/settings/notifications">Settings → Notifications</a>.
            </span>
          </Field>
          <Field label="Full Multiple Companies Support">
            <label className="checkbox"><input type="checkbox" checked={fmcs} onChange={(e) => setFmcs(e.target.checked)} /> Enable FMCS</label>
          </Field>
          <div className="form-actions">
          <button type="submit" className="btn btn-theme" disabled={busy || !canEdit}>{busy ? 'Saving…' : 'Save Settings'}</button>
          <button
            type="button"
            className="btn btn-default"
            disabled={digestBusy || !alertEmail.trim() || !canEdit}
            onClick={() => {
              setDigestBusy(true)
              setError('')
              setOkMsg('')
              api<{ messages?: string[]; payload?: { skippedReason?: string; sent?: boolean } }>('/notifications/eol/run', { method: 'POST' })
                .then((res) => {
                  const payload = res.payload
                  setOkMsg(
                    payload?.sent
                      ? (Array.isArray(res.messages) ? res.messages.join(' ') : 'EOL digest sent')
                      : (payload?.skippedReason || (Array.isArray(res.messages) ? res.messages.join(' ') : 'Skipped')),
                  )
                })
                .catch((err: Error) => setError(err.message))
                .finally(() => setDigestBusy(false))
            }}
          >
            {digestBusy ? 'Sending…' : 'Send EOL digest now'}
          </button>
          </div>
        </form>
      </Box>

      <Box title="SAML / RefexOne SSO" type="primary">
        <p className="help-block" style={{ marginTop: 0 }}>
          Enter these values in the RefexOne portal SAML app registration. Set{' '}
          <code>PUBLIC_APP_URL=https://asset.refexone.com</code> (no port), then{' '}
          <code>SAML_ENABLED=true</code> and paste IdP SSO URL + certificate into{' '}
          <code>server/.env</code>.
        </p>
        {saml?.portal_fields ? (
          <div style={{ display: 'grid', gap: 10, marginBottom: 12 }}>
            {Object.entries(saml.portal_fields).map(([label, value]) => (
              <div key={label}>
                <div style={{ fontWeight: 650, fontSize: 13, marginBottom: 4 }}>{label}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <code style={{ flex: 1, wordBreak: 'break-all', fontSize: 12 }}>{value}</code>
                  <button
                    type="button"
                    className="btn btn-default btn-sm"
                    onClick={() => {
                      void navigator.clipboard.writeText(value)
                      toast.success('Copied')
                    }}
                  >
                    Copy
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted">Loading SAML SP config…</p>
        )}
        <p className="help-block mb-0">
          Status: {saml?.enabled ? 'SSO enabled' : 'SSO disabled'} ·{' '}
          {saml?.idp_configured ? 'IdP configured' : 'IdP not configured yet'}
          {saml?.metadata_url ? (
            <> · <a href={saml.metadata_url} target="_blank" rel="noreferrer">SP metadata XML</a></>
          ) : null}
        </p>
      </Box>

      <Box title="Database migrations" type="primary">
        <p className="help-block" style={{ marginTop: 0 }}>
          Applies pending SQL files from <code>server/src/db/mysql</code> — domains, typed locations,
          spaces, blank QR/barcode labels, and older schema updates. Safe to re-run; already-applied
          versions are skipped. Deploy/pull the new code first, then click this.
        </p>
        {migStatus ? (
          <p className="help-block">
            {migStatus.pending.length
              ? <>Pending: <code>{migStatus.pending.join(', ')}</code></>
              : 'All numbered migrations are already applied.'}
          </p>
        ) : null}
        <button
          type="button"
          className="btn btn-theme"
          disabled={schemaMigrateBusy || !canEdit}
          onClick={() => {
            if (!window.confirm(
              'Run pending database migrations on this server?\n\nThis updates the MySQL schema (new tables/columns for spaces, labels, domains, etc.).',
            )) return
            setSchemaMigrateBusy(true)
            setError('')
            setOkMsg('')
            api<{
              messages?: string[]
              payload?: { applied?: string[]; skipped?: string[]; table_count?: number }
            }>('/settings/run-migrations', { method: 'POST' })
              .then((res) => {
                const msg = Array.isArray(res.messages) ? res.messages.join(' ') : 'Migrations complete'
                setOkMsg(msg)
                toast.success(msg)
                return api<{ pending: string[]; applied: string[] }>('/settings/migrations')
              })
              .then((s) => {
                if (s) setMigStatus({ pending: s.pending || [], applied: s.applied || [] })
              })
              .catch((err: Error) => {
                setError(err.message)
                toast.error(err.message)
              })
              .finally(() => setSchemaMigrateBusy(false))
          }}
        >
          {schemaMigrateBusy ? 'Migrating…' : 'Run pending DB migrations'}
        </button>
      </Box>

      <Box title="Seed office floors & Admin inventory" type="primary">
        <p className="help-block" style={{ marginTop: 0 }}>
          After migrations, click this to create floors, cabins, meeting rooms, workstations, and
          Admin-domain furniture on <strong>Refex Tower-Nungambakkam</strong> and{' '}
          <strong>Bazullah -T.Nagar</strong>. Safe to re-run. Does not move existing IT assets
          and does not reparent those office locations.
        </p>
        <button
          type="button"
          className="btn btn-theme"
          disabled={spaceSeedBusy || !canEdit}
          onClick={() => {
            if (!window.confirm(
              'Seed office floors and Admin inventory?\n\nCreates floors/cabins/meeting rooms and Admin furniture on Nungambakkam and Bazullah. Existing IT assets stay where they are.',
            )) return
            setSpaceSeedBusy(true)
            setError('')
            setOkMsg('')
            api<{
              messages?: string[]
              payload?: {
                new_this_run?: { floors?: number; spaces?: number; assets?: number; qty?: number }
                totals?: Record<string, number>
              }
            }>('/settings/seed-admin-spaces', { method: 'POST' })
              .then((res) => {
                const msg = Array.isArray(res.messages) ? res.messages.join(' ') : 'Office seed complete'
                setOkMsg(msg)
                toast.success(msg)
              })
              .catch((err: Error) => {
                setError(err.message)
                toast.error(err.message)
              })
              .finally(() => setSpaceSeedBusy(false))
          }}
        >
          {spaceSeedBusy ? 'Seeding…' : 'Seed office floors & Admin inventory'}
        </button>
      </Box>

      <Box title="Migrate asset tags" type="warning">
        <p className="help-block" style={{ marginTop: 0 }}>
          For every asset that still has an empty <strong>Old Asset Tag</strong>, copies the current{' '}
          <strong>Asset Tag</strong> into Old Asset Tag, then assigns a new auto tag (
          <code>COMPANY/ENTITY-TYPE-FY-0001</code>…). Safe to re-run — already-migrated assets (those with
          Old Asset Tag set) are skipped. Assets missing company/entity or asset type are reported as failed.
          Reprint labels after migrating if tags are printed.
        </p>
        <button
          type="button"
          className="btn btn-warning"
          disabled={tagMigrateBusy || !canEdit}
          onClick={() => {
            if (!window.confirm(
              'Migrate asset tags?\n\nCurrent Asset Tag → Old Asset Tag, then assign new auto tags for assets that do not already have an Old Asset Tag.',
            )) return
            setTagMigrateBusy(true)
            setError('')
            setOkMsg('')
            api<{
              messages?: string[]
              payload?: { migrated?: number; failed?: number; skipped?: number; errors?: string[] }
            }>('/settings/migrate-asset-tags', { method: 'POST' })
              .then((res) => {
                const msg = Array.isArray(res.messages) ? res.messages.join(' ') : 'Asset tag migration complete'
                const errs = res.payload?.errors?.length
                  ? `\n${res.payload.errors.slice(0, 10).join('\n')}`
                  : ''
                setOkMsg(msg + errs)
                toast.success(msg)
              })
              .catch((err: Error) => {
                setError(err.message)
                toast.error(err.message)
              })
              .finally(() => setTagMigrateBusy(false))
          }}
        >
          {tagMigrateBusy ? 'Migrating…' : 'Move Asset Tag → Old Asset Tag'}
        </button>
      </Box>

      <Box title="Regenerate asset tags (keep Old Asset Tag)" type="warning">
        <p className="help-block" style={{ marginTop: 0 }}>
          Updates <strong>Asset Tag</strong> to the current format{' '}
          <code>COMPANY/ENTITY-TYPE-2026-27-0001</code> (India FY Apr–Mar).{' '}
          <strong>Old Asset Tag is never changed</strong> — existing values stay as they are.
          Assets already on the current FY pattern are skipped. Missing company/entity or asset type
          are reported as failed. Reprint labels after regenerating if tags are printed.
        </p>
        <button
          type="button"
          className="btn btn-warning"
          disabled={tagRegenBusy || !canEdit}
          onClick={() => {
            if (!window.confirm(
              'Regenerate asset tags?\n\nAsset Tag will be rewritten to include FY (e.g. MEMF-LAPTOP-2026-27-0001).\nOld Asset Tag values will NOT be changed.',
            )) return
            setTagRegenBusy(true)
            setError('')
            setOkMsg('')
            api<{
              messages?: string[]
              payload?: {
                regenerated?: number
                failed?: number
                skipped?: number
                fy?: string
                errors?: string[]
              }
            }>('/settings/regenerate-asset-tags', { method: 'POST' })
              .then((res) => {
                const msg = Array.isArray(res.messages) ? res.messages.join(' ') : 'Asset tag regeneration complete'
                const errs = res.payload?.errors?.length
                  ? `\n${res.payload.errors.slice(0, 10).join('\n')}`
                  : ''
                setOkMsg(msg + errs)
                toast.success(msg)
              })
              .catch((err: Error) => {
                setError(err.message)
                toast.error(err.message)
              })
              .finally(() => setTagRegenBusy(false))
          }}
        >
          {tagRegenBusy ? 'Regenerating…' : 'Regenerate Asset Tags (keep Old)'}
        </button>
      </Box>

      <Box title="Asset QR codes" type="warning">
        <p className="help-block" style={{ marginTop: 0 }}>
          Clears every asset&apos;s QR token, public URL, image path, and printed-label counters, and deletes
          stored QR PNG files. Use after changing the public domain (e.g. to{' '}
          <code>https://asset.refexone.com</code>) so Print Label mints fresh codes without{' '}
          <code>:3053</code>.
        </p>
        <button
          type="button"
          className="btn btn-danger"
          disabled={qrBusy || !canEdit}
          onClick={() => {
            if (!window.confirm(
              'Reset ALL asset QR codes?\n\nExisting printed labels will stop matching until you Print Label again for each asset.',
            )) return
            setQrBusy(true)
            setError('')
            setOkMsg('')
            api<{ messages?: string[]; payload?: { cleared?: number; files_removed?: number } }>(
              '/settings/reset-qr',
              { method: 'POST' },
            )
              .then((res) => {
                const msg = Array.isArray(res.messages) ? res.messages.join(' ') : 'QR reset complete'
                setOkMsg(msg)
                toast.success(msg)
              })
              .catch((err: Error) => {
                setError(err.message)
                toast.error(err.message)
              })
              .finally(() => setQrBusy(false))
          }}
        >
          {qrBusy ? 'Resetting…' : 'Reset all QR codes'}
        </button>
      </Box>
    </AppLayout>
  )
}
