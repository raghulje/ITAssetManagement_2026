export type TranscriptLine = { speaker: 'bot' | 'user'; text: string }

function clean(text: string) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

function looksDevanagari(text: string) {
  return /[\u0900-\u097F]/.test(text)
}

function looksTamil(text: string) {
  return /[\u0B80-\u0BFF]/.test(text)
}

function looksTelugu(text: string) {
  return /[\u0C00-\u0C7F]/.test(text)
}

function looksIndic(text: string) {
  return looksDevanagari(text) || looksTamil(text) || looksTelugu(text)
}

function norm(text: string) {
  return clean(text)
    .toLowerCase()
    .replace(/[।.!?،,;:"'`]+/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
}

function isIdentityQuestion(text: string) {
  const t = norm(text)
  return /\bam i speaking\b/.test(t) || /\bspeaking to\b/.test(t)
}

function isLanguageQuestion(text: string) {
  const t = norm(text)
  return /\bwhich language\b/.test(t)
    || /\bprefer to (speak|continue)\b/.test(t)
    || (/\benglish\b/.test(t) && (/\bhindi\b/.test(t) || /\btamil\b/.test(t) || /\btelugu\b/.test(t)))
}

function isOtherIssueQuestion(text: string) {
  const t = norm(text)
  return /\bany other (issue|problem)/.test(t)
    || /\bother (laptop |it[- ]related )?(issue|problem)/.test(t)
    || /\bapart from the battery\b/.test(t)
}

function isBatteryQuestion(text: string) {
  const t = norm(text)
  if (isOtherIssueQuestion(text)) return false
  return /\bbattery drain\b/.test(t)
    || /\bdraining (quickly|faster)\b/.test(t)
    || /\bcharge it more\b/.test(t)
}

function isCloseLine(text: string) {
  const t = norm(text)
  return (/\bthank you\b/.test(t) && /\b(confirm|no issue|helpdesk|forward|further)\b/.test(t))
    || /\bno further action\b/.test(t)
}

function isHoldOn(text: string) {
  const t = norm(text)
  return /\b(hold on|one second|one sec|wait a (sec|second)|wait please)\b/.test(t)
}

function isNoAnswer(text: string) {
  const t = norm(text)
  if (/^(no|nope|nah|not really|not at all|nothing|none|nahi|nahin|nahee|illa|ille|illai|vendam|vendaam|ledu|leda|kadu|kaadu|vaddu)$/.test(t)) return true
  if (/^(no (issue|issues|problem|drain)|all good|im fine|i am fine)$/.test(t)) return true
  if (t === '\u0928\u0939\u0940\u0902' || t === '\u0928\u0939\u0940' || t === '\u0928\u093E') return true
  if (t === '\u0B87\u0BB2\u0BCD\u0BB2\u0BC8' || t === '\u0B87\u0BB2\u0BCD\u0BB2') return true
  if (t === '\u0C15\u0C3E\u0C26\u0C41' || t === '\u0C32\u0C47\u0C26\u0C41' || t === '\u0C35\u0C26\u0C4D\u0C26\u0C41') return true
  return false
}

function isYesAnswer(text: string) {
  const t = norm(text)
  if (!t || isNoAnswer(text) || isHoldOn(text)) return false
  if (/^(yes|yeah|yep|yup|yea|sure|yes sure|correct|right|i am|i do|haan|ha|haanji|aama|aam|avunu)$/.test(t)) return true
  if (/^(yes|yeah|yep|sure|haan|aama|avunu)(\s|$)/.test(t)) return true
  if (t === '\u0939\u093E\u0901' || t === '\u0939\u093E\u0902' || t === '\u0B86\u0BAE\u0BCD' || t === '\u0B86\u0BAE\u0BBE') return true
  if (t === '\u0C05\u0C35\u0C41\u0C28\u0C41' || t === '\u0C38\u0C30\u0C47') return true
  return false
}

function detectLanguage(text: string) {
  const t = norm(text)
  if (/\benglish\b/.test(t)) return 'English'
  if (/\bhindi\b/.test(t)) return 'Hindi'
  if (/\btamil\b|thamizh/.test(t)) return 'Tamil'
  if (/\btelugu\b/.test(t)) return 'Telugu'
  return ''
}

function speakerName(text: string) {
  const match = String(text || '').match(/(?:speaking to|talk to)\s+([^?]+)\??/i)
  return match?.[1]?.replace(/\s+/g, ' ').trim() || ''
}

function glossaryLine(text: string, speaker: 'bot' | 'user', stage: string, previousBot: string): string | null {
  const raw = clean(text)
  if (!raw) return raw
  if (speaker === 'bot') {
    if (isIdentityQuestion(raw)) {
      const name = speakerName(raw)
      return name ? `Hello, am I speaking to ${name}?` : 'Hello, am I speaking to you?'
    }
    if (isLanguageQuestion(raw)) {
      return 'Hi, this is Refex One AI from the IT Helpdesk team. Which language would you prefer to continue in — English, Hindi, Tamil, or Telugu?'
    }
    if (isBatteryQuestion(raw) || (looksIndic(raw) && (stage === 'intro' || stage === 'language'))) {
      return 'Is your laptop battery draining faster than usual, or do you need to charge it more often?'
    }
    if (isOtherIssueQuestion(raw) || (looksIndic(raw) && stage === 'battery')) {
      return 'Besides the battery, is there any other laptop or IT-related issue you want the IT Helpdesk team to look into?'
    }
    if (isCloseLine(raw) || (looksIndic(raw) && (stage === 'other' || stage === 'done'))) {
      if (/\bforward\b/.test(raw)) return 'Thank you. I will forward this to the IT Helpdesk team.'
      return 'Thank you. There are no issues to look into, so no further action is needed.'
    }
    return null
  }
  if (isLanguageQuestion(previousBot)) {
    return detectLanguage(raw) || (isYesAnswer(raw) ? 'Yes' : null)
  }
  if (isHoldOn(raw)) return 'Please wait a second.'
  if (isNoAnswer(raw)) return 'No.'
  if (isYesAnswer(raw)) return /sure/i.test(raw) ? 'Yes, sure.' : 'Yes.'
  return detectLanguage(raw) || null
}

function stillNeedsEnglish(text: string) {
  if (!text) return false
  if (looksIndic(text)) return true
  return /\b(nahi|nahin|haan|avunu|ledu|kadu|illa|aama|theleda|kaadu)\b/i.test(text)
}

function nextStage(text: string, translated: string, stage: string) {
  if (isIdentityQuestion(text) || /am I speaking/i.test(translated)) return 'language'
  if (isLanguageQuestion(text) || /which language/i.test(translated)) return 'language'
  if (isBatteryQuestion(text) || /battery draining/i.test(translated)) return 'battery'
  if (isOtherIssueQuestion(text) || /Besides the battery/i.test(translated)) return 'other'
  if (isCloseLine(text) || /no further action/i.test(translated) || /forward this/i.test(translated)) return 'done'
  return stage
}

async function googleTranslate(text: string): Promise<string | null> {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(text)}`
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'RefexAssetManagement/1.0' },
  })
  if (!res.ok) return null
  const json = await res.json() as unknown
  if (!Array.isArray(json) || !Array.isArray(json[0])) return null
  const out = (json[0] as Array<[string] | null>)
    .map((part) => (Array.isArray(part) ? String(part[0] || '') : ''))
    .join('')
    .trim()
  return out || null
}

async function myMemoryTranslate(text: string): Promise<string | null> {
  const pair = looksTelugu(text) ? 'te|en' : looksTamil(text) ? 'ta|en' : looksDevanagari(text) ? 'hi|en' : 'auto|en'
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 450))}&langpair=${pair}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) return null
  const json = await res.json() as { responseData?: { translatedText?: string } }
  const out = String(json.responseData?.translatedText || '').trim()
  if (!out || /invalid|query length|my memory/i.test(out)) return null
  return out
}

const machineCache = new Map<string, string>()

async function machineTranslate(text: string): Promise<string> {
  const key = text.slice(0, 500)
  const cached = machineCache.get(key)
  if (cached) return cached
  let translated: string | null = null
  try {
    translated = await googleTranslate(text)
  } catch {
    translated = null
  }
  if (!translated || stillNeedsEnglish(translated)) {
    try {
      translated = await myMemoryTranslate(text) || translated
    } catch {
      // keep the first result if the fallback fails
    }
  }
  const out = translated || text
  machineCache.set(key, out)
  return out
}

export async function translateTranscriptToEnglish(lines: TranscriptLine[]): Promise<TranscriptLine[]> {
  const source = Array.isArray(lines) ? lines : []
  let stage = 'intro'
  const out: TranscriptLine[] = []
  for (let i = 0; i < source.length; i += 1) {
    const line = source[i]
    const text = clean(line.text)
    if (!text) {
      out.push({ speaker: line.speaker, text })
      continue
    }
    let previousBot = ''
    for (let j = i - 1; j >= 0; j -= 1) {
      if (source[j].speaker === 'bot') {
        previousBot = source[j].text
        break
      }
    }
    let next = glossaryLine(text, line.speaker, stage, previousBot)
    if (!next || stillNeedsEnglish(next)) {
      if (stillNeedsEnglish(text) || stillNeedsEnglish(next || '')) {
        next = await machineTranslate(text)
        await new Promise((resolve) => setTimeout(resolve, 80))
      } else {
        next = next || text
      }
    }
    if (line.speaker === 'bot') stage = nextStage(text, next, stage)
    out.push({ speaker: line.speaker, text: next })
  }
  return out
}
