import { run } from '../db/index.js'
import { tableHasColumn } from './domainAuth.js'

let ready = false

const ASSET_COLUMNS: Array<[string, string]> = [
  ['grn_number', 'VARCHAR(80) NULL'],
  ['invoice_number', 'VARCHAR(100) NULL'],
  ['invoice_date', 'DATE NULL'],
  ['po_number', 'VARCHAR(100) NULL'],
  ['p2p_line_key', 'VARCHAR(191) NULL'],
  ['p2p_payload', 'JSON NULL'],
  ['registered_by', 'INT UNSIGNED NULL'],
  ['registered_at', 'DATETIME NULL'],
]

async function indexExists(table: string, indexName: string) {
  const { get } = await import('../db/index.js')
  const row = await get<{ c: number }>(`
    SELECT COUNT(*) AS c FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
  `, [table, indexName])
  return Number(row?.c || 0) > 0
}

/** Add P2P purchase columns and the field-registrar columns. Safe to call repeatedly. */
export async function ensureP2pAssetColumns() {
  if (ready) return
  for (const [name, def] of ASSET_COLUMNS) {
    if (!(await tableHasColumn('assets', name))) {
      await run(`ALTER TABLE assets ADD COLUMN \`${name}\` ${def}`)
    }
  }
  if (!(await indexExists('assets', 'uk_assets_p2p_line_key'))) {
    await run('ALTER TABLE assets ADD UNIQUE KEY uk_assets_p2p_line_key (p2p_line_key)').catch(() => undefined)
  }
  if (!(await indexExists('assets', 'idx_assets_grn_number'))) {
    await run('ALTER TABLE assets ADD KEY idx_assets_grn_number (grn_number)').catch(() => undefined)
  }
  if (!(await indexExists('assets', 'idx_assets_po_number'))) {
    await run('ALTER TABLE assets ADD KEY idx_assets_po_number (po_number)').catch(() => undefined)
  }
  if (!(await indexExists('assets', 'idx_assets_invoice_number'))) {
    await run('ALTER TABLE assets ADD KEY idx_assets_invoice_number (invoice_number)').catch(() => undefined)
  }
  if (!(await indexExists('assets', 'idx_assets_registered_by'))) {
    await run('ALTER TABLE assets ADD KEY idx_assets_registered_by (registered_by)').catch(() => undefined)
  }
  await run(`
    CREATE TABLE IF NOT EXISTS p2p_grn_events (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      grn_number VARCHAR(80) NULL,
      po_number VARCHAR(100) NULL,
      invoice_number VARCHAR(100) NULL,
      status VARCHAR(32) NOT NULL,
      payload JSON NULL,
      result JSON NULL,
      created_at DATETIME NULL,
      PRIMARY KEY (id),
      KEY idx_p2p_events_grn (grn_number),
      KEY idx_p2p_events_po (po_number)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
  await backfillRegisteredBy().catch(() => undefined)
  ready = true
}

/** Copy the person already stored on past captures onto the asset, so older records show in the list. */
async function backfillRegisteredBy() {
  const { get } = await import('../db/index.js')
  const captures = await get<{ c: number }>(`
    SELECT COUNT(*) AS c FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'asset_captures'
  `)
  if (Number(captures?.c || 0) > 0) {
    await run(`
      UPDATE assets a
      INNER JOIN (
        SELECT c.asset_id, c.captured_by, COALESCE(c.captured_at, c.created_at) AS captured_at
        FROM asset_captures c
        INNER JOIN (
          SELECT asset_id, MIN(id) AS id
          FROM asset_captures
          WHERE captured_by IS NOT NULL
          GROUP BY asset_id
        ) first_capture ON first_capture.id = c.id
      ) src ON src.asset_id = a.id
      SET a.registered_by = src.captured_by,
          a.registered_at = COALESCE(a.registered_at, src.captured_at),
          a.created_by = COALESCE(a.created_by, src.captured_by)
      WHERE a.registered_by IS NULL
        AND a.deleted_at IS NULL
    `)
  }
  const labels = await get<{ c: number }>(`
    SELECT COUNT(*) AS c FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'label_codes'
  `)
  if (Number(labels?.c || 0) > 0) {
    await run(`
      UPDATE assets a
      INNER JOIN label_codes l ON l.asset_id = a.id AND l.registered_by IS NOT NULL
      SET a.registered_by = l.registered_by,
          a.registered_at = COALESCE(a.registered_at, l.registered_at),
          a.created_by = COALESCE(a.created_by, l.registered_by)
      WHERE a.registered_by IS NULL
        AND a.deleted_at IS NULL
    `)
  }
}
