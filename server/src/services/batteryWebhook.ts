import { get, run, now } from '../db/index.js'
import { getBatteryAdminConfig } from './batteryConfig.js'
import type { BatterySurvey } from './batteryIssueResponse.js'
import { hasReportedIssue } from './batteryIssueResponse.js'

export const KISSFLOW_PROCESS_ID = 'Live_IT_Service_Request_A00'
export const KISSFLOW_SOURCE = 'Mobile'

function viewUrl(issueId: number) {
  const base = (process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '')
  return base ? `${base}/battery-issues/${issueId}` : `/battery-issues/${issueId}`
}

function subType(survey: BatterySurvey) {
  if (survey.battery === 'yes' && survey.other === 'yes') return 'Battery Drain and Other IT Issue'
  if (survey.battery === 'yes') return 'Battery Drain'
  if (survey.other === 'yes') return 'Other IT Issue'
  return 'IT Issue'
}

async function lookupEmployee(email: string, phone: string) {
  const mail = email.trim().toLowerCase()
  const digits = phone.replace(/\D/g, '').slice(-10)
  if (mail) {
    const byEmail = await get<{
      refex_company_name: string | null
      refex_location: string | null
      office_location: string | null
      legal_entity_code: string | null
    }>(
      `SELECT refex_company_name, refex_location, office_location, legal_entity_code
       FROM employees
       WHERE deleted_at IS NULL AND LOWER(TRIM(email)) = ?
       LIMIT 1`,
      [mail],
    )
    if (byEmail) return byEmail
  }
  if (digits.length >= 10) {
    return get<{
      refex_company_name: string | null
      refex_location: string | null
      office_location: string | null
      legal_entity_code: string | null
    }>(
      `SELECT refex_company_name, refex_location, office_location, legal_entity_code
       FROM employees
       WHERE deleted_at IS NULL
         AND (
           RIGHT(REPLACE(REPLACE(IFNULL(mobile, ''), ' ', ''), '-', ''), 10) = ?
           OR RIGHT(REPLACE(REPLACE(IFNULL(work_mobile, ''), ' ', ''), '-', ''), 10) = ?
         )
       LIMIT 1`,
      [digits, digits],
    )
  }
  return null
}

function descriptionLines(input: {
  issueId: number
  phone: string
  company: string
  language: string
  conversationId: string
  survey: BatterySurvey
  view: string
}) {
  const lines = [
    `Battery degradation voice bot — issue #${input.issueId}`,
    `Battery drain: ${input.survey.battery}`,
    `Other IT issue: ${input.survey.other}`,
  ]
  if (input.survey.other_description) lines.push(`Other issue details: ${input.survey.other_description}`)
  if (input.phone) lines.push(`Phone: ${input.phone}`)
  if (input.language) lines.push(`Preferred language: ${input.language}`)
  if (input.company) lines.push(`Company on contact list: ${input.company}`)
  if (input.conversationId) lines.push(`Ello conversation: ${input.conversationId}`)
  if (input.view) lines.push(`View in ITAM: ${input.view}`)
  return lines.join('\n')
}

export function buildKissflowPayload(input: {
  issueId: number
  name: string
  email: string
  phone: string
  company: string
  entity: string
  location: string
  conversationId: string
  recordingUrl: string
  survey: BatterySurvey
}) {
  const attachments = input.recordingUrl ? [input.recordingUrl] : []
  return {
    process_id: KISSFLOW_PROCESS_ID,
    Source: KISSFLOW_SOURCE,
    Name: input.name || 'Unknown',
    Email: input.email || '',
    Entity: input.entity || input.company || 'Refex',
    Location_user: input.location || '',
    Sub_Type: subType(input.survey),
    Criticality: 'Medium',
    Description: descriptionLines({
      issueId: input.issueId,
      phone: input.phone,
      company: input.company,
      language: input.survey.preferred_language,
      conversationId: input.conversationId,
      survey: input.survey,
      view: viewUrl(input.issueId),
    }),
    Attachment: attachments,
  }
}

export async function sendBatteryIssueWebhook(issueId: number, survey: BatterySurvey): Promise<boolean> {
  if (!hasReportedIssue(survey)) return false
  const cfg = await getBatteryAdminConfig()
  const url = String(cfg.webhook_url || '').trim()
  if (!url) return false

  const issue = await get<Record<string, unknown>>(
    `SELECT id, name, phone, email, company, webhook_sent_at, ello_conversation_id, recording_url, status
     FROM battery_degradation_issues WHERE id = ? AND deleted_at IS NULL`,
    [issueId],
  )
  if (!issue) return false
  if (issue.webhook_sent_at) return false

  const email = String(issue.email || '')
  const phone = String(issue.phone || '')
  const company = String(issue.company || '')
  let entity = company
  let location = ''
  try {
    const emp = await lookupEmployee(email, phone)
    if (emp) {
      entity = String(emp.refex_company_name || emp.legal_entity_code || company || '').trim() || company
      location = String(emp.refex_location || emp.office_location || '').trim()
    }
  } catch (e) {
    console.warn('[battery-webhook] employee lookup failed', e instanceof Error ? e.message : e)
  }

  const payload = buildKissflowPayload({
    issueId,
    name: String(issue.name || ''),
    email,
    phone,
    company,
    entity,
    location,
    conversationId: String(issue.ello_conversation_id || ''),
    recordingUrl: String(issue.recording_url || ''),
    survey,
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    const text = await res.text().catch(() => '')
    if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 180)}`)
    await run(`UPDATE battery_degradation_issues SET webhook_sent_at = ? WHERE id = ?`, [now(), issueId])
    console.log(`[battery-webhook] sent issue ${issueId}`)
    return true
  } catch (e) {
    console.warn('[battery-webhook] failed', issueId, e instanceof Error ? e.message : e)
    return false
  } finally {
    clearTimeout(timer)
  }
}
