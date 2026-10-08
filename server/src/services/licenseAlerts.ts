import { all, get, run, now } from '../db/index.js'
import { sendMail, mailConfigured } from './mail.js'
import { brandedEmail } from './notify.js'
import { isEmailCategoryEnabled, resolveEolRecipients } from './notificationConfig.js'
import { subscriptionLabel } from './licenseSubscription.js'

function appBase() {
  return (process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || 'http://localhost:3001').replace(/\/$/, '')
}

/** Week before + last three calendar days before end (7, 3, 2, 1). */
const THRESHOLDS = [
  { kind: '7d', maxDays: 7, minDays: 4, label: '1 week before' },
  { kind: '3d', maxDays: 3, minDays: 3, label: '3 days before' },
  { kind: '2d', maxDays: 2, minDays: 2, label: '2 days before' },
  { kind: '1d', maxDays: 1, minDays: -9999, label: 'last day / overdue' },
] as const

type Threshold = (typeof THRESHOLDS)[number]

type DueLicense = {
  id: number
  name: string
  expiration_date: string
  days_remaining: number
  subscription_period: string | null
  subscription_custom_value: number | null
  subscription_custom_unit: string | null
  is_recurring: number
  company_name: string | null
  requester_name: string | null
  requester_email: string | null
}

function dueThreshold(daysRemaining: number): Threshold | null {
  for (const th of THRESHOLDS) {
    if (daysRemaining <= th.maxDays && daysRemaining >= th.minDays) return th
  }
  return null
}

async function alreadyNotified(kind: string, itemId: number, anchorDate: string) {
  const row = await get<{ id: number }>(`
    SELECT id FROM notification_log
    WHERE kind = ? AND item_type = 'license' AND item_id = ? AND notified_on = ?
    LIMIT 1
  `, [kind, itemId, anchorDate])
  return Boolean(row)
}

async function markNotified(kind: string, itemId: number, anchorDate: string) {
  await run(`
    INSERT IGNORE INTO notification_log (kind, item_type, item_id, notified_on, created_at)
    VALUES (?, 'license', ?, ?, ?)
  `, [kind, itemId, anchorDate, now()])
}

export async function listRecurringLicensesDue(withinDays = 7): Promise<DueLicense[]> {
  const rows = await all<DueLicense>(`
    SELECT l.id, l.name, l.expiration_date,
      DATEDIFF(l.expiration_date, CURDATE()) as days_remaining,
      l.subscription_period, l.subscription_custom_value, l.subscription_custom_unit, l.is_recurring,
      c.name as company_name,
      CASE
        WHEN e.id IS NOT NULL THEN CONCAT(e.first_name, ' ', e.last_name, ' (', e.employee_code, ')')
        ELSE NULL
      END as requester_name,
      e.email as requester_email
    FROM licenses l
    LEFT JOIN companies c ON c.id = l.company_id
    LEFT JOIN employees e ON e.id = l.requested_by_employee_id AND e.deleted_at IS NULL
    WHERE l.deleted_at IS NULL
      AND l.is_recurring = 1
      AND l.expiration_date IS NOT NULL
      AND DATEDIFF(l.expiration_date, CURDATE()) <= ?
    ORDER BY l.expiration_date ASC, l.name ASC
  `, [withinDays])
  return rows.map((r) => ({
    ...r,
    days_remaining: Number(r.days_remaining),
    expiration_date: String(r.expiration_date).slice(0, 10),
  }))
}

export type LicenseDigestResult = {
  sent: boolean
  skippedReason?: string
  count: number
  emailedTo?: string
  milestones?: string[]
}

export async function runLicenseRenewalDigest(): Promise<LicenseDigestResult> {
  if (!mailConfigured()) {
    return { sent: false, skippedReason: 'SMTP is not configured', count: 0 }
  }
  if (!(await isEmailCategoryEnabled('license_renewal'))) {
    return { sent: false, skippedReason: 'License renewal emails disabled in Settings → Notifications', count: 0 }
  }

  const recipients = await resolveEolRecipients()
  if (!recipients.length) {
    return {
      sent: false,
      skippedReason: 'No IT Asset Manager / ops recipients (assign users to IT Asset Manager role or set alert_email)',
      count: 0,
    }
  }

  const due = await listRecurringLicensesDue(7)
  type Pending = { lic: DueLicense; threshold: Threshold }
  const pending: Pending[] = []

  for (const lic of due) {
    const th = dueThreshold(lic.days_remaining)
    if (!th) continue
    const kind = `license_renewal_${th.kind}`
    if (!(await alreadyNotified(kind, lic.id, lic.expiration_date))) {
      pending.push({ lic, threshold: th })
    }
  }

  if (!pending.length) {
    return { sent: false, skippedReason: 'No recurring license renewals due for new milestones', count: 0 }
  }

  // Group by threshold for cleaner digests
  const byKind = new Map<string, Pending[]>()
  for (const p of pending) {
    const k = p.threshold.kind
    if (!byKind.has(k)) byKind.set(k, [])
    byKind.get(k)!.push(p)
  }

  const siteRow = await get<{ site_name?: string }>(`SELECT site_name FROM settings WHERE id = 1`)
  const site = String(siteRow?.site_name || 'Refex ITAM')
  const milestones: string[] = []
  let count = 0

  for (const th of THRESHOLDS) {
    const items = byKind.get(th.kind) || []
    if (!items.length) continue

    const lines = items.map(({ lic }) => {
      const days = lic.days_remaining
      const when = days < 0
        ? `${Math.abs(days)}d overdue`
        : days === 0
          ? 'today'
          : `in ${days}d`
      return `${lic.name} · ends ${lic.expiration_date} (${when}) · ${subscriptionLabel({
        period: lic.subscription_period,
        customValue: lic.subscription_custom_value,
        customUnit: lic.subscription_custom_unit,
        isRecurring: lic.is_recurring,
      })} · req: ${lic.requester_name || '—'}`
    })

    const title = `License renewal — ${th.label}`
    const { html, text } = brandedEmail({
      title,
      intro: `${items.length} recurring license(s) need attention (${th.label}).`,
      fields: [
        { label: 'Reminder', value: th.label },
        { label: 'Licenses in this alert', value: String(items.length) },
        { label: 'License list', value: lines.join(' | ') },
      ],
      ctaLabel: 'Open licenses',
      ctaUrl: `${appBase()}/licenses`,
      footerNote: 'Sent to IT Asset Manager (+ ops). Each milestone (7d / 3d / 2d / 1d) is emailed once per subscription end date.',
    })

    const subject = `[${site}] ${title} (${items.length})`
    for (const to of recipients) {
      try {
        await sendMail({ to, subject, html, text, emailType: 'license_renewal', relatedType: 'license' })
      } catch (e) {
        console.warn('[licenseAlerts] send failed', to, e instanceof Error ? e.message : e)
      }
    }

    for (const { lic, threshold } of items) {
      await markNotified(`license_renewal_${threshold.kind}`, lic.id, lic.expiration_date)
      count += 1
    }
    milestones.push(`${th.kind}:${items.length}`)
  }

  return {
    sent: true,
    count,
    emailedTo: recipients.join(', '),
    milestones,
  }
}

let licTimer: ReturnType<typeof setInterval> | null = null
let licRunning = false

/** Same cadence as EOL alerts by default. LICENSE_ALERT_INTERVAL_MINUTES=0 disables. */
export function startLicenseAlertScheduler() {
  const minutes = Number(
    process.env.LICENSE_ALERT_INTERVAL_MINUTES
      ?? process.env.EOL_ALERT_INTERVAL_MINUTES
      ?? 1440,
  )
  if (!minutes || minutes < 1) {
    console.log('License renewal alert scheduler disabled')
    return
  }

  const ms = minutes * 60_000
  console.log(`License renewal prior-alert scheduler enabled every ${minutes} minute(s) (7d / 3d / 2d / 1d → IT Asset Manager)`)

  const tick = async () => {
    if (licRunning) return
    licRunning = true
    try {
      const result = await runLicenseRenewalDigest()
      if (result.sent) {
        console.log(
          `License renewal alerts sent to ${result.emailedTo}: count=${result.count} [${(result.milestones || []).join(', ')}]`,
        )
      } else {
        console.log(`License renewal alerts skipped: ${result.skippedReason}`)
      }
    } catch (e) {
      console.error('License alert scheduler failed:', e instanceof Error ? e.message : e)
    } finally {
      licRunning = false
    }
  }

  setTimeout(() => { void tick() }, 45_000)
  licTimer = setInterval(() => { void tick() }, ms)
}

export function stopLicenseAlertScheduler() {
  if (licTimer) clearInterval(licTimer)
  licTimer = null
}
