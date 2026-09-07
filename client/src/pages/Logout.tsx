import { useEffect } from 'react'
import { useAuth } from '../api/AuthContext'

/**
 * /logout — clear the Asset Management session and send the user to RefexOne.
 * Used by the in-app Refresh control and by the RefexOne host Refresh URL.
 */
export default function LogoutPage() {
  const { logout } = useAuth()

  useEffect(() => {
    logout()
    // Run once on mount — logout navigates away to RefexOne
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="refexone-logout-page">
      <div className="refexone-logout-card">
        <i className="fas fa-sync-alt fa-spin" aria-hidden="true" />
        <h1>Signing out…</h1>
        <p>Redirecting to RefexOne</p>
      </div>
    </div>
  )
}
