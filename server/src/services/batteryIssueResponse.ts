/**
 * Classify the multilingual IT helpdesk survey from transcript / Ello metadata.
 * Battery YES or other-issue YES → assign + webhook.
 * Battery NO and other NO → close as No Issues.
 */
export type BatteryIssueAnswer = 'yes' | 'no' | 'unknown'

export type OtherIssueTypeKey =
  | 'network_wifi'
  | 'vpn'
  | 'email_outlook'
  | 'teams_meetings'
  | 'laptop_hardware'
  | 'display'
  | 'keyboard_mouse'
  | 'charger_power'
  | 'software_os'
  | 'login_password'
  | 'printer'
  | 'audio'
  | 'camera'
  | 'storage'
  | 'other'

export const OTHER_ISSUE_TYPES: Array<{ key: OtherIssueTypeKey; label: string; icon: string }> = [
  { key: 'network_wifi', label: 'Wi-Fi / Network', icon: 'fas fa-wifi' },
  { key: 'vpn', label: 'VPN', icon: 'fas fa-shield-alt' },
  { key: 'email_outlook', label: 'Email / Outlook', icon: 'fas fa-envelope' },
  { key: 'teams_meetings', label: 'Teams / Meetings', icon: 'fas fa-video' },
  { key: 'laptop_hardware', label: 'Laptop hardware', icon: 'fas fa-laptop' },
  { key: 'display', label: 'Screen / Display', icon: 'fas fa-desktop' },
  { key: 'keyboard_mouse', label: 'Keyboard / Mouse', icon: 'fas fa-keyboard' },
  { key: 'charger_power', label: 'Charger / Power', icon: 'fas fa-plug' },
  { key: 'software_os', label: 'Software / Windows', icon: 'fas fa-window-restore' },
  { key: 'login_password', label: 'Login / Password', icon: 'fas fa-user-lock' },
  { key: 'printer', label: 'Printer / Scanner', icon: 'fas fa-print' },
  { key: 'audio', label: 'Audio', icon: 'fas fa-volume-up' },
  { key: 'camera', label: 'Camera', icon: 'fas fa-camera' },
  { key: 'storage', label: 'Storage / Disk', icon: 'fas fa-hdd' },
  { key: 'other', label: 'Other IT issue', icon: 'fas fa-question-circle' },
]

const OTHER_TYPE_BY_KEY = new Map(OTHER_ISSUE_TYPES.map((item) => [item.key, item]))

export function otherIssueTypeLabel(key: string) {
  return OTHER_TYPE_BY_KEY.get(key as OtherIssueTypeKey)?.label || key
}

export function otherIssueTypeIcon(key: string) {
  return OTHER_TYPE_BY_KEY.get(key as OtherIssueTypeKey)?.icon || 'fas fa-tag'
}

export type BatterySurvey = {
  preferred_language: string
  battery: BatteryIssueAnswer
  other: BatteryIssueAnswer
  other_description: string
  other_types: OtherIssueTypeKey[]
  asked_other: boolean
}

export const NO_ISSUE_COMMENTS = 'No Issues'

export function emptySurvey(): BatterySurvey {
  return {
    preferred_language: '',
    battery: 'unknown',
    other: 'unknown',
    other_description: '',
    other_types: [],
    asked_other: false,
  }
}

function uniqueTypes(keys: string[]): OtherIssueTypeKey[] {
  const known = new Set(OTHER_ISSUE_TYPES.map((item) => item.key))
  const out: OtherIssueTypeKey[] = []
  for (const raw of keys) {
    const key = String(raw || '').trim() as OtherIssueTypeKey
    if (!key || !known.has(key) || out.includes(key)) continue
    out.push(key)
  }
  return out
}

/** Classify free-text other-issue answers into stored insight types. */
export function classifyOtherIssueTypes(text: string): OtherIssueTypeKey[] {
  const t = norm(text)
  if (!t) return []
  const found: OtherIssueTypeKey[] = []
  const add = (key: OtherIssueTypeKey) => {
    if (!found.includes(key)) found.push(key)
  }
  if (/\b(wi\s*fi|wifi|wireless|internet|network|lan|ethernet|connectivity|hotspot)\b/.test(t)) add('network_wifi')
  if (/\b(vpn|globalprotect|anyconnect|pulse secure|forticlient)\b/.test(t)) add('vpn')
  if (/\b(email|e mail|outlook|mailbox|inbox|owa)\b/.test(t)) add('email_outlook')
  if (/\b(teams|zoom|meet(ing)?s?|webex)\b/.test(t)) add('teams_meetings')
  if (/\b(screen|display|monitor|brightness|flicker|resolution)\b/.test(t)) add('display')
  if (/\b(keyboard|mouse|trackpad|touchpad|keys?)\b/.test(t)) add('keyboard_mouse')
  if (/\b(charger|adapter|charging|power cable|power cord|not charging)\b/.test(t)) add('charger_power')
  if (/\b(password|passcode|login|log in|sign in|signin|locked out|mfa|otp|sso)\b/.test(t)) add('login_password')
  if (/\b(printer|printing|printout|scanner|scan)\b/.test(t)) add('printer')
  if (/\b(speaker|microphone|mic|headphone|headset|sound|audio)\b/.test(t)) add('audio')
  if (/\b(camera|webcam|web cam)\b/.test(t)) add('camera')
  if (/\b(storage|hard disk|hard drive|ssd|hdd|disk space|c drive)\b/.test(t)) add('storage')
  if (/\b(windows|software|application|app hang|hanging|freeze|frozen|crash|blue screen|bsod|slow(ness)?|os)\b/.test(t)) {
    add('software_os')
  }
  if (/\b(laptop|notebook|hardware|fan|overheat|hinge|motherboard|ram|port)\b/.test(t)) add('laptop_hardware')
  if (/(வைஃபை|வைபை|இணையம்|நெட்வொர்க்)/.test(t)) add('network_wifi')
  if (/(விபிஎன்)/.test(t)) add('vpn')
  if (/(மின்னஞ்சல்|அவுட்லுக்)/.test(t)) add('email_outlook')
  if (/(டீம்ஸ்|மீட்டிங்)/.test(t)) add('teams_meetings')
  if (/(திரை|மானிட்டர்|டிஸ்ப்ளே)/.test(t)) add('display')
  if (/(விசைப்பலகை|மவுஸ்|டச்பேட்)/.test(t)) add('keyboard_mouse')
  if (/(சார்ஜர்|சார்ஜ் ஆகவில்லை)/.test(t)) add('charger_power')
  if (/(கடவுச்சொல்|லாகின்|உள்நுழை)/.test(t)) add('login_password')
  if (/(அச்சுப்பொறி|பிரிண்டர்|ஸ்கேனர்)/.test(t)) add('printer')
  if (/(ஸ்பீக்கர்|மைக்|ஒலி|ஹெட்செட்)/.test(t)) add('audio')
  if (/(கேமரா)/.test(t)) add('camera')
  if (/(சேமிப்பகம்|ஹார்டு டிஸ்க்)/.test(t)) add('storage')
  if (/(விண்டோஸ்|மென்பொருள்)/.test(t)) add('software_os')
  if (/(லாப்டாப்|வன்பொருள்)/.test(t)) add('laptop_hardware')
  return found
}

export function typesForOtherIssue(survey: Pick<BatterySurvey, 'other' | 'other_description' | 'other_types'>, extraText = '') {
  if (survey.other !== 'yes') return []
  const fromStored = uniqueTypes(survey.other_types || [])
  const fromText = classifyOtherIssueTypes([survey.other_description, extraText].filter(Boolean).join(' '))
  const merged = uniqueTypes([...fromStored, ...fromText])
  return merged.length ? merged : (['other'] as OtherIssueTypeKey[])
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
    .replace(/[\u0964\u0965\u09F7\u0AF0]/g, ' ')
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
  if (botForwardsBatteryIssue(t)) return 'yes'
  if (/^(no|false|n|no issue|no issues|not confirmed|not_confirmed|இல்லை)$/.test(t)) return 'no'
  if (/^(yes|true|y|confirmed|ஆம்)$/.test(t)) return 'yes'
  if (t === 'complaint skipped') return 'no'
  if (/\bcomplaint forwarded\b/.test(t) || /\bhelpdesk followup\b/.test(t)) return 'yes'
  // Do not treat "thank you for confirming" / mixed summaries as no — a later
  // "I'll forward the battery issue" is the real outcome.
  if (/\bno issue\b/.test(t) && !/\bbattery\b/.test(t)) return 'no'
  return 'unknown'
}

function isUnsure(text: string) {
  return /\b(not sure|dont know|do not know|no idea|maybe|perhaps|unsure|what do you mean)\b/.test(text)
    || /தெரியவில்லை|கொஞ்சம் யோசி/.test(text)
}

function isNoAnswer(text: string) {
  const t = norm(text)
  if (!t || isUnsure(t)) return false
  if (/^(no|nope|nah|no thanks|no thank you|not really|not at all|nothing|none|negative|nahi|nahin|nahee|nahi ji|nahin ji|illa|ille|illai|illainga|illaiya|kadu|ledu|leda|alla|venta|vendam|vendaam|venam|nai|naa|नहीं|नही|ना|नहीं जी|नही जी)$/.test(t)) return true
  if (/^(இல்லை|இல்ல)(ங்க|யே|யா|யோ)?$/.test(t)) return true
  if (/^(வேண்டாம்|வேணாம்|வேண்டா|வேணா)$/.test(t)) return true
  if (/^(no (issue|issues|problem|problems|drain|battery issue|battery drain)|all good|im fine|i am fine|its fine|it is fine|doing fine)$/.test(t)) return true
  if (/^(பிரச்சனை இல்லை|சிக்கல் இல்லை|ஒன்றுமில்லை)$/.test(t)) return true
  if (/\bno (battery )?(drain|issue|problem)s?\b/.test(t)) return true
  if (/\bnot (experiencing|having|facing|seeing) (any )?(battery|issue|problem|drain|other)/.test(t)) return true
  if (/\bi (dont|do not|havent|have not) (have|had|noticed|seen)\b/.test(t)) return true
  return false
}

function isYesAnswer(text: string) {
  const t = norm(text)
  if (!t || isUnsure(t) || isNoAnswer(t)) return false
  if (/^(yes|yeah|yep|yup|yea|correct|right|i am|i do|there is|there is one|haan|ha|haanji|haan ji|ho|aama|aam|aamaanga|avunu|haudu|hoi|bilkul|irukku|sari)$/.test(t)) return true
  if (/^(हाँ|हां|जी हाँ|जी हां|ஆம்|ஆமா|ஆமாம்|ஆமாங்க|சரி|சரிங்க|இருக்கு|இருக்கிறது|இருக்கும்|உண்டு|అవును|ಹೌದು|ഉണ്ട്|হ্যাঁ|होय|હા)$/.test(t)) return true
  if (/^(yes|yeah|yep|yup|yea|haan|aama|aam)(\s|$)/.test(t)) return true
  if (/^(ஆம்|ஆமா|ஆமாம்|ஆமாங்க|சரி|சரிங்க)(\s|$)/.test(t)) return true
  if (/\b(draining|drains|dies fast|dies quickly|charge[sd]? (a lot|more|frequently)|battery (issue|problem|drain))\b/.test(t)) return true
  if (/(சீக்கிரம் முடி|அடிக்கடி சார்ஜ்|பேட்டரி பிரச்சனை|பேட்டரி சிக்கல்)/.test(t)) return true
  return false
}

function isLanguageQuestion(text: string) {
  const t = norm(text)
  return /\bwhich language\b/.test(t)
    || /\bprefer to speak\b/.test(t)
    || /\bprefer to continue\b/.test(t)
    || /\bcontinue in\b/.test(t)
    || /\bpreferred language\b/.test(t)
    || /\bkaunsi (bhasha|language)\b/.test(t)
    || /\bkis bhasha\b/.test(t)
    || /किस भाषा/.test(t)
    || /எந்த மொழி/.test(t)
    || /மொழியில் தொடர/.test(t)
    || /விருப்ப(?:மான)? மொழி/.test(t)
}

function isOtherIssueQuestion(text: string) {
  const t = norm(text)
  return /\bany other (issue|issues|problem|problems)\b/.test(t)
    || /\bother (laptop |it[- ]related )?(issue|issues|problem|problems)\b/.test(t)
    || /\bit helpdesk team to look into\b/.test(t)
    || /\bother it\b/.test(t)
    || /\bkoi aur (issue|issues|problem|problems|samasya)\b/.test(t)
    || /\bkisi aur (issue|laptop|it)\b/.test(t)
    || /कोई और/.test(t)
    || /कोई अन्य/.test(t)
    || /अन्य समस्या/.test(t)
    || /समस्या के अलावा/.test(t)
    || /किसी और/.test(t)
    || /IT से जुड़ी/.test(t)
    || /வேறு ஏதேனும்/.test(t)
    || /வேறு எதாவது/.test(t)
    || /வேறு (பிரச்சனை|சிக்கல்)/.test(t)
    || /பிரச்சனையைத் தவிர/.test(t)
    || /பிரச்சனை தவிர/.test(t)
    || /பேட்டரி தவிர/.test(t)
    || /(ஐடி|it) தொடர்பான/.test(t)
}

function isBatteryQuestion(text: string) {
  const t = norm(text)
  if (isOtherIssueQuestion(text)) return false
  if (/बैटरी की जानकारी/.test(t) && !/(खत्म|चार्ज|drain)/.test(t)) return false
  if (/பேட்டரி (தகவல்|விவரம்)/.test(t) && !/(சீக்கிரம்|சார்ஜ்|முடிந்து|வேக|வழக்கம்|drain)/.test(t)) return false
  return /\bbattery drain\b/.test(t)
    || /\bbattery draining\b/.test(t)
    || /\bdraining quickly\b/.test(t)
    || /\bdraining faster than usual\b/.test(t)
    || /\bcharge it more frequently\b/.test(t)
    || /\bbattery jaldi\b/.test(t)
    || /\bbattery (jaldi )?(khatam|drain)\b/.test(t)
    || /जल्दी खत्म/.test(t)
    || /बार बार चार्ज/.test(t)
    || /सामान्य से जल्दी/.test(t)
    || (/बैटरी/.test(t) && /(खत्म|चार्ज|drain|jaldi)/.test(t))
    || /சீக்கிரம் முடி/.test(t)
    || /அடிக்கடி சார்ஜ்/.test(t)
    || /வழக்கத்தை விட/.test(t)
    || (/பேட்டரி/.test(t) && /(சீக்கிரம்|சார்ஜ்|முடிந்து|வேக|வழக்கம்|drain)/.test(t))
}

function isContactDetailsQuestion(text: string) {
  const t = norm(text)
  return /\b(company name and email|email for our records|share your (company|email))\b/.test(t)
    || /(நிறுவனம்|இமெயில்|மின்னஞ்சல்).*(பதிவு|சொல்ல)/.test(t)
}

function botForwardsBatteryIssue(text: string) {
  const t = norm(text)
  return /\bforward(ing)? the battery (drain )?issue\b/.test(t)
    || /\bbattery (drain )?issue (has been |will be )?(forwarded|raised|logged|assigned)\b/.test(t)
    || (/\braise (a |the )?complaint\b/.test(t) && /\bbattery\b/.test(t))
    || /\bbattery issue (ko )?(forward|bhej)\b/.test(t)
    || (/बैटरी (ड्रेन )?इश्यू/.test(t) && /(forward|भेज|शिकायत)/.test(t))
    || (/(பேட்டரி (பிரச்சனை|சிக்கல்))/.test(t) && /(முன்னனுப்பு|புகார்|உதவிக்குழு)/.test(t))
}

function isUserSpeaker(value: string) {
  return /^(user|human|customer|contact|callee|employee|caller)$/.test(String(value || '').toLowerCase().trim())
}

function preferAnswer(primary: BatteryIssueAnswer, fallback: BatteryIssueAnswer): BatteryIssueAnswer {
  if (primary === 'yes' || fallback === 'yes') return 'yes'
  if (primary !== 'unknown') return primary
  return fallback
}

function detectLanguage(text: string) {
  const t = norm(text)
  const map: Array<[RegExp, string]> = [
    [/\benglish\b|अंग्रेजी/, 'English'],
    [/\bhindi\b|हिंदी|हिन्दी/, 'Hindi'],
    [/\btamil\b|தமிழ்|தமிழில்|தமிழ்ல|thamizh/, 'Tamil'],
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

function leftoverAfterYes(text: string) {
  const cleaned = String(text || '')
    .replace(/^(yes|yeah|yep|yup|yea|haan|ha|aama|aam|avunu)[,.\s-]*/i, '')
    .replace(/^(ஆம்|ஆமா|ஆமாம்|ஆமாங்க|சரி|சரிங்க)[,.\s-]*/u, '')
    .trim()
  return cleaned && cleaned !== text.trim() ? cleaned : ''
}

function otherFromTurns(texts: string[]): { answer: BatteryIssueAnswer; description: string } {
  if (!texts.length) return { answer: 'unknown', description: '' }
  for (const text of texts) {
    if (isNoAnswer(text)) return { answer: 'no', description: '' }
    if (isYesAnswer(text)) {
      const extra = [
        leftoverAfterYes(text),
        ...texts.filter((t) => t !== text && !isYesAnswer(t) && !isNoAnswer(t)),
      ].filter(Boolean).join(' ').trim()
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
  const typeRaw = pickMeta(flat, ['other_issue_types', 'otherIssueTypes', 'other_issue_type', 'otherIssueType', 'issue_type'])
  if (typeRaw.startsWith('[')) {
    try { survey.other_types = uniqueTypes(JSON.parse(typeRaw) as string[]) } catch { survey.other_types = classifyOtherIssueTypes(typeRaw) }
  } else if (typeRaw) {
    survey.other_types = uniqueTypes(typeRaw.split(/[,|/]+/)).length
      ? uniqueTypes(typeRaw.split(/[,|/]+/))
      : classifyOtherIssueTypes(typeRaw)
  }
  if (survey.other === 'unknown' && (survey.other_description || survey.other_types.length)) survey.other = 'yes'
  if (survey.other !== 'unknown' || survey.other_description) survey.asked_other = true
  return survey
}

function surveyFromTranscript(linesIn: Array<{ speaker?: string; text?: string }>): BatterySurvey {
  const survey = emptySurvey()
  const lines = (linesIn || [])
    .map((line) => ({
      speaker: isUserSpeaker(String(line.speaker || '')) ? 'user' : 'bot',
      text: String(line.text || ''),
    }))
    .filter((line) => line.text.trim())

  let langIdx = -1
  let batteryIdx = -1
  let otherIdx = -1
  let contactIdx = -1
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].speaker === 'user') continue
    if (isLanguageQuestion(lines[i].text)) langIdx = i
    if (isBatteryQuestion(lines[i].text)) batteryIdx = i
    if (isOtherIssueQuestion(lines[i].text)) otherIdx = i
    if (isContactDetailsQuestion(lines[i].text) && contactIdx < 0) contactIdx = i
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
    const end = otherIdx > batteryIdx ? otherIdx : (contactIdx > batteryIdx ? contactIdx : lines.length)
    survey.battery = firstAnswer(userTurnsAfter(lines, batteryIdx, end))
  }

  if (otherIdx >= 0) {
    const end = contactIdx > otherIdx ? contactIdx : lines.length
    const other = otherFromTurns(userTurnsAfter(lines, otherIdx, end))
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

function mergeSurvey(transcript: BatterySurvey, meta: BatterySurvey): BatterySurvey {
  return {
    preferred_language: transcript.preferred_language || meta.preferred_language,
    battery: preferAnswer(transcript.battery, meta.battery),
    other: preferAnswer(transcript.other, meta.other),
    other_description: transcript.other_description || meta.other_description,
    other_types: uniqueTypes([...(transcript.other_types || []), ...(meta.other_types || [])]),
    asked_other: transcript.asked_other || meta.asked_other,
  }
}

function botConfirmsNoIssues(text: string) {
  const t = norm(text)
  if (!t || botForwardsBatteryIssue(t)) return false
  if (/\bno issues? with the battery\b/.test(t) && /\b(other|it related)\b/.test(t)) return true
  if (/\bno further action\b/.test(t) && /\bbattery\b/.test(t)) return true
  if (/कोई बात नहीं/.test(t) && /धन्यवाद/.test(t) && !/बाद में/.test(t)) return true
  if (/देखने के लिए कोई/.test(t) && /नहीं/.test(t)) return true
  if (/பரவாயில்லை/.test(t) && /நன்றி/.test(t)) return true
  if (/மேலும் நடவடிக்கை/.test(t) && /(தேவையில்லை|இல்லை)/.test(t)) return true
  if (/பிரச்சனை இல்லை/.test(t) && /(பேட்டரி|ஐடி|it)/.test(t)) return true
  return false
}

function applyBotConfirmations(
  linesIn: Array<{ speaker?: string; text?: string }>,
  survey: BatterySurvey,
): BatterySurvey {
  const lines = linesIn || []
  const forwarded = lines.some((line) => {
    if (isUserSpeaker(String(line.speaker || ''))) return false
    return botForwardsBatteryIssue(String(line.text || ''))
  })
  if (forwarded) return { ...survey, battery: 'yes' }
  const noIssues = lines.some((line) => {
    if (isUserSpeaker(String(line.speaker || ''))) return false
    return botConfirmsNoIssues(String(line.text || ''))
  })
  if (noIssues && survey.battery !== 'yes' && survey.other !== 'yes') {
    return { ...survey, battery: survey.battery === 'unknown' ? 'no' : survey.battery, other: survey.other === 'unknown' ? 'no' : survey.other, asked_other: true }
  }
  return survey
}

/** Old one-question prompt never asked about other issues. */
function applyLegacyOther(survey: BatterySurvey): BatterySurvey {
  if (!survey.asked_other && survey.other === 'unknown' && survey.battery === 'no') {
    return { ...survey, other: 'no', other_types: [] }
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
  let survey = mergeSurvey(fromTranscript, fromMeta)
  survey = applyBotConfirmations(transcript || [], survey)
  if (summary) {
    const blob = norm(summary)
    if (botForwardsBatteryIssue(blob) || /\bbattery issue confirmed (yes|true)\b/.test(blob)) {
      survey = { ...survey, battery: 'yes' }
    } else if (botConfirmsNoIssues(blob) && survey.battery !== 'yes' && survey.other !== 'yes') {
      survey = {
        ...survey,
        battery: survey.battery === 'unknown' ? 'no' : survey.battery,
        other: survey.other === 'unknown' ? 'no' : survey.other,
        asked_other: true,
      }
    } else if (survey.battery === 'unknown' && /\bbattery issue confirmed (no|false)\b/.test(blob)) {
      survey = { ...survey, battery: 'no' }
    }
  }
  survey = applyLegacyOther(survey)
  if (survey.other === 'yes') {
    survey = { ...survey, other_types: typesForOtherIssue(survey, summary || '') }
  } else {
    survey = { ...survey, other_types: [] }
  }
  return survey
}

/** Battery-only answer for older call sites. */
export function classifyBatteryDrainResponse(
  transcript: Array<{ speaker?: string; text?: string }> | null | undefined,
  metadata?: Record<string, unknown> | null,
  summary?: string | null,
): BatteryIssueAnswer {
  return classifyCallSurvey(transcript, metadata, summary).battery
}
