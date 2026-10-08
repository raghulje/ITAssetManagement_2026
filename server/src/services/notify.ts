import { get, run, now } from '../db/index.js'
import { sendMail } from './mail.js'
import { isEmailCategoryEnabled, resolveWorkflowRecipients } from './notificationConfig.js'

function appBase() {
  return (process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || 'http://localhost:3001').replace(/\/$/, '')
}

function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export type NotifyField = { label: string; value: string }

export function brandedEmail(opts: {
  title: string
  intro: string
  fields: NotifyField[]
  ctaLabel?: string
  ctaUrl?: string
  footerNote?: string
}) {
  const rows = opts.fields
    .filter((f) => f.value != null && String(f.value).trim() !== '')
    .map((f) => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e8eef2;color:#64748b;font-size:13px;width:34%;vertical-align:top;">${escapeHtml(f.label)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e8eef2;color:#0f172a;font-size:14px;font-weight:600;">${escapeHtml(f.value)}</td>
      </tr>`)
    .join('')

  const cta = opts.ctaUrl
    ? `<p style="margin:24px 0 8px;">
        <a href="${escapeHtml(opts.ctaUrl)}" style="display:inline-block;background:#0b6e66;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;font-size:14px;">
          ${escapeHtml(opts.ctaLabel || 'Open in Refex ITAM')}
        </a>
      </p>`
    : ''

  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f4f7f8;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7f8;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:620px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;">
        <tr><td style="background:linear-gradient(135deg,#0b6e66,#0f766e);padding:22px 24px;color:#fff;">
          <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.85;">Refex IT Asset Management</div>
          <div style="font-size:22px;font-weight:750;margin-top:6px;">${escapeHtml(opts.title)}</div>
        </td></tr>
        <tr><td style="padding:22px 24px 8px;color:#334155;font-size:15px;line-height:1.55;">
          ${escapeHtml(opts.intro)}
        </td></tr>
        <tr><td style="padding:0 24px 8px;">
          <table role="presentation" width="100%" style="border:1px solid #e8eef2;border-radius:10px;border-collapse:collapse;overflow:hidden;">
            ${rows}
          </table>
          ${cta}
          <p style="margin:18px 0 0;color:#94a3b8;font-size:12px;line-height:1.5;">
            ${escapeHtml(opts.footerNote || 'You received this because of your role in Refex IT Asset Management.')}
          </p>
        </td></tr>
        <tr><td style="padding:16px 24px 22px;color:#94a3b8;font-size:11px;">
          ${escapeHtml(appBase())}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`

  const text = [
    opts.title,
    '',
    opts.intro,
    '',
    ...opts.fields.filter((f) => f.value).map((f) => `${f.label}: ${f.value}`),
    opts.ctaUrl ? `\n${opts.ctaLabel || 'Open'}: ${opts.ctaUrl}` : '',
  ].join('\n')

  return { html, text }
}


async function logNotify(kind: string, itemType: string, itemId: number) {
  try {
    const day = now().slice(0, 10)
    await run(
      `INSERT IGNORE INTO notification_log (kind, item_type, item_id, notified_on, created_at) VALUES (?, ?, ?, ?, ?)`,
      [kind, itemType, itemId, day, now()],
    )
  } catch {
    // non-fatal
  }
}

async function sendToMany(
  emails: string[],
  subject: string,
  html: string,
  text: string,
  emailType?: string,
  relatedType?: string,
  relatedId?: number,
) {
  const unique = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@')))]
  const results: { to: string; ok: boolean; error?: string }[] = []
  for (const to of unique) {
    try {
      await sendMail({ to, subject, html, text, emailType, relatedType, relatedId })
      results.push({ to, ok: true })
    } catch (e) {
      results.push({ to, ok: false, error: e instanceof Error ? e.message : String(e) })
      console.warn('[notify] send failed', to, e)
    }
  }
  return results
}

export type WorkflowNotifyInput = {
  category: 'custody' | 'maintenance' | 'inventory' | 'crud'
  event: string
  subject: string
  title: string
  intro: string
  fields: NotifyField[]
  ctaPath?: string
  itemType?: string
  itemId?: number
  /** Also notify this person (assignee) */
  assigneeEmail?: string | null
  assigneeOnlyExtraNote?: string
}

/** Fire-and-forget workflow email. Never throws to callers. */
export function notifyWorkflow(input: WorkflowNotifyInput) {
  void (async () => {
    try {
      if (!(await isEmailCategoryEnabled(input.category))) return
      const { html, text } = brandedEmail({
        title: input.title,
        intro: input.intro,
        fields: input.fields,
        ctaLabel: 'View record',
        ctaUrl: input.ctaPath ? `${appBase()}${input.ctaPath.startsWith('/') ? '' : '/'}${input.ctaPath}` : appBase(),
      })

      const ops = await resolveWorkflowRecipients()
      await sendToMany(ops, input.subject, html, text, input.category, input.itemType, input.itemId)

      if (input.assigneeEmail && input.assigneeEmail.includes('@')) {
        const assigneeMail = brandedEmail({
          title: input.title,
          intro: input.assigneeOnlyExtraNote || input.intro,
          fields: input.fields,
          ctaLabel: 'View record',
          ctaUrl: input.ctaPath ? `${appBase()}${input.ctaPath.startsWith('/') ? '' : '/'}${input.ctaPath}` : appBase(),
          footerNote: 'You received this because an asset or license was assigned to you.',
        })
        await sendToMany(
          [input.assigneeEmail],
          input.subject,
          assigneeMail.html,
          assigneeMail.text,
          input.category,
          input.itemType,
          input.itemId,
        )
      }

      if (input.itemType && input.itemId) {
        await logNotify(input.event, input.itemType, input.itemId)
      }
    } catch (e) {
      console.warn('[notify] workflow failed', input.event, e)
    }
  })()
}

export async function resolveAssigneeEmail(assignedType: string | null | undefined, assignedTo: number | null | undefined): Promise<string | null> {
  if (!assignedTo) return null
  if (assignedType === 'employee') {
    const row = await get<{ email?: string | null }>(`SELECT email FROM employees WHERE id = ? AND deleted_at IS NULL`, [assignedTo])
    const e = String(row?.email || '').trim()
    return e.includes('@') ? e : null
  }
  if (assignedType === 'user') {
    const row = await get<{ email?: string | null }>(`SELECT email FROM users WHERE id = ? AND deleted_at IS NULL`, [assignedTo])
    const e = String(row?.email || '').trim()
    return e.includes('@') ? e : null
  }
  return null
}

export function actorLabel(user?: { first_name?: string; last_name?: string; email?: string | null; username?: string } | null) {
  if (!user) return 'System'
  const name = `${user.first_name || ''} ${user.last_name || ''}`.trim()
  return name || user.username || user.email || 'Admin'
}
