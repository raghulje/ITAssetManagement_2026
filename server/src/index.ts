import dotenv from 'dotenv'
import { createApp } from './app.js'
import { seed } from './db/seed.js'
import { startHrmsAutoSync } from './services/employeeHrmsSync.js'
import { startEolAlertScheduler } from './services/eolAlerts.js'
import { startLicenseAlertScheduler } from './services/licenseAlerts.js'
import { startIgnoredCallScheduler } from './services/batteryIgnoredCallback.js'
import { assignEligibleIssues } from './services/batteryTechnicianAssign.js'

dotenv.config()

const port = Number(process.env.PORT) || 3001
const host = process.env.HOST || '0.0.0.0'
const serveClient = process.env.SERVE_CLIENT === 'true'
const publicApp = (process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '')

await seed()
try {
  const { ensureDefaultRoles } = await import('./services/permissions.js')
  await ensureDefaultRoles()
  console.log('Roles & permissions ready')
} catch (e) {
  console.warn('ensureDefaultRoles failed:', e instanceof Error ? e.message : e)
}

const app = createApp()

app.listen(port, host, () => {
  console.log(`Refex API listening on http://${host}:${port}`)
  console.log(`Local:  http://localhost:${port}`)
  if (serveClient) {
    console.log(`Mode:   SERVE_CLIENT=true (API + client/out on one port — Biogas_MIS style)`)
    if (publicApp) console.log(`Public: ${publicApp}`)
    else console.log(`Public: set PUBLIC_APP_URL / FRONTEND_URL in server/.env to your mapped domain`)
  } else {
    console.log(`Dev:    Vite on :5173 + API on :${port} (set SERVE_CLIENT=true for single-port deploy)`)
  }
  console.log(`Health: http://localhost:${port}/api/v1/status`)
  console.log(`Login:  POST /api/v1/login  { "email": "…", "password": "…" }`)
  startHrmsAutoSync()
  startEolAlertScheduler()
  startLicenseAlertScheduler()
  startIgnoredCallScheduler()
  void assignEligibleIssues()
    .then((r) => {
      console.log(`Battery technician assignment backfill: ${r.assigned} assigned, ${r.skipped} skipped`)
    })
    .catch((e) => console.warn('Battery technician assignment backfill failed:', e instanceof Error ? e.message : e))
})
