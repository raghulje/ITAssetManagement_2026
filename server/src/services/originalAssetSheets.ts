import fs from 'node:fs'
import path from 'node:path'
import XLSX from 'xlsx'
import { storageRoot } from './uploads.js'

export type OriginalAsset = {
  serial: string
  asset_number: string
  employee: string
  company: string
  make: string
  model: string
  processor: string
  ram: string
  storage: string
  os: string
  vendor: string
  invoice: string
  invoice_date: string
  cost: string
  email: string
  source: string
}

type IndexFile = {
  updated_at: string
  files: string[]
  by_serial: Record<string, OriginalAsset>
}

const ALIAS: Record<string, keyof OriginalAsset> = {
  serialnumber: 'serial',
  serialno: 'serial',
  serial: 'serial',
  assetnumber: 'asset_number',
  assetid: 'asset_number',
  assettag: 'asset_number',
  employeename: 'employee',
  allocateto: 'employee',
  engineer: 'employee',
  company: 'company',
  entity: 'company',
  make: 'make',
  model: 'model',
  laptopmodel: 'model',
  processor: 'processor',
  ramsize: 'ram',
  ram: 'ram',
  harddisksize: 'storage',
  ssd: 'storage',
  operatingsystem: 'os',
  vendor: 'vendor',
  invoicenumber: 'invoice',
  invoicedate: 'invoice_date',
  assetcost: 'cost',
  productvalue: 'cost',
  emailid: 'email',
  emailaddress: 'email',
  msofficeemailid: 'email',
}

function sheetDir() {
  const dir = path.join(storageRoot, 'private_uploads/original-asset-sheets')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function indexPath() {
  return path.join(sheetDir(), 'index.json')
}

function headerKey(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function serialKey(value: string) {
  return value.replace(/[^a-z0-9]/gi, '').toUpperCase()
}

function blank(value: string) {
  return ['', 'n/a', 'na', 'none', 'null', '-', '—'].includes(value.trim().toLowerCase())
}

function filledCount(row: OriginalAsset) {
  return Object.values(row).filter((value) => value && !blank(value)).length
}

export function loadOriginalIndex(): { files: string[]; updated_at: string | null; bySerial: Map<string, OriginalAsset> } {
  const bySerial = new Map<string, OriginalAsset>()
  if (!fs.existsSync(indexPath())) return { files: [], updated_at: null, bySerial }
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath(), 'utf8')) as IndexFile
    for (const [key, row] of Object.entries(parsed.by_serial || {})) bySerial.set(key, row)
    return { files: parsed.files || [], updated_at: parsed.updated_at || null, bySerial }
  } catch {
    return { files: [], updated_at: null, bySerial }
  }
}

function rowsFromWorkbook(filePath: string, fileName: string): OriginalAsset[] {
  const wb = XLSX.readFile(filePath, { cellDates: false })
  const found: OriginalAsset[] = []
  for (const sheetName of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: '', raw: false })
    if (!grid.length) continue
    const keys = Object.keys(grid[0])
    const mapped = new Map<keyof OriginalAsset, string>()
    for (const key of keys) {
      const field = ALIAS[headerKey(key)]
      if (field && field !== 'source' && !mapped.has(field)) mapped.set(field, key)
    }
    if (!mapped.has('serial')) continue
    for (const raw of grid) {
      const read = (field: keyof OriginalAsset) => {
        const key = mapped.get(field)
        const text = key ? String(raw[key] ?? '').trim() : ''
        return blank(text) ? '' : text
      }
      const serial = read('serial')
      if (!serial || serialKey(serial).length < 4) continue
      found.push({
        serial,
        asset_number: read('asset_number'),
        employee: read('employee'),
        company: read('company'),
        make: read('make'),
        model: read('model'),
        processor: read('processor'),
        ram: read('ram'),
        storage: read('storage'),
        os: read('os'),
        vendor: read('vendor'),
        invoice: read('invoice'),
        invoice_date: read('invoice_date'),
        cost: read('cost'),
        email: read('email'),
        source: `${fileName} / ${sheetName}`,
      })
    }
  }
  return found
}

export function ingestOriginalWorkbooks(files: Array<{ path: string; name: string }>) {
  const bySerial = new Map<string, OriginalAsset>()
  const names: string[] = []
  for (const file of files) {
    names.push(file.name)
    for (const row of rowsFromWorkbook(file.path, file.name)) {
      const key = serialKey(row.serial)
      const prev = bySerial.get(key)
      if (!prev || filledCount(row) >= filledCount(prev)) bySerial.set(key, row)
    }
  }
  const payload: IndexFile = {
    updated_at: new Date().toISOString(),
    files: names,
    by_serial: Object.fromEntries(bySerial),
  }
  fs.writeFileSync(indexPath(), JSON.stringify(payload))
  return { files: names.length, serials: bySerial.size, updated_at: payload.updated_at }
}
