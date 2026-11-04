import { get, run } from '../db/index.js'

let ready: Promise<void> | null = null

export function ensureConsultants(): Promise<void> {
  if (!ready) {
    ready = run(`
      CREATE TABLE IF NOT EXISTS consultants (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        consultant_code VARCHAR(16) NOT NULL,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL DEFAULT '',
        email VARCHAR(191) NULL,
        phone VARCHAR(64) NULL,
        company_name VARCHAR(191) NULL,
        notes TEXT NULL,
        created_at DATETIME NULL,
        updated_at DATETIME NULL,
        deleted_at DATETIME NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uk_consultants_code (consultant_code),
        KEY idx_consultants_name (first_name, last_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `).then(async () => {
      const col = await get<{ column_type: string }>(`
        SELECT COLUMN_TYPE AS column_type
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assets' AND COLUMN_NAME = 'assigned_type'
      `)
      const type = String(col?.column_type || '')
      if (type && !type.includes('consultant')) {
        await run(`
          ALTER TABLE assets
          MODIFY COLUMN assigned_type ENUM('user','location','asset','employee','consultant') NULL
        `)
      }
    }).catch((err) => {
      ready = null
      throw err
    })
  }
  return ready
}

export async function nextConsultantCode(): Promise<string> {
  await ensureConsultants()
  const row = await get<{ n: number }>(`
    SELECT COALESCE(MAX(CAST(SUBSTRING(consultant_code, 5) AS UNSIGNED)), 0) AS n
    FROM consultants
    WHERE consultant_code REGEXP '^CON-[0-9]+$'
  `)
  const next = Number(row?.n || 0) + 1
  return `CON-${String(next).padStart(4, '0')}`
}

export function consultantLabel(row: { first_name?: string | null; last_name?: string | null; consultant_code?: string | null }) {
  const name = `${row.first_name || ''} ${row.last_name || ''}`.trim()
  const code = String(row.consultant_code || '').trim()
  return code ? `${name} (${code})` : name
}
