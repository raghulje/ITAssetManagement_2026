import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import helmet from 'helmet'
import compression from 'compression'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { authRequired } from './middleware/auth.js'
import { fail } from './utils/response.js'
import authRouter from './routes/auth.js'
import hardwareRouter from './routes/hardware.js'
import licensesRouter from './routes/licenses.js'
import { accessoriesRouter, consumablesRouter, componentsRouter, kitsRouter } from './routes/inventory.js'
import { usersRouter, mastersRouter } from './routes/users.js'
import { employeesRouter } from './routes/employees.js'
import {
  reportsRouter, maintenancesRouter, dashboardRouter,
  settingsRouter, accountRouter, requestsRouter,
} from './routes/reports.js'
import importsRouter from './routes/imports.js'
import filesRouter from './routes/files.js'
import labelsRouter from './routes/labels.js'
import labelCodesRouter from './routes/labelCodes.js'
import publicAssetsRouter from './routes/publicAssets.js'
import agentRouter from './routes/agent.js'
import samlRouter from './routes/saml.js'
import { groupsRouter } from './routes/groups.js'
import { geoRouter } from './routes/geo.js'
import { spacesRouter } from './routes/spaces.js'
import { storageRoot } from './services/uploads.js'
import { moduleGate, requirePerm } from './services/permissions.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const clientOutPath = path.resolve(__dirname, '../../client/out')

export function createApp() {
  const app = express()

  // Vizag pattern: Helmet defaults (HSTS + upgrade-insecure-requests) break plain HTTP LAN
  // (e.g. http://10.x.x.x:3001) by forcing https:// and blank pages.
  const useHttps = process.env.FORCE_HTTPS === 'true'
  app.use(helmet({
    hsts: useHttps ? undefined : false,
    crossOriginOpenerPolicy: useHttps ? { policy: 'same-origin' } : false,
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        upgradeInsecureRequests: useHttps ? [] : null,
        'font-src': ["'self'", 'https:', 'data:', 'https://cdnjs.cloudflare.com', 'https://fonts.gstatic.com'],
        'style-src': ["'self'", 'https:', "'unsafe-inline'", 'https://cdnjs.cloudflare.com', 'https://fonts.googleapis.com'],
        'img-src': ["'self'", 'data:', 'blob:', 'https:'],
        'script-src': [
          "'self'",
          "'unsafe-inline'",
          'https://maps.googleapis.com',
          'https://maps.gstatic.com',
        ],
        'script-src-elem': [
          "'self'",
          "'unsafe-inline'",
          'https://maps.googleapis.com',
          'https://maps.gstatic.com',
        ],
        'connect-src': ["'self'", 'http:', 'https:'],
        'worker-src': ["'self'", 'blob:'],
        'frame-src': ["'self'", 'https://www.google.com', 'https://maps.google.com'],
      },
    },
  }))

  app.use(cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true)
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return cb(null, true)
      if (/^https?:\/\/(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$/i.test(origin)) {
        return cb(null, true)
      }
      const allowed = String(process.env.CLIENT_ORIGIN || process.env.FRONTEND_URL || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (allowed.includes(origin)) return cb(null, true)
      return cb(null, false)
    },
    credentials: true,
  }))

  app.use(compression())
  app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '20mb' }))
  app.use(express.urlencoded({ extended: false }))
  app.use(process.env.NODE_ENV === 'production' ? morgan('combined') : morgan('dev'))

  // Public static files (images, barcodes)
  app.use('/storage', express.static(path.join(storageRoot, 'public'), {
    fallthrough: true,
  }))
  app.use('/storage', express.static(storageRoot))

  app.get('/api/v1/status', (_req, res) => {
    res.json({
      status: 'ok',
      product: 'Refex Asset Management',
      version: '1.1.0',
      serve_client: process.env.SERVE_CLIENT === 'true',
      features: ['imports', 'labels', 'uploads', 'signatures', 'reports', 'public-qr', 'agent-sync', 'agent-remote-scan', 'saml-sso'],
    })
  })

  app.use('/api/v1', authRouter)
  // SAML SSO (IdP → ACS POST is application/x-www-form-urlencoded; no JWT yet)
  app.use('/api/v1/auth/saml', samlRouter)
  // Public QR scan + device agent (no session cookie)
  app.use('/api/v1/public', publicAssetsRouter)
  app.use('/api/v1/agent', agentRouter)

  const api = express.Router()
  api.use(authRequired)

  api.use('/groups', groupsRouter)
  api.use('/hardware', moduleGate('assets'), hardwareRouter)
  api.use('/licenses', moduleGate('licenses'), licensesRouter)
  api.use('/accessories', moduleGate('accessories'), accessoriesRouter)
  api.use('/consumables', moduleGate('consumables'), consumablesRouter)
  api.use('/components', moduleGate('components'), componentsRouter)
  api.use('/kits', moduleGate('assets'), kitsRouter)
  api.use('/users', moduleGate('people'), usersRouter)
  api.use('/employees', moduleGate('people'), employeesRouter)
  // Masters: GET selectlists open to authenticated users; mutating masters needs settings.edit.
  // Path-scoped so POST /labels, /hardware, etc. are not blocked by settings.edit.
  api.use([
    '/companies', '/legal-entities', '/locations', '/departments',
    '/manufacturers', '/suppliers', '/categories', '/statuslabels',
    '/depreciations', '/models', '/fields', '/fieldsets',
    '/location-types', '/space-subtypes',
  ], (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next()
    return requirePerm('settings.edit')(req, res, next)
  })
  api.use(mastersRouter)
  api.use('/reports', moduleGate('reports'), reportsRouter)
  api.use('/maintenances', moduleGate('maintenance'), maintenancesRouter)
  api.use('/dashboard', dashboardRouter)
  api.use('/settings', moduleGate('settings'), settingsRouter)
  api.use('/account', accountRouter)
  api.use('/requests', moduleGate('assets'), requestsRouter)
  api.post('/notifications/eol/run', requirePerm('settings.edit'), async (_req, res) => {
    const { runEolAlertDigest } = await import('./services/eolAlerts.js')
    const { okMessage, fail: failRes } = await import('./utils/response.js')
    try {
      const result = await runEolAlertDigest()
      return okMessage(res, result.sent ? 'EOL digest sent' : (result.skippedReason || 'Skipped'), result)
    } catch (e) {
      return failRes(res, e instanceof Error ? e.message : 'EOL digest failed', 500)
    }
  })
  api.post('/notifications/licenses/run', requirePerm('settings.edit'), async (_req, res) => {
    const { runLicenseRenewalDigest } = await import('./services/licenseAlerts.js')
    const { okMessage, fail: failRes } = await import('./utils/response.js')
    try {
      const result = await runLicenseRenewalDigest()
      return okMessage(
        res,
        result.sent ? 'License renewal digest sent' : (result.skippedReason || 'Skipped'),
        result,
      )
    } catch (e) {
      return failRes(res, e instanceof Error ? e.message : 'License renewal digest failed', 500)
    }
  })
  api.use('/imports', requirePerm('settings.edit'), importsRouter)
  api.use('/labels', moduleGate('assets'), labelsRouter)
  api.use('/label-codes', moduleGate('assets'), labelCodesRouter)
  api.use('/geo', geoRouter)
  api.use('/spaces', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return requirePerm('settings.view')(req, res, next)
    return requirePerm('settings.edit')(req, res, next)
  })
  api.use('/spaces', spacesRouter)
  api.use(filesRouter)

  app.use('/api/v1', api)

  // Biogas_MIS_Vizag pattern: SERVE_CLIENT=true → one process serves UI + API
  const shouldServeClient = process.env.SERVE_CLIENT === 'true'
  if (shouldServeClient && fs.existsSync(clientOutPath)) {
    console.log('Serving production client from:', clientOutPath)
    app.use(express.static(clientOutPath, {
      maxAge: '1y',
      etag: true,
      lastModified: true,
      setHeaders(res, filePath) {
        const ext = path.extname(filePath).toLowerCase()
        const oneYear = 31536000
        if (['.js', '.css', '.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.eot'].includes(ext)) {
          res.setHeader('Cache-Control', `public, max-age=${oneYear}, immutable`)
        } else if (ext === '.html') {
          res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate')
        }
      },
    }))

    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next()
      const p = req.path || ''
      if (p.startsWith('/api') || p.startsWith('/storage') || p.startsWith('/uploads')) {
        return next()
      }
      return res.sendFile(path.join(clientOutPath, 'index.html'))
    })
  } else if (shouldServeClient) {
    console.warn('SERVE_CLIENT=true but client/out not found — run: cd client && npm run build')
  } else {
    app.get('/', (req, res) => {
      const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'
      const host = req.get('host')
      const baseUrl = `${protocol}://${host}`
      res.json({
        message: 'Refex Asset Management API is running',
        mode: process.env.NODE_ENV || 'development',
        apiUrl: `${baseUrl}/api/v1`,
        clientUrl: process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || `${protocol}://${String(host).split(':')[0]}:5173`,
        note: 'Set SERVE_CLIENT=true and build client/out to serve the UI from this process (Biogas_MIS_Vizag style)',
      })
    })
  }

  app.use((_req, res) => fail(res, 'Not found', 404))
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err)
    return fail(res, err.message || 'Server error', 500)
  })

  return app
}
