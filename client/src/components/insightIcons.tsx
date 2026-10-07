import { useId, type ReactNode } from 'react'

function Frame({
  from,
  to,
  children,
}: {
  from: string
  to: string
  children: ReactNode
}) {
  const raw = useId().replace(/:/g, '')
  const gid = `ig-${raw}`
  return (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="6" y1="2" x2="60" y2="62" gradientUnits="userSpaceOnUse">
          <stop stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill={`url(#${gid})`} />
      <rect x="2" y="2" width="60" height="60" rx="16" stroke="rgba(255,255,255,0.45)" strokeWidth="1.2" />
      {children}
    </svg>
  )
}

function shine() {
  return <ellipse cx="20" cy="14" rx="14" ry="7" fill="rgba(255,255,255,0.38)" />
}

const ICONS: Record<string, () => ReactNode> = {
  users: () => (
    <Frame from="#93c5fd" to="#1d4ed8">
      {shine()}
      <circle cx="24" cy="26" r="7" fill="#fff" />
      <circle cx="40" cy="26" r="6" fill="#dbeafe" />
      <path d="M10 48c2-9 9-13 14-13s12 4 14 13" fill="#fff" />
      <path d="M32 48c1-7 6-11 10-11s9 3 11 11" fill="#dbeafe" />
    </Frame>
  ),
  phone: () => (
    <Frame from="#6ee7b7" to="#0f766e">
      {shine()}
      <rect x="22" y="12" width="20" height="40" rx="5" fill="#ecfdf5" />
      <rect x="25" y="17" width="14" height="26" rx="2" fill="#14b8a6" />
      <circle cx="32" cy="47" r="2" fill="#0f766e" />
    </Frame>
  ),
  clock: () => (
    <Frame from="#fde68a" to="#d97706">
      {shine()}
      <circle cx="32" cy="33" r="16" fill="#fff7ed" />
      <circle cx="32" cy="33" r="12.5" fill="#fdba74" />
      <circle cx="32" cy="33" r="2" fill="#fff" />
      <path d="M32 24v9l6 4" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
    </Frame>
  ),
  userCheck: () => (
    <Frame from="#86efac" to="#15803d">
      {shine()}
      <circle cx="26" cy="24" r="8" fill="#fff" />
      <path d="M10 48c2-10 9-14 16-14s14 4 16 14" fill="#fff" />
      <path d="M38 36l5 5 9-10" stroke="#bbf7d0" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </Frame>
  ),
  phoneSlash: () => (
    <Frame from="#fda4af" to="#be123c">
      {shine()}
      <rect x="22" y="12" width="20" height="40" rx="5" fill="#fff1f2" />
      <path d="M16 18l32 28" stroke="#9f1239" strokeWidth="3.4" strokeLinecap="round" />
    </Frame>
  ),
  phoneMissed: () => (
    <Frame from="#fdba74" to="#c2410c">
      {shine()}
      <path d="M18 40c8-10 20-10 28 0l-6 6c-5-4-11-4-16 0z" fill="#fff7ed" />
      <path d="M38 18l8 2-3 8" stroke="#ffedd5" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </Frame>
  ),
  batteryLow: () => (
    <Frame from="#fca5a5" to="#b91c1c">
      {shine()}
      <rect x="14" y="24" width="32" height="18" rx="4" fill="#fff1f2" />
      <rect x="46" y="29" width="5" height="8" rx="1.5" fill="#fecaca" />
      <rect x="17" y="27" width="8" height="12" rx="2" fill="#ef4444" />
    </Frame>
  ),
  batteryFull: () => (
    <Frame from="#86efac" to="#047857">
      {shine()}
      <rect x="14" y="24" width="32" height="18" rx="4" fill="#ecfdf5" />
      <rect x="46" y="29" width="5" height="8" rx="1.5" fill="#a7f3d0" />
      <rect x="17" y="27" width="26" height="12" rx="2" fill="#10b981" />
    </Frame>
  ),
  laptop: () => (
    <Frame from="#93c5fd" to="#1e40af">
      {shine()}
      <rect x="14" y="18" width="36" height="22" rx="3" fill="#dbeafe" />
      <rect x="17" y="21" width="30" height="16" rx="1.5" fill="#1d4ed8" />
      <path d="M10 42h44l-4 6H14z" fill="#bfdbfe" />
    </Frame>
  ),
  check: () => (
    <Frame from="#5eead4" to="#0f766e">
      {shine()}
      <circle cx="32" cy="33" r="16" fill="#ecfdf5" />
      <path d="M23 34l6 6 13-14" stroke="#0f766e" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </Frame>
  ),
  layers: () => (
    <Frame from="#c4b5fd" to="#6d28d9">
      {shine()}
      <path d="M32 14l18 9-18 9-18-9z" fill="#ede9fe" />
      <path d="M14 36l18 9 18-9" stroke="#ddd6fe" strokeWidth="4" strokeLinejoin="round" />
      <path d="M14 43l18 9 18-9" stroke="#c4b5fd" strokeWidth="4" strokeLinejoin="round" />
    </Frame>
  ),
  clipboard: () => (
    <Frame from="#67e8f9" to="#0e7490">
      {shine()}
      <rect x="18" y="16" width="28" height="36" rx="5" fill="#ecfeff" />
      <rect x="24" y="12" width="16" height="8" rx="3" fill="#a5f3fc" />
      <path d="M24 30h16M24 37h12" stroke="#0891b2" strokeWidth="2.4" strokeLinecap="round" />
    </Frame>
  ),
  commentOff: () => (
    <Frame from="#fdba74" to="#c2410c">
      {shine()}
      <path d="M14 18h36v22H28l-8 8v-8H14z" fill="#fff7ed" />
      <path d="M18 20l28 28" stroke="#9a3412" strokeWidth="3" strokeLinecap="round" />
    </Frame>
  ),
  barcode: () => (
    <Frame from="#99f6e4" to="#0f766e">
      {shine()}
      <path d="M16 18h3v28h-3zM22 18h2v28h-2zM27 18h5v28h-5zM35 18h2v28h-2zM40 18h4v28h-4zM47 18h2v28h-2z" fill="#ecfdf5" />
    </Frame>
  ),
  warehouse: () => (
    <Frame from="#86efac" to="#166534">
      {shine()}
      <path d="M10 30L32 14l22 16v22H10z" fill="#dcfce7" />
      <rect x="26" y="36" width="12" height="16" fill="#16a34a" />
      <path d="M10 30h44" stroke="#bbf7d0" strokeWidth="3" />
    </Frame>
  ),
  calendar: () => (
    <Frame from="#fca5a5" to="#b91c1c">
      {shine()}
      <rect x="14" y="18" width="36" height="32" rx="5" fill="#fff1f2" />
      <rect x="14" y="18" width="36" height="10" fill="#fb7185" />
      <rect x="22" y="34" width="8" height="8" rx="1.5" fill="#e11d48" />
    </Frame>
  ),
  floppy: () => (
    <Frame from="#f9a8d4" to="#9d174d">
      {shine()}
      <rect x="16" y="14" width="32" height="36" rx="4" fill="#fce7f3" />
      <rect x="22" y="14" width="20" height="12" fill="#fbcfe8" />
      <rect x="22" y="32" width="20" height="12" rx="2" fill="#db2777" />
    </Frame>
  ),
  keyboard: () => (
    <Frame from="#fdba74" to="#c2410c">
      {shine()}
      <rect x="10" y="24" width="44" height="20" rx="4" fill="#fff7ed" />
      <path d="M16 30h4v4h-4zM23 30h4v4h-4zM30 30h4v4h-4zM37 30h4v4h-4zM44 30h4v4h-4zM20 37h24v3H20z" fill="#ea580c" />
    </Frame>
  ),
  droplet: () => (
    <Frame from="#7dd3fc" to="#0369a1">
      {shine()}
      <path d="M32 14c10 14 16 20 16 28a16 16 0 1 1-32 0c0-8 6-14 16-28z" fill="#e0f2fe" />
      <ellipse cx="27" cy="38" rx="4" ry="6" fill="rgba(255,255,255,0.55)" />
    </Frame>
  ),
  hdd: () => (
    <Frame from="#86efac" to="#166534">
      {shine()}
      <rect x="14" y="22" width="36" height="24" rx="5" fill="#dcfce7" />
      <circle cx="24" cy="34" r="5" fill="#16a34a" />
      <circle cx="24" cy="34" r="2" fill="#bbf7d0" />
      <path d="M34 30h10M34 36h8" stroke="#15803d" strokeWidth="2.2" strokeLinecap="round" />
    </Frame>
  ),
  userSlash: () => (
    <Frame from="#fda4af" to="#9f1239">
      {shine()}
      <circle cx="32" cy="24" r="8" fill="#fff" />
      <path d="M16 48c2-10 8-14 16-14s14 4 16 14" fill="#ffe4e6" />
      <path d="M16 16l32 32" stroke="#881337" strokeWidth="3.2" strokeLinecap="round" />
    </Frame>
  ),
  wifi: () => (
    <Frame from="#93c5fd" to="#1d4ed8">
      {shine()}
      <path d="M16 28c9-9 23-9 32 0" stroke="#dbeafe" strokeWidth="3.4" strokeLinecap="round" />
      <path d="M21 34c6-6 16-6 22 0" stroke="#bfdbfe" strokeWidth="3.4" strokeLinecap="round" />
      <circle cx="32" cy="44" r="3.4" fill="#fff" />
    </Frame>
  ),
  shield: () => (
    <Frame from="#c4b5fd" to="#6d28d9">
      {shine()}
      <path d="M32 12l16 6v14c0 11-7 18-16 22-9-4-16-11-16-22V18z" fill="#ede9fe" />
      <path d="M26 33l5 5 9-10" stroke="#6d28d9" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </Frame>
  ),
  envelope: () => (
    <Frame from="#fde68a" to="#b45309">
      {shine()}
      <rect x="12" y="22" width="40" height="24" rx="4" fill="#fffbeb" />
      <path d="M12 26l20 12 20-12" stroke="#d97706" strokeWidth="2.6" strokeLinejoin="round" />
    </Frame>
  ),
  video: () => (
    <Frame from="#93c5fd" to="#1e40af">
      {shine()}
      <rect x="12" y="22" width="28" height="20" rx="4" fill="#dbeafe" />
      <path d="M42 28l10-5v18l-10-5z" fill="#bfdbfe" />
    </Frame>
  ),
  desktop: () => (
    <Frame from="#a5b4fc" to="#3730a3">
      {shine()}
      <rect x="12" y="16" width="40" height="26" rx="4" fill="#e0e7ff" />
      <rect x="16" y="20" width="32" height="18" fill="#4338ca" />
      <path d="M28 42h8l2 6H26z" fill="#c7d2fe" />
    </Frame>
  ),
  plug: () => (
    <Frame from="#fdba74" to="#c2410c">
      {shine()}
      <rect x="24" y="14" width="6" height="10" rx="1.5" fill="#ffedd5" />
      <rect x="34" y="14" width="6" height="10" rx="1.5" fill="#ffedd5" />
      <rect x="20" y="22" width="24" height="16" rx="5" fill="#fff7ed" />
      <rect x="29" y="38" width="6" height="12" rx="2" fill="#fed7aa" />
    </Frame>
  ),
  window: () => (
    <Frame from="#7dd3fc" to="#0369a1">
      {shine()}
      <rect x="14" y="16" width="36" height="32" rx="5" fill="#e0f2fe" />
      <rect x="14" y="16" width="36" height="8" fill="#38bdf8" />
      <circle cx="19" cy="20" r="1.6" fill="#fff" />
      <circle cx="24" cy="20" r="1.6" fill="#fff" />
    </Frame>
  ),
  lock: () => (
    <Frame from="#c4b5fd" to="#5b21b6">
      {shine()}
      <path d="M24 30v-6a8 8 0 1 1 16 0v6" stroke="#ddd6fe" strokeWidth="3.4" strokeLinecap="round" />
      <rect x="20" y="30" width="24" height="18" rx="4" fill="#ede9fe" />
      <circle cx="32" cy="39" r="3" fill="#6d28d9" />
    </Frame>
  ),
  printer: () => (
    <Frame from="#cbd5e1" to="#334155">
      {shine()}
      <rect x="16" y="14" width="32" height="12" rx="2" fill="#f8fafc" />
      <rect x="12" y="24" width="40" height="18" rx="4" fill="#e2e8f0" />
      <rect x="20" y="36" width="24" height="12" rx="2" fill="#f8fafc" />
    </Frame>
  ),
  volume: () => (
    <Frame from="#fdba74" to="#c2410c">
      {shine()}
      <path d="M16 28h8l10-8v24l-10-8h-8z" fill="#fff7ed" />
      <path d="M40 26c4 3 4 9 0 12M45 22c7 6 7 14 0 20" stroke="#ffedd5" strokeWidth="2.6" strokeLinecap="round" />
    </Frame>
  ),
  camera: () => (
    <Frame from="#67e8f9" to="#0e7490">
      {shine()}
      <rect x="12" y="22" width="40" height="24" rx="6" fill="#ecfeff" />
      <circle cx="32" cy="34" r="7" fill="#0891b2" />
      <circle cx="32" cy="34" r="3" fill="#cffafe" />
      <rect x="24" y="16" width="10" height="8" rx="2" fill="#a5f3fc" />
    </Frame>
  ),
  question: () => (
    <Frame from="#cbd5e1" to="#475569">
      {shine()}
      <circle cx="32" cy="32" r="16" fill="#f8fafc" />
      <text x="32" y="40" textAnchor="middle" fontSize="22" fontWeight="800" fill="#334155">?</text>
    </Frame>
  ),
}

const FA_TO_KEY: Record<string, string> = {
  'fa-users': 'users',
  'fa-phone': 'phone',
  'fa-phone-volume': 'phone',
  'fa-clock': 'clock',
  'fa-user-check': 'userCheck',
  'fa-phone-slash': 'phoneSlash',
  'fa-phone-alt': 'phoneMissed',
  'fa-battery-quarter': 'batteryLow',
  'fa-battery-full': 'batteryFull',
  'fa-laptop': 'laptop',
  'fa-check-circle': 'check',
  'fa-layer-group': 'layers',
  'fa-clipboard-check': 'clipboard',
  'fa-comment-slash': 'commentOff',
  'fa-barcode': 'barcode',
  'fa-warehouse': 'warehouse',
  'fa-calendar-times': 'calendar',
  'fa-save': 'floppy',
  'fa-keyboard': 'keyboard',
  'fa-tint': 'droplet',
  'fa-hdd': 'hdd',
  'fa-user-slash': 'userSlash',
  'fa-wifi': 'wifi',
  'fa-shield-alt': 'shield',
  'fa-envelope': 'envelope',
  'fa-video': 'video',
  'fa-desktop': 'desktop',
  'fa-plug': 'plug',
  'fa-window-restore': 'window',
  'fa-user-lock': 'lock',
  'fa-print': 'printer',
  'fa-volume-up': 'volume',
  'fa-camera': 'camera',
  'fa-question-circle': 'question',
  'fa-hourglass-half': 'clock',
  'fa-exclamation-triangle': 'calendar',
  'fa-box-open': 'warehouse',
  'fa-cubes': 'layers',
  'fa-id-badge': 'userCheck',
  'fa-share': 'layers',
  'fa-boxes': 'warehouse',
}

const LABEL_TO_KEY: Record<string, string> = {
  'Total users': 'users',
  Employees: 'users',
  'Active employees': 'users',
  Active: 'userCheck',
  'Active (page)': 'userCheck',
  Inactive: 'userSlash',
  Called: 'phone',
  'Yet to call': 'clock',
  Attended: 'userCheck',
  Rejected: 'phoneSlash',
  Ignored: 'phoneMissed',
  'Battery yes': 'batteryLow',
  'Battery no': 'batteryFull',
  'Other issue only': 'laptop',
  'No issues': 'check',
  'Both issues': 'layers',
  'Answered both': 'clipboard',
  'Not answered': 'commentOff',
  'Total assets': 'barcode',
  Assets: 'barcode',
  Assigned: 'userCheck',
  'In stock': 'warehouse',
  'EOL due': 'calendar',
  'Assets assigned': 'laptop',
  Products: 'floppy',
  Licenses: 'floppy',
  'Licenses assigned': 'userCheck',
  'Licenses available': 'check',
  Accessories: 'keyboard',
  Consumables: 'droplet',
  Components: 'hdd',
  Pending: 'clock',
  'Audit due': 'clipboard',
  'Wi-Fi / Network': 'wifi',
  VPN: 'shield',
  'Email / Outlook': 'envelope',
  'Teams / Meetings': 'video',
  'Laptop hardware': 'laptop',
  'Screen / Display': 'desktop',
  'Keyboard / Mouse': 'keyboard',
  'Charger / Power': 'plug',
  'Software / Windows': 'window',
  'Login / Password': 'lock',
  'Printer / Scanner': 'printer',
  Audio: 'volume',
  Camera: 'camera',
  'Storage / Disk': 'hdd',
  'Other IT issue': 'question',
}

export function resolveInsightIconKey(label: string, icon?: string) {
  if (LABEL_TO_KEY[label]) return LABEL_TO_KEY[label]
  const fa = String(icon || '').split(/\s+/).find((part) => part.startsWith('fa-') && part !== 'fa-solid' && part !== 'fas' && part !== 'far')
  if (fa && FA_TO_KEY[fa]) return FA_TO_KEY[fa]
  return 'layers'
}

export function InsightGlyph({ name }: { name: string }) {
  const render = ICONS[name] || ICONS.layers
  return render()
}
