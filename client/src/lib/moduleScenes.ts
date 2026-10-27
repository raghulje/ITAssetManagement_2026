/** Soft clay hero art + header mode, mapped by route module and IT / Admin domain. */

export type HeaderVariant = 'soft' | 'form'
export type SceneDomain = 'it' | 'admin'

const IT = {
  welcome: '/art/asset-it-welcome.jpg',
  stock: '/art/asset-it-stock.jpg',
  people: '/art/asset-it-people.jpg',
  form: '/art/asset-it-form.jpg',
  battery: '/art/asset-it-battery.jpg',
  licenses: '/art/asset-it-licenses.jpg',
  labels: '/art/asset-it-labels.jpg',
  accessories: '/art/asset-it-accessories.jpg',
  components: '/art/asset-it-components.jpg',
  consumables: '/art/asset-it-consumables.jpg',
  spaces: '/art/asset-spaces.jpg',
} as const

const ADMIN = {
  welcome: '/art/asset-admin-welcome.jpg',
  stock: '/art/asset-admin-stock.jpg',
  people: '/art/asset-admin-people.jpg',
  form: '/art/asset-admin-form.jpg',
  supplies: '/art/asset-admin-supplies.jpg',
  spaces: '/art/asset-spaces.jpg',
  /** Admin has no software licenses / laptop battery — fall back to mixed stock. */
  licenses: '/art/asset-admin-stock.jpg',
  battery: '/art/asset-admin-stock.jpg',
  labels: '/art/asset-it-labels.jpg',
  accessories: '/art/asset-admin-supplies.jpg',
  components: '/art/asset-admin-supplies.jpg',
  consumables: '/art/asset-admin-supplies.jpg',
} as const

const LIST_PATHS = [
  /^\/$/,
  /^\/hardware\/?$/,
  /^\/hardware\/eol\/due\/?$/,
  /^\/hardware\/checkins\/due\/?$/,
  /^\/hardware\/quickscancheckin\/?$/,
  /^\/hardware\/bulkcheckout\/?$/,
  /^\/hardware\/history\/?$/,
  /^\/hardware\/requested\/?$/,
  /^\/maintenances\/?$/,
  /^\/labels\/?$/,
  /^\/licenses\/?$/,
  /^\/accessories\/?$/,
  /^\/consumables\/?$/,
  /^\/components\/?$/,
  /^\/kits\/?$/,
  /^\/employees\/?$/,
  /^\/users\/?$/,
  /^\/battery-issues\/?$/,
  /^\/spaces\/?$/,
  /^\/companies\/?$/,
  /^\/departments\/?$/,
  /^\/locations\/?$/,
  /^\/suppliers\/?$/,
  /^\/models\/?$/,
  /^\/asset-types\/?$/,
  /^\/manufacturers\/?$/,
  /^\/categories\/?$/,
  /^\/statuslabels\/?$/,
  /^\/fields\/?$/,
  /^\/depreciations\/?$/,
  /^\/settings\/?$/,
  /^\/settings\/[^/]+\/?$/,
  /^\/reports(\/.*)?$/,
  /^\/import\/?$/,
  /^\/admin\/?$/,
]

function pack(domain: string | null | undefined) {
  return String(domain || 'it').toLowerCase() === 'admin' ? ADMIN : IT
}

export function resolveModuleScene(pathname: string, domain?: string | null): string {
  const art = pack(domain)
  const p = pathname || '/'

  if (p.startsWith('/battery-issues') || p.startsWith('/settings/battery')) return art.battery
  if (p.startsWith('/licenses') || p.startsWith('/reports/licenses')) return art.licenses
  if (p.startsWith('/labels')) return art.labels
  if (p.startsWith('/accessories') || p.startsWith('/reports/accessories')) return art.accessories
  if (p.startsWith('/components')) return art.components
  if (p.startsWith('/consumables')) return art.consumables
  if (p.startsWith('/spaces')) return art.spaces
  if (p.startsWith('/employees') || p.startsWith('/users')) return art.people

  if (
    p.includes('/create')
    || p.includes('/edit')
    || p.endsWith('/checkout')
    || p.endsWith('/checkin')
    || p.endsWith('/transfer')
  ) return art.form

  if (
    p.startsWith('/hardware')
    || p.startsWith('/maintenances')
    || p.startsWith('/kits')
    || p.startsWith('/reports')
  ) return art.stock

  if (
    p.startsWith('/companies')
    || p.startsWith('/departments')
    || p.startsWith('/locations')
    || p.startsWith('/suppliers')
    || p.startsWith('/models')
    || p.startsWith('/asset-types')
    || p.startsWith('/manufacturers')
    || p.startsWith('/categories')
    || p.startsWith('/statuslabels')
    || p.startsWith('/fields')
    || p.startsWith('/depreciations')
    || p.startsWith('/settings')
    || p.startsWith('/import')
    || p.startsWith('/admin')
  ) return art.welcome

  if (p === '/' || p === '') return art.welcome
  return art.welcome
}

export function resolveFormScene(domain?: string | null): string {
  return pack(domain).form
}

export function resolveHeaderVariant(pathname: string): HeaderVariant {
  if (LIST_PATHS.some((re) => re.test(pathname))) return 'soft'
  if (pathname.includes('/create') || pathname.includes('/edit') || pathname.includes('/import')) return 'form'
  return 'form'
}

export { IT as MODULE_ART_IT, ADMIN as MODULE_ART_ADMIN }
