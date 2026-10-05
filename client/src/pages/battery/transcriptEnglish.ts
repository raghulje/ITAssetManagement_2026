import type { BatteryTranscriptLine } from '../../api/batteryIssues'

function clean(text: string) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

function looksIndic(text: string) {
  return /[\u0900-\u097F\u0B80-\u0BFF\u0C00-\u0C7F]/.test(text)
}

function norm(text: string) {
  return clean(text)
    .toLowerCase()
    .replace(/[।.!?،,;:]+/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
}

function isIdentityQuestion(text: string) {
  const t = norm(text)
  return /\bam i speaking\b/.test(t)
    || /\bspeaking to\b/.test(t)
    || /\bis this .{0,60}speaking\b/.test(t)
    || /बात कर रहा|बोल रहा/.test(text)
    || /பேசுகிறேனா|பேசிக்/.test(text)
}

function isLanguageQuestion(text: string) {
  const t = norm(text)
  return /\bwhich language\b/.test(t)
    || /\bprefer to (speak|continue)\b/.test(t)
    || (/\benglish\b/.test(t) && /\bhindi\b/.test(t))
    || /किस भाषा/.test(text)
    || /எந்த மொழி|மொழியில் தொடர/.test(text)
}

function isOtherIssueQuestion(text: string) {
  const t = norm(text)
  return /\bany other (issue|problem)/.test(t)
    || /\bother (laptop |it[- ]related )?(issue|problem)/.test(t)
    || /\bapart from the battery\b/.test(t)
    || /कोई और|कोई अन्य|अन्य समस्या|किसी और|IT से जुड़ी/.test(text)
    || /வேறு ஏதேனும்|வேறு எதாவது|பேட்டரி தவிர|(ஐடி|it) தொடர்பான/.test(text)
}

function isBatteryQuestion(text: string) {
  const t = norm(text)
  if (isOtherIssueQuestion(text)) return false
  return /\bbattery drain\b/.test(t)
    || /\bdraining (quickly|faster)\b/.test(t)
    || /\bcharge it more\b/.test(t)
    || /जल्दी खत्म|बार बार चार्ज|सामान्य से जल्दी/.test(text)
    || (/बैटरी|बैटेरी|लैपटरी/.test(text) && /(खत्म|चार्ज|drain|जल्दी|कम हो)/.test(text))
    || /சீக்கிரம் முடி|அடிக்கடி சார்ஜ்|வழக்கத்தை விட/.test(text)
    || (/பேட்டரி/.test(text) && /(சீக்கிரம்|சார்ஜ்|முடிந்து|வேக|வழக்கம்|drain)/.test(text))
}

function isCloseLine(text: string) {
  const t = norm(text)
  return (/\bthank you\b/.test(t) && /\b(confirm|no issue|helpdesk|forward|further)\b/.test(t))
    || /\bno further action\b/.test(t)
    || /कोई बात नहीं|धन्यवाद|आगे (कुछ )?नहीं|देखने के लिए कोई/.test(text)
    || /நன்றி|தேவையில்லை|மேலும் நடவடிக்கை/.test(text)
}

function isHoldOn(text: string) {
  const t = norm(text)
  return /\b(hold on|one second|one sec|wait a (sec|second)|wait please)\b/.test(t)
    || /एक सेकंड|एक मिनट|ज़रा रुक|जरा रुक/.test(text)
    || /ஒரு செகண்ட்|ஒரு நிமிடம்|சற்று நில்லு/.test(text)
}

function isNoAnswer(text: string) {
  const t = norm(text)
  return /^(no|nope|nah|not really|not at all|nothing|none|nahi|nahin|nahee|illa|ille|illai|vendam|vendaam|नहीं|नही|ना|नहीं जी|नही जी)$/.test(t)
    || /^(இல்லை|இல்ல)(ங்க|யே|யா)?$/.test(t)
    || /^(no (issue|issues|problem|drain)|all good|im fine|i am fine)$/.test(t)
}

function isYesAnswer(text: string) {
  const t = norm(text)
  if (!t || isNoAnswer(text) || isHoldOn(text)) return false
  return /^(yes|yeah|yep|yup|yea|sure|yes sure|correct|right|i am|i do|haan|ha|haanji|aama|aam|हाँ|हां|जी हाँ|जी हां|ஆம்|ஆமா|ஆமாம்|ஆமாங்க|சரி|சரிங்க|இருக்கு)$/.test(t)
    || /^(yes|yeah|yep|sure|haan|aama|हाँ|हां|ஆம்|ஆமா)(\s|$)/.test(t)
}

function detectLanguage(text: string) {
  const t = norm(text)
  if (/\benglish\b|अंग्रेजी/.test(t)) return 'English'
  if (/\bhindi\b|हिंदी|हिन्दी/.test(t)) return 'Hindi'
  if (/\btamil\b|தமிழ்|thamizh/.test(t)) return 'Tamil'
  return ''
}

function speakerName(text: string) {
  const match = String(text || '').match(/(?:speaking to|talk to)\s+([^?]+)\??/i)
  return match?.[1]?.replace(/\s+/g, ' ').trim() || ''
}

function previousBotText(lines: BatteryTranscriptLine[], index: number) {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (lines[i].speaker === 'bot') return lines[i].text
  }
  return ''
}

function translateUser(text: string, previousBot: string) {
  const raw = clean(text)
  if (!raw) return raw
  if (isLanguageQuestion(previousBot)) {
    return detectLanguage(raw) || (isYesAnswer(raw) ? 'Yes' : raw)
  }
  if (isHoldOn(raw)) return 'Please wait a second.'
  if (isNoAnswer(raw)) return 'No.'
  if (isYesAnswer(raw)) return /sure/i.test(raw) ? 'Yes, sure.' : 'Yes.'
  if (!looksIndic(raw)) return raw
  return detectLanguage(raw) || raw
    .replace(/नहीं[।.]?/g, 'No')
    .replace(/हाँ[।.]?|हां[।.]?/g, 'Yes')
    .replace(/இல்லை[.]?/g, 'No')
    .replace(/ஆம்[.]?|ஆமாம்[.]?/g, 'Yes')
}

function translateBot(text: string, stage: 'intro' | 'language' | 'battery' | 'other' | 'done') {
  const raw = clean(text)
  if (isIdentityQuestion(raw)) {
    const name = speakerName(raw)
    return name ? `Hello, am I speaking to ${name}?` : 'Hello, am I speaking to you?'
  }
  if (isLanguageQuestion(raw)) {
    return 'Hi, this is Refex One AI from the IT Helpdesk team. Which language would you prefer to continue in — English, Hindi, or Tamil?'
  }
  if (isBatteryQuestion(raw) || (looksIndic(raw) && (stage === 'intro' || stage === 'language'))) {
    return 'Is your laptop battery draining faster than usual, or do you need to charge it more often?'
  }
  if (isOtherIssueQuestion(raw) || (looksIndic(raw) && stage === 'battery')) {
    return 'Besides the battery, is there any other laptop or IT-related issue you want the IT Helpdesk team to look into?'
  }
  if (isCloseLine(raw) || (looksIndic(raw) && (stage === 'other' || stage === 'done'))) {
    if (/\bforward\b|भेज|शिकायत|முன்னனுப்பு|புகார்/.test(raw)) {
      return 'Thank you. I will forward this to the IT Helpdesk team.'
    }
    return 'Thank you. There are no issues to look into, so no further action is needed.'
  }
  return raw
}

export function transcriptNeedsEnglish(lines: BatteryTranscriptLine[]) {
  return (lines || []).some((line) => (
    looksIndic(line.text)
    || isNoAnswer(line.text)
    || detectLanguage(line.text) === 'Hindi'
    || detectLanguage(line.text) === 'Tamil'
  ))
}

export function transcriptInEnglish(lines: BatteryTranscriptLine[]): BatteryTranscriptLine[] {
  const source = lines || []
  let stage: 'intro' | 'language' | 'battery' | 'other' | 'done' = 'intro'
  return source.map((line, index) => {
    const text = clean(line.text)
    if (!text) return { ...line, text }
    if (line.speaker === 'bot') {
      const next = translateBot(text, stage)
      if (isIdentityQuestion(text) || /am I speaking/i.test(next)) stage = 'language'
      else if (isLanguageQuestion(text) || /which language/i.test(next)) stage = 'language'
      else if (isBatteryQuestion(text) || /battery draining/i.test(next)) stage = 'battery'
      else if (isOtherIssueQuestion(text) || /Besides the battery/i.test(next)) stage = 'other'
      else if (isCloseLine(text) || /no further action/i.test(next) || /forward this/i.test(next)) stage = 'done'
      return { ...line, text: next }
    }
    return { ...line, text: translateUser(text, previousBotText(source, index)) }
  })
}
