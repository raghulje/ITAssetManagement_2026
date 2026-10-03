import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { get, run, now } from '../db/index.js'
import { runPendingSchemaMigrations } from './schemaMigrate.js'
import { ensureDefaultRoles } from './permissions.js'

type Contact = { name: string; company: string; phone: string; email: string }

function defaultTracker(createdAt: string) {
  return [
    { key: 'start', label: 'Start', status: 'completed', source: 'Battery Degradation Issue', at: createdAt },
    { key: 'voice', label: 'Voice Bot Conversation', status: 'not_started', source: 'Refex IT' },
    { key: 'assign', label: 'Assign technician', status: 'not_started', source: 'UserTask' },
    { key: 'summary', label: 'Enter issue summary', status: 'not_started' },
    { key: 'completed', label: 'Completed', status: 'not_started', source: 'Battery Degradation Issue' },
  ]
}

function contactsPath() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(here, '../seeds/ril-asset-couriered-contacts.json')
}

/** Insert RIL couriered contacts as issues with no call / conversation history. Existing matches are skipped. */
export async function seedRilBatteryIssues(): Promise<{ total: number; inserted: number; skipped: number }> {
  const file = contactsPath()
  if (!fs.existsSync(file)) {
    throw new Error(`RIL contacts file missing: ${file}`)
  }
  const contacts = JSON.parse(fs.readFileSync(file, 'utf8')) as Contact[]
  const ts = now()
  let inserted = 0
  let skipped = 0

  for (const row of contacts) {
    const name = String(row.name || '').trim()
    if (!name) {
      skipped += 1
      continue
    }
    const phone = String(row.phone || '').trim()
    const email = String(row.email || '').trim().toLowerCase()
    const company = String(row.company || 'Refex Industries').trim() || 'Refex Industries'

    const existing = email
      ? await get<{ id: number }>(
          `SELECT id FROM battery_degradation_issues
           WHERE deleted_at IS NULL AND LOWER(email) = ?
           LIMIT 1`,
          [email],
        )
      : await get<{ id: number }>(
          `SELECT id FROM battery_degradation_issues
           WHERE deleted_at IS NULL AND LOWER(name) = ? AND IFNULL(phone, '') = ?
           LIMIT 1`,
          [name.toLowerCase(), phone],
        )

    if (existing) {
      skipped += 1
      continue
    }

    await run(
      `
      INSERT INTO battery_degradation_issues
        (name, phone, email, company, transcript, tracker, status, call_result, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'open', 'yet_to_call', ?, ?)
      `,
      [
        name,
        phone || null,
        email || null,
        company,
        JSON.stringify([]),
        JSON.stringify(defaultTracker(ts)),
        ts,
        ts,
      ],
    )
    inserted += 1
  }

  return { total: contacts.length, inserted, skipped }
}

export async function runBatteryDegradationSetup() {
  const migrations = await runPendingSchemaMigrations()
  try {
    await ensureDefaultRoles()
  } catch (e) {
    console.warn('[battery-setup] ensureDefaultRoles', e instanceof Error ? e.message : e)
  }
  const seed = await seedRilBatteryIssues()
  let typeBackfill = 0
  try {
    const { backfillOtherIssueTypes } = await import('./batteryTechnicianAssign.js')
    typeBackfill = await backfillOtherIssueTypes()
  } catch (e) {
    console.warn('[battery-setup] other issue type backfill', e instanceof Error ? e.message : e)
  }
  return { migrations, seed, typeBackfill }
}
