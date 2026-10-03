import { mailConfigured, sendMail } from './mail.js'
import { batteryNotifyEmails } from './batteryConfig.js'
import { appSignedInUrl, refexOneHomeUrl } from './appLinks.js'

export type CallEmailTranscriptLine = { speaker: 'bot' | 'user'; text: string }

function appBase() {
  return refexOneHomeUrl()
}

function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatIst(value: unknown): string {
  if (value == null || value === '') return ''
  const raw = String(value).trim()
  let ms: number
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) {
    ms = new Date(raw).getTime()
  } else {
    const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T')
    ms = new Date(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(normalized) ? `${normalized}Z` : raw).getTime()
  }
  if (Number.isNaN(ms)) return raw
  return new Date(ms).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
}

function fieldRow(label: string, value: string) {
  if (!value) return ''
  return `<tr>
    <td style="padding:10px 14px;border-bottom:1px solid #e8eef2;color:#64748b;font-size:12px;width:34%;vertical-align:top;letter-spacing:.02em;">${escapeHtml(label)}</td>
    <td style="padding:10px 14px;border-bottom:1px solid #e8eef2;color:#0f172a;font-size:14px;font-weight:650;">${escapeHtml(value)}</td>
  </tr>`
}

function transcriptHtml(lines: CallEmailTranscriptLine[]) {
  if (!lines.length) {
    return `<p style="margin:0;color:#94a3b8;font-size:13px;">No transcript captured for this call.</p>`
  }
  return lines.map((line) => {
    const bot = line.speaker !== 'user'
    const bubble = bot
      ? 'background:#e8f7f4;color:#134e4a;border-bottom-left-radius:6px;'
      : 'background:#f1f5f9;color:#0f172a;border-bottom-right-radius:6px;'
    const align = bot ? 'flex-start' : 'flex-end'
    const who = bot ? 'Ello' : 'You'
    return `<div style="display:flex;justify-content:${align};margin:0 0 10px;">
      <div style="max-width:88%;">
        <div style="font-size:11px;font-weight:700;color:#94a3b8;margin:0 2px 4px;">${who}</div>
        <div style="padding:10px 12px;border-radius:14px;font-size:14px;line-height:1.5;${bubble}">${escapeHtml(line.text)}</div>
      </div>
    </div>`
  }).join('')
}

export type BatteryCallEndedMail = {
  issueId: number
  sequence: number
  name: string
  phone: string
  email: string
  company?: string
  botSummary: string
  transcript: CallEmailTranscriptLine[]
  callStatus: string
  duration: string
  at: string
}

export function batteryCallEndedEmail(input: BatteryCallEndedMail) {
  const viewUrl = appSignedInUrl(`/battery-issues/${input.issueId}`)
  const when = formatIst(input.at) || formatIst(new Date().toISOString())
  const metaLine = `Ello.AI · ${when}`
  const convo = `Conversation ${input.sequence}`
  const title = 'Battery degradation call complete'
  const intro = `A voice call with ${input.name || 'the requester'} has ended. Open the record to review the full conversation.`

  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f4f7f8;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7f8;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:640px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;">
        <tr><td style="background:linear-gradient(135deg,#0b6e66,#0f766e);padding:22px 24px;color:#fff;">
          <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.85;">Refex IT Asset Management</div>
          <div style="font-size:22px;font-weight:750;margin-top:6px;">${escapeHtml(title)}</div>
          <div style="margin-top:8px;font-size:13px;opacity:.92;">${escapeHtml(convo)} · ${escapeHtml(metaLine)}</div>
        </td></tr>
        <tr><td style="padding:22px 24px 8px;color:#334155;font-size:15px;line-height:1.55;">
          ${escapeHtml(intro)}
        </td></tr>
        <tr><td style="padding:8px 24px 4px;">
          <a href="${escapeHtml(viewUrl)}" style="display:inline-block;background:#0b6e66;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700;font-size:14px;">
            View now
          </a>
        </td></tr>
        <tr><td style="padding:16px 24px 8px;">
          <table role="presentation" width="100%" style="border:1px solid #e8eef2;border-radius:10px;border-collapse:collapse;overflow:hidden;">
            ${fieldRow('Name', input.name)}
            ${fieldRow('Phone', input.phone)}
            ${fieldRow('Email', input.email)}
            ${fieldRow('Company', input.company || '')}
            ${fieldRow('Call status', input.callStatus || 'ended')}
            ${fieldRow('Call duration', input.duration)}
            ${fieldRow('Source', metaLine)}
          </table>
        </td></tr>
        <tr><td style="padding:12px 24px 6px;">
          <div style="font-size:12px;font-weight:700;color:#64748b;letter-spacing:.04em;text-transform:uppercase;">Bot summary</div>
          <p style="margin:8px 0 0;color:#334155;font-size:14px;line-height:1.55;">${escapeHtml(input.botSummary || 'No bot summary yet.')}</p>
        </td></tr>
        <tr><td style="padding:16px 24px 8px;">
          <div style="font-size:12px;font-weight:700;color:#64748b;letter-spacing:.04em;text-transform:uppercase;margin-bottom:10px;">Conversation transcript</div>
          <div style="background:#f8fafc;border:1px solid #e8eef2;border-radius:12px;padding:14px;">
            ${transcriptHtml(input.transcript)}
          </div>
        </td></tr>
        <tr><td style="padding:8px 24px 24px;">
          <a href="${escapeHtml(viewUrl)}" style="display:inline-block;background:#0b6e66;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700;font-size:14px;">
            View now
          </a>
          <p style="margin:16px 0 0;color:#94a3b8;font-size:12px;line-height:1.5;">
            You received this because a battery degradation voice call completed for this contact.
          </p>
          <p style="margin:8px 0 0;color:#94a3b8;font-size:11px;">
            <a href="${escapeHtml(appBase())}" style="color:#94a3b8;text-decoration:underline;">${escapeHtml(appBase())}</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`

  const text = [
    title,
    `${convo} · ${metaLine}`,
    '',
    intro,
    '',
    `Name: ${input.name}`,
    `Phone: ${input.phone}`,
    `Email: ${input.email}`,
    input.company ? `Company: ${input.company}` : '',
    `Call status: ${input.callStatus || 'ended'}`,
    `Call duration: ${input.duration}`,
    '',
    'Bot summary',
    input.botSummary || 'No bot summary yet.',
    '',
    'Conversation transcript',
    ...input.transcript.map((l) => `${l.speaker === 'user' ? 'You' : 'Ello'}: ${l.text}`),
    '',
    `View now: ${viewUrl}`,
  ].filter((line) => line !== '').join('\n')

  return {
    subject: `${title} — ${input.name} (${convo})`,
    html,
    text,
    viewUrl,
  }
}

export async function sendBatteryCallEndedEmail(input: BatteryCallEndedMail) {
  const recipients = new Set<string>()
  const contact = String(input.email || '').trim().toLowerCase()
  if (contact.includes('@')) recipients.add(contact)
  for (const e of await batteryNotifyEmails()) recipients.add(e)
  if (!recipients.size) return { sent: false, reason: 'no-email' as const }
  if (!mailConfigured()) return { sent: false, reason: 'smtp' as const }
  const mail = batteryCallEndedEmail(input)
  const to = [...recipients]
  await sendMail({ to: to.join(', '), subject: mail.subject, html: mail.html, text: mail.text })
  return { sent: true as const, to: to.join(', ') }
}

export function isCallEnded(status: string | null | undefined, endedAt?: string | null) {
  const s = String(status || '').toLowerCase()
  return s === 'ended' || s === 'completed' || s === 'disconnected' || Boolean(endedAt)
}
