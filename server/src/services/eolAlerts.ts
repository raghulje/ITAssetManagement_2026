import { all, get, run, now } from '../db/index.js'
import { mailConfigured, sendMail } from './mail.js'
import { brandedEmail } from './notify.js'
import { isEmailCategoryEnabled, resolveEolRecipients } from './notificationConfig.js'

/** UI / dashboard still shows assets within this lead window. */
const LEAD_DAYS = 30

/** Prior reminder milestones: ~1 month, 1 week, 1 day before. */
const PRIOR_THRESHOLDS = [
  { days: 30, kind: '30d', label: '1 month' },
  { days: 7, kind: '7d', label: '1 week' },
  { days: 1, kind: '1d', label: '1 day' },
] as const

type PriorKind = (typeof PRIOR_THRESHOLDS)[number]

export type EolDueRow = {
  id: number
  asset_tag: string
  name: string | null
  purchase_date: string | null
  eol_date: string | null
  warranty_end: string | null
  model_name: string | null
  days_to_eol: number | null
  days_to_warranty: number | null
  eol_due: boolean
  warranty_due: boolean
}

function todaySql() {
  return now().slice(0, 10)
}

function appBase() {
  return (process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || 'http://localhost:3001').replace(/\/$/, '')
}

export type EolListFilters = {
  companyId?: number | null
  locationId?: number | null
  search?: string
  /** When set (user APIs), restrict to the caller's authorized domains. Omitted for background digest email. */
  permissions?: Record<string, unknown> | null
  domain?: unknown
}

/** Assets with EOL and/or warranty ending within lead window (or overdue). */
export async function listEolDueAssets(filters: EolListFilters = {}): Promise<EolDueRow[]> {
  const params: unknown[] = []
  let extra = ''
  if (filters.permissions) {
    const { inventoryDomainClause } = await import('./domainAuth.js')
    const domain = await inventoryDomainClause(filters.permissions, filters.domain, 'a')
    extra += domain.sql
    params.push(...domain.params)
  }
  if (filters.companyId) {
    extra += ' AND a.company_id = ?'
    params.push(filters.companyId)
  }
  if (filters.locationId) {
    extra += ' AND (a.location_id = ? OR a.rtd_location_id = ?)'
    params.push(filters.locationId, filters.locationId)
  }
  if (filters.search?.trim()) {
    const q = `%${filters.search.trim()}%`
    extra += ' AND (a.asset_tag LIKE ? OR a.name LIKE ? OR a.serial LIKE ?)'
    params.push(q, q, q)
  }

  const rows = await all<Record<string, unknown>>(`
    SELECT
      a.id,
      a.asset_tag,
      a.name,
      a.purchase_date,
      m.name AS model_name,
      COALESCE(a.asset_eol_date, IF(a.purchase_date IS NOT NULL AND m.eol IS NOT NULL AND m.eol > 0,
        DATE_ADD(a.purchase_date, INTERVAL m.eol MONTH), NULL)) AS eol_date,
      IF(a.purchase_date IS NOT NULL AND a.warranty_months IS NOT NULL AND a.warranty_months > 0,
        DATE_ADD(a.purchase_date, INTERVAL a.warranty_months MONTH), NULL) AS warranty_end,
      DATEDIFF(
        COALESCE(a.asset_eol_date, IF(a.purchase_date IS NOT NULL AND m.eol IS NOT NULL AND m.eol > 0,
          DATE_ADD(a.purchase_date, INTERVAL m.eol MONTH), NULL)),
        CURDATE()
      ) AS days_to_eol,
      DATEDIFF(
        IF(a.purchase_date IS NOT NULL AND a.warranty_months IS NOT NULL AND a.warranty_months > 0,
          DATE_ADD(a.purchase_date, INTERVAL a.warranty_months MONTH), NULL),
        CURDATE()
      ) AS days_to_warranty
    FROM assets a
    LEFT JOIN models m ON m.id = a.model_id
    WHERE a.deleted_at IS NULL
      ${extra}
      AND (
        (
          COALESCE(a.asset_eol_date, IF(a.purchase_date IS NOT NULL AND m.eol IS NOT NULL AND m.eol > 0,
            DATE_ADD(a.purchase_date, INTERVAL m.eol MONTH), NULL)) IS NOT NULL
          AND COALESCE(a.asset_eol_date, IF(a.purchase_date IS NOT NULL AND m.eol IS NOT NULL AND m.eol > 0,
            DATE_ADD(a.purchase_date, INTERVAL m.eol MONTH), NULL))
            <= DATE_ADD(CURDATE(), INTERVAL ${LEAD_DAYS} DAY)
        )
        OR (
          a.purchase_date IS NOT NULL AND a.warranty_months IS NOT NULL AND a.warranty_months > 0
          AND DATE_ADD(a.purchase_date, INTERVAL a.warranty_months MONTH)
            <= DATE_ADD(CURDATE(), INTERVAL ${LEAD_DAYS} DAY)
        )
      )
    ORDER BY COALESCE(
      COALESCE(a.asset_eol_date, IF(a.purchase_date IS NOT NULL AND m.eol IS NOT NULL AND m.eol > 0,
        DATE_ADD(a.purchase_date, INTERVAL m.eol MONTH), NULL)),
      IF(a.purchase_date IS NOT NULL AND a.warranty_months IS NOT NULL AND a.warranty_months > 0,
        DATE_ADD(a.purchase_date, INTERVAL a.warranty_months MONTH), NULL)
    ) ASC
  `, params)

  return rows.map((r) => {
    const daysEol = r.days_to_eol == null ? null : Number(r.days_to_eol)
    const daysWar = r.days_to_warranty == null ? null : Number(r.days_to_warranty)
    return {
      id: Number(r.id),
      asset_tag: String(r.asset_tag || ''),
      name: r.name != null ? String(r.name) : null,
      purchase_date: r.purchase_date != null ? String(r.purchase_date).slice(0, 10) : null,
      eol_date: r.eol_date != null ? String(r.eol_date).slice(0, 10) : null,
      warranty_end: r.warranty_end != null ? String(r.warranty_end).slice(0, 10) : null,
      model_name: r.model_name != null ? String(r.model_name) : null,
      days_to_eol: daysEol,
      days_to_warranty: daysWar,
      eol_due: daysEol != null && daysEol <= LEAD_DAYS,
      warranty_due: daysWar != null && daysWar <= LEAD_DAYS,
    }
  })
}

export async function countEolDue(filters: EolListFilters = {}): Promise<number> {
  const rows = await listEolDueAssets(filters)
  return rows.length
}

/**
 * Pick the highest due milestone that has not been sent yet for this asset.
 * e.g. at 25 days remaining → still fires "1 month" if 30d not logged;
 * at 5 days → fires "1 week" if 7d not logged.
 */
function duePriorThreshold(daysRemaining: number | null): PriorKind | null {
  if (daysRemaining == null || daysRemaining > 30) return null
  // Overdue / today still get the 1-day reminder if not yet sent
  if (daysRemaining <= 1) return PRIOR_THRESHOLDS[2]
  if (daysRemaining <= 7) return PRIOR_THRESHOLDS[1]
  if (daysRemaining <= 30) return PRIOR_THRESHOLDS[0]
  return null
}

async function alreadyNotified(kind: string, itemId: number, anchorDate: string) {
  const row = await get<{ id: number }>(`
    SELECT id FROM notification_log
    WHERE kind = ? AND item_type = 'asset' AND item_id = ? AND notified_on = ?
    LIMIT 1
  `, [kind, itemId, anchorDate])
  return Boolean(row)
}

async function markNotified(kind: string, itemId: number, anchorDate: string) {
  await run(`
    INSERT IGNORE INTO notification_log (kind, item_type, item_id, notified_on, created_at)
    VALUES (?, 'asset', ?, ?, ?)
  `, [kind, itemId, anchorDate, now()])
}

function daysLabel(d: number | null) {
  if (d == null) return '—'
  if (d < 0) return `${Math.abs(d)} day(s) overdue`
  if (d === 0) return 'today'
  return `in ${d} day(s)`
}

async function sendToMany(recipients: string[], subject: string, html: string, text: string) {
  for (const to of recipients) {
    try {
      await sendMail({ to, subject, html, text })
    } catch (e) {
      console.warn('[eolAlerts] send failed', to, e instanceof Error ? e.message : e)
    }
  }
}

type PriorItem = {
  row: EolDueRow
  type: 'eol' | 'warranty'
  threshold: PriorKind
  eventDate: string
  days: number | null
}

export type EolDigestResult = {
  sent: boolean
  skippedReason?: string
  eolCount: number
  warrantyCount: number
  emailedTo?: string
  milestones?: string[]
}

/** Prior EOL + warranty reminders (30d / 7d / 1d) to IT Asset Manager (+ ops). */
export async function runEolAlertDigest(): Promise<EolDigestResult> {
  if (!mailConfigured()) {
    return { sent: false, skippedReason: 'SMTP is not configured', eolCount: 0, warrantyCount: 0 }
  }
  if (!(await isEmailCategoryEnabled('eol_warranty'))) {
    return { sent: false, skippedReason: 'EOL/warranty emails disabled in Settings → Notifications', eolCount: 0, warrantyCount: 0 }
  }

  const recipients = await resolveEolRecipients()
  if (!recipients.length) {
    return {
      sent: false,
      skippedReason: 'No IT Asset Manager / ops recipients (assign users to IT Asset Manager role or set alert_email)',
      eolCount: 0,
      warrantyCount: 0,
    }
  }

  const due = await listEolDueAssets()
  const pending: PriorItem[] = []

  for (const row of due) {
    if (row.eol_date && row.days_to_eol != null) {
      const th = duePriorThreshold(row.days_to_eol)
      if (th) {
        const kind = `asset_eol_${th.kind}`
        // Anchor on expiry date so each milestone fires once per EOL date
        if (!(await alreadyNotified(kind, row.id, row.eol_date))) {
          pending.push({
            row,
            type: 'eol',
            threshold: th,
            eventDate: row.eol_date,
            days: row.days_to_eol,
          })
        }
      }
    }
    if (row.warranty_end && row.days_to_warranty != null) {
      const th = duePriorThreshold(row.days_to_warranty)
      if (th) {
        const kind = `asset_warranty_${th.kind}`
        if (!(await alreadyNotified(kind, row.id, row.warranty_end))) {
          pending.push({
            row,
            type: 'warranty',
            threshold: th,
            eventDate: row.warranty_end,
            days: row.days_to_warranty,
          })
        }
      }
    }
  }

  if (!pending.length) {
    return { sent: false, skippedReason: 'No new 30d/7d/1d EOL or warranty reminders due', eolCount: 0, warrantyCount: 0 }
  }

  const siteRow = await get<{ site_name?: string }>(`SELECT site_name FROM settings WHERE id = 1`)
  const site = siteRow?.site_name || 'Refex IT Asset Management'

  // Group by milestone + type for cleaner emails
  const groups = new Map<string, PriorItem[]>()
  for (const item of pending) {
    const key = `${item.type}:${item.threshold.kind}`
    const list = groups.get(key) || []
    list.push(item)
    groups.set(key, list)
  }

  let eolCount = 0
  let warrantyCount = 0
  const milestones: string[] = []

  for (const [, items] of groups) {
    const sample = items[0]
    const isEol = sample.type === 'eol'
    const title = isEol
      ? `EOL reminder — ${sample.threshold.label} before`
      : `Warranty reminder — ${sample.threshold.label} before`
    const intro = isEol
      ? `${items.length} asset(s) reach end of life ${sample.threshold.label === '1 day' ? 'tomorrow / today' : `in about ${sample.threshold.label}`}. Please plan replacement or disposal.`
      : `${items.length} asset(s) have warranty ending ${sample.threshold.label === '1 day' ? 'tomorrow / today' : `in about ${sample.threshold.label}`}. Please review coverage and renewals.`

    const lines = items.map((i) => {
      const a = i.row
      return `• ${a.asset_tag}${a.name ? ` — ${a.name}` : ''} | ${isEol ? 'EOL' : 'Warranty'} ${i.eventDate} (${daysLabel(i.days)})${a.model_name ? ` | ${a.model_name}` : ''}`
    })

    const { html, text } = brandedEmail({
      title,
      intro,
      fields: [
        { label: 'Reminder', value: `${sample.threshold.label} before ${isEol ? 'EOL' : 'warranty end'}` },
        { label: 'Assets in this alert', value: String(items.length) },
        { label: 'Asset list', value: lines.join(' | ') },
      ],
      ctaLabel: 'Open EOL due list',
      ctaUrl: `${appBase()}/hardware/eol/due`,
      footerNote: 'Sent to IT Asset Manager and ops roles. Each milestone (1 month / 1 week / 1 day) is emailed once per asset.',
    })

    const subject = `[${site}] ${title} (${items.length})`
    await sendToMany(recipients, subject, html, text)

    for (const i of items) {
      const kind = isEol ? `asset_eol_${i.threshold.kind}` : `asset_warranty_${i.threshold.kind}`
      await markNotified(kind, i.row.id, i.eventDate)
      if (isEol) eolCount += 1
      else warrantyCount += 1
    }
    milestones.push(`${sample.type}_${sample.threshold.kind}:${items.length}`)
  }

  return {
    sent: true,
    eolCount,
    warrantyCount,
    emailedTo: recipients.join(', '),
    milestones,
  }
}

let eolTimer: ReturnType<typeof setInterval> | null = null
let eolRunning = false

/** Daily (or custom interval) EOL/warranty prior reminders. EOL_ALERT_INTERVAL_MINUTES=0 disables. */
export function startEolAlertScheduler() {
  const minutes = Number(process.env.EOL_ALERT_INTERVAL_MINUTES ?? 1440)
  if (!minutes || minutes < 1) {
    console.log('EOL alert scheduler disabled (EOL_ALERT_INTERVAL_MINUTES=0)')
    return
  }

  const ms = minutes * 60_000
  console.log(`EOL/warranty prior-alert scheduler enabled every ${minutes} minute(s) (30d / 7d / 1d → IT Asset Manager)`)

  const tick = async () => {
    if (eolRunning) {
      console.warn('EOL alert skipped (previous run still in progress)')
      return
    }
    eolRunning = true
    try {
      const result = await runEolAlertDigest()
      if (result.sent) {
        console.log(
          `EOL/warranty prior alerts sent to ${result.emailedTo}: eol=${result.eolCount} warranty=${result.warrantyCount} [${(result.milestones || []).join(', ')}]`,
        )
      } else {
        console.log(`EOL/warranty prior alerts skipped: ${result.skippedReason}`)
      }
    } catch (e) {
      console.error('EOL alert scheduler failed:', e instanceof Error ? e.message : e)
    } finally {
      eolRunning = false
    }
  }

  setTimeout(() => { void tick() }, 20_000)
  eolTimer = setInterval(() => { void tick() }, ms)
}

export function stopEolAlertScheduler() {
  if (eolTimer) clearInterval(eolTimer)
  eolTimer = null
}
