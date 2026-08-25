/**
 * Wave 2.3 — production GET-only smoke against ITAssetManagement_2026.
 */
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: path.join(serverRoot, '.env') })

const PROD = 'ITAssetManagement_2026'
const selectedEnv = String(process.env.DB_NAME || '')
if (selectedEnv.toLowerCase() !== PROD.toLowerCase()) {
  console.error(`Refusing smoke: DB_NAME=${selectedEnv} (expected ${PROD})`)
  process.exit(2)
}

async function json(base: string, p: string, headers: Record<string, string>) {
  const res = await fetch(`${base}${p}`, { headers: { Accept: 'application/json', ...headers } })
  const text = await res.text()
  let body: unknown = text
  try { body = text ? JSON.parse(text) : null } catch { /* keep */ }
  return { status: res.status, body }
}

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: PROD,
})
const [[db]] = await conn.query<mysql.RowDataPacket[]>('SELECT DATABASE() AS d')
if (String(db.d).toLowerCase() !== PROD.toLowerCase()) {
  await conn.end()
  throw new Error(`DATABASE SAFETY BLOCKER: ${db.d}`)
}
const [[user]] = await conn.query<mysql.RowDataPacket[]>(`
  SELECT id, username FROM users WHERE deleted_at IS NULL AND activated = 1 ORDER BY id ASC LIMIT 1
`)
await conn.end()
if (!user) throw new Error('No activated user')

const { signToken } = await import('../src/middleware/auth.js')
const { startApp } = await import('../test/wave0/helpers/http.js')
const { getPool } = await import('../src/db/index.js')
const poolDb = await getPool().query('SELECT DATABASE() AS d')
const poolName = (poolDb[0] as mysql.RowDataPacket[])[0]?.d
if (String(poolName).toLowerCase() !== PROD.toLowerCase()) {
  throw new Error(`App pool not production: ${poolName}`)
}

const app = await startApp()
const auth = { Authorization: `Bearer ${signToken({ id: Number(user.id), username: String(user.username) })}` }
try {
  const status = await json(app.baseUrl, '/api/v1/status', {})
  const locations = await json(app.baseUrl, '/api/v1/locations?limit=5', auth)
  const selectlist = await json(app.baseUrl, '/api/v1/locations/selectlist?limit=20', auth)
  const hardware = await json(app.baseUrl, '/api/v1/hardware?limit=5', auth)
  const consumables = await json(app.baseUrl, '/api/v1/consumables?limit=5', auth)
  const accessories = await json(app.baseUrl, '/api/v1/accessories?limit=5', auth)
  const components = await json(app.baseUrl, '/api/v1/components?limit=5', auth)

  const locRows = (locations.body as { rows?: Array<Record<string, unknown>> })?.rows || []
  const firstLoc = locRows[0]
  const locDetail = firstLoc?.id
    ? await json(app.baseUrl, `/api/v1/locations/${firstLoc.id}`, auth)
    : { status: 0, body: null }

  const hwRows = (hardware.body as { rows?: Array<{ id?: number }> })?.rows || []
  const hwDetail = hwRows[0]?.id
    ? await json(app.baseUrl, `/api/v1/hardware/${hwRows[0].id}`, auth)
    : { status: 0, body: null }

  const additiveOk = Boolean(
    firstLoc
    && Object.prototype.hasOwnProperty.call(firstLoc, 'location_type_id')
    && Object.prototype.hasOwnProperty.call(firstLoc, 'location_type')
    && (firstLoc.location_type as { code?: string } | null)?.code === 'UNSPECIFIED',
  )

  const selectOk = Array.isArray((selectlist.body as { results?: unknown[] })?.results)

  const checks = [status, locations, selectlist, hardware, consumables, accessories, components, locDetail, hwDetail]
  const pass = checks.every((c) => c.status === 200) && additiveOk && selectOk

  console.log(JSON.stringify({
    verdict: pass ? 'PASS' : 'FAIL',
    database: String(db.d),
    pool: String(poolName),
    status: status.status,
    locations: locations.status,
    selectlist: selectlist.status,
    hardware: hardware.status,
    hardware_detail: hwDetail.status,
    location_detail: locDetail.status,
    consumables: consumables.status,
    accessories: accessories.status,
    components: components.status,
    additive_typed_fields: additiveOk,
    first_location_type: (firstLoc?.location_type as { code?: string } | null)?.code || null,
  }, null, 2))
  if (!pass) process.exit(1)
} finally {
  await app.close()
  await getPool().end()
}
