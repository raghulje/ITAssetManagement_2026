import nodemailer from 'nodemailer'
import { insertEmailLog, type EmailLogStatus } from './emailLog.js'

function smtpConfig() {
  const host = process.env.SMTP_HOST || 'smtp.zoho.in'
  const port = Number(process.env.SMTP_PORT || 465)
  // Port 465 is SMTPS (implicit TLS). STARTTLS (587) uses SMTP_SECURE=false.
  const secure = port === 465
    ? true
    : process.env.SMTP_SECURE === 'true' || process.env.SMTP_SECURE === '1'
  const user = process.env.SMTP_USER || ''
  const pass = process.env.SMTP_PASS || ''
  const fromRaw = process.env.SMTP_FROM || 'noreply'
  const from = fromRaw.includes('@')
    ? fromRaw
    : `"${fromRaw}" <${user}>`

  return { host, port, secure, user, pass, from }
}

export function mailConfigured() {
  const { user, pass } = smtpConfig()
  return Boolean(user && pass)
}

export function smtpAdminHint() {
  const { host, port, user } = smtpConfig()
  if (mailConfigured()) {
    return `SMTP is configured via server environment: ${host}:${port} as ${user}.`
  }
  return 'SMTP is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS in server/.env'
}

export type SendMailOpts = {
  to: string
  subject: string
  text: string
  html?: string
  emailType?: string
  relatedType?: string
  relatedId?: number
}

export async function sendMail(opts: SendMailOpts) {
  const cfg = smtpConfig()
  const logBase = {
    emailType: opts.emailType || 'generic',
    relatedType: opts.relatedType || null,
    relatedId: opts.relatedId || null,
    toAddresses: opts.to,
    subject: opts.subject,
  }

  if (!cfg.user || !cfg.pass) {
    await insertEmailLog({
      ...logBase,
      status: 'skipped',
      errorMessage: 'SMTP is not configured (SMTP_USER / SMTP_PASS)',
    })
    throw new Error('SMTP is not configured (SMTP_USER / SMTP_PASS)')
  }

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
  })

  try {
    const info = await transporter.sendMail({
      from: cfg.from,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html || opts.text.replace(/\n/g, '<br/>'),
    })
    const accepted = (info.accepted || []).map((a) => String(a))
    const rejected = (info.rejected || []).map((a) => String(a))
    let status: EmailLogStatus = 'sent'
    let errorMessage: string | null = null
    if (rejected.length && !accepted.length) {
      status = 'failed'
      errorMessage = `Rejected: ${rejected.join(', ')}`
    } else if (rejected.length) {
      errorMessage = `Rejected: ${rejected.join(', ')}`
    }
    await insertEmailLog({
      ...logBase,
      status,
      messageId: info.messageId || null,
      errorMessage,
      meta: {
        accepted,
        rejected,
        response: info.response || '',
      },
    })
    return info
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await insertEmailLog({
      ...logBase,
      status: 'failed',
      errorMessage: message,
    })
    throw e
  }
}
