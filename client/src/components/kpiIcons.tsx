import type { ReactNode } from 'react'

/** Latest_VMS / P2pKpiCard-style stroke icons, themed for IT Asset Management. */

function StrokeIcon({
  className,
  children,
  strokeWidth = 1.85,
}: {
  className?: string
  children: ReactNode
  strokeWidth?: number
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

export type KpiIconKey =
  | 'assets'
  | 'licenses'
  | 'accessories'
  | 'consumables'
  | 'components'
  | 'people'
  | 'assigned'
  | 'stock'
  | 'eol'
  | 'battery'
  | 'qr'
  | 'warning'
  | 'clock'
  | 'check'
  | 'laptop'
  | 'box'
  | 'share'
  | 'users'
  | 'arrow'
  | 'default'

const ICONS: Record<KpiIconKey, ReactNode> = {
  assets: (
    <StrokeIcon className="kpi-ico kpi-ico-assets">
      <rect x="3.5" y="6.2" width="17" height="12.2" rx="2.2" />
      <path d="M7.2 9.4h2.1M10.2 9.4h2.1M13.2 9.4h2.1M16.2 9.4h1.3" />
      <path d="M7.2 12.2h1.5M9.6 12.2h1.5M12 12.2h1.5M14.4 12.2h2.8" />
      <path d="M7.2 15h3.2M11.2 15h5.6" />
      <path d="M8.4 18.4h7.2" />
    </StrokeIcon>
  ),
  licenses: (
    <StrokeIcon className="kpi-ico kpi-ico-licenses">
      <path d="M14 3.2H7.5A2 2 0 0 0 5.5 5.2v13.6A2 2 0 0 0 7.5 20.8h9A2 2 0 0 0 18.5 18.8V8Z" />
      <path d="M14 3.2v4.8h4.5" />
      <circle cx="12" cy="13.6" r="2.6" />
      <path d="m10.7 13.6 1 1 1.9-2" />
    </StrokeIcon>
  ),
  accessories: (
    <StrokeIcon className="kpi-ico kpi-ico-accessories">
      <rect x="3.4" y="8.2" width="17.2" height="9.4" rx="2" />
      <path d="M6.2 11h1.4M8.6 11h1.4M11 11h1.4M13.4 11h1.4M15.8 11h1.4" />
      <path d="M6.2 13.8h1.4M8.6 13.8h1.4M11 13.8h1.4M13.4 13.8h1.4M15.8 13.8h1.4" />
      <path d="M9.2 17.6h5.6" />
    </StrokeIcon>
  ),
  consumables: (
    <StrokeIcon className="kpi-ico kpi-ico-consumables">
      <path d="M12 3.4c-2.8 3.2-5.4 6-5.4 9.1a5.4 5.4 0 0 0 10.8 0c0-3.1-2.6-5.9-5.4-9.1Z" />
      <path d="M10.2 14.4c.6 1.4 1.7 2.1 2.9 2.1" />
    </StrokeIcon>
  ),
  components: (
    <StrokeIcon className="kpi-ico kpi-ico-components">
      <rect x="5.2" y="6.4" width="13.6" height="11.2" rx="2" />
      <path d="M8.2 9.2h7.6M8.2 12h7.6M8.2 14.8h4.8" />
      <path d="M3.6 9.4h1.6M3.6 14.6h1.6M18.8 9.4h1.6M18.8 14.6h1.6" />
    </StrokeIcon>
  ),
  people: (
    <StrokeIcon className="kpi-ico kpi-ico-people">
      <circle cx="9" cy="8" r="2.4" />
      <circle cx="16" cy="8.6" r="2" />
      <path d="M3.8 18.6c.5-3.2 2.4-5 5.2-5s3.6 1 4.4 2.4c.8-1.2 2-2 3.8-2 2.2 0 3.8 1.6 4.2 4.6" />
    </StrokeIcon>
  ),
  assigned: (
    <StrokeIcon className="kpi-ico kpi-ico-assigned">
      <circle cx="9.2" cy="8" r="2.5" />
      <path d="M4.2 18.6c.5-3.3 2.4-5.1 5-5.1s3.6 1 4.4 2.5" />
      <path d="M14.2 12.4h5.4v7.2h-5.4z" />
      <path d="m15.4 16 1.4 1.4 2.4-2.6" />
    </StrokeIcon>
  ),
  stock: (
    <StrokeIcon className="kpi-ico kpi-ico-stock">
      <path d="M4.2 9.2 12 4.8l7.8 4.4v8.6L12 21.4 4.2 17.8Z" />
      <path d="M12 12.2v9.2M4.2 9.2 12 12.2l7.8-3" />
    </StrokeIcon>
  ),
  eol: (
    <StrokeIcon className="kpi-ico kpi-ico-eol">
      <rect x="3.6" y="5.4" width="16.8" height="14.4" rx="2.1" />
      <path d="M8 3.8v3.2M16 3.8v3.2M3.6 10h16.8" />
      <path d="M9.2 14.2 14.8 19.8M14.8 14.2 9.2 19.8" />
    </StrokeIcon>
  ),
  battery: (
    <StrokeIcon className="kpi-ico kpi-ico-battery">
      <rect x="3.6" y="8.2" width="14.8" height="8.4" rx="2" />
      <path d="M18.4 10.6h1.6v3.6h-1.6" />
      <path d="M6.2 10.8h4.8v3.2H6.2z" />
    </StrokeIcon>
  ),
  qr: (
    <StrokeIcon className="kpi-ico kpi-ico-qr">
      <rect x="3.6" y="3.6" width="7" height="7" rx="1.2" />
      <rect x="13.4" y="3.6" width="7" height="7" rx="1.2" />
      <rect x="3.6" y="13.4" width="7" height="7" rx="1.2" />
      <path d="M13.4 13.4h2.6v2.6M18.4 13.4v3.2h-2.2M13.4 18.8h3.2M18.4 18.8v1.6" />
    </StrokeIcon>
  ),
  warning: (
    <StrokeIcon className="kpi-ico kpi-ico-warning">
      <path d="M12 4.2 20.4 18.8H3.6Z" />
      <path d="M12 10.2v4.2M12 16.8h.01" />
    </StrokeIcon>
  ),
  clock: (
    <StrokeIcon className="kpi-ico kpi-ico-clock">
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.6V12l3.2 2" />
    </StrokeIcon>
  ),
  check: (
    <StrokeIcon className="kpi-ico kpi-ico-check">
      <circle cx="12" cy="12" r="8.2" />
      <path d="m8.4 12.2 2.4 2.4 4.8-5" />
    </StrokeIcon>
  ),
  laptop: (
    <StrokeIcon className="kpi-ico kpi-ico-laptop">
      <rect x="4.2" y="5.4" width="15.6" height="10.4" rx="1.6" />
      <path d="M2.8 18.4h18.4M9.4 15.8h5.2" />
    </StrokeIcon>
  ),
  box: (
    <StrokeIcon className="kpi-ico kpi-ico-box">
      <path d="M4.2 8.4 12 4.6l7.8 3.8v8.8L12 20.8 4.2 17.2Z" />
      <path d="M12 12.2v8.6M4.2 8.4 12 12.2l7.8-3.8" />
    </StrokeIcon>
  ),
  share: (
    <StrokeIcon className="kpi-ico kpi-ico-share">
      <circle cx="18" cy="6.2" r="2.2" />
      <circle cx="6" cy="12" r="2.2" />
      <circle cx="18" cy="17.8" r="2.2" />
      <path d="m8 11 8-3.8M8 13l8 3.8" />
    </StrokeIcon>
  ),
  users: (
    <StrokeIcon className="kpi-ico kpi-ico-users">
      <circle cx="9" cy="8" r="2.4" />
      <circle cx="16" cy="8.6" r="2" />
      <path d="M3.8 18.6c.5-3.2 2.4-5 5.2-5s3.6 1 4.4 2.4c.8-1.2 2-2 3.8-2 2.2 0 3.8 1.6 4.2 4.6" />
    </StrokeIcon>
  ),
  arrow: (
    <StrokeIcon className="kpi-ico kpi-ico-arrow" strokeWidth={2.2}>
      <path d="M5 12h12.5M13.2 7.2 18.5 12l-5.3 4.8" />
    </StrokeIcon>
  ),
  default: (
    <StrokeIcon className="kpi-ico kpi-ico-default">
      <rect x="4.4" y="4.4" width="15.2" height="15.2" rx="3" />
      <path d="M9 12h6M12 9v6" />
    </StrokeIcon>
  ),
}

const FA_TO_KEY: Record<string, KpiIconKey> = {
  'fas fa-barcode': 'assets',
  'fas fa-qrcode': 'qr',
  'fas fa-save': 'licenses',
  'fas fa-key': 'licenses',
  'fas fa-keyboard': 'accessories',
  'fas fa-tint': 'consumables',
  'fas fa-hdd': 'components',
  'fas fa-users': 'people',
  'fas fa-user': 'people',
  'fas fa-user-check': 'assigned',
  'fas fa-warehouse': 'stock',
  'fas fa-boxes': 'stock',
  'fas fa-box': 'box',
  'fas fa-box-open': 'box',
  'fas fa-cubes': 'box',
  'fas fa-calendar-times': 'eol',
  'fas fa-battery-half': 'battery',
  'fas fa-exclamation-triangle': 'warning',
  'fas fa-hourglass-half': 'clock',
  'fas fa-clock': 'clock',
  'fas fa-check-circle': 'check',
  'fas fa-check': 'check',
  'fas fa-laptop': 'laptop',
  'fas fa-id-badge': 'assigned',
  'fas fa-share': 'share',
  'fas fa-clipboard-check': 'check',
  'fas fa-user-slash': 'warning',
  'fas fa-desktop': 'laptop',
  'fas fa-tag': 'assets',
  'fas fa-file': 'licenses',
  'fas fa-plug': 'accessories',
  'fas fa-server': 'components',
  'fas fa-building': 'stock',
}

const MARK_SETS: Record<KpiIconKey, KpiIconKey[]> = {
  assets: ['assets', 'qr', 'laptop', 'check', 'box'],
  licenses: ['licenses', 'check', 'assigned', 'laptop', 'default'],
  accessories: ['accessories', 'laptop', 'box', 'check', 'components'],
  consumables: ['consumables', 'box', 'stock', 'check', 'share'],
  components: ['components', 'laptop', 'stock', 'assets', 'check'],
  people: ['people', 'assigned', 'laptop', 'check', 'stock'],
  assigned: ['assigned', 'laptop', 'assets', 'people', 'check'],
  stock: ['stock', 'box', 'assets', 'check', 'components'],
  eol: ['eol', 'clock', 'warning', 'laptop', 'assets'],
  battery: ['battery', 'warning', 'laptop', 'clock', 'check'],
  qr: ['qr', 'assets', 'laptop', 'check', 'box'],
  warning: ['warning', 'eol', 'clock', 'assets', 'check'],
  clock: ['clock', 'eol', 'warning', 'check', 'assets'],
  check: ['check', 'assigned', 'stock', 'assets', 'people'],
  laptop: ['laptop', 'assets', 'accessories', 'check', 'qr'],
  box: ['box', 'stock', 'consumables', 'check', 'share'],
  share: ['share', 'assigned', 'people', 'assets', 'check'],
  users: ['users', 'people', 'assigned', 'check', 'laptop'],
  arrow: ['arrow', 'share', 'check', 'assets', 'laptop'],
  default: ['default', 'box', 'assets', 'check', 'stock'],
}

export function resolveKpiIconKey(icon?: string | null): KpiIconKey {
  if (!icon) return 'default'
  if (icon in ICONS) return icon as KpiIconKey
  return FA_TO_KEY[icon] || 'default'
}

export function KpiIcon({ icon, className }: { icon?: string | null; className?: string }) {
  const key = resolveKpiIconKey(icon)
  const node = ICONS[key]
  if (!className) return <>{node}</>
  return <span className={className}>{node}</span>
}

export function KpiMarkIcons({ icon }: { icon?: string | null }) {
  const key = resolveKpiIconKey(icon)
  const marks = MARK_SETS[key] || MARK_SETS.default
  return (
    <>
      {marks.map((m, i) => (
        <span key={`${m}-${i}`} className="small-box-mark">
          {ICONS[m]}
        </span>
      ))}
    </>
  )
}
