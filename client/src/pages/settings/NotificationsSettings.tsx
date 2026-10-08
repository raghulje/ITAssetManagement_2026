import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import AppLayout from '../../layout/AppLayout'
import { Box, Field } from '../../components/ui'
import { api } from '../../api/client'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../api/AuthContext'

type Category = { key: string; label: string }
type AppUser = { id: number; name: string; email: string | null }
type Snapshot = {
  smtp_configured: boolean
  smtp_hint: string
  alert_email: string | null
  config: {
    emails_enabled: boolean
    email_notifications: Record<string, boolean>
    extra_ops_emails: string
    email_recipient_user_ids: number[]
    eol_to_it_asset_manager: boolean
    workflow_to_ops_roles: boolean
  }
  it_asset_managers: Array<{ id: number; name: string; email: string | null }>
  app_users: AppUser[]
  resolved_ops_emails: string[]
  resolved_eol_emails: string[]
  categories: Category[]
}

const emptyCfg = {
  emails_enabled: false,
  email_notifications: {
    custody: true,
    maintenance: true,
    inventory: true,
    crud: true,
    eol_warranty: true,
    license_renewal: true,
    battery_calls: true,
  } as Record<string, boolean>,
  extra_ops_emails: '',
  email_recipient_user_ids: [] as number[],
  eol_to_it_asset_manager: true,
  workflow_to_ops_roles: false,
}

export default function NotificationsSettings() {
  const toast = useToast()
  const { can } = useAuth()
  const canEdit = can('settings.edit')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [digestBusy, setDigestBusy] = useState(false)
  const [licDigestBusy, setLicDigestBusy] = useState(false)
  const [error, setError] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const [smtpHint, setSmtpHint] = useState('')
  const [smtpOk, setSmtpOk] = useState(false)
  const [alertEmail, setAlertEmail] = useState('')
  const [cfg, setCfg] = useState(emptyCfg)
  const [categories, setCategories] = useState<Category[]>([])
  const [itam, setItam] = useState<Snapshot['it_asset_managers']>([])
  const [appUsers, setAppUsers] = useState<AppUser[]>([])
  const [userQuery, setUserQuery] = useState('')
  const [resolvedOps, setResolvedOps] = useState<string[]>([])
  const [resolvedEol, setResolvedEol] = useState<string[]>([])

  const load = () => {
    setLoading(true)
    api<Snapshot>('/settings/notifications')
      .then((s) => {
        setSmtpOk(Boolean(s.smtp_configured))
        setSmtpHint(String(s.smtp_hint || ''))
        setAlertEmail(String(s.alert_email || ''))
        setCfg({
          emails_enabled: s.config?.emails_enabled === true,
          email_notifications: { ...emptyCfg.email_notifications, ...(s.config?.email_notifications || {}) },
          extra_ops_emails: String(s.config?.extra_ops_emails || ''),
          email_recipient_user_ids: Array.isArray(s.config?.email_recipient_user_ids)
            ? s.config.email_recipient_user_ids.map(Number).filter((n) => n > 0)
            : [],
          eol_to_it_asset_manager: s.config?.eol_to_it_asset_manager !== false,
          workflow_to_ops_roles: s.config?.workflow_to_ops_roles === true,
        })
        setCategories(s.categories || [])
        setItam(s.it_asset_managers || [])
        setAppUsers(s.app_users || [])
        setResolvedOps(s.resolved_ops_emails || [])
        setResolvedEol(s.resolved_eol_emails || [])
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canEdit) return
    setBusy(true)
    setError('')
    setOkMsg('')
    try {
      const res = await api<{ payload?: Snapshot }>('/settings/notifications', {
        method: 'PUT',
        json: {
          alert_email: alertEmail.trim() || null,
          emails_enabled: cfg.emails_enabled,
          email_notifications: cfg.email_notifications,
          extra_ops_emails: cfg.extra_ops_emails,
          email_recipient_user_ids: cfg.email_recipient_user_ids,
          eol_to_it_asset_manager: cfg.eol_to_it_asset_manager,
          workflow_to_ops_roles: cfg.workflow_to_ops_roles,
        },
      })
      const s = res.payload
      if (s) {
        setResolvedOps(s.resolved_ops_emails || [])
        setResolvedEol(s.resolved_eol_emails || [])
        setItam(s.it_asset_managers || [])
        setAppUsers(s.app_users || [])
      }
      setOkMsg('Notification settings saved')
      toast.success('Notification settings saved')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <AppLayout title="Notifications" backTo="/settings"><p className="text-muted">Loading…</p></AppLayout>
  }

  return (
    <AppLayout title="Notifications" subtitle="Email recipients & alert categories (Biogas-style)" backTo="/settings">
      {error ? <div className="callout callout-danger"><p>{error}</p></div> : null}
      {okMsg ? <div className="callout callout-success"><p>{okMsg}</p></div> : null}
      <div className="callout callout-info">
        <p>
          Workflow emails now go only to the app users you select below (plus extra addresses).
          Admin / IT Asset Manager membership no longer emails the whole role.
          Delivery and failures are recorded in <Link to="/settings/email-logs">Email logs</Link>.
        </p>
      </div>

      <div className="row">
        <div className="col-md-7">
          <Box title="Email alerts" type="primary">
            <form className="form-horizontal" onSubmit={(e) => { void submit(e) }}>
              <div className={`callout ${cfg.emails_enabled ? 'callout-success' : 'callout-warning'}`}>
                <label className="checkbox" style={{ display: 'block', margin: 0, fontWeight: 700 }}>
                  <input
                    type="checkbox"
                    disabled={!canEdit}
                    checked={cfg.emails_enabled}
                    onChange={(e) => setCfg((c) => ({ ...c, emails_enabled: e.target.checked }))}
                  />
                  {' '}Email notifications are {cfg.emails_enabled ? 'enabled' : 'disabled'}
                </label>
                <p className="help-block" style={{ margin: '8px 0 0' }}>
                  Keep this off to stop asset create/delete, assign, maintenance, inventory, EOL, and license emails.
                  Battery Degradation call emails are separate and stay on unless you turn that category off below.
                  Recipients for those are set in Settings → Battery Degradation.
                </p>
              </div>

              <Field label="SMTP">
                <p className={`help-block ${smtpOk ? 'text-success' : 'text-danger'}`} style={{ marginTop: 0 }}>
                  {smtpHint}
                </p>
                <span className="help-block">
                  Host, user, and password live in <code>server/.env</code>:
                  {' '}<code>SMTP_HOST</code>, <code>SMTP_PORT</code>, <code>SMTP_USER</code>, <code>SMTP_PASS</code>, <code>SMTP_FROM</code>.
                  Default host is <code>smtp.zoho.in</code> port 465.
                </span>
                <p style={{ marginTop: 8 }}>
                  <Link to="/settings/email-logs">View email delivery log →</Link>
                </p>
              </Field>

              <Field label="Fallback alert email">
                <input
                  className="form-control"
                  type="email"
                  value={alertEmail}
                  disabled={!canEdit}
                  onChange={(e) => setAlertEmail(e.target.value)}
                  placeholder="ops@refex.co.in"
                />
                <span className="help-block">Always included when set (EOL digests + workflow ops mail).</span>
              </Field>

              <Field label="Extra ops emails">
                <textarea
                  className="form-control"
                  rows={3}
                  disabled={!canEdit}
                  value={cfg.extra_ops_emails}
                  onChange={(e) => setCfg((c) => ({ ...c, extra_ops_emails: e.target.value }))}
                  placeholder="one@refex.co.in, two@refex.co.in"
                />
                <span className="help-block">Comma or newline separated. Added on top of role-based recipients.</span>
              </Field>

              <Field label="App users who receive emails">
                <span className="help-block" style={{ marginTop: 0 }}>
                  Only the people you tick here get asset create/delete, assign, and workflow emails.
                  Granting a role (Admin / IT Asset Manager) no longer emails everyone in that role.
                </span>
                <input
                  className="form-control"
                  style={{ marginBottom: 8 }}
                  placeholder="Search name or email"
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                />
                <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid #d2d6de', padding: '8px 10px', background: '#fff' }}>
                  {appUsers
                    .filter((u) => {
                      const q = userQuery.trim().toLowerCase()
                      if (!q) return true
                      return `${u.name} ${u.email || ''}`.toLowerCase().includes(q)
                    })
                    .map((u) => {
                      const checked = cfg.email_recipient_user_ids.includes(u.id)
                      return (
                        <label key={u.id} className="checkbox" style={{ display: 'block', marginBottom: 4 }}>
                          <input
                            type="checkbox"
                            disabled={!canEdit}
                            checked={checked}
                            onChange={(e) => setCfg((c) => ({
                              ...c,
                              email_recipient_user_ids: e.target.checked
                                ? [...new Set([...c.email_recipient_user_ids, u.id])]
                                : c.email_recipient_user_ids.filter((id) => id !== u.id),
                            }))}
                          />
                          {' '}{u.name}
                          {u.email ? <span className="text-muted"> — {u.email}</span> : <span className="text-muted"> — no email</span>}
                        </label>
                      )
                    })}
                  {appUsers.length === 0 ? <p className="text-muted" style={{ margin: 0 }}>No activated app users.</p> : null}
                </div>
                <p className="help-block">
                  {cfg.email_recipient_user_ids.length} selected.
                  You can also tick “Receive ops workflow emails” on a role under{' '}
                  <Link to="/settings/roles">Roles & permissions</Link>.
                </p>
              </Field>

              <Field label="Recipient rules">
                <label className="checkbox" style={{ display: 'block' }}>
                  <input
                    type="checkbox"
                    disabled={!canEdit || !cfg.emails_enabled}
                    checked={cfg.workflow_to_ops_roles}
                    onChange={(e) => setCfg((c) => ({ ...c, workflow_to_ops_roles: e.target.checked }))}
                  />
                  {' '}Also email every app user whose role has “Receive ops emails”
                </label>
                <span className="help-block">
                  Leave this off unless you really want that role permission to fan out mail.
                  Admin / Superuser / IT Asset Manager no longer receive mail just because of the role.
                </span>
                <label className="checkbox" style={{ display: 'block' }}>
                  <input
                    type="checkbox"
                    disabled={!canEdit || !cfg.emails_enabled}
                    checked={cfg.eol_to_it_asset_manager}
                    onChange={(e) => setCfg((c) => ({ ...c, eol_to_it_asset_manager: e.target.checked }))}
                  />
                  {' '}Send EOL & warranty prior alerts to <strong>IT Asset Manager</strong> role members
                </label>
              </Field>

              <Field label="Alert categories">
                {categories.map((cat) => {
                  const independent = cat.key === 'battery_calls'
                  return (
                    <label key={cat.key} className="checkbox" style={{ display: 'block', marginBottom: 6 }}>
                      <input
                        type="checkbox"
                        disabled={!canEdit || (!independent && !cfg.emails_enabled)}
                        checked={cfg.email_notifications[cat.key] !== false}
                        onChange={(e) => setCfg((c) => ({
                          ...c,
                          email_notifications: { ...c.email_notifications, [cat.key]: e.target.checked },
                        }))}
                      />
                      {' '}{cat.label}
                    </label>
                  )
                })}
              </Field>

              <div className="form-actions">
              {canEdit ? (
                <button type="submit" className="btn btn-theme" disabled={busy}>
                  {busy ? 'Saving…' : 'Save notification settings'}
                </button>
              ) : (
                <p className="text-muted">You have view-only access.</p>
              )}
              <button
                type="button"
                className="btn btn-default"
                disabled={digestBusy || !smtpOk}
                onClick={() => {
                  setDigestBusy(true)
                  setError('')
                  setOkMsg('')
                  api<{ messages?: string[]; payload?: { skippedReason?: string; sent?: boolean; emailedTo?: string } }>(
                    '/notifications/eol/run',
                    { method: 'POST' },
                  )
                    .then((res) => {
                      const p = res.payload
                      setOkMsg(
                        p?.sent
                          ? `EOL/warranty prior alerts sent${p.emailedTo ? ` → ${p.emailedTo}` : ''}`
                          : (p?.skippedReason || 'Skipped'),
                      )
                    })
                    .catch((err: Error) => setError(err.message))
                    .finally(() => setDigestBusy(false))
                }}
              >
                {digestBusy ? 'Running…' : 'Run EOL/warranty alerts now'}
              </button>
              <button
                type="button"
                className="btn btn-default"
                disabled={licDigestBusy || !smtpOk}
                onClick={() => {
                  setLicDigestBusy(true)
                  setError('')
                  setOkMsg('')
                  api<{ messages?: string[]; payload?: { skippedReason?: string; sent?: boolean; emailedTo?: string } }>(
                    '/notifications/licenses/run',
                    { method: 'POST' },
                  )
                    .then((res) => {
                      const p = res.payload
                      setOkMsg(
                        p?.sent
                          ? `License renewal alerts sent${p.emailedTo ? ` → ${p.emailedTo}` : ''}`
                          : (p?.skippedReason || 'Skipped'),
                      )
                    })
                    .catch((err: Error) => setError(err.message))
                    .finally(() => setLicDigestBusy(false))
                }}
              >
                {licDigestBusy ? 'Running…' : 'Run license renewal alerts now'}
              </button>
              </div>
            </form>
          </Box>
        </div>

        <div className="col-md-5">
          <Box title="IT Asset Manager members" type="default">
            <p className="help-block">
              Manage who is in this role under{' '}
              <Link to="/settings/roles">Settings → Roles & permissions</Link>.
            </p>
            {itam.length === 0 ? (
              <p className="text-muted">No users in IT Asset Manager yet.</p>
            ) : (
              <ul className="list-unstyled" style={{ marginBottom: 0 }}>
                {itam.map((u) => (
                  <li key={u.id} style={{ marginBottom: 6 }}>
                    <strong>{u.name}</strong>
                    <br />
                    <span className="text-muted">{u.email || 'no email'}</span>
                  </li>
                ))}
              </ul>
            )}
          </Box>

          <Box title="Resolved recipients (live)" type="default">
            <h5>Workflow / ops</h5>
            {resolvedOps.length ? (
              <ul>{resolvedOps.map((e) => <li key={e}>{e}</li>)}</ul>
            ) : (
              <p className="text-muted">None yet — assign roles or set alert email.</p>
            )}
            <h5>EOL & warranty</h5>
            {resolvedEol.length ? (
              <ul>{resolvedEol.map((e) => <li key={`e-${e}`}>{e}</li>)}</ul>
            ) : (
              <p className="text-muted">None yet.</p>
            )}
          </Box>
        </div>
      </div>
    </AppLayout>
  )
}
