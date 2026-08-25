/**
 * Wave 1.6 runtime smoke against ITAssetManagement_2026_test only.
 * Sets DB_NAME after loading .env so the live default cannot win.
 */
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: path.join(serverRoot, '.env') })

const TARGET = 'ITAssetManagement_2026_test'
process.env.DB_NAME = TARGET

function blocked(name: string) {
  return String(name).toLowerCase() === 'itassetmanagement_2026'
}

const results: Record<string, unknown> = { target: TARGET }

async function json(base: string, p: string, init: RequestInit = {}) {
  const res = await fetch(`${base}${p}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  let body: unknown = text
  try { body = text ? JSON.parse(text) : null } catch { /* keep text */ }
  return { status: res.status, body }
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: TARGET,
  })
  const [[dbRow]] = await conn.query<mysql.RowDataPacket[]>('SELECT DATABASE() AS d')
  const selected = String(dbRow.d)
  results.database_selected = selected
  if (blocked(selected) || selected.toLowerCase() !== TARGET.toLowerCase()) {
    throw new Error(`DATABASE SAFETY BLOCKER: smoke refused DATABASE()=${selected}`)
  }

  const [[user]] = await conn.query<mysql.RowDataPacket[]>(`
    SELECT id, username FROM users WHERE deleted_at IS NULL AND activated = 1 ORDER BY id ASC LIMIT 1
  `)
  if (!user) throw new Error('No activated user in staging clone')

  const { signToken } = await import('../src/middleware/auth.js')
  const { startApp } = await import('../test/wave0/helpers/http.js')
  const { getPool } = await import('../src/db/index.js')

  const poolDb = await getPool().query('SELECT DATABASE() AS d')
  const poolName = (poolDb[0] as mysql.RowDataPacket[])[0]?.d
  results.app_pool_database = poolName
  if (blocked(String(poolName))) throw new Error('App pool pointed at live DB')

  const app = await startApp()
  const auth = { Authorization: `Bearer ${signToken({ id: Number(user.id), username: String(user.username) })}` }

  try {
    const domains = await json(app.baseUrl, '/api/v1/asset-domains?limit=50', { headers: auth })
    const types = await json(app.baseUrl, '/api/v1/asset-types?limit=50', { headers: auth })
    const cats = await json(app.baseUrl, '/api/v1/categories?limit=50', { headers: auth })
    const models = await json(app.baseUrl, '/api/v1/models?limit=5', { headers: auth })
    const hardware = await json(app.baseUrl, '/api/v1/hardware?limit=5', { headers: auth })
    const dup = await json(app.baseUrl, '/api/v1/asset-domains', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ name: 'IT', code: 'it' }),
    })
    const created = await json(app.baseUrl, '/api/v1/asset-domains', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ name: 'WAVE16_SMOKE_DOMAIN', code: 'wave16-smoke' }),
    })

    const rootId = Number((await conn.query<mysql.RowDataPacket[]>(
      `SELECT id FROM categories WHERE deleted_at IS NULL AND parent_id IS NULL ORDER BY id LIMIT 1`,
    ))[0][0]?.id)
    const sub = await json(app.baseUrl, '/api/v1/categories', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ name: 'WAVE16_SMOKE_SUB', category_type: 'asset', parent_id: rootId }),
    })
    const subId = Number((sub.body as { payload?: { id?: number } })?.payload?.id)
    const third = await json(app.baseUrl, '/api/v1/categories', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ name: 'WAVE16_SMOKE_THIRD', category_type: 'asset', parent_id: subId }),
    })
    const selfParent = await json(app.baseUrl, `/api/v1/categories/${rootId}`, {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({ parent_id: rootId }),
    })

    results.list_domains = { status: domains.status, total: (domains.body as { total?: number })?.total }
    results.list_types = { status: types.status, total: (types.body as { total?: number })?.total }
    results.list_categories = { status: cats.status, total: (cats.body as { total?: number })?.total }
    results.list_models = { status: models.status }
    results.list_hardware = { status: hardware.status }
    results.duplicate_it_domain = { status: dup.status, messages: (dup.body as { messages?: string[] })?.messages }
    results.create_smoke_domain = { status: created.status }
    results.create_subcategory = { status: sub.status, id: subId }
    results.reject_third_level = { status: third.status, messages: (third.body as { messages?: string[] })?.messages }
    results.reject_self_parent = { status: selfParent.status, messages: (selfParent.body as { messages?: string[] })?.messages }

    const smokeDomainId = Number((created.body as { payload?: { id?: number } })?.payload?.id)
    if (smokeDomainId) {
      await json(app.baseUrl, `/api/v1/asset-domains/${smokeDomainId}`, { method: 'DELETE', headers: auth })
    }
    if (subId) {
      await json(app.baseUrl, `/api/v1/categories/${subId}`, { method: 'DELETE', headers: auth })
    }

    const pass = domains.status === 200
      && types.status === 200
      && cats.status === 200
      && models.status === 200
      && hardware.status === 200
      && dup.status >= 400
      && created.status === 201
      && sub.status === 201
      && third.status === 422
      && selfParent.status === 422
    results.verdict = pass ? 'PASS' : 'PARTIAL'
  } finally {
    await app.close()
    await conn.end()
    await getPool().end()
  }

  console.log(JSON.stringify(results, null, 2))
  if (results.verdict !== 'PASS') process.exit(2)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
