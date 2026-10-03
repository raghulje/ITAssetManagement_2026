import { useEffect, useState, type FormEvent } from 'react'
import AppLayout from '../../layout/AppLayout'
import { Box, Field } from '../../components/ui'
import { api } from '../../api/client'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../api/AuthContext'

type BatteryCfg = { agent_id: string; notify_email: string; webhook_url: string }

export default function BatterySettings() {
  const toast = useToast()
  const { can } = useAuth()
  const canEdit = can('settings.edit')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [migrateBusy, setMigrateBusy] = useState(false)
  const [error, setError] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const [agentId, setAgentId] = useState('')
  const [notifyEmail, setNotifyEmail] = useState('')
  const [webhookUrl, setWebhookUrl] = useState('')

  const load = () => {
    setLoading(true)
    api<BatteryCfg>('/settings/battery')
      .then((s) => {
        setAgentId(String(s.agent_id || ''))
        setNotifyEmail(String(s.notify_email || ''))
        setWebhookUrl(String(s.webhook_url || ''))
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    setOkMsg('')
    try {
      const res = await api<{ messages?: string[]; payload?: BatteryCfg }>('/settings/battery', {
        method: 'PUT',
        json: { agent_id: agentId.trim(), notify_email: notifyEmail.trim(), webhook_url: webhookUrl.trim() },
      })
      if (res.payload) {
        setAgentId(res.payload.agent_id || '')
        setNotifyEmail(res.payload.notify_email || '')
        setWebhookUrl(res.payload.webhook_url || '')
      }
      const msg = Array.isArray(res.messages) ? res.messages.join(' ') : 'Battery Degradation settings saved'
      setOkMsg(msg)
      toast.success(msg)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Save failed'
      setError(message)
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }

  const runMigration = () => {
    if (!window.confirm(
      'Run Battery Degradation setup on this server?\n\nThis creates the module tables if they are missing and imports the RIL Asset Couriered List as new issues with no call history. Existing matching contacts are skipped.',
    )) return
    setMigrateBusy(true)
    setError('')
    setOkMsg('')
    api<{ messages?: string[] }>('/settings/run-battery-migration', { method: 'POST' })
      .then((res) => {
        const msg = Array.isArray(res.messages) ? res.messages.join(' ') : 'Battery Degradation setup complete'
        setOkMsg(msg)
        toast.success(msg)
      })
      .catch((err: Error) => {
        setError(err.message)
        toast.error(err.message)
      })
      .finally(() => setMigrateBusy(false))
  }

  if (loading) {
    return <AppLayout title="Battery Degradation" backTo="/settings"><p className="text-muted">Loading…</p></AppLayout>
  }

  return (
    <AppLayout title="Battery Degradation" backTo="/settings">
      {error ? <div className="callout callout-danger"><p>{error}</p></div> : null}
      {okMsg ? <div className="callout callout-success"><p>{okMsg}</p></div> : null}

      <Box title="Voice agent & notifications" type="primary">
        <p className="help-block" style={{ marginTop: 0 }}>
          Saved here for this server — you do not need to put the agent id or notify email in <code>.env</code>.
          The Ello API key still stays in <code>server/.env</code> as <code>ELLO_API_KEY</code>.
        </p>
        <form className="form-horizontal" onSubmit={(e) => { void save(e) }}>
          <Field label="Ello agent id">
            <input
              className="form-control"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              placeholder="6abe1d312713e05e957c8eb4"
              disabled={!canEdit}
            />
            <span className="help-block">Outbound voice calls use this Battery Degradation agent.</span>
          </Field>
          <Field label="Notify email">
            <input
              className="form-control"
              value={notifyEmail}
              onChange={(e) => setNotifyEmail(e.target.value)}
              placeholder="it.assets@refex.co.in"
              disabled={!canEdit}
            />
            <span className="help-block">
              Receives new issue submissions and completed-call alerts. Separate multiple addresses with commas.
            </span>
          </Field>
          <Field label="Issue webhook URL">
            <input
              className="form-control"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://development-refexgroup.kissflow.com/integration/…"
              disabled={!canEdit}
            />
            <span className="help-block">
              Kissflow IT Service Request webhook. Posted when the employee says yes to battery drain or any other IT issue.
              The default development URL is used if you leave this blank.
            </span>
          </Field>
          <div className="form-actions">
            <button type="submit" className="btn btn-theme" disabled={busy || !canEdit}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </Box>

      <Box title="Production setup" type="primary">
        <p className="help-block" style={{ marginTop: 0 }}>
          Click once on production after this code is deployed. It applies Battery Degradation database
          tables and imports the RIL Asset Couriered List as fresh issues (name, phone, email, company only —
          no conversation history).
        </p>
        <button
          type="button"
          className="btn btn-theme"
          disabled={migrateBusy || !canEdit}
          onClick={runMigration}
        >
          {migrateBusy ? 'Running…' : 'Run Battery Degradation migration'}
        </button>
      </Box>
    </AppLayout>
  )
}
