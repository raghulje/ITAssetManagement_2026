import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { api } from '../api/client'
import '../components/login/login-suite.css'

function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="suite-page login-page" style={{ minHeight: '100vh' }}>
      <div className="login-box" style={{ margin: '48px auto', maxWidth: 420 }}>
        <div className="login-box-body">
          <h3 style={{ marginTop: 0, marginBottom: 8, textAlign: 'center' }}>{title}</h3>
          {children}
        </div>
      </div>
    </div>
  )
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [okMsg, setOkMsg] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    setOkMsg('')
    try {
      const res = await api<{ messages?: string[] }>('/password/forgot', {
        method: 'POST',
        json: { email: email.trim().toLowerCase() },
      })
      setOkMsg(Array.isArray(res.messages) ? res.messages.join(' ') : 'If that email is registered, a reset link has been sent.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Forgot password">
      <p className="login-box-msg">Enter your work email and we will send a reset link.</p>
      {error ? <div className="em-error" role="alert">{error}</div> : null}
      {okMsg ? <div className="callout callout-success" style={{ marginBottom: 14 }}><p style={{ margin: 0 }}>{okMsg}</p></div> : null}
      {!okMsg && (
        <form onSubmit={(e) => { void submit(e) }}>
          <div className="form-group" style={{ marginBottom: 14 }}>
            <label htmlFor="forgot-email" style={{ display: 'block', textAlign: 'left', marginBottom: 6, fontWeight: 650 }}>Email</label>
            <input
              id="forgot-email"
              className="form-control"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@refex.co.in"
            />
          </div>
          <button type="submit" className="btn btn-theme w-100" disabled={busy}>
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}
      <p style={{ marginTop: 18, textAlign: 'center' }}>
        <Link to="/login">Back to sign in</Link>
      </p>
    </AuthShell>
  )
}

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') || ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(true)
  const [valid, setValid] = useState(false)
  const [error, setError] = useState('')
  const [okMsg, setOkMsg] = useState('')

  useEffect(() => {
    if (!token) {
      setError('Missing reset token. Use the link from your email.')
      setValid(false)
      setChecking(false)
      return
    }
    setChecking(true)
    api(`/password/reset/${encodeURIComponent(token)}`)
      .then(() => { setValid(true); setError('') })
      .catch((e: Error) => {
        setValid(false)
        setError(e.message || 'This reset link is invalid or has expired')
      })
      .finally(() => setChecking(false))
  }, [token])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
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
      const res = await api<{ messages?: string[] }>('/password/reset', {
        method: 'POST',
        json: { token, password, password_confirmation: confirm },
      })
      setOkMsg(Array.isArray(res.messages) ? res.messages.join(' ') : 'Password has been reset.')
      setValid(false)
      setTimeout(() => navigate('/login'), 1600)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Reset password">
      <p className="login-box-msg">Choose a new password for your account.</p>
      {checking ? <p className="text-muted">Checking link…</p> : null}
      {error ? <div className="em-error" role="alert">{error}</div> : null}
      {okMsg ? <div className="callout callout-success" style={{ marginBottom: 14 }}><p style={{ margin: 0 }}>{okMsg}</p></div> : null}
      {!checking && valid && !okMsg ? (
        <form onSubmit={(e) => { void submit(e) }}>
          <div className="form-group" style={{ marginBottom: 14 }}>
            <label htmlFor="reset-pass" style={{ display: 'block', textAlign: 'left', marginBottom: 6, fontWeight: 650 }}>New password</label>
            <input
              id="reset-pass"
              className="form-control"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          <div className="form-group" style={{ marginBottom: 14 }}>
            <label htmlFor="reset-confirm" style={{ display: 'block', textAlign: 'left', marginBottom: 6, fontWeight: 650 }}>Confirm password</label>
            <input
              id="reset-confirm"
              className="form-control"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          <button type="submit" className="btn btn-theme w-100" disabled={busy}>
            {busy ? 'Saving…' : 'Update password'}
          </button>
        </form>
      ) : null}
      {!checking && !valid && !okMsg ? (
        <p style={{ textAlign: 'center' }}>
          <Link to="/forgot-password">Request a new reset link</Link>
        </p>
      ) : null}
      <p style={{ marginTop: 18, textAlign: 'center' }}>
        <Link to="/login">Back to sign in</Link>
      </p>
    </AuthShell>
  )
}
