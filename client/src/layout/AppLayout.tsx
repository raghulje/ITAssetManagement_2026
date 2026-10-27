import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import AOS from 'aos'
import { siteName } from '../data/mockData'
import { useAuth } from '../api/AuthContext'
import { softwareLicensesInDomain } from '../lib/domainScope'
import { PageBack } from '../components/ui'
import { goToRefexOne } from '../utils/refexOneUrl'
import { resolveHeaderVariant, resolveModuleScene } from '../lib/moduleScenes'

function HeaderBubbles() {
  return (
    <span className="p2p-header-bubbles" aria-hidden>
      <i /><i /><i /><i /><i /><i /><i />
    </span>
  )
}

type Props = {
  children: ReactNode
  title: string
  subtitle?: string
  hideHeader?: boolean
  scene?: string
  backTo?: string
  backLabel?: string
  onBack?: () => void
}

type SectionTab = {
  to: string
  label: string
  /** Return true when this tab should look active */
  isActive: (pathname: string, search: string) => boolean
  /** Visual group: status filters vs tools (assets section) */
  group?: 'status' | 'tools'
}

type SectionKey = 'assets' | 'people' | 'spaces' | 'masters' | 'settings' | 'reports'

const SECTION_TABS: Record<SectionKey, SectionTab[]> = {
  assets: [
    {
      to: '/hardware',
      label: 'List All',
      group: 'status',
      isActive: (p, s) => p === '/hardware' && !new URLSearchParams(s).has('status_type'),
    },
    {
      to: '/hardware?status_type=Assigned',
      label: 'Assigned',
      group: 'status',
      isActive: (p, s) => {
        if (p !== '/hardware') return false
        const t = new URLSearchParams(s).get('status_type')
        return t === 'Assigned' || t === 'Deployed'
      },
    },
    {
      to: '/hardware?status_type=RTD',
      label: 'In Stock',
      group: 'status',
      isActive: (p, s) => p === '/hardware' && new URLSearchParams(s).get('status_type') === 'RTD',
    },
    // Pending / Deleted — not used at Refex for now; restore when needed
    // {
    //   to: '/hardware?status_type=Pending',
    //   label: 'Pending',
    //   group: 'status',
    //   isActive: (p, s) => p === '/hardware' && new URLSearchParams(s).get('status_type') === 'Pending',
    // },
    // {
    //   to: '/hardware?status_type=Deleted',
    //   label: 'Deleted',
    //   group: 'status',
    //   isActive: (p, s) => p === '/hardware' && new URLSearchParams(s).get('status_type') === 'Deleted',
    // },
    // Assets tool tabs — restore when needed
    // {
    //   to: '/hardware/audit/due',
    //   label: 'Audit Due',
    //   group: 'tools',
    //   isActive: (p) => p.startsWith('/hardware/audit/due'),
    // },
    // {
    //   to: '/hardware/eol/due',
    //   label: 'EOL Due',
    //   group: 'tools',
    //   isActive: (p) => p.startsWith('/hardware/eol/due'),
    // },
    // {
    //   to: '/hardware/checkins/due',
    //   label: 'Due for Unassign',
    //   group: 'tools',
    //   isActive: (p) => p.startsWith('/hardware/checkins/due'),
    // },
    // {
    //   to: '/hardware/quickscancheckin',
    //   label: 'Quickscan Unassign',
    //   group: 'tools',
    //   isActive: (p) => p.startsWith('/hardware/quickscancheckin'),
    // },
    // {
    //   to: '/hardware/bulkcheckout',
    //   label: 'Bulk Assign',
    //   group: 'tools',
    //   isActive: (p) => p.startsWith('/hardware/bulkcheckout'),
    // },
    // {
    //   to: '/maintenances',
    //   label: 'Maintenances',
    //   group: 'tools',
    //   isActive: (p) => p.startsWith('/maintenances'),
    // },
    // {
    //   to: '/hardware/bulkaudit',
    //   label: 'Bulk Audit',
    //   group: 'tools',
    //   isActive: (p) => p.startsWith('/hardware/bulkaudit'),
    // },
    // {
    //   to: '/hardware/agent-activity',
    //   label: 'Agent activity',
    //   group: 'tools',
    //   isActive: (p) => p.startsWith('/hardware/agent-activity'),
    // },
    // {
    //   to: '/hardware/history',
    //   label: 'Import History',
    //   group: 'tools',
    //   isActive: (p) => p.startsWith('/hardware/history'),
    // },
  ],
  people: [
    { to: '/employees', label: 'Employees', isActive: (p) => p.startsWith('/employees') && !p.startsWith('/employees/import') },
    { to: '/employees/import', label: 'Sync / Import HRMS', isActive: (p) => p.startsWith('/employees/import') },
    {
      to: '/users',
      label: 'App Users',
      isActive: (p, s) => {
        if (p !== '/users') return false
        const q = new URLSearchParams(s)
        return !q.has('superadmins') && !q.has('admins') && !q.has('status') && !q.has('activated')
      },
    },
    { to: '/users?superadmins=true', label: 'Superadmins', isActive: (p, s) => p === '/users' && new URLSearchParams(s).get('superadmins') === 'true' },
    { to: '/users?admins=true', label: 'Admins', isActive: (p, s) => p === '/users' && new URLSearchParams(s).get('admins') === 'true' },
    { to: '/users?status=deleted', label: 'Deleted Users', isActive: (p, s) => p === '/users' && new URLSearchParams(s).get('status') === 'deleted' },
    { to: '/users?activated=1', label: 'Login Enabled', isActive: (p, s) => p === '/users' && new URLSearchParams(s).get('activated') === '1' },
    { to: '/users?activated=0', label: 'Login Disabled', isActive: (p, s) => p === '/users' && new URLSearchParams(s).get('activated') === '0' },
  ],
  spaces: [
    { to: '/spaces', label: 'Offices & floors', isActive: (p) => p.startsWith('/spaces') },
  ],
  masters: [
    { to: '/companies', label: 'Companies', isActive: (p) => p.startsWith('/companies') },
    { to: '/departments', label: 'Departments', isActive: (p) => p.startsWith('/departments') },
    { to: '/locations', label: 'Locations', isActive: (p) => p.startsWith('/locations') },
    { to: '/suppliers', label: 'Suppliers / Vendors', isActive: (p) => p.startsWith('/suppliers') },
    { to: '/models', label: 'Asset Models', isActive: (p) => p.startsWith('/models') },
    { to: '/asset-types', label: 'Asset types', isActive: (p) => p.startsWith('/asset-types') },
    { to: '/manufacturers', label: 'Manufacturers', isActive: (p) => p.startsWith('/manufacturers') },
  ],
  settings: [
    { to: '/settings', label: 'General', isActive: (p) => p === '/settings' },
    { to: '/settings/battery', label: 'Battery Degradation', isActive: (p) => p.startsWith('/settings/battery') },
    { to: '/settings/roles', label: 'Roles & permissions', isActive: (p) => p.startsWith('/settings/roles') },
    { to: '/settings/notifications', label: 'Notifications', isActive: (p) => p.startsWith('/settings/notifications') || p.startsWith('/settings/email-logs') },
    { to: '/settings/email-logs', label: 'Email logs', isActive: (p) => p.startsWith('/settings/email-logs') },
    { to: '/categories', label: 'Categories', isActive: (p) => p.startsWith('/categories') },
    { to: '/statuslabels', label: 'Status Labels', isActive: (p) => p.startsWith('/statuslabels') },
    { to: '/fields', label: 'Custom Fields', isActive: (p) => p.startsWith('/fields') },
    { to: '/depreciations', label: 'Depreciation', isActive: (p) => p.startsWith('/depreciations') },
  ],
  reports: [
    { to: '/reports', label: 'List All', isActive: (p) => p === '/reports' },
    { to: '/reports/activity', label: 'Activity Report', isActive: (p) => p.startsWith('/reports/activity') },
    { to: '/reports/custom', label: 'Custom Report', isActive: (p) => p.startsWith('/reports/custom') },
    // { to: '/reports/audit', label: 'Audit Report', isActive: (p) => p.startsWith('/reports/audit') }, // Audit feature — restore when needed
    { to: '/reports/depreciation', label: 'Depreciation Report', isActive: (p) => p.startsWith('/reports/depreciation') },
    { to: '/reports/licenses', label: 'License Report', isActive: (p) => p.startsWith('/reports/licenses') },
    { to: '/reports/maintenances', label: 'Asset Maintenance Report', isActive: (p) => p.startsWith('/reports/maintenances') },
    { to: '/reports/unaccepted', label: 'Unaccepted Assets', isActive: (p) => p.startsWith('/reports/unaccepted') },
    { to: '/reports/accessories', label: 'Accessory Report', isActive: (p) => p.startsWith('/reports/accessories') },
  ],
}

function resolveSection(pathname: string, search = ''): SectionKey | null {
  // Asset opened from an employee record should stay under People in the sidebar
  const from = new URLSearchParams(search).get('from')
  if (from === 'employee' && pathname.startsWith('/hardware')) return 'people'
  if (pathname.startsWith('/hardware') || pathname.startsWith('/maintenances')) return 'assets'
  if (pathname.startsWith('/employees') || pathname.startsWith('/users')) return 'people'
  if (pathname.startsWith('/spaces')) return 'spaces'
  if (
    pathname.startsWith('/companies')
    || pathname.startsWith('/departments')
    || pathname.startsWith('/locations')
    || pathname.startsWith('/suppliers')
    || pathname.startsWith('/models')
    || pathname.startsWith('/asset-types')
    || pathname.startsWith('/manufacturers')
  ) return 'masters'
  if (
    pathname.startsWith('/settings')
    || pathname.startsWith('/categories')
    || pathname.startsWith('/statuslabels')
    || pathname.startsWith('/fields')
    || pathname.startsWith('/depreciations')
  ) return 'settings'
  if (pathname.startsWith('/reports')) return 'reports'
  return null
}

/**
 * Section tabs navigate between list / filter views.
 * Hide them on create, edit, and single-record view pages.
 */
function shouldShowSectionTabs(pathname: string): boolean {
  if (pathname.startsWith('/reports')) return true

  const listRoutes = [
    /^\/hardware\/?$/,
    // /^\/hardware\/audit\/due\/?$/, // Audit feature — restore when needed
    /^\/hardware\/eol\/due\/?$/,
    /^\/hardware\/checkins\/due\/?$/,
    /^\/hardware\/quickscancheckin\/?$/,
    /^\/hardware\/bulkcheckout\/?$/,
    // /^\/hardware\/bulkaudit\/?$/, // Audit feature — restore when needed
    /^\/hardware\/history\/?$/,
    /^\/maintenances\/?$/,
    /^\/employees\/?$/,
    /^\/employees\/import\/?$/,
    /^\/users\/?$/,
    /^\/spaces\/?$/,
    /^\/companies\/?$/,
    /^\/departments\/?$/,
    /^\/locations\/?$/,
    /^\/suppliers\/?$/,
    /^\/models\/?$/,
    /^\/asset-types\/?$/,
    /^\/manufacturers\/?$/,
    /^\/settings\/?$/,
    /^\/settings\/battery\/?$/,
    /^\/settings\/roles\/?$/,
    /^\/settings\/notifications\/?$/,
    /^\/settings\/email-logs\/?$/,
    /^\/categories\/?$/,
    /^\/statuslabels\/?$/,
    /^\/fields\/?$/,
    /^\/depreciations\/?$/,
  ]
  return listRoutes.some((re) => re.test(pathname))
}

function SectionTabs({ section }: { section: SectionKey }) {
  const location = useLocation()
  const { activeDomain } = useAuth()
  const tabs = SECTION_TABS[section].filter((t) => (
    t.to !== '/reports/licenses' || softwareLicensesInDomain(activeDomain)
  ))
  const search = location.search

  // Use Link (not NavLink): RR matches /hardware?* by pathname only and would
  // mark List All + Assigned + In Stock + … all "active" at once.
  const statusTabs = tabs.filter((t) => t.group === 'status')
  const toolTabs = tabs.filter((t) => t.group === 'tools')
  const plainTabs = tabs.filter((t) => !t.group)
  const renderTab = (tab: SectionTab) => {
    const active = tab.isActive(location.pathname, search)
    return (
      <Link
        key={tab.to + tab.label}
        to={tab.to}
        className={active ? 'active' : undefined}
        aria-current={active ? 'page' : undefined}
      >
        {tab.label}
      </Link>
    )
  }

  return (
    <nav className="section-tabs" aria-label="Section">
      <div className="section-tabs-track">
        {statusTabs.length > 0 ? (
          <>
            <div className="section-tabs-group">{statusTabs.map(renderTab)}</div>
            {toolTabs.length > 0 ? <span className="section-tabs-divider" aria-hidden /> : null}
            <div className="section-tabs-group">{toolTabs.map(renderTab)}</div>
          </>
        ) : (
          plainTabs.map(renderTab)
        )}
      </div>
    </nav>
  )
}

function RefexOneShell() {
  return (
    <div className="refexone-shell">
      <button type="button" className="refexone-shell-back" onClick={() => goToRefexOne()} title="Back to RefexOne">
        <i className="fas fa-arrow-left" aria-hidden="true" />
        <span className="refexone-shell-titles">
          <strong>RefexOne</strong>
          <small>Application</small>
        </span>
      </button>
      <button
        type="button"
        className="refexone-shell-refresh"
        onClick={() => window.location.reload()}
        title="Reload this page"
      >
        <i className="fas fa-sync-alt" aria-hidden="true" />
        <span>Refresh</span>
      </button>
    </div>
  )
}

export default function AppLayout({ children, title, subtitle, hideHeader, scene, backTo, backLabel, onBack }: Props) {
  const navRef = useRef<HTMLElement>(null)
  const [userOpen, setUserOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [tag, setTag] = useState('')
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout, can, isAdmin, domainScope, activeDomain, setActiveDomain } = useAuth()
  const showLicenses = can('licenses.view') && softwareLicensesInDomain(activeDomain)
  const displayName = user ? `${user.first_name} ${user.last_name}`.trim() : 'Admin User'
  const designation = String(user?.hrms_designation || '').trim()
  const section = resolveSection(location.pathname, location.search)
  const showSectionTabs = Boolean(
    section
    && shouldShowSectionTabs(location.pathname)
    && !(new URLSearchParams(location.search).get('from') === 'employee' && location.pathname.startsWith('/hardware')),
  )
  const activeScene = scene || resolveModuleScene(location.pathname, activeDomain)
  const headerVariant = resolveHeaderVariant(location.pathname)
  useEffect(() => {
    setUserOpen(false)
    setCreateOpen(false)
  }, [location.pathname, location.search])

  useEffect(() => {
    const t = window.setTimeout(() => AOS.refreshHard(), 40)
    return () => window.clearTimeout(t)
  }, [location.pathname, location.search, activeDomain])

  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const pill = nav.querySelector<HTMLElement>('.app-nav-pill')
    if (!pill) return
    const place = (animate: boolean) => {
      const active = nav.querySelector<HTMLElement>('a.active')
      if (!active) {
        pill.style.opacity = '0'
        return
      }
      const nextLeft = active.offsetLeft
      const nextWidth = active.offsetWidth
      const seen = pill.dataset.left != null
      const prevLeft = Number(pill.dataset.left ?? nextLeft)
      const prevWidth = Number(pill.dataset.width ?? nextWidth)
      pill.style.opacity = '1'
      if (!animate || !seen) {
        pill.style.transition = 'none'
        pill.style.transform = `translate3d(${nextLeft}px,0,0)`
        pill.style.width = `${nextWidth}px`
        pill.style.borderRadius = '10px'
      } else {
        const left = Math.min(prevLeft, nextLeft)
        const right = Math.max(prevLeft + prevWidth, nextLeft + nextWidth)
        const forward = nextLeft >= prevLeft
        pill.style.transition = 'none'
        pill.style.transform = `translate3d(${left}px,0,0)`
        pill.style.width = `${Math.max(right - left, nextWidth)}px`
        pill.style.borderRadius = forward ? '12px 22px 22px 12px' : '22px 12px 12px 22px'
        pill.getBoundingClientRect()
        pill.style.transition = 'transform 720ms cubic-bezier(.18,1.55,.32,1), width 720ms cubic-bezier(.18,1.55,.32,1), border-radius 720ms cubic-bezier(.2,1.2,.32,1)'
        pill.style.transform = `translate3d(${nextLeft}px,0,0)`
        pill.style.width = `${nextWidth}px`
        pill.style.borderRadius = '10px'
      }
      pill.dataset.left = String(nextLeft)
      pill.dataset.width = String(nextWidth)
      const viewLeft = nav.scrollLeft
      const viewRight = viewLeft + nav.clientWidth
      if (nextLeft < viewLeft + 8) nav.scrollLeft = Math.max(0, nextLeft - 12)
      else if (nextLeft + nextWidth > viewRight - 8) nav.scrollLeft = nextLeft + nextWidth - nav.clientWidth + 12
    }
    place(true)
    const onResize = () => place(false)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [location.pathname, location.search, section, showLicenses])

  useEffect(() => {
    if (softwareLicensesInDomain(activeDomain)) return
    if (location.pathname.startsWith('/licenses') || location.pathname.startsWith('/reports/licenses')) {
      navigate('/', { replace: true })
    }
  }, [activeDomain, location.pathname, navigate])

  const searchTag = (e: FormEvent) => {
    e.preventDefault()
    if (tag.trim()) navigate(`/hardware?q=${encodeURIComponent(tag.trim())}`)
  }

  return (
    <div className="wrapper has-refexone-shell">
      <RefexOneShell />
      <header className="main-header">
        <NavLink to="/" className="logo" aria-label={siteName}>
          <img src="/refexone-logo.png" alt={siteName} />
        </NavLink>
        <nav className="navbar">
          <form className="header-search" onSubmit={searchTag}>
            <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Search asset tag" />
            <button type="submit"><i className="fas fa-search" /></button>
          </form>
          {domainScope.all ? (
            <div className="domain-toggle" role="group" aria-label="IT or Admin assets">
              <button
                type="button"
                className={activeDomain === 'it' ? 'is-active' : ''}
                onClick={() => setActiveDomain('it')}
                aria-label="IT assets"
              >
                IT
              </button>
              <button
                type="button"
                className={activeDomain === 'admin' ? 'is-active' : ''}
                onClick={() => setActiveDomain('admin')}
                aria-label="Admin assets"
                title="Admin"
              >
                <span className="domain-toggle-full">Admin</span>
                <span className="domain-toggle-short" aria-hidden>Adm</span>
              </button>
            </div>
          ) : null}
          <div className="navbar-custom-menu">
            <ul className="navbar-nav">
              {can('assets.view') ? <li><NavLink to="/hardware" title="Assets"><i className="fas fa-barcode" /></NavLink></li> : null}
              {can('assets.view') ? <li><NavLink to="/labels" title="QR / Barcode"><i className="fas fa-qrcode" /></NavLink></li> : null}
              {showLicenses ? <li><NavLink to="/licenses" title="Licenses"><i className="fas fa-save" /></NavLink></li> : null}
              {can('accessories.view') ? <li><NavLink to="/accessories" title="Accessories"><i className="fas fa-keyboard" /></NavLink></li> : null}
              {can('consumables.view') ? <li><NavLink to="/consumables" title="Consumables"><i className="fas fa-tint" /></NavLink></li> : null}
              {can('components.view') ? <li><NavLink to="/components" title="Components"><i className="fas fa-hdd" /></NavLink></li> : null}
              {can('battery_issues.view') ? <li><NavLink to="/battery-issues" title="Battery Degradation"><i className="fas fa-battery-half" /></NavLink></li> : null}
              {can('people.view') ? <li><NavLink to="/employees" title="Employees"><i className="fas fa-id-badge" /></NavLink></li> : null}
              {can('people.view') ? <li><NavLink to="/users" title="App Users"><i className="fas fa-users" /></NavLink></li> : null}
              {(can('assets.create') || can('licenses.create') || can('people.create')) ? (
                <li className={`dropdown ${createOpen ? 'open' : ''}`}>
                  <button type="button" className="nav-icon-btn" onClick={() => setCreateOpen((o) => !o)}>
                    <i className="fas fa-plus" />
                  </button>
                  <div className="dropdown-menu">
                    {can('assets.create') ? <NavLink to="/hardware/create" onClick={() => setCreateOpen(false)}>Asset</NavLink> : null}
                    {showLicenses && can('licenses.create') ? <NavLink to="/licenses/create" onClick={() => setCreateOpen(false)}>License</NavLink> : null}
                    {can('accessories.create') ? <NavLink to="/accessories/create" onClick={() => setCreateOpen(false)}>Accessory</NavLink> : null}
                    {can('consumables.create') ? <NavLink to="/consumables/create" onClick={() => setCreateOpen(false)}>Consumable</NavLink> : null}
                    {can('components.create') ? <NavLink to="/components/create" onClick={() => setCreateOpen(false)}>Component</NavLink> : null}
                    {can('people.create') ? <NavLink to="/employees/create" onClick={() => setCreateOpen(false)}>Employee</NavLink> : null}
                    {can('people.create') ? <NavLink to="/users/create" onClick={() => setCreateOpen(false)}>App User</NavLink> : null}
                    {can('battery_issues.create') ? <NavLink to="/battery-issues/create" onClick={() => setCreateOpen(false)}>Battery issue</NavLink> : null}
                  </div>
                </li>
              ) : null}
              {isAdmin ? <li><NavLink to="/admin" title="Admin"><i className="fas fa-cog" /></NavLink></li> : null}
              <li className={`dropdown ${userOpen ? 'open' : ''}`}>
                <button type="button" className="nav-icon-btn nav-user-btn" onClick={() => setUserOpen((o) => !o)}>
                  <i className="fas fa-user" aria-hidden="true" />
                  <span className="nav-user-copy">
                    <span className="nav-user-name">{displayName}</span>
                    {designation ? <span className="nav-user-role">Logged in as {designation}</span> : null}
                  </span>
                </button>
                <div className="dropdown-menu">
                  {designation ? (
                    <div className="nav-user-menu-role">Logged in as {designation}</div>
                  ) : null}
                  <NavLink to="/account/profile" onClick={() => setUserOpen(false)}>Edit Profile</NavLink>
                  <NavLink to="/account/password" onClick={() => setUserOpen(false)}>Change Password</NavLink>
                  <div className="divider" />
                  <button type="button" onClick={logout}>Logout</button>
                </div>
              </li>
            </ul>
          </div>
        </nav>
      </header>

      <div className="content-wrapper" style={{ ['--page-scene' as string]: `url("${activeScene}")` }}>
        <div className="page-scene-wash" aria-hidden />
        <nav className="app-nav" aria-label="Sections" ref={navRef}>
          <span className="app-nav-pill" aria-hidden="true" />
          <NavLink to="/" end>Dashboard</NavLink>
          {can('assets.view') ? <NavLink to="/hardware" className={section === 'assets' ? 'active' : undefined}>Assets</NavLink> : null}
          {can('assets.view') ? <NavLink to="/labels">QR / Barcode</NavLink> : null}
          {showLicenses ? <NavLink to="/licenses">Licenses</NavLink> : null}
          {can('accessories.view') ? <NavLink to="/accessories">Accessories</NavLink> : null}
          {can('consumables.view') ? <NavLink to="/consumables">Consumables</NavLink> : null}
          {can('components.view') ? <NavLink to="/components">Components</NavLink> : null}
          {can('battery_issues.view') ? <NavLink to="/battery-issues">Battery</NavLink> : null}
          {can('people.view') ? <NavLink to="/employees" className={section === 'people' ? 'active' : undefined}>People</NavLink> : null}
          {can('settings.view') ? <NavLink to="/spaces" className={section === 'spaces' ? 'active' : undefined}>Spaces</NavLink> : null}
          {can('settings.view') ? <NavLink to="/companies" className={section === 'masters' ? 'active' : undefined}>Masters</NavLink> : null}
          {can('settings.edit') ? <NavLink to="/import">Import</NavLink> : null}
          {isAdmin ? <NavLink to="/settings" className={section === 'settings' ? 'active' : undefined}>Settings</NavLink> : null}
          {isAdmin ? <NavLink to="/reports" className={section === 'reports' ? 'active' : undefined}>Reports</NavLink> : null}
        </nav>
        {!hideHeader ? (
          headerVariant === 'form' ? (
            <section
              className="content-header content-header--form"
              style={{ ['--scene' as string]: `url("${activeScene}")` }}
              key={`h-${location.pathname}`}
              data-aos="fade-down"
            >
              <HeaderBubbles />
              <div className="content-header-copy">
                <ol className="breadcrumb breadcrumb--on-dark">
                  <li><NavLink to="/">Home</NavLink></li>
                  <li>{title}</li>
                </ol>
                {onBack || backTo ? (
                  <PageBack fallback={backTo || '/'} label={backLabel || 'Back'} onClick={onBack} />
                ) : null}
                <h1>{title}</h1>
                {subtitle ? <p className="content-kicker content-kicker--on-dark">{subtitle}</p> : null}
              </div>
            </section>
          ) : (
            <section
              className="content-header has-scene"
              style={{ ['--scene' as string]: `url("${activeScene}")` }}
              key={`h-${location.pathname}`}
              data-aos="fade-down"
            >
              <HeaderBubbles />
              <div className="content-header-copy">
                {onBack || backTo ? (
                  <PageBack fallback={backTo || '/'} label={backLabel || 'Back'} onClick={onBack} />
                ) : null}
                {subtitle ? <p className="content-kicker">{subtitle}</p> : null}
                <h1>{title}</h1>
              </div>
              <ol className="breadcrumb">
                <li><NavLink to="/">Home</NavLink></li>
                <li>{title}</li>
              </ol>
            </section>
          )
        ) : null}
        {showSectionTabs && section ? <SectionTabs section={section} /> : null}
        <section className={`content${hideHeader ? ' content--flush' : ''}`} key={`c-${location.pathname}`}>{children}</section>
      </div>

      <footer className="main-footer">
        <strong>Copyright &copy; {new Date().getFullYear()} {siteName}.</strong> Asset Management.
      </footer>
    </div>
  )
}
