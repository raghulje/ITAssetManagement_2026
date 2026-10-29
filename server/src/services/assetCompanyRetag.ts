import XLSX from 'xlsx'
import { all, get, now, run } from '../db/index.js'
import { companyTagCode } from './assetTag.js'

type SheetRow = Record<string, string>

function compactName(value: string) {
  return value.replace(/[\u00a0\u2007\u202f]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function nameKey(value: string) {
  return compactName(value).toLowerCase()
}

function headerKey(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function cell(row: SheetRow, key: string) {
  return key ? String(row[key] ?? '').trim() : ''
}

function qrToken(url: string) {
  const match = url.match(/\/asset\/([a-z0-9]+)/i)
  return match ? match[1].toLowerCase() : ''
}

function replacePrefix(tag: string, code: string) {
  const dash = tag.indexOf('-')
  if (dash < 0) return code
  return `${code}${tag.slice(dash)}`
}

function nextFreeTag(tag: string, taken: Set<string>) {
  if (!taken.has(tag.toLowerCase())) return tag
  const match = tag.match(/^(.*-)(\d+)$/)
  if (!match) throw new Error(`Tag ${tag} is already used`)
  let n = Number(match[2])
  const width = match[2].length
  let next = tag
  do {
    n += 1
    next = `${match[1]}${String(n).padStart(width, '0')}`
  } while (taken.has(next.toLowerCase()))
  return next
}

export async function applyAssetCompanySheet(filePath: string) {
  const wb = XLSX.readFile(filePath, { cellDates: false })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) throw new Error('The workbook has no sheets')
  const grid = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: '', raw: false })
  if (!grid.length) throw new Error('The sheet has no data rows')
  const columns = Object.keys(grid[0])
  const qrCol = columns.find((name) => headerKey(name) === 'qr') || ''
  const tagCol = columns.find((name) => headerKey(name) === 'assetname') || ''
  const companyCol = columns.find((name) => headerKey(name).includes('basedcompanyname')) || ''
  if (!tagCol || !companyCol) {
    throw new Error('The sheet needs Asset Name and Assset Based - Company Name columns')
  }

  const rows: SheetRow[] = grid.map((raw) => {
    const out: SheetRow = {}
    for (const key of columns) out[key] = String(raw[key] ?? '').trim()
    return out
  })

  const assets = await all<{ id: number; asset_tag: string; company_id: number | null; qr_token: string | null }>(`
    SELECT id, asset_tag, company_id, qr_token
    FROM assets
    WHERE deleted_at IS NULL
  `)
  const byToken = new Map<string, typeof assets>()
  const byTag = new Map<string, typeof assets>()
  for (const asset of assets) {
    const token = String(asset.qr_token || '').trim().toLowerCase()
    if (token) {
      const list = byToken.get(token) || []
      list.push(asset)
      byToken.set(token, list)
    }
    const tag = String(asset.asset_tag || '').trim().toLowerCase()
    if (tag) {
      const list = byTag.get(tag) || []
      list.push(asset)
      byTag.set(tag, list)
    }
  }

  const companies = await all<{ id: number; name: string }>(`
    SELECT id, name FROM companies WHERE deleted_at IS NULL
  `)
  const companyIds = new Map<string, number>()
  for (const company of companies) companyIds.set(nameKey(company.name), Number(company.id))

  const takenRows = await all<{ asset_tag: string }>(`SELECT asset_tag FROM assets WHERE asset_tag IS NOT NULL`)
  const taken = new Set(takenRows.map((row) => String(row.asset_tag || '').trim().toLowerCase()).filter(Boolean))

  type Job = {
    id: number
    current: string
    companyId: number
    desired: string
    label: string
  }
  const jobs = new Map<number, Job>()
  let skipped = 0
  let failed = 0
  const errors: string[] = []
  const fail = (message: string) => {
    failed += 1
    if (errors.length < 12) errors.push(message)
  }

  for (const row of rows) {
    const currentTag = cell(row, tagCol)
    const companyName = compactName(cell(row, companyCol))
    const label = currentTag || cell(row, qrCol) || 'row'
    if (!companyName) {
      skipped += 1
      continue
    }
    const token = qrToken(cell(row, qrCol))
    const tokenHits = token ? byToken.get(token) || [] : []
    const tagHits = currentTag ? byTag.get(currentTag.toLowerCase()) || [] : []
    const hits = tokenHits.length ? tokenHits : tagHits
    if (hits.length !== 1) {
      fail(hits.length > 1 ? `${label}: matches more than one asset` : `${label}: no asset with this QR or asset name`)
      continue
    }
    const asset = hits[0]
    let companyId = companyIds.get(nameKey(companyName)) || 0
    if (!companyId) {
      const existing = await get<{ id: number }>(
        `SELECT id FROM companies WHERE LOWER(name) = LOWER(?) AND deleted_at IS NULL LIMIT 1`,
        [companyName],
      )
      if (existing) companyId = Number(existing.id)
      else {
        const ts = now()
        const info = await run(
          `INSERT INTO companies (name, created_at, updated_at) VALUES (?, ?, ?)`,
          [companyName, ts, ts],
        )
        companyId = Number(info.insertId)
      }
      companyIds.set(nameKey(companyName), companyId)
    }
    const code = companyTagCode(companyName)
    jobs.set(asset.id, {
      id: asset.id,
      current: String(asset.asset_tag || '').trim(),
      companyId,
      desired: replacePrefix(String(asset.asset_tag || '').trim(), code),
      label,
    })
  }

  for (const job of jobs.values()) {
    if (job.current && job.current.toLowerCase() !== job.desired.toLowerCase()) taken.delete(job.current.toLowerCase())
  }

  let updated = 0
  let retagged = 0
  let renumbered = 0
  const ts = now()
  for (const job of jobs.values()) {
    const sameCompany = Number(assets.find((asset) => asset.id === job.id)?.company_id || 0) === job.companyId
    let nextTag = job.desired
    try {
      if (job.current.toLowerCase() !== job.desired.toLowerCase()) {
        const free = nextFreeTag(job.desired, taken)
        if (free !== job.desired) renumbered += 1
        nextTag = free
      }
    } catch (e) {
      fail(`${job.label}: ${e instanceof Error ? e.message : 'tag is already used'}`)
      continue
    }
    if (sameCompany && nextTag.toLowerCase() === job.current.toLowerCase()) {
      skipped += 1
      continue
    }
    await run(
      `UPDATE assets SET asset_tag = ?, company_id = ?, updated_at = ? WHERE id = ?`,
      [nextTag, job.companyId, ts, job.id],
    )
    taken.add(nextTag.toLowerCase())
    updated += 1
    if (nextTag.toLowerCase() !== job.current.toLowerCase()) retagged += 1
  }

  return { updated, retagged, renumbered, skipped, failed, errors }
}
