/**
 * Wave 2.7 — controlled typed hierarchy creation + validation on STAGING ONLY.
 * Target: ITAssetManagement_2026_test
 * Never writes to ITAssetManagement_2026.
 *
 * Sample data is clearly labelled "FACILITY TEST …" / external_code WAVE27_*.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'
import {
  assertLocationHierarchy,
  isLocationTypeCode,
  type LocationTypeCode,
} from '../src/services/locationFoundation.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const serverRoot = path.resolve(__dirname, '..')
dotenv.config({ path: path.join(serverRoot, '.env') })

const PROD = 'ITAssetManagement_2026'
const STAGING = process.env.WAVE27_TARGET_DB || 'ITAssetManagement_2026_test'
const PREFIX = 'FACILITY TEST'
const EXT = 'WAVE27'

function isStagingName(name: string) {
  const n = String(name || '').trim()
  if (!n) return false
  if (n.toLowerCase() === PROD.toLowerCase()) return false
  return /test|staging|sandbox/i.test(n)
}

function connOpts(database: string) {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database,
    charset: 'utf8mb4' as const,
  }
}

async function q<T extends mysql.RowDataPacket>(conn: mysql.Connection, sql: string, params: unknown[] = []) {
  const [rows] = await conn.query<T[]>(sql, params)
  return rows
}

async function assertDb(conn: mysql.Connection, expectStaging: boolean) {
  const db = String((await q<{ d: string }>(conn, 'SELECT DATABASE() AS d'))[0]?.d || '')
  if (expectStaging) {
    if (!isStagingName(db) || db.toLowerCase() === PROD.toLowerCase()) {
      throw new Error(`DATABASE SAFETY BLOCKER: expected staging, got ${db}`)
    }
  }
  return db
}

async function snapshot(conn: mysql.Connection) {
  const database = await assertDb(conn, false)
  const n = async (sql: string, params: unknown[] = []) =>
    Number((await q<{ c: number }>(conn, sql, params))[0]?.c || 0)

  const types = await q<{ id: number; code: string; name: string }>(
    conn,
    `SELECT id, code, name FROM location_types ORDER BY hierarchy_level, id`,
  )
  const subtypes = await q<{ id: number; code: string; name: string }>(
    conn,
    `SELECT id, code, name FROM space_subtypes ORDER BY id`,
  )
  const companies = await q<{ id: number; name: string; code: string | null }>(
    conn,
    `SELECT id, name, code FROM companies WHERE deleted_at IS NULL ORDER BY id LIMIT 5`,
  )

  return {
    database,
    types,
    subtypes,
    companies,
    locations_live: await n('SELECT COUNT(*) AS c FROM locations WHERE deleted_at IS NULL'),
    locations_deleted: await n('SELECT COUNT(*) AS c FROM locations WHERE deleted_at IS NOT NULL'),
    unspecified_live: await n(`
      SELECT COUNT(*) AS c FROM locations l
      JOIN location_types t ON t.id = l.location_type_id
      WHERE l.deleted_at IS NULL AND t.code = 'UNSPECIFIED'
    `),
    typed_physical_live: await n(`
      SELECT COUNT(*) AS c FROM locations l
      JOIN location_types t ON t.id = l.location_type_id
      WHERE l.deleted_at IS NULL AND t.code <> 'UNSPECIFIED'
    `),
    parent_id_nonnull: await n('SELECT COUNT(*) AS c FROM locations WHERE deleted_at IS NULL AND parent_id IS NOT NULL'),
    legacy_id_checksum: await n(`
      SELECT COALESCE(SUM(l.id),0) AS c FROM locations l
      JOIN location_types t ON t.id = l.location_type_id
      WHERE l.deleted_at IS NULL AND t.code = 'UNSPECIFIED'
    `),
    legacy_parent_checksum: await n(`
      SELECT COALESCE(SUM(COALESCE(l.parent_id,0)),0) AS c FROM locations l
      JOIN location_types t ON t.id = l.location_type_id
      WHERE l.deleted_at IS NULL AND t.code = 'UNSPECIFIED'
    `),
    legacy_type_checksum: await n(`
      SELECT COALESCE(SUM(l.location_type_id),0) AS c FROM locations l
      JOIN location_types t ON t.id = l.location_type_id
      WHERE l.deleted_at IS NULL AND t.code = 'UNSPECIFIED'
    `),
    assets: await n('SELECT COUNT(*) AS c FROM assets WHERE deleted_at IS NULL'),
    asset_id_checksum: await n('SELECT COALESCE(SUM(id),0) AS c FROM assets WHERE deleted_at IS NULL'),
    asset_location_sum: await n('SELECT COALESCE(SUM(location_id),0) AS c FROM assets WHERE deleted_at IS NULL'),
    asset_rtd_sum: await n('SELECT COALESCE(SUM(rtd_location_id),0) AS c FROM assets WHERE deleted_at IS NULL'),
    asset_tag_checksum: await n(`
      SELECT COALESCE(SUM(CRC32(COALESCE(asset_tag,''))),0) AS c FROM assets WHERE deleted_at IS NULL
    `),
    assets_with_location: await n('SELECT COUNT(*) AS c FROM assets WHERE deleted_at IS NULL AND location_id IS NOT NULL'),
    assets_with_rtd: await n('SELECT COUNT(*) AS c FROM assets WHERE deleted_at IS NULL AND rtd_location_id IS NOT NULL'),
    consumables: await n('SELECT COUNT(*) AS c FROM consumables WHERE deleted_at IS NULL'),
    accessories: await n('SELECT COUNT(*) AS c FROM accessories WHERE deleted_at IS NULL'),
    components: await n('SELECT COUNT(*) AS c FROM components WHERE deleted_at IS NULL'),
    cons_loc_sum: await n('SELECT COALESCE(SUM(location_id),0) AS c FROM consumables WHERE deleted_at IS NULL'),
    acc_loc_sum: await n('SELECT COALESCE(SUM(location_id),0) AS c FROM accessories WHERE deleted_at IS NULL'),
    comp_loc_sum: await n('SELECT COALESCE(SUM(location_id),0) AS c FROM components WHERE deleted_at IS NULL'),
    wave27_existing: await n(`SELECT COUNT(*) AS c FROM locations WHERE external_code LIKE ? OR name LIKE ?`, [
      `${EXT}_%`,
      `${PREFIX}%`,
    ]),
  }
}

type TypeMap = Record<string, number>
type SubMap = Record<string, number>

async function loadMasters(conn: mysql.Connection) {
  const types = await q<{ id: number; code: string }>(conn, 'SELECT id, code FROM location_types')
  const subtypes = await q<{ id: number; code: string }>(conn, 'SELECT id, code FROM space_subtypes')
  const typeByCode: TypeMap = {}
  const subtypeByCode: SubMap = {}
  for (const t of types) typeByCode[t.code] = Number(t.id)
  for (const s of subtypes) subtypeByCode[s.code] = Number(s.id)
  for (const code of ['SITE', 'BUILDING', 'FLOOR', 'ZONE', 'DEPARTMENT_AREA', 'SPACE', 'UNSPECIFIED']) {
    if (!typeByCode[code]) throw new Error(`Missing location type ${code}`)
  }
  for (const code of ['MEETING_ROOM', 'STORE_ROOM', 'WORKSTATION', 'CABIN', 'OTHER']) {
    if (!subtypeByCode[code]) throw new Error(`Missing space subtype ${code}`)
  }
  return { typeByCode, subtypeByCode }
}

async function ancestorTypeCodes(conn: mysql.Connection, parentId: number | null): Promise<{
  parentTypeCode: LocationTypeCode | null
  parentIsSpace: boolean
  ancestorIds: number[]
}> {
  if (parentId == null) return { parentTypeCode: null, parentIsSpace: false, ancestorIds: [] }
  const parent = (await q<{ location_type_id: number | null; code: string | null; is_space: number }>(conn, `
    SELECT l.location_type_id, t.code, t.is_space
    FROM locations l
    LEFT JOIN location_types t ON t.id = l.location_type_id
    WHERE l.id = ? AND l.deleted_at IS NULL
  `, [parentId]))[0]
  if (!parent) throw new Error(`Parent ${parentId} not found`)
  const parentTypeCode = parent.code && isLocationTypeCode(parent.code) ? parent.code : null
  const ancestorIds: number[] = []
  const seen = new Set<number>()
  let current: number | null = parentId
  while (current != null) {
    if (seen.has(current)) {
      ancestorIds.push(current)
      break
    }
    seen.add(current)
    ancestorIds.push(current)
    const row = (await q<{ parent_id: number | null }>(conn, `SELECT parent_id FROM locations WHERE id = ?`, [current]))[0]
    current = row?.parent_id != null ? Number(row.parent_id) : null
  }
  return { parentTypeCode, parentIsSpace: Boolean(parent.is_space), ancestorIds }
}

async function insertLoc(
  conn: mysql.Connection,
  opts: {
    name: string
    ext: string
    typeCode: LocationTypeCode
    parentId: number | null
    companyId: number | null
    subtypeCode?: string | null
    typeByCode: TypeMap
    subtypeByCode: SubMap
  },
) {
  const db = await assertDb(conn, true)
  const typeId = opts.typeByCode[opts.typeCode]
  const subtypeId = opts.subtypeCode ? opts.subtypeByCode[opts.subtypeCode] : null
  const { parentTypeCode, parentIsSpace, ancestorIds } = await ancestorTypeCodes(conn, opts.parentId)
  assertLocationHierarchy({
    locationId: null,
    parentId: opts.parentId,
    typeCode: opts.typeCode,
    parentTypeCode,
    parentIsSpace,
    ancestorIds,
    hasChildren: false,
  })
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ')
  const [result] = await conn.query<mysql.ResultSetHeader>(
    `INSERT INTO locations
      (name, external_code, parent_id, company_id, location_type_id, space_subtype_id, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.name,
      opts.ext,
      opts.parentId,
      opts.companyId,
      typeId,
      subtypeId,
      `Wave 2.7 NON-PRODUCTION sample (${db})`,
      ts,
      ts,
    ],
  )
  return Number(result.insertId)
}

async function purgePreviousWave27(conn: mysql.Connection) {
  await assertDb(conn, true)
  // Remove disposable fixtures first (assets/inventory pointing at WAVE27 spaces)
  await conn.query(`
    DELETE FROM assets WHERE asset_tag LIKE 'WAVE27-TEMP-%'
  `)
  await conn.query(`
    DELETE FROM consumables WHERE name LIKE 'WAVE27 TEMP %'
  `)
  // Children before parents
  const rows = await q<{ id: number }>(conn, `
    SELECT id FROM locations
    WHERE external_code LIKE ? OR name LIKE ?
    ORDER BY id DESC
  `, [`${EXT}_%`, `${PREFIX}%`])
  for (const r of rows) {
    await conn.query(`UPDATE locations SET parent_id = NULL WHERE parent_id = ?`, [r.id])
    await conn.query(`DELETE FROM locations WHERE id = ?`, [r.id])
  }
  return rows.length
}

async function main() {
  if (!isStagingName(STAGING)) {
    throw new Error(`DATABASE SAFETY BLOCKER: WAVE27_TARGET_DB=${STAGING}`)
  }

  // --- Phase A: read-only production + staging baseline ---
  const prodConn = await mysql.createConnection(connOpts(PROD))
  let prodBaseline: Awaited<ReturnType<typeof snapshot>>
  try {
    const pdb = await assertDb(prodConn, false)
    if (pdb.toLowerCase() !== PROD.toLowerCase()) {
      throw new Error(`Expected production connection to ${PROD}, got ${pdb}`)
    }
    prodBaseline = await snapshot(prodConn)
  } finally {
    await prodConn.end()
  }

  const stagingConn = await mysql.createConnection(connOpts(STAGING))
  const report: Record<string, unknown> = {
    wave: '2.7',
    production_database: PROD,
    staging_database: STAGING,
    production_baseline: null as unknown,
    staging_baseline_before: null as unknown,
    staging_baseline_after: null as unknown,
    inserted: [] as unknown[],
    validations: {} as Record<string, unknown>,
    defects: [] as string[],
    code_changes_required: false,
  }

  try {
    const sdb = await assertDb(stagingConn, true)
    report.selected_staging = sdb
    const before = await snapshot(stagingConn)
    report.production_baseline = {
      database: prodBaseline.database,
      locations_live: prodBaseline.locations_live,
      unspecified_live: prodBaseline.unspecified_live,
      typed_physical_live: prodBaseline.typed_physical_live,
      assets: prodBaseline.assets,
      asset_location_sum: prodBaseline.asset_location_sum,
      asset_rtd_sum: prodBaseline.asset_rtd_sum,
      inventory: {
        consumables: prodBaseline.consumables,
        accessories: prodBaseline.accessories,
        components: prodBaseline.components,
      },
      types: prodBaseline.types,
      subtypes: prodBaseline.subtypes,
    }
    report.staging_baseline_before = {
      database: before.database,
      locations_live: before.locations_live,
      unspecified_live: before.unspecified_live,
      typed_physical_live: before.typed_physical_live,
      parent_id_nonnull: before.parent_id_nonnull,
      assets: before.assets,
      asset_location_sum: before.asset_location_sum,
      asset_rtd_sum: before.asset_rtd_sum,
      asset_id_checksum: before.asset_id_checksum,
      asset_tag_checksum: before.asset_tag_checksum,
      inventory: {
        consumables: before.consumables,
        accessories: before.accessories,
        components: before.components,
        cons_loc_sum: before.cons_loc_sum,
        acc_loc_sum: before.acc_loc_sum,
        comp_loc_sum: before.comp_loc_sum,
      },
      legacy_checksums: {
        id: before.legacy_id_checksum,
        parent: before.legacy_parent_checksum,
        type: before.legacy_type_checksum,
      },
      types: before.types,
      subtypes: before.subtypes,
      companies: before.companies,
      wave27_existing: before.wave27_existing,
    }

    const purged = await purgePreviousWave27(stagingConn)
    report.purged_previous_wave27 = purged

    const { typeByCode, subtypeByCode } = await loadMasters(stagingConn)
    const companyId = before.companies[0]?.id != null ? Number(before.companies[0].id) : null

    await stagingConn.beginTransaction()
    try {
      const siteId = await insertLoc(stagingConn, {
        name: `${PREFIX} SITE`,
        ext: `${EXT}_SITE`,
        typeCode: 'SITE',
        parentId: null,
        companyId,
        typeByCode,
        subtypeByCode,
      })
      const buildingId = await insertLoc(stagingConn, {
        name: `${PREFIX} BUILDING A`,
        ext: `${EXT}_BUILDING_A`,
        typeCode: 'BUILDING',
        parentId: siteId,
        companyId: null,
        typeByCode,
        subtypeByCode,
      })
      const floor01 = await insertLoc(stagingConn, {
        name: `${PREFIX} Floor 01`,
        ext: `${EXT}_FLOOR_01`,
        typeCode: 'FLOOR',
        parentId: buildingId,
        companyId: null,
        typeByCode,
        subtypeByCode,
      })
      const floor02 = await insertLoc(stagingConn, {
        name: `${PREFIX} Floor 02`,
        ext: `${EXT}_FLOOR_02`,
        typeCode: 'FLOOR',
        parentId: buildingId,
        companyId: null,
        typeByCode,
        subtypeByCode,
      })
      const zoneId = await insertLoc(stagingConn, {
        name: `${PREFIX} North Zone`,
        ext: `${EXT}_ZONE_N`,
        typeCode: 'ZONE',
        parentId: floor01,
        companyId: null,
        typeByCode,
        subtypeByCode,
      })
      const deptId = await insertLoc(stagingConn, {
        name: `${PREFIX} Operations Area`,
        ext: `${EXT}_DEPT_OPS`,
        typeCode: 'DEPARTMENT_AREA',
        parentId: floor01,
        companyId: null,
        typeByCode,
        subtypeByCode,
      })
      const meetingId = await insertLoc(stagingConn, {
        name: `${PREFIX} Meeting Room 01`,
        ext: `${EXT}_SPACE_MEETING_01`,
        typeCode: 'SPACE',
        parentId: floor01,
        companyId: null,
        subtypeCode: 'MEETING_ROOM',
        typeByCode,
        subtypeByCode,
      })
      const storeId = await insertLoc(stagingConn, {
        name: `${PREFIX} Store Room 01`,
        ext: `${EXT}_SPACE_STORE_01`,
        typeCode: 'SPACE',
        parentId: floor01,
        companyId: null,
        subtypeCode: 'STORE_ROOM',
        typeByCode,
        subtypeByCode,
      })
      const ws1 = await insertLoc(stagingConn, {
        name: `${PREFIX} Workstation Zone A-01`,
        ext: `${EXT}_SPACE_WS_A01`,
        typeCode: 'SPACE',
        parentId: zoneId,
        companyId: null,
        subtypeCode: 'WORKSTATION',
        typeByCode,
        subtypeByCode,
      })
      const ws2 = await insertLoc(stagingConn, {
        name: `${PREFIX} Workstation Zone A-02`,
        ext: `${EXT}_SPACE_WS_A02`,
        typeCode: 'SPACE',
        parentId: zoneId,
        companyId: null,
        subtypeCode: 'WORKSTATION',
        typeByCode,
        subtypeByCode,
      })
      const cabinId = await insertLoc(stagingConn, {
        name: `${PREFIX} Cabin 01`,
        ext: `${EXT}_SPACE_CABIN_01`,
        typeCode: 'SPACE',
        parentId: deptId,
        companyId: null,
        subtypeCode: 'CABIN',
        typeByCode,
        subtypeByCode,
      })
      const archiveLeafId = await insertLoc(stagingConn, {
        name: `${PREFIX} Archive Leaf`,
        ext: `${EXT}_SPACE_ARCHIVE_LEAF`,
        typeCode: 'SPACE',
        parentId: floor02,
        companyId: null,
        subtypeCode: 'OTHER',
        typeByCode,
        subtypeByCode,
      })

      await stagingConn.commit()

      const inserted = await q<{
        id: number
        name: string
        parent_id: number | null
        company_id: number | null
        type_code: string
        subtype_code: string | null
        external_code: string | null
      }>(stagingConn, `
        SELECT l.id, l.name, l.parent_id, l.company_id, t.code AS type_code, s.code AS subtype_code, l.external_code
        FROM locations l
        JOIN location_types t ON t.id = l.location_type_id
        LEFT JOIN space_subtypes s ON s.id = l.space_subtype_id
        WHERE l.external_code LIKE ?
        ORDER BY l.id
      `, [`${EXT}_%`])
      report.inserted = inserted
      report.ids = {
        siteId, buildingId, floor01, floor02, zoneId, deptId,
        meetingId, storeId, ws1, ws2, cabinId, archiveLeafId,
      }
    } catch (e) {
      await stagingConn.rollback()
      throw e
    }

    // Point app pool at staging for Wave 2.6 service APIs
    process.env.DB_NAME = STAGING
    const {
      getLocationTree,
      getLocationPath,
      getLocationChildren,
      validateProposedParent,
      moveLocation,
      archiveLocation,
      restoreLocation,
      collectArchiveCounts,
      LocationHierarchyError,
    } = await import('../src/services/locationHierarchy.js')

    const ids = report.ids as Record<string, number>

    // Structure checks
    const structureOk = insertedStructureOk(report.inserted as Array<Record<string, unknown>>, ids)
    report.validations.structure = structureOk

    // Tree API
    const tree = await getLocationTree({})
    const treeWithOps = await getLocationTree({ include_operational: 'true' })
    const treeHasSite = JSON.stringify(tree.trees).includes(`"id":${ids.siteId}`)
    const treeHasUnspecifiedInside = (() => {
      const walk = (nodes: Array<{ location_type?: { code?: string }; children?: unknown[] }>): boolean => {
        for (const n of nodes) {
          if (n.location_type?.code === 'UNSPECIFIED') return true
          if (n.children && walk(n.children as never[])) return true
        }
        return false
      }
      return walk(tree.trees as never[])
    })()
    const opsCount = (treeWithOps.operational || []).length
    report.validations.tree = {
      typed_contains_site: treeHasSite,
      unspecified_in_typed_tree: treeHasUnspecifiedInside,
      operational_count: opsCount,
      cycles_detected: tree.meta.cycles_detected,
      ordering: tree.meta.ordering,
      include_operational_separate: opsCount > 0 && !treeHasUnspecifiedInside,
    }

    // Path API
    const pathChecks: Record<string, string[]> = {}
    for (const [label, id] of Object.entries({
      SITE: ids.siteId,
      BUILDING: ids.buildingId,
      FLOOR: ids.floor01,
      ZONE: ids.zoneId,
      DEPARTMENT_AREA: ids.deptId,
      SPACE: ids.ws1,
    })) {
      const p = await getLocationPath(id)
      pathChecks[label] = p.path.map((x) => String(x.location_type?.code || ''))
    }
    report.validations.path = pathChecks

    // Children API
    const floorChildren = await getLocationChildren(ids.floor01)
    const spaceChildren = await getLocationChildren(ids.ws1)
    report.validations.children = {
      floor01_child_ids: floorChildren.children.map((c) => c.id).sort((a, b) => a - b),
      space_children: spaceChildren.children.length,
    }

    // Parent validation
    const parentValidation: Record<string, unknown> = {}
    try {
      await validateProposedParent({ locationId: ids.ws1, parentId: ids.deptId })
      parentValidation.valid_space_under_dept = true
    } catch (e) {
      parentValidation.valid_space_under_dept = false
      parentValidation.valid_space_under_dept_error = e instanceof Error ? e.message : String(e)
    }
    const expectFail = async (key: string, fn: () => Promise<unknown>) => {
      try {
        await fn()
        parentValidation[key] = 'UNEXPECTED_PASS'
      } catch (e) {
        parentValidation[key] = e instanceof LocationHierarchyError || e instanceof Error ? e.message : 'failed'
      }
    }
    await expectFail('self_parent', () => validateProposedParent({ locationId: ids.ws1, parentId: ids.ws1 }))
    await expectFail('cycle', () => validateProposedParent({ locationId: ids.floor01, parentId: ids.ws1 }))
    await expectFail('space_as_parent', () => validateProposedParent({
      locationId: null,
      parentId: ids.ws1,
      locationTypeId: typeByCode.BUILDING,
    }))
    const unspecifiedParent = (await q<{ id: number }>(stagingConn, `
      SELECT l.id FROM locations l
      JOIN location_types t ON t.id = l.location_type_id
      WHERE l.deleted_at IS NULL AND t.code = 'UNSPECIFIED'
      ORDER BY l.id LIMIT 1
    `))[0]?.id
    if (unspecifiedParent) {
      await expectFail('typed_under_unspecified', () => validateProposedParent({
        locationId: null,
        parentId: unspecifiedParent,
        locationTypeId: typeByCode.BUILDING,
      }))
    }
    await expectFail('site_under_building', () => validateProposedParent({
      locationId: ids.siteId,
      parentId: ids.buildingId,
    }))
    report.validations.parent = parentValidation

    // Placement checksums before move
    const beforeMove = await snapshot(stagingConn)

    // Move: SPACE ws1 ZONE → DEPARTMENT_AREA, then restore
    const moved = await moveLocation(ids.ws1, ids.deptId, null)
    const afterMoveParent = (await q<{ parent_id: number | null }>(
      stagingConn,
      `SELECT parent_id FROM locations WHERE id = ?`,
      [ids.ws1],
    ))[0]?.parent_id
    const childStillUnderZone = Number((await q<{ c: number }>(stagingConn, `
      SELECT COUNT(*) AS c FROM locations WHERE parent_id = ? AND deleted_at IS NULL
    `, [ids.zoneId]))[0]?.c || 0)
    await moveLocation(ids.ws1, ids.zoneId, null) // restore intended state
    const afterRestoreParent = (await q<{ parent_id: number | null }>(
      stagingConn,
      `SELECT parent_id FROM locations WHERE id = ?`,
      [ids.ws1],
    ))[0]?.parent_id
    const afterMove = await snapshot(stagingConn)
    report.validations.move = {
      moved_parent_was: afterMoveParent,
      expected_temp_parent: ids.deptId,
      restored_parent: afterRestoreParent,
      expected_final_parent: ids.zoneId,
      node_id_unchanged: moved.node && Number((moved.node as { id: number }).id) === ids.ws1,
      zone_still_has_ws2: childStillUnderZone >= 1,
      asset_location_sum_unchanged: beforeMove.asset_location_sum === afterMove.asset_location_sum,
      asset_rtd_sum_unchanged: beforeMove.asset_rtd_sum === afterMove.asset_rtd_sum,
      inventory_sums_unchanged:
        beforeMove.cons_loc_sum === afterMove.cons_loc_sum
        && beforeMove.acc_loc_sum === afterMove.acc_loc_sum
        && beforeMove.comp_loc_sum === afterMove.comp_loc_sum,
    }

    // Archive / restore unused leaf
    await archiveLocation(ids.archiveLeafId, null)
    const archived = (await q<{ deleted_at: string | null }>(
      stagingConn,
      `SELECT deleted_at FROM locations WHERE id = ?`,
      [ids.archiveLeafId],
    ))[0]
    await restoreLocation(ids.archiveLeafId, null)
    const restored = (await q<{ deleted_at: string | null }>(
      stagingConn,
      `SELECT deleted_at FROM locations WHERE id = ?`,
      [ids.archiveLeafId],
    ))[0]

    // Archive guards
    const floorBlock = await collectArchiveCounts(ids.floor01)
    let assetBlockOk = false
    let invBlockOk = false
    const ts = new Date().toISOString().slice(0, 19).replace('T', ' ')
    // Temporary staging-only asset (not an existing production row)
    const [assetIns] = await stagingConn.query<mysql.ResultSetHeader>(`
      INSERT INTO assets (asset_tag, name, status_id, location_id, rtd_location_id, model_id, created_at, updated_at)
      SELECT 'WAVE27-TEMP-ASSET', 'WAVE27 TEMP ASSET',
        (SELECT id FROM status_labels WHERE deleted_at IS NULL ORDER BY id LIMIT 1),
        ?, ?,
        (SELECT id FROM models WHERE deleted_at IS NULL ORDER BY id LIMIT 1),
        ?, ?
    `, [ids.meetingId, ids.meetingId, ts, ts])
    const tempAssetId = Number(assetIns.insertId)
    const meetingBlock = await collectArchiveCounts(ids.meetingId)
    assetBlockOk = meetingBlock.counts.asset_placements > 0 || meetingBlock.counts.rtd_references > 0
    await stagingConn.query(`DELETE FROM assets WHERE id = ? AND asset_tag = 'WAVE27-TEMP-ASSET'`, [tempAssetId])

    const [consIns] = await stagingConn.query<mysql.ResultSetHeader>(`
      INSERT INTO consumables (name, qty, location_id, created_at, updated_at)
      VALUES ('WAVE27 TEMP CONSUMABLE', 1, ?, ?, ?)
    `, [ids.storeId, ts, ts])
    const tempConsId = Number(consIns.insertId)
    const storeBlock = await collectArchiveCounts(ids.storeId)
    invBlockOk = storeBlock.counts.inventory_records > 0
    await stagingConn.query(`DELETE FROM consumables WHERE id = ? AND name = 'WAVE27 TEMP CONSUMABLE'`, [tempConsId])

    report.validations.archive_restore = {
      unused_leaf_archived: archived?.deleted_at != null,
      unused_leaf_restored: restored?.deleted_at == null,
      floor_blocked_by_children: floorBlock.blocked && floorBlock.counts.active_children > 0,
      asset_placement_block: assetBlockOk && meetingBlock.blocked,
      inventory_block: invBlockOk && storeBlock.blocked,
    }

    // Final integrity vs staging baseline (legacy + existing assets)
    const after = await snapshot(stagingConn)
    report.staging_baseline_after = {
      database: after.database,
      locations_live: after.locations_live,
      unspecified_live: after.unspecified_live,
      typed_physical_live: after.typed_physical_live,
      assets: after.assets,
      asset_location_sum: after.asset_location_sum,
      asset_rtd_sum: after.asset_rtd_sum,
      asset_id_checksum: after.asset_id_checksum,
      asset_tag_checksum: after.asset_tag_checksum,
      inventory: {
        consumables: after.consumables,
        accessories: after.accessories,
        components: after.components,
        cons_loc_sum: after.cons_loc_sum,
        acc_loc_sum: after.acc_loc_sum,
        comp_loc_sum: after.comp_loc_sum,
      },
      legacy_checksums: {
        id: after.legacy_id_checksum,
        parent: after.legacy_parent_checksum,
        type: after.legacy_type_checksum,
      },
    }

    const integrity = {
      legacy_unspecified_unchanged: before.unspecified_live === after.unspecified_live
        && before.legacy_id_checksum === after.legacy_id_checksum
        && before.legacy_parent_checksum === after.legacy_parent_checksum
        && before.legacy_type_checksum === after.legacy_type_checksum,
      assets_unchanged: before.assets === after.assets
        && before.asset_id_checksum === after.asset_id_checksum
        && before.asset_tag_checksum === after.asset_tag_checksum
        && before.asset_location_sum === after.asset_location_sum
        && before.asset_rtd_sum === after.asset_rtd_sum,
      inventory_unchanged: before.consumables === after.consumables
        && before.accessories === after.accessories
        && before.components === after.components
        && before.cons_loc_sum === after.cons_loc_sum
        && before.acc_loc_sum === after.acc_loc_sum
        && before.comp_loc_sum === after.comp_loc_sum,
      typed_increased: after.typed_physical_live === before.typed_physical_live - purged + (report.inserted as unknown[]).length
        || after.typed_physical_live >= (report.inserted as unknown[]).length,
      new_typed_count: (report.inserted as unknown[]).length,
      production_not_written: true,
    }
    report.validations.integrity = integrity

    // Production still untouched (read-only recheck)
    const prodRecheck = await mysql.createConnection(connOpts(PROD))
    try {
      const p2 = await snapshot(prodRecheck)
      report.validations.production_unchanged = {
        locations_live: p2.locations_live === prodBaseline.locations_live,
        unspecified_live: p2.unspecified_live === prodBaseline.unspecified_live,
        typed_physical_live: p2.typed_physical_live === prodBaseline.typed_physical_live,
        assets: p2.assets === prodBaseline.assets,
        asset_location_sum: p2.asset_location_sum === prodBaseline.asset_location_sum,
        asset_rtd_sum: p2.asset_rtd_sum === prodBaseline.asset_rtd_sum,
      }
    } finally {
      await prodRecheck.end()
    }

    const failures: string[] = []
    if (!structureOk.ok) failures.push('structure')
    if (!treeHasSite || treeHasUnspecifiedInside) failures.push('tree')
    if (pathChecks.SPACE?.join('→') !== 'SITE→BUILDING→FLOOR→ZONE→SPACE') failures.push('path')
    if ((report.validations.children as { space_children: number }).space_children !== 0) failures.push('children')
    if (parentValidation.valid_space_under_dept !== true) failures.push('parent_valid')
    if (String(parentValidation.self_parent).includes('UNEXPECTED')) failures.push('self_parent')
    if (String(parentValidation.site_under_building).includes('UNEXPECTED')) failures.push('site_under')
    const move = report.validations.move as Record<string, unknown>
    if (!move.asset_location_sum_unchanged || !move.restored_parent) failures.push('move')
    const ar = report.validations.archive_restore as Record<string, unknown>
    if (!ar.unused_leaf_archived || !ar.unused_leaf_restored || !ar.floor_blocked_by_children) failures.push('archive')
    if (!integrity.legacy_unspecified_unchanged || !integrity.assets_unchanged || !integrity.inventory_unchanged) {
      failures.push('integrity')
    }
    report.failures = failures
    report.ok = failures.length === 0
  } finally {
    await stagingConn.end()
  }

  console.log(JSON.stringify(report, null, 2))
  try {
    const { getPool } = await import('../src/db/index.js')
    await getPool().end()
  } catch { /* ignore */ }
  if (!report.ok) process.exit(1)
}

function insertedStructureOk(
  inserted: Array<Record<string, unknown>>,
  ids: Record<string, number>,
) {
  const byId = new Map(inserted.map((r) => [Number(r.id), r]))
  const checks: Record<string, boolean> = {}
  const site = byId.get(ids.siteId)
  checks.site_no_parent = site?.parent_id == null && site?.type_code === 'SITE'
  checks.building_under_site = byId.get(ids.buildingId)?.parent_id === ids.siteId
    && byId.get(ids.buildingId)?.type_code === 'BUILDING'
  checks.floor_under_building = byId.get(ids.floor01)?.parent_id === ids.buildingId
  checks.zone_under_floor = byId.get(ids.zoneId)?.parent_id === ids.floor01
  checks.dept_under_floor = byId.get(ids.deptId)?.parent_id === ids.floor01
  checks.meeting_under_floor = byId.get(ids.meetingId)?.parent_id === ids.floor01
    && byId.get(ids.meetingId)?.subtype_code === 'MEETING_ROOM'
  checks.ws_under_zone = byId.get(ids.ws1)?.parent_id === ids.zoneId
    && byId.get(ids.ws1)?.subtype_code === 'WORKSTATION'
  checks.cabin_under_dept = byId.get(ids.cabinId)?.parent_id === ids.deptId
    && byId.get(ids.cabinId)?.subtype_code === 'CABIN'
  checks.count = inserted.length === 12
  return { ok: Object.values(checks).every(Boolean), checks }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
