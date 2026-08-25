/**
 * Seed Space Management (Refex Tower Nungambakkam + Bazullah T.Nagar)
 * and ADMIN-domain inventory placed on those spaces.
 *
 *   cd server && npx tsx scripts/seed-admin-spaces.ts
 *
 * Idempotent by floor/space name under the existing office rows.
 * Does NOT move existing IT assets (location_id / rtd_location_id unchanged).
 * Does NOT reparent the office locations.
 */
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { all, get, run, now } from '../src/db/index.js'
import { allocateAssetTag } from '../src/services/assetTag.js'

const SEED_NOTE = 'SEED_ADMIN_SPACES'
let ts = now()
const OFFICE_NAMES = {
  nunga: 'Refex Tower-Nungambakkam',
  bazullah: 'Bazullah -T.Nagar',
} as const

type Subtype = 'CABIN' | 'MEETING_ROOM' | 'WORKSTATION' | 'OTHER'

async function typeId(code: string) {
  const row = await get<{ id: number }>(`SELECT id FROM location_types WHERE code = ? LIMIT 1`, [code])
  if (!row) throw new Error(`location type ${code} missing`)
  return Number(row.id)
}

async function subtypeId(code: Subtype) {
  const row = await get<{ id: number }>(`SELECT id FROM space_subtypes WHERE code = ? LIMIT 1`, [code])
  if (!row) throw new Error(`space subtype ${code} missing`)
  return Number(row.id)
}

async function domainId(code: 'it' | 'admin') {
  const row = await get<{ id: number }>(`SELECT id FROM asset_domains WHERE code = ? AND deleted_at IS NULL LIMIT 1`, [code])
  if (!row) throw new Error(`domain ${code} missing`)
  return Number(row.id)
}

async function categoryId(name: string, categoryType: string, adminDomain: number) {
  const row = await get<{ id: number }>(`
    SELECT id FROM categories
    WHERE name = ? AND category_type = ? AND domain_id = ? AND deleted_at IS NULL
    LIMIT 1
  `, [name, categoryType, adminDomain])
  if (!row) throw new Error(`ADMIN category ${categoryType}/${name} missing`)
  return Number(row.id)
}

async function ensureManufacturer(name: string) {
  const existing = await get<{ id: number }>(`SELECT id FROM manufacturers WHERE name = ? AND deleted_at IS NULL LIMIT 1`, [name])
  if (existing) return Number(existing.id)
  const info = await run(`INSERT INTO manufacturers (name, created_at, updated_at) VALUES (?, ?, ?)`, [name, ts, ts])
  return Number(info.insertId)
}

async function ensureModel(name: string, categoryIdVal: number, manufacturerId: number | null) {
  const existing = await get<{ id: number }>(
    `SELECT id FROM models WHERE name = ? AND category_id = ? AND deleted_at IS NULL LIMIT 1`,
    [name, categoryIdVal],
  )
  if (existing) return Number(existing.id)
  const info = await run(
    `INSERT INTO models (name, category_id, manufacturer_id, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [name, categoryIdVal, manufacturerId, SEED_NOTE, ts, ts],
  )
  return Number(info.insertId)
}

async function ensureOffice(name: string, companyId: number, siteTypeId: number) {
  const row = await get<{ id: number; company_id: number | null; location_type_id: number | null }>(
    `SELECT id, company_id, location_type_id FROM locations WHERE name = ? AND deleted_at IS NULL LIMIT 1`,
    [name],
  )
  if (!row) throw new Error(`Office location not found: ${name}`)
  await run(
    `UPDATE locations
     SET is_office = 1,
         location_type_id = ?,
         company_id = COALESCE(company_id, ?),
         updated_at = ?
     WHERE id = ?`,
    [siteTypeId, companyId, ts, row.id],
  )
  return Number(row.id)
}

async function ensureFloor(officeId: number, companyId: number, floorTypeId: number, name: string, seatCount: number | null) {
  const existing = await get<{ id: number }>(`
    SELECT id FROM locations
    WHERE parent_id = ? AND name = ? AND location_type_id = ? AND deleted_at IS NULL
    LIMIT 1
  `, [officeId, name, floorTypeId])
  if (existing) {
    await run(`UPDATE locations SET seat_count = COALESCE(?, seat_count), space_active = 1, updated_at = ? WHERE id = ?`, [
      seatCount, ts, existing.id,
    ])
    return Number(existing.id)
  }
  const info = await run(
    `INSERT INTO locations (name, parent_id, company_id, location_type_id, seat_count, space_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    [name, officeId, companyId, floorTypeId, seatCount, ts, ts],
  )
  return Number(info.insertId)
}

async function ensureSpace(
  floorId: number,
  companyId: number,
  spaceTypeId: number,
  name: string,
  subtype: Subtype,
  seatCount: number | null,
) {
  const st = await subtypeId(subtype)
  const existing = await get<{ id: number }>(`
    SELECT id FROM locations
    WHERE parent_id = ? AND name = ? AND location_type_id = ? AND deleted_at IS NULL
    LIMIT 1
  `, [floorId, name, spaceTypeId])
  if (existing) {
    await run(
      `UPDATE locations SET space_subtype_id = ?, seat_count = COALESCE(?, seat_count), updated_at = ? WHERE id = ?`,
      [st, seatCount, ts, existing.id],
    )
    return Number(existing.id)
  }
  const info = await run(
    `INSERT INTO locations (name, parent_id, company_id, location_type_id, space_subtype_id, seat_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, floorId, companyId, spaceTypeId, st, seatCount, ts, ts],
  )
  return Number(info.insertId)
}

async function ensureAsset(opts: {
  name: string
  category: string
  model: string
  locationId: number
  companyId: number
  adminDomain: number
  manufacturerId: number | null
  statusId: number
}) {
  const existing = await get<{ id: number }>(`
    SELECT id FROM assets WHERE name = ? AND domain_id = ? AND deleted_at IS NULL LIMIT 1
  `, [opts.name, opts.adminDomain])
  if (existing) {
    await run(`UPDATE assets SET location_id = ?, rtd_location_id = ?, updated_at = ? WHERE id = ?`, [
      opts.locationId, opts.locationId, ts, existing.id,
    ])
    return { id: Number(existing.id), created: false }
  }
  const catId = await categoryId(opts.category, 'asset', opts.adminDomain)
  const modelId = await ensureModel(opts.model, catId, opts.manufacturerId)
  const tag = await allocateAssetTag({ companyId: opts.companyId, categoryId: catId })
  const info = await run(
    `INSERT INTO assets (
      domain_id, asset_tag, old_asset_tag, name, model_id, status_id, company_id,
      location_id, rtd_location_id, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.adminDomain, tag, `${SEED_NOTE}:${opts.name}`, opts.name, modelId, opts.statusId, opts.companyId,
      opts.locationId, opts.locationId, SEED_NOTE, ts, ts,
    ],
  )
  return { id: Number(info.insertId), created: true }
}

async function ensureQty(
  table: 'accessories' | 'consumables' | 'components',
  opts: {
    name: string
    category: string
    categoryType: 'accessory' | 'consumable' | 'component'
    qty: number
    locationId: number
    companyId: number
    adminDomain: number
    minAmt?: number
  },
) {
  const existing = await get<{ id: number }>(
    `SELECT id FROM ${table} WHERE name = ? AND company_id = ? AND deleted_at IS NULL LIMIT 1`,
    [opts.name, opts.companyId],
  )
  const catId = await categoryId(opts.category, opts.categoryType, opts.adminDomain)
  if (existing) {
    await run(
      `UPDATE ${table} SET location_id = ?, qty = ?, domain_id = ?, updated_at = ? WHERE id = ?`,
      [opts.locationId, opts.qty, opts.adminDomain, ts, existing.id],
    )
    return { id: Number(existing.id), created: false }
  }
  const extra = table === 'components' ? ', serial' : ''
  const extraPh = table === 'components' ? ', ?' : ''
  const vals: unknown[] = [
    opts.adminDomain, opts.name, catId, opts.companyId, opts.locationId, opts.qty, opts.minAmt ?? 2, SEED_NOTE, ts, ts,
  ]
  if (table === 'components') vals.push(null)
  await run(
    `INSERT INTO ${table} (domain_id, name, category_id, company_id, location_id, qty, min_amt, notes, created_at, updated_at${extra})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?${extraPh})`,
    vals,
  )
  return { created: true }
}

export async function seedAdminSpaces() {
  ts = now()
  const company = await get<{ id: number; name: string }>(`
  SELECT id, name FROM companies
  WHERE deleted_at IS NULL AND name = 'Refex Industries Limited'
  LIMIT 1
`)
  if (!company) throw new Error('Refex Industries Limited company not found')

const adminDomain = await domainId('admin')
const siteType = await typeId('SITE')
const floorType = await typeId('FLOOR')
const spaceType = await typeId('SPACE')
const status = await get<{ id: number }>(`SELECT id FROM status_labels WHERE name = 'In Stock' AND deleted_at IS NULL LIMIT 1`)
if (!status) throw new Error('In Stock status missing')
const statusId = Number(status.id)

const mfg = {
  godrej: await ensureManufacturer('Godrej Interio'),
  stag: await ensureManufacturer('Stag'),
  samsung: await ensureManufacturer('Samsung'),
  lg: await ensureManufacturer('LG'),
  epson: await ensureManufacturer('Epson'),
  blue: await ensureManufacturer('Blue Star'),
}

const nungaId = await ensureOffice(OFFICE_NAMES.nunga, company.id, siteType)
const bazId = await ensureOffice(OFFICE_NAMES.bazullah, company.id, siteType)

const created = { floors: 0, spaces: 0, assets: 0, qty: 0 }

async function floor(officeId: number, name: string, seats: number | null) {
  const before = await get<{ id: number }>(`
    SELECT id FROM locations WHERE parent_id = ? AND name = ? AND deleted_at IS NULL LIMIT 1
  `, [officeId, name])
  const id = await ensureFloor(officeId, company.id, floorType, name, seats)
  if (!before) created.floors += 1
  return id
}

async function space(floorId: number, name: string, subtype: Subtype, seats: number | null) {
  const before = await get<{ id: number }>(`
    SELECT id FROM locations WHERE parent_id = ? AND name = ? AND deleted_at IS NULL LIMIT 1
  `, [floorId, name])
  const id = await ensureSpace(floorId, company.id, spaceType, name, subtype, seats)
  if (!before) created.spaces += 1
  return id
}

async function asset(name: string, category: string, model: string, locationId: number, manufacturerId: number | null) {
  const r = await ensureAsset({
    name, category, model, locationId, companyId: company.id, adminDomain, manufacturerId, statusId,
  })
  if (r.created) created.assets += 1
  return r.id
}

async function qty(
  table: 'accessories' | 'consumables' | 'components',
  name: string,
  category: string,
  categoryType: 'accessory' | 'consumable' | 'component',
  quantity: number,
  locationId: number,
) {
  const r = await ensureQty(table, {
    name, category, categoryType, qty: quantity, locationId, companyId: company.id, adminDomain,
  })
  if (r.created) created.qty += 1
}

// --- Nungambakkam: 6 floors ---
const nF1 = await floor(nungaId, 'Floor 1', null)
const nF2 = await floor(nungaId, 'Floor 2', 55)
const nF3 = await floor(nungaId, 'Floor 3', 58)
const nF4 = await floor(nungaId, 'Floor 4', 52)
const nF5 = await floor(nungaId, 'Floor 5', null)
const nF6 = await floor(nungaId, 'Floor 6', 60)

const play = await space(nF1, 'Play Area', 'OTHER', 12)
const meetingRooms: number[] = []
for (let i = 1; i <= 7; i++) {
  meetingRooms.push(await space(nF1, `Meeting Room ${i}`, 'MEETING_ROOM', 8))
}
const board = await space(nF1, 'Board Room', 'MEETING_ROOM', 16)

await asset('Nungambakkam Play Area — Table Tennis', 'Table', 'Stag Table Tennis Table', play, mfg.stag)
await asset('Nungambakkam Play Area — Carrom Board', 'Table', 'Tournament Carrom Board', play, mfg.stag)
await asset('Nungambakkam Play Area — Chess Table', 'Table', 'Wooden Chess Table', play, mfg.godrej)
await asset('Nungambakkam Play Area — Foosball', 'Table', 'Foosball Table', play, mfg.stag)
await qty('accessories', 'Nungambakkam Play Area — Visitor Chairs', 'Chair Accessories', 'accessory', 12, play)

for (let i = 0; i < meetingRooms.length; i++) {
  const loc = meetingRooms[i]
  const n = i + 1
  await asset(`Nungambakkam Meeting Room ${n} — Conference Table`, 'Table', 'Godrej Conference Table', loc, mfg.godrej)
  await asset(`Nungambakkam Meeting Room ${n} — Whiteboard`, 'Whiteboard', 'Wall Whiteboard 4x6', loc, mfg.godrej)
  if (n === 1 || n === 4 || n === 7) {
    await asset(`Nungambakkam Meeting Room ${n} — Display TV`, 'TV', 'Samsung 55-inch Display', loc, mfg.samsung)
    await qty('accessories', `Nungambakkam Meeting Room ${n} — TV Remote`, 'TV Remote', 'accessory', 1, loc)
  }
  await qty('accessories', `Nungambakkam Meeting Room ${n} — Meeting Chairs`, 'Chair Accessories', 'accessory', 8, loc)
  await qty('consumables', `Nungambakkam Meeting Room ${n} — Markers`, 'Marker', 'consumable', 12, loc)
  await qty('consumables', `Nungambakkam Meeting Room ${n} — Whiteboard Erasers`, 'Whiteboard Eraser', 'consumable', 4, loc)
}

await asset('Nungambakkam Board Room — Conference Table', 'Table', 'Boardroom Conference Table', board, mfg.godrej)
await asset('Nungambakkam Board Room — Display TV', 'TV', 'Samsung 75-inch Display', board, mfg.samsung)
await asset('Nungambakkam Board Room — Projector', 'Projector', 'Epson Meeting Projector', board, mfg.epson)
await asset('Nungambakkam Board Room — Whiteboard', 'Whiteboard', 'Boardroom Whiteboard', board, mfg.godrej)
await asset('Nungambakkam Board Room — Air Conditioner', 'Air Conditioner', 'Blue Star Cassette AC', board, mfg.blue)
await qty('accessories', 'Nungambakkam Board Room — Board Chairs', 'Chair Accessories', 'accessory', 16, board)
await qty('accessories', 'Nungambakkam Board Room — TV Remote', 'TV Remote', 'accessory', 1, board)
await qty('accessories', 'Nungambakkam Board Room — Projector Remote', 'Projector Remote', 'accessory', 1, board)
await qty('consumables', 'Nungambakkam Board Room — Markers', 'Marker', 'consumable', 20, board)
await qty('consumables', 'Nungambakkam Board Room — Notebooks', 'Notebook', 'consumable', 30, board)
await qty('consumables', 'Nungambakkam Board Room — Pens', 'Pen', 'consumable', 40, board)
await qty('components', 'Nungambakkam Board Room — AC Filters', 'AC Filter', 'component', 4, board)

async function seedSittingFloor(
  floorId: number,
  label: string,
  openSeats: number,
  cabinNames: string[],
) {
  const open = await space(floorId, 'Open Workspace', 'WORKSTATION', openSeats)
  await qty('accessories', `${label} — Workstation Chairs`, 'Chair Accessories', 'accessory', openSeats, open)
  await qty('components', `${label} — Chair Wheels`, 'Chair Wheel', 'component', 8, open)
  for (const cabin of cabinNames) {
    const loc = await space(floorId, cabin, 'CABIN', 1)
    await asset(`${label} — ${cabin} Desk`, 'Desk', 'Godrej Executive Desk', loc, mfg.godrej)
    await asset(`${label} — ${cabin} Chair`, 'Chair', 'Godrej Executive Chair', loc, mfg.godrej)
  }
}

await seedSittingFloor(nF2, 'Nungambakkam Floor 2', 55, [
  'CEO Cabin', 'CFO Cabin', 'CTO Cabin', 'CHRO Cabin', 'AGM Cabin', 'GM Cabin',
])
await seedSittingFloor(nF3, 'Nungambakkam Floor 3', 58, [
  'GM Finance Cabin', 'AGM Operations Cabin', 'DGM Cabin', 'Head Legal Cabin', 'Company Secretary Cabin', 'Internal Audit Cabin',
])
await seedSittingFloor(nF4, 'Nungambakkam Floor 4', 52, [
  'GM Projects Cabin', 'AGM Admin Cabin', 'AGM HR Cabin', 'DGM Commercial Cabin', 'Cabin 5',
])
await seedSittingFloor(nF6, 'Nungambakkam Floor 6', 60, [
  'VP Cabin', 'AVP Cabin', 'GM Cabin 1', 'GM Cabin 2', 'AGM Cabin 1', 'AGM Cabin 2', 'DGM Cabin', 'Cabin 8',
])

const pantry = await space(nF5, 'Pantry & Cafeteria', 'OTHER', 40)
await asset('Nungambakkam Pantry — Water Dispenser', 'Water Dispenser', 'Usha Water Dispenser', pantry, mfg.lg)
await asset('Nungambakkam Pantry — Charging Station', 'Charging Station', 'Multi-device Charging Station', pantry, mfg.godrej)
for (let i = 1; i <= 6; i++) {
  await asset(`Nungambakkam Pantry — Dining Table ${i}`, 'Table', 'Cafeteria Dining Table', pantry, mfg.godrej)
}
await qty('accessories', 'Nungambakkam Pantry — Dining Chairs', 'Chair Accessories', 'accessory', 40, pantry)
await qty('consumables', 'Nungambakkam Pantry — Paper', 'Paper', 'consumable', 20, pantry)
await qty('components', 'Nungambakkam Pantry — Light Drivers', 'Light Driver', 'component', 6, pantry)

// --- Bazullah: 4 floors ---
const bF1 = await floor(bazId, 'Floor 1', 50)
const bF2 = await floor(bazId, 'Floor 2', 52)
const bF3 = await floor(bazId, 'Floor 3', 48)
const bF4 = await floor(bazId, 'Floor 4', null)

await seedSittingFloor(bF1, 'Bazullah Floor 1', 50, [
  'Branch Head Cabin', 'AGM Cabin', 'GM Cabin', 'Cabin 4',
])
await seedSittingFloor(bF2, 'Bazullah Floor 2', 52, [
  'AGM Operations Cabin', 'AGM Admin Cabin', 'DGM Cabin', 'Cabin 4', 'Cabin 5',
])
await seedSittingFloor(bF3, 'Bazullah Floor 3', 48, [
  'GM Cabin', 'AGM HR Cabin', 'Cabin 3', 'Cabin 4', 'Cabin 5',
])

const bPantry = await space(bF4, 'Pantry', 'OTHER', 24)
await asset('Bazullah Pantry — Water Dispenser', 'Water Dispenser', 'Usha Water Dispenser', bPantry, mfg.lg)
for (let i = 1; i <= 4; i++) {
  await asset(`Bazullah Pantry — Dining Table ${i}`, 'Table', 'Cafeteria Dining Table', bPantry, mfg.godrej)
}
await qty('accessories', 'Bazullah Pantry — Dining Chairs', 'Chair Accessories', 'accessory', 24, bPantry)
await qty('consumables', 'Bazullah Pantry — Markers', 'Marker', 'consumable', 8, bPantry)
await qty('components', 'Bazullah Pantry — Door Locks', 'Door Lock', 'component', 4, bPantry)

const offices = await all<{ id: number; name: string; is_office: number }>(
  `SELECT id, name, is_office FROM locations WHERE id IN (?, ?) ORDER BY id`,
  [nungaId, bazId],
)
const floorCount = await get<{ c: number }>(`
  SELECT COUNT(*) as c FROM locations
  WHERE deleted_at IS NULL AND location_type_id = ? AND parent_id IN (?, ?)
`, [floorType, nungaId, bazId])
const spaceCount = await get<{ c: number }>(`
  SELECT COUNT(*) as c FROM locations
  WHERE deleted_at IS NULL AND location_type_id = ?
    AND parent_id IN (SELECT id FROM locations WHERE parent_id IN (?, ?) AND deleted_at IS NULL)
`, [spaceType, nungaId, bazId])
const adminAssets = await get<{ c: number }>(`SELECT COUNT(*) as c FROM assets WHERE deleted_at IS NULL AND domain_id = ?`, [adminDomain])
const adminAcc = await get<{ c: number }>(`SELECT COUNT(*) as c FROM accessories WHERE deleted_at IS NULL AND domain_id = ?`, [adminDomain])
const adminCons = await get<{ c: number }>(`SELECT COUNT(*) as c FROM consumables WHERE deleted_at IS NULL AND domain_id = ?`, [adminDomain])
const adminComp = await get<{ c: number }>(`SELECT COUNT(*) as c FROM components WHERE deleted_at IS NULL AND domain_id = ?`, [adminDomain])
const itOnTower = await get<{ c: number }>(`
  SELECT COUNT(*) as c FROM assets
  WHERE deleted_at IS NULL AND (location_id = ? OR rtd_location_id = ?)
    AND domain_id = (SELECT id FROM asset_domains WHERE code = 'it' AND deleted_at IS NULL LIMIT 1)
`, [nungaId, nungaId])
const itOnBazullah = await get<{ c: number }>(`
  SELECT COUNT(*) as c FROM assets
  WHERE deleted_at IS NULL AND (location_id = ? OR rtd_location_id = ?)
    AND domain_id = (SELECT id FROM asset_domains WHERE code = 'it' AND deleted_at IS NULL LIMIT 1)
`, [bazId, bazId])

  return {
    db: (await get<{ d: string }>('SELECT DATABASE() as d'))?.d,
    company: company.name,
    offices,
    new_this_run: created,
    totals: {
      floors: Number(floorCount?.c || 0),
      spaces: Number(spaceCount?.c || 0),
      admin_assets: Number(adminAssets?.c || 0),
      admin_accessories: Number(adminAcc?.c || 0),
      admin_consumables: Number(adminCons?.c || 0),
      admin_components: Number(adminComp?.c || 0),
    },
    it_assets_still_on_office_root: {
      nungambakkam: Number(itOnTower?.c || 0),
      bazullah: Number(itOnBazullah?.c || 0),
    },
    note: 'Existing IT assets on Refex Tower were not moved.',
  }
}

const isDirect = process.argv[1]
  && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])
if (isDirect) {
  dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env') })
  seedAdminSpaces()
    .then((r) => {
      console.log(JSON.stringify(r, null, 2))
      process.exit(0)
    })
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e)
      process.exit(1)
    })
}
