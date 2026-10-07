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
  const [recordingsBusy, setRecordingsBusy] = useState(false)
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
        json: { agent_id: agentId.trim(), notify_email: notifyEmail.trim() },
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
              This is not turned off by Settings → Notifications master switch.
            </span>
          </Field>
          {/* Kissflow webhook posting is paused. Keep the field/code here to turn back on later.
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
            </span>
          </Field>
          */}
          <p className="help-block">
            Kissflow webhook posting is paused. Issues stay in this system. The webhook code is kept and can be turned back on later.
            {webhookUrl ? ' A webhook URL is already saved on this server but is not being posted to.' : ''}
          </p>
          <p className="help-block">
            After the employee says yes to any other IT issue, the Ello prompt should ask what kind of issue it is
            (Wi-Fi, email, laptop, printer, login, and so on) and let them describe it. This app stores those types
            from the transcript for insights.
          </p>
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
        <p className="help-block" style={{ marginTop: 16 }}>
          Use this after deploying the call-recording / English-transcript update. It only applies
          migration <code>054</code> (local recordings) and <code>055</code> (English transcript cache).
          It does not import contacts again.
        </p>
        <button
          type="button"
          className="btn btn-default"
          disabled={recordingsBusy || !canEdit}
          onClick={() => {
            if (!window.confirm(
              'Apply call recordings migration 054 on this server?\n\nThis adds local recording storage and English transcript cache. It does not import contacts.',
            )) return
            setRecordingsBusy(true)
            setError('')
            setOkMsg('')
            api<{ messages?: string[] }>('/settings/run-battery-recordings-migration', { method: 'POST' })
              .then((res) => {
                const msg = Array.isArray(res.messages) ? res.messages.join(' ') : 'Call recordings migration applied'
                setOkMsg(msg)
                toast.success(msg)
              })
              .catch((err: Error) => {
                setError(err.message)
                toast.error(err.message)
              })
              .finally(() => setRecordingsBusy(false))
          }}
        >
          {recordingsBusy ? 'Applying…' : 'Apply call recordings migration (054)'}
        </button>
      </Box>
    </AppLayout>
  )
}
