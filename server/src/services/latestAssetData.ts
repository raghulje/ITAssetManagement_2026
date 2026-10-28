import fs from 'node:fs'
import path from 'node:path'
import XLSX from 'xlsx'
import { all, get, now, run } from '../db/index.js'
import { inventoryDomainClause, resolveWriteDomainId, tableHasColumn } from './domainAuth.js'
import { logAction } from './actionLog.js'
import { allocateAssetTag } from './assetTag.js'
import { loadOriginalIndex, type OriginalAsset } from './originalAssetSheets.js'
import { storageRoot } from './uploads.js'

const BLANK = new Set(['', 'n/a', 'na', 'none', 'null', '-', '—'])

export type LatestChange = { field: string; label: string; from: string; to: string; source?: string }
export type LatestReview = { label: string; report: string; system: string }

export type LatestCompareRow = {
  row_index: number
  endpoint: string
  serial: string
  model: string
  site: string
  last_user: string
  email: string
  status: 'update' | 'unchanged' | 'unmatched' | 'ambiguous' | 'skipped'
  match_by: string
  reason: string
  asset_id: number | null
  asset_tag: string | null
  asset_name: string | null
  changes: LatestChange[]
  review: LatestReview[]
}

export type LatestCompareResult = {
  upload_id: string
  summary: {
    rows: number
    columns: number
    columns_with_values: number
    matched: number
    updates: number
    unchanged: number
    unmatched: number
    ambiguous: number
    skipped: number
    storage_ready: boolean
    original_serials: number
  }
  detail_columns: string[]
  rows: LatestCompareRow[]
}

type SheetRow = Record<string, string>

type AssetSnap = {
  id: number
  asset_tag: string
  old_asset_tag: string
  name: string
  serial: string
  serial_key: string
  agent_hostname: string
  company_id: number | null
  company_name: string
  place_name: string
  assigned_to: number | null
  assigned_name: string
  assigned_email: string
  attrs: Record<string, string>
  details: Record<string, string>
}

function cellText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (Math.abs(value) >= 1e12) return String(Math.round(value))
    return String(value)
  }
  let text = String(value).trim()
  if (/^\d+(\.\d+)?e\+\d+$/i.test(text)) {
    const n = Number(text)
    if (Number.isFinite(n)) text = String(Math.round(n))
  }
  return text
}

export function isBlankReportValue(value: string): boolean {
  return BLANK.has(value.trim().toLowerCase())
}

export function parseLatestAssetWorkbook(filePath: string): { columns: string[]; rows: SheetRow[] } {
  const wb = XLSX.readFile(filePath, { cellDates: false })
  const name = wb.SheetNames[0]
  if (!name) throw new Error('The workbook has no sheets')
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], { defval: '', raw: false })
  if (!raw.length) throw new Error('The workbook has no data rows')
  const columns = Object.keys(raw[0])
  if (!columns.includes('Serial Number') || !columns.includes('Endpoint Name')) {
    throw new Error('This file is not the endpoint report. It needs Endpoint Name and Serial Number columns.')
  }
  const rows = raw.map((row) => {
    const out: SheetRow = {}
    for (const key of columns) out[key] = cellText(row[key])
    return out
  })
  return { columns, rows }
}

function serialKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toUpperCase()
}

function hostKey(value: string): string {
  return value.trim().toLowerCase()
}

function sameText(a: string, b: string): boolean {
  return a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ')
}

function macList(raw: string): string {
  const found = raw.match(/[0-9a-f]{2}(?::[0-9a-f]{2}){5}/gi) || []
  return [...new Set(found.map((m) => m.toLowerCase()))].join(', ')
}

function sameMac(a: string, b: string): boolean {
  const left = macList(a) || a.trim().toLowerCase()
  const right = macList(b) || b.trim().toLowerCase()
  return left === right
}

function specsFromRow(row: SheetRow): Record<string, string> {
  const os = !isBlankReportValue(row['OS Version'] || '')
    ? row['OS Version']
    : (!isBlankReportValue(row.OS || '') ? row.OS : '')
  const mac = macList(row['MAC Addresses'] || '')
  const ip = !isBlankReportValue(row['Last Reported IP'] || '') ? row['Last Reported IP'] : ''
  const spec: Record<string, string> = {
    processor: row['CPU Type'] || '',
    ram: row.Memory || '',
    os,
    mac_address: mac,
    ip_address: ip,
  }
  for (const key of Object.keys(spec)) {
    if (isBlankReportValue(spec[key] || '')) delete spec[key]
  }
  return spec
}

function meaningfulFields(row: SheetRow, columns: string[]): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const key of columns) {
    const value = row[key] || ''
    if (!isBlankReportValue(value)) fields[key] = value
  }
  return fields
}

function asStringMap(raw: unknown): Record<string, string> {
  let obj: unknown = raw
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw) } catch { return {} }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (value == null) continue
    const text = String(value).trim()
    if (text) out[key] = text
  }
  return out
}

function detailFields(raw: unknown): Record<string, string> {
  let obj: unknown = raw
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw) } catch { return {} }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {}
  const fields = (obj as { fields?: unknown }).fields
  return asStringMap(fields)
}

function pushUnique(map: Map<string, AssetSnap[]>, key: string, asset: AssetSnap) {
  if (!key) return
  const list = map.get(key)
  if (!list) map.set(key, [asset])
  else if (!list.some((item) => item.id === asset.id)) list.push(asset)
}

const SPEC_LABELS: Record<string, string> = {
  processor: 'Processor',
  ram: 'RAM',
  os: 'Operating system',
  mac_address: 'MAC address',
  ip_address: 'IP address',
}

function buildChanges(asset: AssetSnap, row: SheetRow, columns: string[], canHostname: boolean): LatestChange[] {
  const changes: LatestChange[] = []
  const specs = specsFromRow(row)
  for (const [key, value] of Object.entries(specs)) {
    const current = asset.attrs[key] || ''
    const same = key === 'mac_address' ? sameMac(current, value) : sameText(current, value)
    if (!same) {
      changes.push({ field: key, label: SPEC_LABELS[key] || key, from: current || '—', to: value })
    }
  }
  const endpoint = row['Endpoint Name'] || ''
  if (canHostname && endpoint && !sameText(asset.agent_hostname, endpoint)) {
    changes.push({
      field: 'agent_hostname',
      label: 'Hostname',
      from: asset.agent_hostname || '—',
      to: endpoint,
    })
  }
  const serial = row['Serial Number'] || ''
  if (!asset.serial.trim() && serial && !isBlankReportValue(serial)) {
    changes.push({ field: 'serial', label: 'Serial', from: '—', to: serial })
  }
  if (!asset.name.trim() && endpoint) {
    changes.push({ field: 'name', label: 'Name', from: '—', to: endpoint })
  }
  const nextDetails = meaningfulFields(row, columns)
  const prev = asset.details
  for (const [key, value] of Object.entries(nextDetails)) {
    const current = prev[key] || ''
    if (!sameText(current, value)) {
      changes.push({ field: `extra:${key}`, label: key, from: current || '—', to: value })
    }
  }
  return changes
}

const GENERIC_USER = new Set(['refex', 'user', 'admin', 'administrator', 'default', 'local', 'it', 'system', 'na', 'n/a'])

type Emp = { id: number; name: string; email: string; code: string }
type EmpIndex = { byEmail: Map<string, Emp>; byCode: Map<string, Emp>; byName: Map<string, Emp[]> }
type CompanyRow = { id: number; name: string }

function personName(value: string) {
  const text = value.trim()
  if (!text || isBlankReportValue(text)) return ''
  if (GENERIC_USER.has(text.toLowerCase()) || /department/i.test(text)) return ''
  return text
}

function companyKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function sameCompany(a: string, b: string) {
  const left = companyKey(a)
  const right = companyKey(b)
  if (!left || !right) return false
  return left === right || (left.length > 4 && right.length > 4 && (left.includes(right) || right.includes(left)))
}

function matchCompany(companies: CompanyRow[], name: string) {
  const key = companyKey(name)
  if (!key) return null
  return companies.find((company) => companyKey(company.name) === key)
    || companies.find((company) => sameCompany(company.name, name))
    || null
}

function indexEmployees(rows: Emp[]): EmpIndex {
  const byEmail = new Map<string, Emp>()
  const byCode = new Map<string, Emp>()
  const byName = new Map<string, Emp[]>()
  for (const row of rows) {
    if (row.email) byEmail.set(row.email.trim().toLowerCase(), row)
    if (row.code) byCode.set(row.code.trim().toLowerCase(), row)
    const name = row.name.trim().toLowerCase().replace(/\s+/g, ' ')
    if (!name) continue
    const list = byName.get(name) || []
    list.push(row)
    byName.set(name, list)
  }
  return { byEmail, byCode, byName }
}

function resolveEmployee(index: EmpIndex, email: string, code: string, name: string): Emp | null {
  const mail = email.trim().toLowerCase()
  if (mail && index.byEmail.has(mail)) return index.byEmail.get(mail) || null
  const employeeCode = code.trim().toLowerCase()
  if (employeeCode && index.byCode.has(employeeCode)) return index.byCode.get(employeeCode) || null
  const person = personName(name).toLowerCase().replace(/\s+/g, ' ')
  if (!person) return null
  const hits = index.byName.get(person) || []
  return hits.length === 1 ? hits[0] : null
}

function identityChanges(
  asset: AssetSnap,
  row: SheetRow,
  original: OriginalAsset | null,
  employees: EmpIndex,
  companies: CompanyRow[],
  creating: boolean,
): LatestChange[] {
  const changes: LatestChange[] = []
  const reportEmail = isBlankReportValue(row.EMAIL_ADDRESS || '') ? '' : row.EMAIL_ADDRESS
  const reportUser = personName(row['Last Logged In User'] || '')
  const originalEmployee = personName(original?.employee || '')
  const originalEmail = original?.email || ''
  const target = resolveEmployee(
    employees,
    reportEmail || originalEmail,
    row.EMPLOYEE_ID || '',
    reportUser || originalEmployee,
  )
  const nextName = target?.name || reportUser || originalEmployee
  if (nextName && !sameText(asset.assigned_name, nextName)) {
    changes.push({
      field: 'assigned_to',
      label: 'Assigned to',
      from: asset.assigned_name || '—',
      to: target ? target.name : `${nextName} (no matching employee)`,
      source: target ? `employee:${target.id}` : 'unlinked',
    })
  }
  const nextEmail = reportEmail || originalEmail || target?.email || ''
  if (nextEmail && !sameText(asset.assigned_email, nextEmail)) {
    changes.push({ field: 'email', label: 'Email', from: asset.assigned_email || '—', to: nextEmail })
  }
  const originalCompany = original?.company || ''
  const account = isBlankReportValue(row.Account || '') ? '' : row.Account
  const displayCompany = originalCompany || account
  if (displayCompany && !sameCompany(asset.company_name, displayCompany)) {
    const companyHit = matchCompany(companies, displayCompany)
    const canApply = Boolean(originalCompany) || creating || Boolean(companyHit)
    changes.push({
      field: 'company',
      label: 'Company',
      from: asset.company_name || '—',
      to: canApply ? (companyHit?.name || displayCompany) : `${displayCompany} (no matching company)`,
      source: canApply ? (originalCompany ? 'original' : 'report') : 'unlinked',
    })
  }
  const site = isBlankReportValue(row.Site || '') ? '' : row.Site
  if (site && !sameText(asset.place_name, site)) {
    changes.push({ field: 'place', label: 'Place', from: asset.place_name || '—', to: site })
  }
  if (original?.asset_number && (creating || !asset.old_asset_tag.trim()) && !sameText(asset.old_asset_tag, original.asset_number)) {
    changes.push({
      field: 'old_asset_tag',
      label: 'Old asset tag',
      from: asset.old_asset_tag || '—',
      to: original.asset_number,
      source: 'original',
    })
  }
  if (creating && (original?.model || row['Model Name'])) {
    changes.push({ field: 'model', label: 'Model', from: '—', to: original?.model || row['Model Name'], source: original?.model ? 'original' : 'report' })
  }
  if (creating && original?.invoice) {
    changes.push({ field: 'order_number', label: 'Invoice', from: '—', to: original.invoice, source: 'original' })
  }
  if (creating && original?.cost) {
    changes.push({ field: 'purchase_cost', label: 'Asset cost', from: '—', to: original.cost, source: 'original' })
  }
  return changes
}

function emptySnap(): AssetSnap {
  return {
    id: 0,
    asset_tag: '',
    old_asset_tag: '',
    name: '',
    serial: '',
    serial_key: '',
    agent_hostname: '',
    company_id: null,
    company_name: '',
    place_name: '',
    assigned_to: null,
    assigned_name: '',
    assigned_email: '',
    attrs: {},
    details: {},
  }
}

export function uploadDir() {
  const dir = path.join(storageRoot, 'private_uploads/latest-asset-data')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function resolveLatestUpload(uploadId: string): string {
  const base = path.basename(uploadId)
  if (!base || base !== uploadId || !/\.xlsx?$/i.test(base)) {
    throw new Error('Choose the report again')
  }
  const full = path.join(uploadDir(), base)
  if (!fs.existsSync(full)) throw new Error('That report is no longer on the server. Upload it again.')
  return full
}

export async function compareLatestAssetFile(
  filePath: string,
  uploadId: string,
  domain: { sql: string; params: unknown[] },
): Promise<LatestCompareResult> {
  const { columns, rows } = parseLatestAssetWorkbook(filePath)
  const filled = new Set<string>()
  for (const row of rows) {
    for (const key of columns) {
      if (!isBlankReportValue(row[key] || '')) filled.add(key)
    }
  }
  const detailColumns = columns.filter((key) => filled.has(key))

  const hasDetails = await tableHasColumn('assets', 'additional_details')
  const hasAttrs = await tableHasColumn('assets', 'domain_attrs')
  const hasHost = await tableHasColumn('assets', 'agent_hostname')
  const hasPlace = await tableHasColumn('assets', 'location_text')

  const assets = await all<Record<string, unknown>>(`
    SELECT a.id, a.asset_tag, a.old_asset_tag, a.name, a.serial, a.company_id, a.assigned_to, a.assigned_type,
      ${hasHost ? 'a.agent_hostname' : 'NULL AS agent_hostname'},
      ${hasAttrs ? 'a.domain_attrs' : 'NULL AS domain_attrs'},
      ${hasDetails ? 'a.additional_details' : 'NULL AS additional_details'},
      c.name AS company_name,
      ${hasPlace ? "COALESCE(NULLIF(TRIM(a.location_text), ''), loc.name)" : 'loc.name'} AS place_name,
      CASE
        WHEN a.assigned_type = 'employee' THEN (
          SELECT CONCAT(first_name, ' ', last_name) FROM employees WHERE id = a.assigned_to
        )
        WHEN a.assigned_type = 'user' THEN (
          SELECT CONCAT(first_name, ' ', last_name) FROM users WHERE id = a.assigned_to
        )
        ELSE NULL
      END AS assigned_name,
      CASE
        WHEN a.assigned_type = 'employee' THEN (
          SELECT email FROM employees WHERE id = a.assigned_to
        )
        WHEN a.assigned_type = 'user' THEN (
          SELECT email FROM users WHERE id = a.assigned_to
        )
        ELSE NULL
      END AS assigned_email
    FROM assets a
    LEFT JOIN companies c ON c.id = a.company_id
    LEFT JOIN locations loc ON loc.id = a.location_id
    WHERE a.deleted_at IS NULL
    ${domain.sql}
  `, domain.params)

  const snaps: AssetSnap[] = assets.map((row) => {
    const serial = String(row.serial || '')
    return {
      id: Number(row.id),
      asset_tag: String(row.asset_tag || ''),
      old_asset_tag: String(row.old_asset_tag || ''),
      name: String(row.name || ''),
      serial,
      serial_key: serialKey(serial),
      agent_hostname: String(row.agent_hostname || ''),
      company_id: row.company_id == null ? null : Number(row.company_id),
      company_name: String(row.company_name || ''),
      place_name: String(row.place_name || ''),
      assigned_to: row.assigned_to == null ? null : Number(row.assigned_to),
      assigned_name: String(row.assigned_name || ''),
      assigned_email: String(row.assigned_email || ''),
      attrs: asStringMap(row.domain_attrs),
      details: detailFields(row.additional_details),
    }
  })

  const bySerial = new Map<string, AssetSnap[]>()
  const byHost = new Map<string, AssetSnap[]>()
  for (const asset of snaps) {
    pushUnique(bySerial, asset.serial_key, asset)
    for (const value of [asset.agent_hostname, asset.asset_tag, asset.old_asset_tag, asset.name]) {
      pushUnique(byHost, hostKey(value), asset)
    }
  }

  const originalIndex = loadOriginalIndex()
  const employees = indexEmployees(await all<Emp>(`
    SELECT id, TRIM(CONCAT(first_name, ' ', last_name)) AS name, email, employee_code AS code
    FROM employees WHERE deleted_at IS NULL
  `))
  const companies = await all<CompanyRow>(`SELECT id, name FROM companies WHERE deleted_at IS NULL`)

  const preliminary: LatestCompareRow[] = rows.map((row, index) => {
    const endpoint = row['Endpoint Name'] || ''
    const serial = row['Serial Number'] || ''
    const base = {
      row_index: index + 2,
      endpoint,
      serial,
      model: row['Model Name'] || '',
      site: row.Site || '',
      last_user: row['Last Logged In User'] || '',
      email: row.EMAIL_ADDRESS || '',
    }
    const key = serialKey(serial)
    if (!key || isBlankReportValue(serial)) {
      return {
        ...base,
        status: 'skipped' as const,
        match_by: '',
        reason: 'No serial number, so this row is skipped.',
        asset_id: null,
        asset_tag: null,
        asset_name: null,
        changes: [],
        review: [],
      }
    }
    const original = originalIndex.bySerial.get(key) || null
    let hits: AssetSnap[] = []
    let matchBy = ''
    if (key && bySerial.has(key)) {
      hits = bySerial.get(key) || []
      matchBy = 'serial'
    } else {
      const host = hostKey(endpoint)
      if (host && byHost.has(host)) {
        hits = byHost.get(host) || []
        const hit = hits[0]
        matchBy = hit && hostKey(hit.asset_tag) === host ? 'asset tag' : 'endpoint name'
      }
      if (!hits.length && original?.asset_number) {
        const legacy = hostKey(original.asset_number)
        if (legacy && byHost.has(legacy)) {
          hits = byHost.get(legacy) || []
          matchBy = 'original asset number'
        }
      }
    }
    if (hits.length > 1) {
      return {
        ...base,
        status: 'ambiguous' as const,
        match_by: matchBy,
        reason: matchBy === 'serial'
          ? 'This serial matches more than one asset'
          : 'This endpoint name matches more than one asset',
        asset_id: null,
        asset_tag: null,
        asset_name: null,
        changes: [],
        review: [],
      }
    }
    if (!hits.length) {
      const draft = emptySnap()
      const changes = [
        ...identityChanges(draft, row, original, employees, companies, true),
        ...buildChanges(draft, row, columns, hasHost),
      ]
      return {
        ...base,
        status: 'unmatched' as const,
        match_by: original ? 'original sheet' : '',
        reason: original
          ? 'No asset with this serial or endpoint name. It will be created using the original asset sheet.'
          : 'No asset with this serial or endpoint name. It will be created from this report.',
        asset_id: null,
        asset_tag: original?.asset_number || null,
        asset_name: endpoint || null,
        changes,
        review: [],
      }
    }
    const asset = hits[0]
    const changes = [
      ...identityChanges(asset, row, original, employees, companies, false),
      ...buildChanges(asset, row, columns, hasHost),
    ]
    return {
      ...base,
      status: changes.length ? 'update' as const : 'unchanged' as const,
      match_by: matchBy,
      reason: '',
      asset_id: asset.id,
      asset_tag: asset.asset_tag,
      asset_name: asset.name || null,
      changes,
      review: [],
    }
  })

  const owners = new Map<number, number[]>()
  preliminary.forEach((row, index) => {
    if (row.asset_id == null || row.status === 'ambiguous') return
    const list = owners.get(row.asset_id) || []
    list.push(index)
    owners.set(row.asset_id, list)
  })
  for (const indexes of owners.values()) {
    if (indexes.length < 2) continue
    for (const index of indexes) {
      const row = preliminary[index]
      preliminary[index] = {
        ...row,
        status: 'ambiguous',
        reason: 'More than one report row matches this asset',
        changes: [],
        review: [],
      }
    }
  }

  const summary = {
    rows: preliminary.length,
    columns: columns.length,
    columns_with_values: detailColumns.length,
    matched: preliminary.filter((row) => row.asset_id != null && row.status !== 'ambiguous').length,
    updates: preliminary.filter((row) => row.status === 'update').length,
    unchanged: preliminary.filter((row) => row.status === 'unchanged').length,
    unmatched: preliminary.filter((row) => row.status === 'unmatched').length,
    ambiguous: preliminary.filter((row) => row.status === 'ambiguous').length,
    skipped: preliminary.filter((row) => row.status === 'skipped').length,
    storage_ready: hasDetails,
    original_serials: originalIndex.bySerial.size,
  }

  return { upload_id: uploadId, summary, detail_columns: detailColumns, rows: preliminary }
}

export async function compareLatestAssetUpload(
  uploadId: string,
  perms: Record<string, unknown> | null | undefined,
  requestedDomain: unknown,
) {
  const domain = await inventoryDomainClause(perms, requestedDomain, 'a')
  return compareLatestAssetFile(resolveLatestUpload(uploadId), uploadId, domain)
}

function moneyAmount(raw: string): number | null {
  const n = Number(String(raw).replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

function modelLabel(modelName: string, fallback: string) {
  const text = modelName.trim()
  if (!text || isBlankReportValue(text)) return fallback
  const parts = text.split(' - ').map((part) => part.trim()).filter(Boolean)
  return parts.length > 1 ? parts.slice(1).join(' - ') : text
}

function brandLabel(modelName: string) {
  const text = modelName.trim()
  const parts = text.split(' - ').map((part) => part.trim()).filter(Boolean)
  return parts.length > 1 ? parts[0] : ''
}

async function ensureByName(table: string, name: string) {
  const trimmed = name.trim()
  if (!trimmed) return null
  const live = await get<{ id: number }>(
    `SELECT id FROM ${table} WHERE LOWER(name) = LOWER(?) AND deleted_at IS NULL LIMIT 1`,
    [trimmed],
  )
  if (live) return Number(live.id)
  const ts = now()
  const info = await run(
    `INSERT INTO ${table} (name, created_at, updated_at) VALUES (?, ?, ?)`,
    [trimmed, ts, ts],
  )
  return Number(info.insertId)
}

async function ensureAssetCategory(name: string) {
  const label = name.trim() || 'Laptop'
  const live = await get<{ id: number }>(
    `SELECT id FROM categories WHERE LOWER(name) = LOWER(?) AND category_type = 'asset' AND deleted_at IS NULL LIMIT 1`,
    [label],
  )
  if (live) return Number(live.id)
  const ts = now()
  const info = await run(
    `INSERT INTO categories (name, category_type, created_at, updated_at) VALUES (?, 'asset', ?, ?)`,
    [label, ts, ts],
  )
  return Number(info.insertId)
}

async function ensureModel(name: string, categoryId: number, manufacturerId: number | null) {
  const live = await get<{ id: number }>(
    `SELECT id FROM models WHERE LOWER(name) = LOWER(?) AND deleted_at IS NULL LIMIT 1`,
    [name],
  )
  if (live) return Number(live.id)
  const ts = now()
  const hasMfr = await tableHasColumn('models', 'manufacturer_id')
  if (hasMfr) {
    const info = await run(
      `INSERT INTO models (name, category_id, manufacturer_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [name, categoryId, manufacturerId, ts, ts],
    )
    return Number(info.insertId)
  }
  const info = await run(
    `INSERT INTO models (name, category_id, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    [name, categoryId, ts, ts],
  )
  return Number(info.insertId)
}

async function deployableStatusId() {
  const row = await get<{ id: number }>(
    `SELECT id FROM status_labels WHERE deleted_at IS NULL AND type = 'deployable' ORDER BY default_label DESC, id LIMIT 1`,
  )
  return row?.id ? Number(row.id) : 1
}

function withOriginalFields(fields: Record<string, string>, original: OriginalAsset | null) {
  if (!original) return fields
  const extra: Record<string, string> = {
    'Original asset number': original.asset_number,
    'Original company': original.company,
    'Original employee': original.employee,
    'Original make': original.make,
    'Original model': original.model,
    'Original processor': original.processor,
    'Original RAM': original.ram,
    'Original storage': original.storage,
    'Original operating system': original.os,
    'Original vendor': original.vendor,
    'Original invoice': original.invoice,
    'Original invoice date': original.invoice_date,
    'Original cost': original.cost,
    'Original email': original.email,
    'Original sheet': original.source,
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value) fields[key] = value
  }
  return fields
}

export async function applyLatestAssetUpdates(opts: {
  uploadId: string
  assetIds?: number[]
  rowIndexes?: number[]
  userId?: number | null
  perms: Record<string, unknown> | null | undefined
  requestedDomain: unknown
}) {
  const hasDetails = await tableHasColumn('assets', 'additional_details')
  if (!hasDetails) {
    throw new Error('Additional details are not in the database yet. In Admin, click migrate_comparision_feature, then apply again.')
  }
  const rowSet = new Set((opts.rowIndexes || []).map((id) => Number(id)).filter((id) => Number.isFinite(id)))
  const wanted = new Set((opts.assetIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))
  if (!rowSet.size && !wanted.size) throw new Error('Select at least one row to update or create')

  const compared = await compareLatestAssetUpload(opts.uploadId, opts.perms, opts.requestedDomain)
  const { columns, rows: sheetRows } = parseLatestAssetWorkbook(resolveLatestUpload(opts.uploadId))
  const hasAttrs = await tableHasColumn('assets', 'domain_attrs')
  const hasHost = await tableHasColumn('assets', 'agent_hostname')
  const ts = now()
  let updated = 0
  let created = 0
  let skipped = 0
  const failed: string[] = []
  const createdRows: Array<{ row_index: number; asset_id: number; asset_tag: string }> = []
  const originals = loadOriginalIndex().bySerial
  const selected = (row: LatestCompareRow) => (
    rowSet.size ? rowSet.has(row.row_index) : row.asset_id != null && wanted.has(row.asset_id)
  )

  for (const row of compared.rows) {
    if (!selected(row)) continue
    if (row.status !== 'update' && row.status !== 'unmatched') {
      skipped += 1
      continue
    }
    if (row.status === 'unmatched' && (!serialKey(row.serial) || isBlankReportValue(row.serial))) {
      skipped += 1
      continue
    }
    const sheet = sheetRows[row.row_index - 2]
    if (!sheet) {
      skipped += 1
      continue
    }
    try {
      const original = originals.get(serialKey(sheet['Serial Number'] || '')) || null
      const fields = withOriginalFields(meaningfulFields(sheet, columns), original)
      if (row.status === 'unmatched') {
        const createdAsset = await createAssetFromReport({
          sheet,
          original,
          fields,
          changes: row.changes,
          perms: opts.perms,
          requestedDomain: opts.requestedDomain,
          userId: opts.userId,
          ts,
        })
        created += 1
        createdRows.push({ row_index: row.row_index, asset_id: createdAsset.id, asset_tag: createdAsset.asset_tag })
        continue
      }
      const current = await all<Record<string, unknown>>(
        `SELECT id, name, serial, ${hasHost ? 'agent_hostname' : 'NULL AS agent_hostname'},
                ${hasAttrs ? 'domain_attrs' : 'NULL AS domain_attrs'}
         FROM assets WHERE id = ? AND deleted_at IS NULL`,
        [row.asset_id],
      )
      const asset = current[0]
      if (!asset) {
        skipped += 1
        continue
      }
      const sets: string[] = ['additional_details = ?', 'updated_at = ?']
      const details = {
        source: 'SentinelOne',
        imported_at: ts,
        endpoint: sheet['Endpoint Name'] || '',
        fields,
      }
      const vals: unknown[] = [JSON.stringify(details), ts]
      if (hasAttrs) {
        const attrs = { ...asStringMap(asset.domain_attrs), ...specsFromRow(sheet) }
        sets.unshift('domain_attrs = ?')
        vals.unshift(JSON.stringify(attrs))
      }
      const endpoint = sheet['Endpoint Name'] || ''
      if (hasHost && endpoint && !sameText(String(asset.agent_hostname || ''), endpoint)) {
        sets.unshift('agent_hostname = ?')
        vals.unshift(endpoint)
      }
      const serial = sheet['Serial Number'] || ''
      if (!String(asset.serial || '').trim() && serial && !isBlankReportValue(serial)) {
        sets.unshift('serial = ?')
        vals.unshift(serial)
      }
      if (!String(asset.name || '').trim() && endpoint) {
        sets.unshift('name = ?')
        vals.unshift(endpoint)
      }
      const companyChange = row.changes.find((change) => change.field === 'company' && change.source !== 'unlinked')
      if (companyChange) {
        const companyId = await ensureByName('companies', companyChange.to)
        if (companyId) {
          sets.push('company_id = ?')
          vals.push(companyId)
        }
      }
      const assignChange = row.changes.find((change) => change.field === 'assigned_to' && change.source?.startsWith('employee:'))
      if (assignChange?.source) {
        const employeeId = Number(assignChange.source.split(':')[1])
        if (employeeId) {
          sets.push('assigned_to = ?', 'assigned_type = ?', 'last_checkout = ?')
          vals.push(employeeId, 'employee', ts)
        }
      }
      const placeChange = row.changes.find((change) => change.field === 'place')
      if (placeChange && await tableHasColumn('assets', 'location_text')) {
        sets.push('location_text = ?')
        vals.push(placeChange.to.slice(0, 255))
      }
      const oldTag = row.changes.find((change) => change.field === 'old_asset_tag')
      if (oldTag) {
        sets.push('old_asset_tag = ?')
        vals.push(oldTag.to.slice(0, 191))
      }
      vals.push(row.asset_id)
      await run(`UPDATE assets SET ${sets.join(', ')} WHERE id = ?`, vals)
      await logAction({
        userId: opts.userId,
        actionType: 'update',
        itemType: 'asset',
        itemId: row.asset_id,
        note: 'Updated from the latest endpoint report',
      })
      updated += 1
    } catch (e) {
      failed.push(e instanceof Error ? e.message : `Asset ${row.asset_id} failed`)
    }
  }

  return { updated, created, skipped, failed: failed.slice(0, 8), created_rows: createdRows, summary: compared.summary }
}

async function createAssetFromReport(opts: {
  sheet: SheetRow
  original: OriginalAsset | null
  fields: Record<string, string>
  changes: LatestChange[]
  perms: Record<string, unknown> | null | undefined
  requestedDomain: unknown
  userId?: number | null
  ts: string
}) {
  const endpoint = opts.sheet['Endpoint Name'] || ''
  const serial = opts.sheet['Serial Number'] || ''
  if (!serialKey(serial) || isBlankReportValue(serial)) {
    throw new Error(`${endpoint || 'This row'} has no serial number, so it was not created`)
  }
  const modelName = opts.original?.model || modelLabel(opts.sheet['Model Name'] || '', endpoint || 'Laptop')
  const make = opts.original?.make || brandLabel(opts.sheet['Model Name'] || '')
  const device = opts.sheet['Device Type'] || 'laptop'
  const categoryName = /desktop/i.test(device) ? 'Desktop' : /laptop|notebook/i.test(device) ? 'Laptop' : (device || 'Laptop')
  const companyChange = opts.changes.find((change) => change.field === 'company' && change.source !== 'unlinked')
  const companyName = companyChange?.to || opts.original?.company || opts.sheet.Account || ''
  if (!companyName || isBlankReportValue(companyName)) throw new Error(`${endpoint || serial}: company is missing, so the asset was not created`)
  const companyId = await ensureByName('companies', companyName)
  if (!companyId) throw new Error(`${endpoint || serial}: company is missing, so the asset was not created`)
  const categoryId = await ensureAssetCategory(categoryName)
  const manufacturerId = make ? await ensureByName('manufacturers', make) : null
  const modelId = await ensureModel(modelName, categoryId, manufacturerId)
  const statusId = await deployableStatusId()
  const supplierId = opts.original?.vendor ? await ensureByName('suppliers', opts.original.vendor) : null
  const domain = await resolveWriteDomainId(opts.perms, { domain: opts.requestedDomain })
  const assetTag = await allocateAssetTag({ companyId, legalEntityId: null, categoryId })
  const assignChange = opts.changes.find((change) => change.field === 'assigned_to' && change.source?.startsWith('employee:'))
  const employeeId = assignChange?.source ? Number(assignChange.source.split(':')[1]) : null
  const place = opts.changes.find((change) => change.field === 'place')?.to || opts.sheet.Site || null
  const specs = specsFromRow(opts.sheet)
  if (!specs.processor && opts.original?.processor) specs.processor = opts.original.processor
  if (!specs.ram && opts.original?.ram) specs.ram = opts.original.ram
  if (!specs.os && opts.original?.os) specs.os = opts.original.os
  if (opts.original?.storage) specs.storage = opts.original.storage
  const hasAttrs = await tableHasColumn('assets', 'domain_attrs')
  const hasHost = await tableHasColumn('assets', 'agent_hostname')
  const hasPlace = await tableHasColumn('assets', 'location_text')
  const hasMfr = await tableHasColumn('assets', 'manufacturer_id')
  const domainReady = await tableHasColumn('assets', 'domain_id')
  const columns = [
    ...(domainReady ? ['domain_id'] : []),
    'asset_tag', 'old_asset_tag', 'name', 'serial', 'model_id',
    ...(hasMfr ? ['manufacturer_id'] : []),
    'status_id', 'company_id', 'supplier_id',
    ...(hasPlace ? ['location_text'] : []),
    'purchase_cost', 'order_number', 'notes',
    ...(hasAttrs ? ['domain_attrs'] : []),
    'additional_details',
    ...(hasHost ? ['agent_hostname'] : []),
    ...(employeeId ? ['assigned_to', 'assigned_type', 'last_checkout'] : []),
    'created_at', 'updated_at',
  ]
  const details = {
    source: 'SentinelOne',
    imported_at: opts.ts,
    endpoint,
    fields: opts.fields,
  }
  const values: unknown[] = [
    ...(domainReady ? [domain.id] : []),
    assetTag,
    opts.original?.asset_number || null,
    endpoint || null,
    serial || null,
    modelId,
    ...(hasMfr ? [manufacturerId] : []),
    statusId,
    companyId,
    supplierId,
    ...(hasPlace ? [place ? String(place).slice(0, 255) : null] : []),
    opts.original?.cost ? moneyAmount(opts.original.cost) : null,
    opts.original?.invoice || null,
    'Created from the latest endpoint report.',
    ...(hasAttrs ? [JSON.stringify(specs)] : []),
    JSON.stringify(details),
    ...(hasHost ? [endpoint || null] : []),
    ...(employeeId ? [employeeId, 'employee', opts.ts] : []),
    opts.ts,
    opts.ts,
  ]
  const info = await run(
    `INSERT INTO assets (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    values,
  )
  const id = Number(info.insertId)
  await logAction({
    userId: opts.userId,
    actionType: 'create',
    itemType: 'asset',
    itemId: id,
    note: 'Created from the latest endpoint report',
  })
  return { id, asset_tag: assetTag }
}
