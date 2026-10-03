import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../api/AuthContext'
import { setToken } from '../api/client'
import { consumeLoginNext } from '../utils/loginNext'

/** Completes SAML SSO: IdP redirects here with ?token=JWT */
export default function SsoCallback() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { refreshUser } = useAuth()
  const [error, setError] = useState('')

  useEffect(() => {
    const token = params.get('token')
    if (!token) {
      setError('Missing SSO token')
      return
    }
    setToken(token)
    refreshUser()
      .then(() => navigate(consumeLoginNext(params.get('next')), { replace: true }))
      .catch((e: Error) => {
        setToken(null)
        setError(e.message || 'SSO session failed')
      })
  }, [params, navigate, refreshUser])

  return (
    <div style={{ maxWidth: 420, margin: '64px auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      {error ? (
        <>
          <h1 style={{ fontSize: 20 }}>SSO failed</h1>
          <p>{error}</p>
          <a href="/login">Back to login</a>
        </>
      ) : (
        <p>Signing you in…</p>
      )}
    </div>
  )
}
