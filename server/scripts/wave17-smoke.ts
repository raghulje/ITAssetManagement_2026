/**
 * Wave 1.7 — production smoke: GET-only against ITAssetManagement_2026.
 * Does not create or delete records.
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
  const checks = {
    database: String(db.d),
    pool: String(poolName),
    domains: await json(app.baseUrl, '/api/v1/asset-domains?limit=50', auth),
    types: await json(app.baseUrl, '/api/v1/asset-types?limit=50', auth),
    categories: await json(app.baseUrl, '/api/v1/categories?limit=50', auth),
    models: await json(app.baseUrl, '/api/v1/models?limit=5', auth),
    hardware: await json(app.baseUrl, '/api/v1/hardware?limit=5', auth),
    hardware_one: null as unknown,
  }
  const hwBody = checks.hardware.body as { rows?: Array<{ id?: number }> }
  const firstId = hwBody?.rows?.[0]?.id
  if (firstId) {
    checks.hardware_one = await json(app.baseUrl, `/api/v1/hardware/${firstId}`, auth)
  }
  const pass = [checks.domains, checks.types, checks.categories, checks.models, checks.hardware]
    .every((c) => c.status === 200)
    && (!checks.hardware_one || (checks.hardware_one as { status: number }).status === 200)
  const out = {
    verdict: pass ? 'PASS' : 'FAIL',
    database: checks.database,
    totals: {
      domains: (checks.domains.body as { total?: number })?.total,
      types: (checks.types.body as { total?: number })?.total,
      categories: (checks.categories.body as { total?: number })?.total,
    },
    statuses: {
      domains: checks.domains.status,
      types: checks.types.status,
      categories: checks.categories.status,
      models: checks.models.status,
      hardware: checks.hardware.status,
      hardware_detail: checks.hardware_one ? (checks.hardware_one as { status: number }).status : null,
    },
  }
  console.log(JSON.stringify(out, null, 2))
  if (!pass) process.exit(2)
} finally {
  await app.close()
  await getPool().end()
}
