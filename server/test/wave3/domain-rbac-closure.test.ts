import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readServerSource } from '../wave0/helpers/source.js'
import { jsonRequest, startApp, type StartedApp } from '../wave0/helpers/http.js'
import {
  canAccessDomainId,
  domainCodeFromRows,
  resolveImportDomainCode,
  scopedDomainCodes,
  type AssetDomainRow,
} from '../../src/services/domainAuth.js'

const DOMAINS: AssetDomainRow[] = [
  { id: 1, name: 'IT', code: 'it' },
  { id: 2, name: 'ADMIN', code: 'admin' },
]

describe('Wave 3.2 — Domain helper fail-closed and import force', () => {
  it('NULL domain_id is IT; unknown domain_id throws (fail closed)', () => {
    assert.equal(domainCodeFromRows(null, DOMAINS), 'it')
    assert.equal(domainCodeFromRows(1, DOMAINS), 'it')
    assert.equal(domainCodeFromRows(2, DOMAINS), 'admin')
    assert.throws(() => domainCodeFromRows(999, DOMAINS), /Unknown domain/)
  })

  it('canAccessDomainId denies unknown domain_id instead of treating it as IT', () => {
    assert.equal(canAccessDomainId(['it'], null, DOMAINS), true)
    assert.equal(canAccessDomainId(['admin'], null, DOMAINS), false)
    assert.equal(canAccessDomainId(['it'], 1, DOMAINS), true)
    assert.equal(canAccessDomainId(['it'], 2, DOMAINS), false)
    assert.equal(canAccessDomainId(['admin'], 1, DOMAINS), false)
    assert.equal(canAccessDomainId(['admin'], 2, DOMAINS), true)
    assert.equal(canAccessDomainId(['it'], 999, DOMAINS), false)
    assert.equal(canAccessDomainId(['it', 'admin'], 999, DOMAINS), false)
  })

  it('IT Asset Manager import is server-forced to IT even if client sends ADMIN', () => {
    assert.equal(resolveImportDomainCode(['it'], 'admin'), 'it')
    assert.equal(resolveImportDomainCode(['it'], 'ADMIN'), 'it')
    assert.equal(resolveImportDomainCode(['it'], 2), 'it')
  })

  it('Admin Asset Manager import is server-forced to ADMIN even if client sends IT', () => {
    assert.equal(resolveImportDomainCode(['admin'], 'it'), 'admin')
    assert.equal(resolveImportDomainCode(['admin'], 'IT'), 'admin')
    assert.equal(resolveImportDomainCode(['admin'], 1), 'admin')
  })

  it('Super Admin import accepts IT or ADMIN and defaults omitted domain to IT', () => {
    assert.equal(resolveImportDomainCode(['it', 'admin'], 'admin'), 'admin')
    assert.equal(resolveImportDomainCode(['it', 'admin'], 'it'), 'it')
    assert.equal(resolveImportDomainCode(['it', 'admin'], undefined), 'it')
    assert.equal(resolveImportDomainCode(['it', 'admin'], null), 'it')
  })

  it('unauthorized ?domain= query still collapses list scope to empty (no widening)', () => {
    assert.deepEqual(scopedDomainCodes(['it'], 'admin'), [])
    assert.deepEqual(scopedDomainCodes(['admin'], 'it'), [])
    assert.deepEqual(scopedDomainCodes(['it', 'admin'], 'admin'), ['admin'])
  })
})

describe('Wave 3.2 — Endpoint source contracts for previously leaky APIs', () => {
  it('EOL due list and counts pass caller permissions into listEolDueAssets', () => {
    const hw = readServerSource('src/routes/hardware.ts')
    const eol = readServerSource('src/services/eolAlerts.ts')
    const reports = readServerSource('src/routes/reports.ts')
    assert.match(hw, /listEolDueAssets\(\{\s*permissions: req\.user\?\.permissions/)
    assert.match(eol, /inventoryDomainClause\(filters\.permissions, filters\.domain, 'a'\)/)
    assert.match(reports, /countEolDue\(\{ permissions: req\.user\?\.permissions/)
    assert.match(reports, /countEolDue\(\{[\s\S]*permissions: req\.user\?\.permissions/)
  })

  it('dashboard and activity logs are domain-scoped', () => {
    const reports = readServerSource('src/routes/reports.ts')
    assert.match(reports, /actionLogDomainSql\(req\.user\?\.permissions/)
    assert.match(reports, /invDomainL/)
    assert.match(reports, /JOIN licenses l ON l.id = ls.license_id/)
    assert.match(reports, /checkout_acceptances ca[\s\S]*JOIN assets a/)
  })

  it('space item listing applies inventoryDomainClause per table', () => {
    const spaces = readServerSource('src/routes/spaces.ts')
    assert.match(spaces, /spacesRouter\.get\('\/spaces\/:id\/assets'/)
    assert.match(spaces, /inventoryDomainClause\(req\.user\?\.permissions/)
    assert.match(spaces, /FROM accessories WHERE deleted_at IS NULL AND location_id = \?\$\{accDomain\.sql\}/)
  })

  it('audit-by-tag and restore require record domain access', () => {
    const hw = readServerSource('src/routes/hardware.ts')
    assert.match(hw, /router\.post\('\/audit'[\s\S]*loadItemDomain\('assets', 'asset_tag = \? AND deleted_at IS NULL'/)
    assert.match(hw, /router\.post\('\/audit'[\s\S]*assertRecordDomainAccess\(req, res, row\.domain_id\)/)
    assert.match(hw, /router\.post\('\/:id\/restore'[\s\S]*assertRecordDomainAccess/)
    assert.match(hw, /router\.post\('\/:id\/audit'[\s\S]*requireAssetDomain/)
  })

  it('files and license invoices authorize against the parent domain-owned entity', () => {
    const files = readServerSource('src/routes/files.ts')
    const lic = readServerSource('src/routes/licenses.ts')
    const auth = readServerSource('src/services/domainAuth.ts')
    assert.match(files, /assertUploadableDomainAccess/)
    assert.match(auth, /uploadableType === 'license_invoice'|t === 'license_invoice'/)
    assert.match(lic, /router\.put\('\/invoices\/:invoiceId'[\s\S]*loadItemDomain\('licenses'/)
    assert.match(lic, /router\.delete\('\/invoices\/:invoiceId'[\s\S]*assertRecordDomainAccess/)
  })

  it('import resolves domain server-side and does not hard-code IT', () => {
    const eng = readServerSource('src/services/importEngine.ts')
    const imports = readServerSource('src/routes/imports.ts')
    const page = readServerSource('../client/src/pages/ImportPage.tsx')
    assert.match(eng, /resolveImportDomainId\(opts\.permissions, opts\.domain\)/)
    assert.doesNotMatch(eng, /domainIdForCode\('it'\)/)
    assert.match(imports, /permissions: req\.user\?\.permissions/)
    assert.match(imports, /domain: req\.body\?\.domain/)
    assert.match(page, /DomainSelect/)
    assert.match(page, /inventoryTypes\.has\(type\) \? \{ domain \}/)
  })

  it('GET /spaces requires settings.view; writes still require settings.edit', () => {
    const app = readServerSource('src/app.ts')
    assert.match(app, /requirePerm\('settings\.view'\)/)
    assert.match(app, /requirePerm\('settings\.edit'\)/)
  })

  it('labels, agent logs, maintenances, and requestable lists are domain-scoped', () => {
    const labels = readServerSource('src/routes/labels.ts')
    const hw = readServerSource('src/routes/hardware.ts')
    const reports = readServerSource('src/routes/reports.ts')
    assert.match(labels, /assertRecordDomainAccess\(req, res, row\.domain_id\)/)
    assert.match(hw, /agent-sync-logs[\s\S]*inventoryDomainClause/)
    assert.match(hw, /router\.get\('\/:id\/agent'[\s\S]*requireAssetDomain/)
    assert.match(reports, /requireMaintenanceAssetDomain/)
    assert.match(reports, /requestsRouter\.get\('\/requestable'[\s\S]*inventoryDomainClause/)
  })

  it('public QR routes remain unauthenticated and are not wired through domainAuth', () => {
    const pub = readServerSource('src/routes/publicAssets.ts')
    assert.doesNotMatch(pub, /assertRecordDomainAccess/)
    assert.doesNotMatch(pub, /inventoryDomainClause/)
    const app = readServerSource('src/app.ts')
    assert.match(app, /publicAssets|\/asset\/|\/api\/v1\/public/)
  })
})

describe('Wave 3.2 — Direct API bypass (unauthenticated / query-param contract)', () => {
  let app: StartedApp

  before(async () => {
    app = await startApp()
  })

  after(async () => {
    await app.close()
  })

  it('previously leaky authenticated endpoints still require a Bearer token', async () => {
    const paths: Array<{ method?: string; path: string; body?: unknown }> = [
      { path: '/api/v1/hardware/eol/due' },
      { path: '/api/v1/reports/activity' },
      { path: '/api/v1/reports/hub' },
      { path: '/api/v1/dashboard' },
      { path: '/api/v1/spaces/1/assets' },
      { path: '/api/v1/hardware/1/files' },
      { path: '/api/v1/files/1/download' },
      { path: '/api/v1/labels/hardware/1' },
      { path: '/api/v1/hardware/agent-sync-logs' },
      { path: '/api/v1/maintenances' },
      { method: 'POST', path: '/api/v1/hardware/audit', body: { asset_tag: 'ADMIN-1' } },
      { method: 'PUT', path: '/api/v1/licenses/invoices/1', body: { notes: 'x' } },
      { method: 'POST', path: '/api/v1/imports/process/1', body: { domain: 'admin' } },
    ]
    for (const item of paths) {
      const { status, body } = await jsonRequest(app.baseUrl, item.path, {
        method: item.method || 'GET',
        ...(item.body ? { body: JSON.stringify(item.body) } : {}),
      })
      assert.equal(status, 401, `${item.method || 'GET'} ${item.path}`)
      assert.deepEqual(body, { status: 'error', messages: ['Unauthorized'], payload: null })
    }
  })

  it('query-parameter domain spoofing cannot widen scopedDomainCodes', () => {
    // Direct analogue of ?domain=admin as an IT Asset Manager: empty intersection, not unfiltered.
    assert.deepEqual(scopedDomainCodes(['it'], 'admin'), [])
    assert.deepEqual(scopedDomainCodes(['admin'], 'it'), [])
    assert.equal(resolveImportDomainCode(['it'], 'admin'), 'it')
    assert.equal(resolveImportDomainCode(['admin'], 'it'), 'admin')
  })

  it('invalid JWT cannot reach domain-owned secondary endpoints', async () => {
    const { status } = await jsonRequest(app.baseUrl, '/api/v1/hardware/eol/due', {
      headers: { Authorization: 'Bearer not-a-jwt' },
    })
    assert.equal(status, 401)
  })
})
