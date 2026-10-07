import { all, get, run, now } from '../db/index.js'
import { mailConfigured } from './mail.js'
import { listOpsRecipientEmails, listRoleRecipientEmails } from './permissions.js'

export type EmailCategoryKey =
  | 'custody'
  | 'maintenance'
  | 'inventory'
  | 'crud'
  | 'eol_warranty'
  | 'license_renewal'

export type NotificationConfig = {
  /** Master switch. When false, no workflow / create / delete / EOL / license emails are sent. */
  emails_enabled: boolean
  email_notifications: Record<EmailCategoryKey, boolean>
  /** Extra addresses (comma/newline) always BCC'd on ops digests */
  extra_ops_emails: string
  /** Also email IT Asset Manager role members for EOL/warranty / license renewals (default true) */
  eol_to_it_asset_manager: boolean
  /** Also email all notify.ops / admin / superuser for workflow events (default true) */
  workflow_to_ops_roles: boolean
}

const DEFAULT_CONFIG: NotificationConfig = {
  emails_enabled: false,
  email_notifications: {
    custody: true,
    maintenance: true,
    inventory: true,
    crud: true,
    eol_warranty: true,
    license_renewal: true,
  },
  extra_ops_emails: '',
  eol_to_it_asset_manager: true,
  workflow_to_ops_roles: true,
}

function parseConfig(raw: unknown): NotificationConfig {
  let obj: Record<string, unknown> = {}
  if (typeof raw === 'string' && raw.trim()) {
    try { obj = JSON.parse(raw) as Record<string, unknown> } catch { obj = {} }
  } else if (raw && typeof raw === 'object') {
    obj = raw as Record<string, unknown>
  }
  const toggles = (obj.email_notifications && typeof obj.email_notifications === 'object')
    ? obj.email_notifications as Record<string, unknown>
    : obj
  const en = { ...DEFAULT_CONFIG.email_notifications }
  for (const k of Object.keys(en) as EmailCategoryKey[]) {
    if (toggles[k] === false || toggles[k] === 0 || toggles[k] === '0') en[k] = false
    else if (toggles[k] === true || toggles[k] === 1 || toggles[k] === '1') en[k] = true
  }
  return {
    emails_enabled: obj.emails_enabled === true || obj.emails_enabled === 1 || obj.emails_enabled === '1',
    email_notifications: en,
    extra_ops_emails: String(obj.extra_ops_emails ?? ''),
    eol_to_it_asset_manager: obj.eol_to_it_asset_manager === false ? false : true,
    workflow_to_ops_roles: obj.workflow_to_ops_roles === false ? false : true,
  }
}

export async function getNotificationConfig(): Promise<NotificationConfig> {
  try {
    const row = await get<{ notification_config?: unknown }>(
      `SELECT notification_config FROM settings WHERE id = 1`,
    )
    return parseConfig(row?.notification_config)
  } catch {
    return { ...DEFAULT_CONFIG, email_notifications: { ...DEFAULT_CONFIG.email_notifications } }
  }
}

export async function saveNotificationConfig(partial: Partial<NotificationConfig> & {
  email_notifications?: Partial<Record<EmailCategoryKey, boolean>>
}): Promise<NotificationConfig> {
  const current = await getNotificationConfig()
  const next: NotificationConfig = {
    emails_enabled: partial.emails_enabled !== undefined
      ? Boolean(partial.emails_enabled)
      : current.emails_enabled,
    email_notifications: {
      ...current.email_notifications,
      ...(partial.email_notifications || {}),
    },
    extra_ops_emails: partial.extra_ops_emails !== undefined
      ? String(partial.extra_ops_emails)
      : current.extra_ops_emails,
    eol_to_it_asset_manager: partial.eol_to_it_asset_manager !== undefined
      ? Boolean(partial.eol_to_it_asset_manager)
      : current.eol_to_it_asset_manager,
    workflow_to_ops_roles: partial.workflow_to_ops_roles !== undefined
      ? Boolean(partial.workflow_to_ops_roles)
      : current.workflow_to_ops_roles,
  }
  await run(`UPDATE settings SET notification_config = ?, updated_at = ? WHERE id = 1`, [
    JSON.stringify(next),
    now(),
  ])
  return next
}

export async function isEmailCategoryEnabled(category: EmailCategoryKey | string): Promise<boolean> {
  if (!mailConfigured()) return false
  const cfg = await getNotificationConfig()
  if (!cfg.emails_enabled) return false
  const key = category as EmailCategoryKey
  if (key in cfg.email_notifications) return Boolean(cfg.email_notifications[key])
  return true
}

function splitEmails(raw: string): string[] {
  return raw
    .split(/[,;\n]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes('@'))
}

export async function resolveWorkflowRecipients(): Promise<string[]> {
  const cfg = await getNotificationConfig()
  const emails = new Set<string>()
  if (cfg.workflow_to_ops_roles) {
    for (const e of await listOpsRecipientEmails()) emails.add(e)
  }
  for (const e of splitEmails(cfg.extra_ops_emails)) emails.add(e)
  const row = await get<{ alert_email?: string | null }>(`SELECT alert_email FROM settings WHERE id = 1`)
  const fallback = String(row?.alert_email || '').trim().toLowerCase()
  if (fallback.includes('@')) emails.add(fallback)
  return [...emails]
}

export async function resolveEolRecipients(): Promise<string[]> {
  const cfg = await getNotificationConfig()
  if (!(await isEmailCategoryEnabled('eol_warranty'))) return []
  const emails = new Set<string>()
  if (cfg.eol_to_it_asset_manager) {
    for (const e of await listRoleRecipientEmails('IT Asset Manager')) emails.add(e)
  }
  if (cfg.workflow_to_ops_roles) {
    for (const e of await listOpsRecipientEmails()) emails.add(e)
  }
  for (const e of splitEmails(cfg.extra_ops_emails)) emails.add(e)
  const row = await get<{ alert_email?: string | null }>(`SELECT alert_email FROM settings WHERE id = 1`)
  const fallback = String(row?.alert_email || '').trim().toLowerCase()
  if (fallback.includes('@')) emails.add(fallback)
  return [...emails]
}

export async function notificationAdminSnapshot() {
  const cfg = await getNotificationConfig()
  const settings = await get<{ alert_email?: string | null; site_name?: string }>(
    `SELECT alert_email, site_name FROM settings WHERE id = 1`,
  )
  const itam = await all<{ id: number; email: string | null; first_name: string; last_name: string; username: string }>(`
    SELECT u.id, u.email, u.first_name, u.last_name, u.username
    FROM users u
    INNER JOIN users_groups ug ON ug.user_id = u.id
    INNER JOIN permission_groups g ON g.id = ug.group_id
    WHERE g.name = 'IT Asset Manager' AND u.deleted_at IS NULL AND u.activated = 1
    ORDER BY u.first_name, u.last_name
  `)
  const ops = await listOpsRecipientEmails()
  return {
    smtp_configured: mailConfigured(),
    smtp_hint: mailConfigured()
      ? 'SMTP is configured via server environment (SMTP_HOST / SMTP_USER).'
      : 'SMTP is not configured. Set SMTP_USER / SMTP_PASS in server/.env',
    alert_email: settings?.alert_email || null,
    site_name: settings?.site_name || null,
    config: cfg,
    it_asset_managers: itam.map((u) => ({
      id: u.id,
      name: `${u.first_name} ${u.last_name}`.trim() || u.username,
      email: u.email,
    })),
    resolved_ops_emails: ops,
    resolved_eol_emails: await resolveEolRecipients(),
    categories: [
      { key: 'custody', label: 'Assign / unassign / replace (assets, licenses, accessories…)' },
      { key: 'maintenance', label: 'Maintenance scheduled / updated / completed' },
      { key: 'inventory', label: 'License / accessory / consumable / component added' },
      { key: 'crud', label: 'Asset created / deleted' },
      { key: 'eol_warranty', label: 'EOL & warranty prior reminders (30d / 7d / 1d)' },
      { key: 'license_renewal', label: 'Recurring license renewals (7d / last 3 days → IT Asset Manager)' },
    ],
  }
}
