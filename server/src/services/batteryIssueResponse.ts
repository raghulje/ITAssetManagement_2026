/**
 * Classify the multilingual IT helpdesk survey from transcript / Ello metadata.
 * Battery YES or other-issue YES → assign + webhook.
 * Battery NO and other NO → close as No Issues.
 */
export type BatteryIssueAnswer = 'yes' | 'no' | 'unknown'

export type BatterySurvey = {
  preferred_language: string
  battery: BatteryIssueAnswer
  other: BatteryIssueAnswer
  other_description: string
  asked_other: boolean
}

export const NO_ISSUE_COMMENTS = 'No Issues'

export function emptySurvey(): BatterySurvey {
  return { preferred_language: '', battery: 'unknown', other: 'unknown', other_description: '', asked_other: false }
}

export function isNoIssueComments(value: unknown) {
  return /^no issues$/i.test(String(value || '').trim())
}

export function hasReportedIssue(survey: BatterySurvey) {
  return survey.battery === 'yes' || survey.other === 'yes'
}

export function isBothNo(survey: BatterySurvey) {
  return survey.battery === 'no' && survey.other === 'no'
}

function norm(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/[^\w\s\u0900-\u097F\u0980-\u09FF\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F]/g, ' ')
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

function isUnsure(text: string) {
  return /\b(not sure|dont know|do not know|no idea|maybe|perhaps|unsure|what do you mean)\b/.test(text)
}

function isNoAnswer(text: string) {
  const t = norm(text)
  if (!t || isUnsure(t)) return false
  if (/^(no|nope|nah|no thanks|no thank you|not really|not at all|nothing|none|negative|nahi|nahin|nahee|illa|ille|illai|kadu|ledu|leda|alla|venta|nai|naa)$/.test(t)) return true
  if (/^(no (issue|issues|problem|problems|drain|battery issue|battery drain)|all good|im fine|i am fine|its fine|it is fine|doing fine)$/.test(t)) return true
  if (/\bno (battery )?(drain|issue|problem)s?\b/.test(t)) return true
  if (/\bnot (experiencing|having|facing|seeing) (any )?(battery|issue|problem|drain|other)/.test(t)) return true
  if (/\bi (dont|do not|havent|have not) (have|had|noticed|seen)\b/.test(t)) return true
  return false
}

function isYesAnswer(text: string) {
  const t = norm(text)
  if (!t || isUnsure(t) || isNoAnswer(t)) return false
  if (/^(yes|yeah|yep|yup|yea|correct|right|i am|i do|there is|there is one|haan|ha|ho|aama|aam|avunu|haudu|hoi)$/.test(t)) return true
  if (/^(हाँ|हां|ஆம்|అవును|ಹೌದು|ഉണ്ട്|হ্যাঁ|होय|હા)$/.test(t)) return true
  if (/\b(draining|drains|dies fast|dies quickly|charge[sd]? (a lot|more|frequently)|battery (issue|problem|drain))\b/.test(t)) return true
  return false
}

function isLanguageQuestion(text: string) {
  const t = norm(text)
  return /\bwhich language\b/.test(t) || /\bprefer to speak\b/.test(t) || /\bpreferred language\b/.test(t)
}

function isBatteryQuestion(text: string) {
  const t = norm(text)
  return /\bbattery drain\b/.test(t)
    || /\bbattery draining\b/.test(t)
    || /\bdraining quickly\b/.test(t)
    || /\bdraining faster than usual\b/.test(t)
    || /\bcharge it more frequently\b/.test(t)
}

function isOtherIssueQuestion(text: string) {
  const t = norm(text)
  return /\bany other (issue|issues|problem|problems)\b/.test(t)
    || /\bother (laptop |it[- ]related )?(issue|issues|problem|problems)\b/.test(t)
    || /\bit helpdesk team to look into\b/.test(t)
    || /\bother it\b/.test(t)
}

function detectLanguage(text: string) {
  const t = norm(text)
  const map: Array<[RegExp, string]> = [
    [/\benglish\b|अंग्रेजी/, 'English'],
    [/\bhindi\b|हिंदी|हिन्दी/, 'Hindi'],
    [/\btamil\b|தமிழ்/, 'Tamil'],
    [/\btelugu\b|తెలుగు/, 'Telugu'],
    [/\bkannada\b|ಕನ್ನಡ/, 'Kannada'],
    [/\bmalayalam\b|മലയാളം/, 'Malayalam'],
    [/\bbengali\b|\bbangla\b|বাংলা/, 'Bengali'],
    [/\bmarathi\b|मराठी/, 'Marathi'],
    [/\bgujarati\b|ગુજરાતી/, 'Gujarati'],
  ]
  for (const [re, label] of map) {
    if (re.test(t)) return label
  }
  return ''
}

function userTurnsAfter(lines: Array<{ speaker: string; text: string }>, startIdx: number, endIdx: number) {
  return lines
    .slice(startIdx + 1, endIdx)
    .filter((line) => line.speaker === 'user')
    .map((line) => line.text.trim())
    .filter(Boolean)
}

function firstAnswer(texts: string[]): BatteryIssueAnswer {
  for (const text of texts) {
    if (isNoAnswer(text)) return 'no'
    if (isYesAnswer(text)) return 'yes'
  }
  return 'unknown'
}

function otherFromTurns(texts: string[]): { answer: BatteryIssueAnswer; description: string } {
  if (!texts.length) return { answer: 'unknown', description: '' }
  for (const text of texts) {
    if (isNoAnswer(text)) return { answer: 'no', description: '' }
    if (isYesAnswer(text)) {
      const extra = texts.filter((t) => !isYesAnswer(t) && !isNoAnswer(t)).join(' ').trim()
      return { answer: 'yes', description: extra }
    }
  }
  const description = texts.join(' ').trim()
  if (description) return { answer: 'yes', description }
  return { answer: 'unknown', description: '' }
}

function flattenMeta(metadata?: Record<string, unknown> | null) {
  const flat: Record<string, unknown> = {}
  if (metadata) walkMeta(metadata, flat)
  return flat
}

function surveyFromMetadata(metadata?: Record<string, unknown> | null): BatterySurvey {
  const survey = emptySurvey()
  if (!metadata) return survey
  const flat = flattenMeta(metadata)
  survey.preferred_language = pickMeta(flat, ['preferred_language', 'preferredLanguage', 'language'])
  survey.battery = classifyToken(pickMeta(flat, ['battery_issue_confirmed', 'batteryIssueConfirmed']))
  survey.other = classifyToken(pickMeta(flat, ['other_issue_reported', 'otherIssueReported']))
  survey.other_description = pickMeta(flat, ['other_issue_description', 'otherIssueDescription'])
  if (survey.other === 'unknown' && survey.other_description) survey.other = 'yes'
  if (survey.other !== 'unknown' || survey.other_description) survey.asked_other = true
  return survey
}

function surveyFromTranscript(linesIn: Array<{ speaker?: string; text?: string }>): BatterySurvey {
  const survey = emptySurvey()
  const lines = (linesIn || [])
    .map((line) => ({
      speaker: String(line.speaker || '').toLowerCase() === 'user' ? 'user' : 'bot',
      text: String(line.text || ''),
    }))
    .filter((line) => line.text.trim())

  let langIdx = -1
  let batteryIdx = -1
  let otherIdx = -1
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].speaker === 'user') continue
    if (isLanguageQuestion(lines[i].text)) langIdx = i
    if (isBatteryQuestion(lines[i].text)) batteryIdx = i
    if (isOtherIssueQuestion(lines[i].text)) otherIdx = i
  }
  survey.asked_other = otherIdx >= 0

  if (langIdx >= 0) {
    const end = batteryIdx >= 0 ? batteryIdx : (otherIdx >= 0 ? otherIdx : lines.length)
    const langTurns = userTurnsAfter(lines, langIdx, end)
    for (const turn of langTurns) {
      const lang = detectLanguage(turn)
      if (lang) {
        survey.preferred_language = lang
        break
      }
    }
    if (!survey.preferred_language && langTurns[0]) survey.preferred_language = langTurns[0]
  }

  if (batteryIdx >= 0) {
    const end = otherIdx > batteryIdx ? otherIdx : lines.length
    survey.battery = firstAnswer(userTurnsAfter(lines, batteryIdx, end))
  }

  if (otherIdx >= 0) {
    const other = otherFromTurns(userTurnsAfter(lines, otherIdx, lines.length))
    survey.other = other.answer
    survey.other_description = other.description
  } else if (langIdx >= 0 && batteryIdx < 0) {
    const afterLang = userTurnsAfter(lines, langIdx, lines.length)
    if (afterLang.length >= 2) {
      if (!survey.preferred_language) survey.preferred_language = detectLanguage(afterLang[0]) || afterLang[0]
      survey.battery = firstAnswer([afterLang[1]])
      if (afterLang.length >= 3) {
        survey.asked_other = true
        const extra = otherFromTurns(afterLang.slice(2))
        survey.other = extra.answer
        survey.other_description = extra.description
      }
    } else if (afterLang.length === 1 && !detectLanguage(afterLang[0])) {
      survey.battery = firstAnswer(afterLang)
    }
  }

  return survey
}

function mergeSurvey(primary: BatterySurvey, fallback: BatterySurvey): BatterySurvey {
  return {
    preferred_language: primary.preferred_language || fallback.preferred_language,
    battery: primary.battery !== 'unknown' ? primary.battery : fallback.battery,
    other: primary.other !== 'unknown' ? primary.other : fallback.other,
    other_description: primary.other_description || fallback.other_description,
    asked_other: primary.asked_other || fallback.asked_other,
  }
}

/** Old one-question prompt never asked about other issues. */
function applyLegacyOther(survey: BatterySurvey): BatterySurvey {
  if (!survey.asked_other && survey.other === 'unknown' && survey.battery === 'no') {
    return { ...survey, other: 'no' }
  }
  return survey
}

export function classifyCallSurvey(
  transcript: Array<{ speaker?: string; text?: string }> | null | undefined,
  metadata?: Record<string, unknown> | null,
  summary?: string | null,
): BatterySurvey {
  const fromMeta = surveyFromMetadata(metadata)
  const fromTranscript = surveyFromTranscript(transcript || [])
  let survey = mergeSurvey(fromMeta, fromTranscript)
  if (survey.battery === 'unknown' && summary) {
    const blob = norm(summary)
    if (/\bbattery issue confirmed (yes|true)\b/.test(blob)) survey = { ...survey, battery: 'yes' }
    if (/\bbattery issue confirmed (no|false)\b/.test(blob)) survey = { ...survey, battery: 'no' }
  }
  return applyLegacyOther(survey)
}

/** Battery-only answer for older call sites. */
export function classifyBatteryDrainResponse(
  transcript: Array<{ speaker?: string; text?: string }> | null | undefined,
  metadata?: Record<string, unknown> | null,
  summary?: string | null,
): BatteryIssueAnswer {
  return classifyCallSurvey(transcript, metadata, summary).battery
}
