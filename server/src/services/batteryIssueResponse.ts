/**
 * Detect whether the employee confirmed a laptop battery-drain issue.
 * Matches the Refex One AI voice prompt:
 *   YES → raise complaint with IT Helpdesk
 *   NO  → thank you for confirming / no issue
 */
export type BatteryIssueAnswer = 'yes' | 'no' | 'unknown'

export const NO_ISSUE_COMMENTS = 'No Issues'

export function isNoIssueComments(value: unknown) {
  return /^no issues$/i.test(String(value || '').trim())
}

function norm(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function pickMeta(obj: Record<string, unknown> | null | undefined, keys: string[]): string {
  if (!obj) return ''
  for (const key of keys) {
    if (obj[key] == null) continue
    const v = String(obj[key]).trim()
    if (v && v !== 'null' && v !== 'undefined') return v
  }
  return ''
}

function walkMeta(raw: unknown, into: Record<string, unknown>, depth = 0) {
  if (!raw || depth > 5) return
  if (Array.isArray(raw)) {
    for (const item of raw) walkMeta(item, into, depth + 1)
    return
  }
  if (typeof raw !== 'object') return
  const obj = raw as Record<string, unknown>
  for (const [key, value] of Object.entries(obj)) {
    const existing = into[key]
    if (existing == null || existing === '') into[key] = value
    if (value && typeof value === 'object') walkMeta(value, into, depth + 1)
  }
}

function classifyToken(value: string): BatteryIssueAnswer {
  const t = norm(value)
  if (!t) return 'unknown'
  if (/^(no|false|n|no issue|no issues|not confirmed|not_confirmed)$/.test(t)) return 'no'
  if (/^(yes|true|y|confirmed)$/.test(t)) return 'yes'
  if (/\bno issue\b/.test(t) || t === 'complaint skipped') return 'no'
  if (/\bcomplaint forwarded\b/.test(t) || /\bhelpdesk followup\b/.test(t)) return 'yes'
  return 'unknown'
}

function classifyFromMetadata(metadata: Record<string, unknown> | null | undefined): BatteryIssueAnswer {
  if (!metadata) return 'unknown'
  const flat: Record<string, unknown> = {}
  walkMeta(metadata, flat)
  const confirmed = pickMeta(flat, [
    'battery_issue_confirmed',
    'batteryIssueConfirmed',
    'issue_confirmed',
    'issueConfirmed',
  ])
  const fromConfirmed = classifyToken(confirmed)
  if (fromConfirmed !== 'unknown') return fromConfirmed

  const action = pickMeta(flat, [
    'action_taken',
    'actionTaken',
    'resolution_status',
    'resolutionStatus',
    'out_come',
    'outcome',
  ])
  const fromAction = classifyToken(action)
  if (fromAction !== 'unknown') return fromAction
  return 'unknown'
}

function classifyFromBotSpeech(botBlob: string): BatteryIssueAnswer {
  const t = norm(botBlob)
  if (!t) return 'unknown'
  if (/\braise your complaint\b/.test(t) || /\bhelpdesk team will review the issue\b/.test(t)) return 'yes'
  if (/\bthank you for confirming\b/.test(t)) return 'no'
  return 'unknown'
}

function isUnsure(text: string) {
  return /\b(not sure|dont know|do not know|no idea|maybe|perhaps|unsure|what do you mean)\b/.test(text)
}

function isNoAnswer(text: string) {
  if (isUnsure(text)) return false
  if (/^(no|nope|nah|no thanks|no thank you|not really|not at all|nothing|none|negative)$/.test(text)) return true
  if (/^(no (issue|issues|problem|problems|drain|battery issue|battery drain)|all good|im fine|i am fine|its fine|it is fine|doing fine)$/.test(text)) return true
  if (/\bno (battery )?(drain|issue|problem)s?\b/.test(text)) return true
  if (/\bnot (experiencing|having|facing|seeing) (any )?(battery|issue|problem|drain)/.test(text)) return true
  if (/\bi (dont|do not|havent|have not) (have|had|noticed|seen)\b/.test(text)) return true
  return false
}

function isYesAnswer(text: string) {
  if (isUnsure(text)) return false
  if (isNoAnswer(text)) return false
  if (/^(yes|yeah|yep|yup|yea|correct|right|i am|i do|there is|there is one)$/.test(text)) return true
  if (/\b(draining|drains|dies fast|dies quickly|charge[sd]? (a lot|more|frequently)|battery (issue|problem|drain))\b/.test(text)) return true
  return false
}

function isBatteryQuestion(text: string) {
  const t = norm(text)
  return /\bbattery drain\b/.test(t)
    || /\bdraining faster than usual\b/.test(t)
    || /\bcharge it more frequently\b/.test(t)
}

function classifyFromUserAfterQuestion(lines: Array<{ speaker: string; text: string }>): BatteryIssueAnswer {
  let questionIdx = -1
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].speaker !== 'user' && isBatteryQuestion(lines[i].text)) questionIdx = i
  }
  const after = (questionIdx >= 0 ? lines.slice(questionIdx + 1) : [])
    .filter((line) => line.speaker === 'user')
    .map((line) => norm(line.text))
    .filter(Boolean)
  for (const text of after) {
    if (isNoAnswer(text)) return 'no'
    if (isYesAnswer(text)) return 'yes'
  }
  return 'unknown'
}

function classifyFromTextBlob(raw: string): BatteryIssueAnswer {
  const t = norm(raw)
  if (!t) return 'unknown'
  if (/\bbattery issue confirmed (no|false)\b/.test(t) || /\baction taken no issue\b/.test(t) || /\bno issue\b/.test(t) && /\bconfirm/.test(t)) {
    return 'no'
  }
  if (/\bbattery issue confirmed (yes|true)\b/.test(t) || /\bcomplaint forwarded\b/.test(t)) return 'yes'
  if (/\bthank you for confirming\b/.test(t)) return 'no'
  if (/\braise your complaint\b/.test(t)) return 'yes'
  return 'unknown'
}

export function classifyBatteryDrainResponse(
  transcript: Array<{ speaker?: string; text?: string }> | null | undefined,
  metadata?: Record<string, unknown> | null,
  summary?: string | null,
): BatteryIssueAnswer {
  const fromMeta = classifyFromMetadata(metadata)
  if (fromMeta !== 'unknown') return fromMeta

  const lines = (transcript || [])
    .map((line) => ({
      speaker: String(line.speaker || '').toLowerCase() === 'user' ? 'user' : 'bot',
      text: String(line.text || ''),
    }))
    .filter((line) => line.text.trim())

  const fromBot = classifyFromBotSpeech(lines.filter((line) => line.speaker === 'bot').map((line) => line.text).join(' '))
  if (fromBot !== 'unknown') return fromBot

  const fromUser = classifyFromUserAfterQuestion(lines)
  if (fromUser !== 'unknown') return fromUser

  return classifyFromTextBlob(String(summary || ''))
}
