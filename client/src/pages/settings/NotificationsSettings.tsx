import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import AppLayout from '../../layout/AppLayout'
import { Box, Field } from '../../components/ui'
import { api } from '../../api/client'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../api/AuthContext'

type Category = { key: string; label: string }
type Snapshot = {
  smtp_configured: boolean
  smtp_hint: string
  alert_email: string | null
  config: {
    email_notifications: Record<string, boolean>
    extra_ops_emails: string
    eol_to_it_asset_manager: boolean
    workflow_to_ops_roles: boolean
  }
  it_asset_managers: Array<{ id: number; name: string; email: string | null }>
  resolved_ops_emails: string[]
  resolved_eol_emails: string[]
  categories: Category[]
}

const emptyCfg = {
  email_notifications: {
    custody: true,
    maintenance: true,
    inventory: true,
    crud: true,
    eol_warranty: true,
    license_renewal: true,
  } as Record<string, boolean>,
  extra_ops_emails: '',
  eol_to_it_asset_manager: true,
  workflow_to_ops_roles: true,
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
          email_notifications: { ...emptyCfg.email_notifications, ...(s.config?.email_notifications || {}) },
          extra_ops_emails: String(s.config?.extra_ops_emails || ''),
          eol_to_it_asset_manager: s.config?.eol_to_it_asset_manager !== false,
          workflow_to_ops_roles: s.config?.workflow_to_ops_roles !== false,
        })
        setCategories(s.categories || [])
        setItam(s.it_asset_managers || [])
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
          email_notifications: cfg.email_notifications,
          extra_ops_emails: cfg.extra_ops_emails,
          eol_to_it_asset_manager: cfg.eol_to_it_asset_manager,
          workflow_to_ops_roles: cfg.workflow_to_ops_roles,
        },
      })
      const s = res.payload
      if (s) {
        setResolvedOps(s.resolved_ops_emails || [])
        setResolvedEol(s.resolved_eol_emails || [])
        setItam(s.it_asset_managers || [])
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

      <div className="row">
        <div className="col-md-7">
          <Box title="Email alerts" type="primary">
            <form className="form-horizontal" onSubmit={(e) => { void submit(e) }}>
              <Field label="SMTP">
                <p className={`help-block ${smtpOk ? 'text-success' : 'text-danger'}`} style={{ marginTop: 0 }}>
                  {smtpHint}
                </p>
                <span className="help-block">
                  Host/user/password live in <code>server/.env</code> (same pattern as Biogas SMTP tab, env-backed here).
                </span>
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

              <Field label="Recipient rules">
                <label className="checkbox" style={{ display: 'block' }}>
                  <input
                    type="checkbox"
                    disabled={!canEdit}
                    checked={cfg.workflow_to_ops_roles}
                    onChange={(e) => setCfg((c) => ({ ...c, workflow_to_ops_roles: e.target.checked }))}
                  />
                  {' '}Send workflow emails to Admin / Superuser / roles with “Receive ops emails”
                </label>
                <label className="checkbox" style={{ display: 'block' }}>
                  <input
                    type="checkbox"
                    disabled={!canEdit}
                    checked={cfg.eol_to_it_asset_manager}
                    onChange={(e) => setCfg((c) => ({ ...c, eol_to_it_asset_manager: e.target.checked }))}
                  />
                  {' '}Send EOL & warranty prior alerts to <strong>IT Asset Manager</strong> role members
                </label>
              </Field>

              <Field label="Alert categories">
                {categories.map((cat) => (
                  <label key={cat.key} className="checkbox" style={{ display: 'block', marginBottom: 6 }}>
                    <input
                      type="checkbox"
                      disabled={!canEdit}
                      checked={cfg.email_notifications[cat.key] !== false}
                      onChange={(e) => setCfg((c) => ({
                        ...c,
                        email_notifications: { ...c.email_notifications, [cat.key]: e.target.checked },
                      }))}
                    />
                    {' '}{cat.label}
                  </label>
                ))}
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
