import { useState, useEffect, useRef, useCallback } from 'react'
import { kf } from './../sdk/index.js'
import PendingApprovalsWidget from './components/PendingApprovalsWidget.jsx'
import RecordsPeriodPicker, { getEmptyPeriodState } from './components/RecordsPeriodPicker.jsx'
import SatelliteCreateMenu from './components/SatelliteCreateMenu.jsx'
import {
    flightIcon,
    customTravelBookingIcon,
    customTravelAdvanceIcon,
    customTravelExpenseIcon,
    customPendingRequestsIcon,
    customNearingSlaIcon,
    customSlaBreachedIcon,
    customExceptionIcon,
} from '../../../raghul_icons/index.js'

const APP_ID = 'Expense_and_Travel_Management_A00'
const EMPLOYEE_DASHBOARD_PAGE_ID = 'Employee_Dashboard_V2_A00'
const REPORT_PAGE_SIZE = 2000
const REPORT_MAX_PAGES = 15
const CREATE_POPUPS = {
    expense: 'Popup_E4xarw8lLE',
    advance: 'Popup_J0C5lIdWCL',
    travel: 'Popup_rCILSrY8KF',
}

/** Pending items per process — same reports as the pending-approvals widget */
const PENDING_COUNT_TABS = [
    { key: 'travel', processId: 'Travel_Management_A02', reportId: 'All_Items_A00' },
    { key: 'advance', processId: 'Advance_Payment_Request_Process_A01', reportId: 'ALL_ITEMS_WITH_TABLE_A00' },
    { key: 'expense', processId: 'Expense_Management_A03', reportId: 'All_Items_MK_A00' },
]

const EXCEPTION_COL = {
    expense: 'Column__hqtAn5Ntn',
    advance: 'Column_ke6yUOIhtC',
    travel: 'Column_9UVEZRstyf',
}

function isYesLike(raw) {
    if (raw === true) return true
    if (raw === false || raw == null || raw === '') return false
    if (typeof raw === 'number') return raw === 1
    const s = String(raw).trim().toLowerCase()
    return s === 'yes' || s === 'true' || s === '1'
}

const TAB_STATUS_VALUE = {
    expense: (row) => row?.['Column_ly2Y3J4L9f'] || row?.['Column_dfTTpYLnJ0'] || row?.['Column_-9Qj6UkJOI'],
    advance: (row) => row?.['Column_p9wbFBO6NA'] || row?.['Column_PdcYkpz3ei'],
    travel: (row) => row?.['Column_iujlmrkz00'] || row?.['Column_hx4B-_JQjZ'],
}

/** SLA deadlines per process (prefer explicit IDs; fallback to name-matching). */
const DEADLINE_COL_IDS = {
    // Same as widget `EMPTY_EXPENSE_FIELD_IDS.slaDeadline`
    expense: ['Column_KD_a7365Yi'],
    // Same as widget `ADVANCE_FIELD_IDS.slaDeadline`
    advance: ['Column_Wc-2EfDPkD'],
    // Same as widget `TRAVEL_FIELD_IDS.slaDeadline`
    travel: ['Column_3l8DHla3JD'],
}

/** How far ahead of the deadline counts as “nearing SLA” (still pending, not yet breached) */
const NEARING_SLA_MS = 48 * 60 * 60 * 1000

function isPendingStatus(text) {
    const s = String(text || '').toLowerCase()
    if (!s) return true
    if (s.includes('reject') || s.includes('cancel') || s.includes('complete') || s.includes('approve') || s.includes('booked') || s.includes('paid')) return false
    return s.includes('pending') || s.includes('progress') || s.includes('review') || s.includes('approval') || s.includes('desk')
}

function findDeadlineColumnId(columns) {
    const cols = columns || []
    const col = cols.find((c) => {
        const n = String(c?.Name || '').toLowerCase()
        if (/\bdeadline\b/.test(n)) return true
        if (n.includes('sla') && (n.includes('due') || n.includes('end') || n.includes('deadline'))) return true
        if (n.includes('due') && n.includes('date')) return true
        return false
    })
    return col?.Id || ''
}

function deadlineRawToMs(raw) {
    if (raw == null || raw === '') return NaN
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw > 1e12 ? raw : raw * 1000
    if (typeof raw === 'string') {
        const d = new Date(raw)
        return Number.isNaN(d.getTime()) ? NaN : d.getTime()
    }
    if (typeof raw === 'object') {
        const v = raw.Value ?? raw.value ?? raw.Text ?? raw.text ?? raw.Name ?? raw.name
        if (v != null && v !== raw) return deadlineRawToMs(v)
        const d = new Date(String(raw))
        return Number.isNaN(d.getTime()) ? NaN : d.getTime()
    }
    return NaN
}

function earliestDeadlineMsForRow(row, tabKey, fallbackDeadlineColId) {
    const ids = DEADLINE_COL_IDS?.[tabKey] || []
    let best = Number.POSITIVE_INFINITY

    for (const colId of ids) {
        const ms = deadlineRawToMs(row?.[colId])
        if (Number.isFinite(ms) && ms > 0 && ms < best) best = ms
    }

    if (fallbackDeadlineColId) {
        const ms = deadlineRawToMs(row?.[fallbackDeadlineColId])
        if (Number.isFinite(ms) && ms > 0 && ms < best) best = ms
    }

    return best === Number.POSITIVE_INFINITY ? NaN : best
}

const COUNT_UP_MS = 1100

function useCountUp(endValue, duration = COUNT_UP_MS) {
    const [display, setDisplay] = useState(0)
    const displayRef = useRef(0)

    useEffect(() => {
        const to = Number.isFinite(Number(endValue)) ? Math.round(Number(endValue)) : 0
        const from = displayRef.current
        let raf = 0
        const t0 = performance.now()
        const easeOutCubic = (t) => 1 - (1 - t) ** 3

        const step = (now) => {
            const t = Math.min(1, (now - t0) / duration)
            const v = from + (to - from) * easeOutCubic(t)
            const rounded = Math.round(v)
            setDisplay(rounded)
            displayRef.current = rounded
            if (t < 1) raf = requestAnimationFrame(step)
            else {
                displayRef.current = to
                setDisplay(to)
            }
        }
        raf = requestAnimationFrame(step)
        return () => cancelAnimationFrame(raf)
    }, [endValue, duration])

    return display
}

function AnimatedInt({ value, className, style }) {
    const n = useCountUp(value)
    return (
        <span className={className} style={style}>
            {n.toLocaleString('en-IN')}
        </span>
    )
}

const KPI_BRAND = {
    blue: '#1E88E5',
    orange: '#FB8C00',
    amberText: '#FB8C00',
    red: '#E53935',
    purple: '#7c3aed',
}

const COMPACT_CARD = {
    pending: {
        bg: '#f0f7ff',
        border: 'rgba(40, 121, 182, 0.2)',
        icon: customPendingRequestsIcon,
        valueColor: KPI_BRAND.blue,
    },
    nearing: {
        bg: '#fffbeb',
        border: 'rgba(217, 119, 6, 0.22)',
        icon: customNearingSlaIcon,
        valueColor: KPI_BRAND.amberText,
    },
    breached: {
        bg: '#fef2f2',
        border: 'rgba(220, 38, 38, 0.2)',
        icon: customSlaBreachedIcon,
        valueColor: KPI_BRAND.red,
    },
    exception: {
        bg: '#faf5ff',
        border: 'rgba(124, 58, 237, 0.18)',
        icon: customExceptionIcon,
        valueColor: KPI_BRAND.purple,
    },
}

const SUMMARY_FOCUS = {
    pending: { bucket: 'pending', processKey: null, label: 'Pending requests' },
    'pending-travel': { bucket: 'pending', processKey: 'travel', label: 'Pending · Travel Booking' },
    'pending-advance': { bucket: 'pending', processKey: 'advance', label: 'Pending · Travel Advance' },
    'pending-expense': { bucket: 'pending', processKey: 'expense', label: 'Pending · Travel Expense' },
    nearing: { bucket: 'nearing', processKey: null, label: 'Nearing SLA' },
    'nearing-travel': { bucket: 'nearing', processKey: 'travel', label: 'Nearing SLA · Travel Booking' },
    'nearing-advance': { bucket: 'nearing', processKey: 'advance', label: 'Nearing SLA · Travel Advance' },
    'nearing-expense': { bucket: 'nearing', processKey: 'expense', label: 'Nearing SLA · Travel Expense' },
    breached: { bucket: 'breached', processKey: null, label: 'SLA Breached' },
    'breached-travel': { bucket: 'breached', processKey: 'travel', label: 'SLA Breached · Travel Booking' },
    'breached-advance': { bucket: 'breached', processKey: 'advance', label: 'SLA Breached · Travel Advance' },
    'breached-expense': { bucket: 'breached', processKey: 'expense', label: 'SLA Breached · Travel Expense' },
    exception: { bucket: 'exception', processKey: null, label: 'Exception' },
    'exception-travel': { bucket: 'exception', processKey: 'travel', label: 'Exception · Travel Booking' },
    'exception-advance': { bucket: 'exception', processKey: 'advance', label: 'Exception · Travel Advance' },
    'exception-expense': { bucket: 'exception', processKey: 'expense', label: 'Exception · Travel Expense' },
}

function CompactSummaryCard({ title, values, variant, delayClass = '', activeKey = null, onSelect }) {
    const s = COMPACT_CARD[variant]
    const expense = values?.expense ?? 0
    const advance = values?.advance ?? 0
    const travel = values?.travel ?? 0
    const total = expense + advance + travel
    const breakdown = [
        { label: 'Booking', value: travel, icon: customTravelBookingIcon, processKey: 'travel' },
        { label: 'Advance', value: advance, icon: customTravelAdvanceIcon, processKey: 'advance' },
        { label: 'Expense', value: expense, icon: customTravelExpenseIcon, processKey: 'expense' },
    ]
    const cardActive = activeKey === variant || String(activeKey || '').startsWith(`${variant}-`)
    return (
        <div
            className={`summary-kpi-card min-w-0 animate-fade-in-up ${delayClass}${cardActive ? ' is-active' : ''}`}
            style={{
                '--summary-accent': s.valueColor,
                '--summary-border': s.border,
                background: `radial-gradient(ellipse 90% 85% at 0% 0%, ${s.bg} 0%, transparent 58%), radial-gradient(ellipse 65% 60% at 100% 100%, ${s.bg} 0%, transparent 54%), #fff`,
            }}
        >
            <div className="summary-kpi-head">
                <button
                    type="button"
                    className="summary-status-icon"
                    aria-label={`Filter ${title}`}
                    title={`Filter ${title}`}
                    onClick={() => onSelect?.(variant)}
                >
                    <span className="summary-icon-glow" />
                    <span className="summary-icon-shine" />
                    <img src={s.icon} alt="" />
                </button>
                <button
                    type="button"
                    className="summary-kpi-title"
                    onClick={() => onSelect?.(variant)}
                >
                    <p title={title}>{title}</p>
                    <span>Requires your attention</span>
                </button>
                <button
                    type="button"
                    className={`summary-total ${activeKey === variant ? 'is-active' : ''}`}
                    onClick={() => onSelect?.(variant)}
                >
                    <AnimatedInt value={total} />
                    <span>Total</span>
                </button>
            </div>

            <div className="summary-breakdown">
                {breakdown.map((item) => {
                    const itemKey = `${variant}-${item.processKey}`
                    const itemActive = activeKey === itemKey
                    return (
                        <button
                            type="button"
                            className={`summary-breakdown-item ${itemActive ? 'is-active' : ''}`}
                            key={item.label}
                            onClick={() => onSelect?.(itemKey)}
                        >
                            <img src={item.icon} alt="" aria-hidden="true" />
                            <div>
                                <span>{item.label}</span>
                                <AnimatedInt value={item.value} />
                            </div>
                        </button>
                    )
                })}
            </div>
        </div>
    )
}

function MobileWelcomeCard({
    greetingText,
    userName,
    scope,
    onScopeChange,
    onRefresh,
    createOpen,
    onToggleCreate,
    onCreate,
    period,
    onPeriodChange,
}) {
    return (
        <section className="mobile-welcome" aria-label="Welcome">
            <h1 className="mobile-welcome-title">
                {greetingText}, {userName}
            </h1>
            <div className="mobile-welcome-actions">
                <div className="mobile-welcome-scope" role="group" aria-label="Dashboard scope">
                    {[
                        { id: 'me', label: 'Me', color: '#1E88E5' },
                        { id: 'team', label: 'My team', color: '#43A047' },
                    ].map((opt) => (
                        <button
                            key={opt.id}
                            type="button"
                            className={`mobile-welcome-scope-btn${scope === opt.id ? ' is-active' : ''}`}
                            style={{ '--scope-accent': opt.color }}
                            onClick={() => onScopeChange(opt.id)}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
                <div className="mobile-welcome-tools">
                    <button
                        type="button"
                        className="mobile-welcome-icon-btn"
                        aria-label="Refresh dashboard"
                        onClick={onRefresh}
                    >
                        <i className="ri-refresh-line" aria-hidden="true" />
                    </button>
                    <RecordsPeriodPicker
                        variant="icon"
                        tone="light"
                        mode={period?.mode}
                        range={period?.range}
                        ranges={period?.ranges}
                        parts={period?.parts}
                        fyStartYear={period?.fyStartYear}
                        summaryLabel={period?.summaryLabel}
                        onChange={onPeriodChange}
                    />
                    <button
                        type="button"
                        className={`mobile-welcome-icon-btn${createOpen ? ' is-open' : ''}`}
                        aria-label={createOpen ? 'Close create menu' : 'Create a new request'}
                        aria-expanded={createOpen}
                        onClick={onToggleCreate}
                    >
                        <i className={`ri-add-line${createOpen ? ' is-open' : ''}`} aria-hidden="true" />
                    </button>
                </div>
            </div>
            {createOpen ? (
                <div className="mobile-welcome-creates" role="menu" aria-label="Create request">
                    {[
                        { key: 'travel', label: 'Travel Booking', color: '#1E88E5' },
                        { key: 'advance', label: 'Travel Advance', color: '#43A047' },
                        { key: 'expense', label: 'Travel Expense', color: '#FB8C00' },
                    ].map((action) => (
                        <button
                            key={action.key}
                            type="button"
                            role="menuitem"
                            className="mobile-welcome-create-item"
                            style={{ '--satellite-accent': action.color }}
                            onClick={() => onCreate?.(action.key)}
                        >
                            {action.label}
                        </button>
                    ))}
                </div>
            ) : null}
        </section>
    )
}

export function DefaultLandingComponent() {
    const [scope, setScope] = useState('team')
    const [createOpen, setCreateOpen] = useState(false)
    const [refreshNonce, setRefreshNonce] = useState(0)
    const [pendingCounts, setPendingCounts] = useState({
        expense: 0,
        advance: 0,
        travel: 0,
    })
    const [slaSummary, setSlaSummary] = useState({
        nearingSla: { expense: 0, advance: 0, travel: 0 },
        breachedSla: { expense: 0, advance: 0, travel: 0 },
        exception: { expense: 0, advance: 0, travel: 0 },
    })
    const [recordsFocus, setRecordsFocus] = useState(null)
    const [recordsPeriod, setRecordsPeriod] = useState(() => getEmptyPeriodState())
    const recordsSectionRef = useRef(null)
    const recordsPulseTimerRef = useRef(null)

    const userName = (kf && kf.user && kf.user.Name) || ''
    const accountId = kf?.account?._id
    const userId = String(kf?.user?._id || '').trim()

    /** Full user profile includes accurate `Company`; `kf.user.Company` may be empty — overwritten after `/user/2/...` fetch. */
    const [resolvedCompany, setResolvedCompany] = useState(() =>
        String(kf?.user?.Company || '').trim()
    )
    const companyDisplayName = resolvedCompany.trim() || 'Refex Group'

    useEffect(() => {
        if (!accountId || !userId || typeof kf?.api !== 'function') return
        let cancelled = false
        ;(async () => {
            try {
                const url = `/user/2/${accountId}/${userId}`
                const resp = await kf.api(url, {
                    method: 'GET',
                    headers: { Accept: 'application/json' },
                })
                const co = String(resp?.Company ?? '').trim()
                if (!cancelled && co) setResolvedCompany(co)
            } catch (e) {
                console.warn('[approvers-dashboard] User profile fetch failed', e)
            }
        })()
        return () => {
            cancelled = true
        }
    }, [accountId, userId])

    const appRoles = Array.isArray(kf?.user?.AppRoles)
        ? kf.user.AppRoles
        : Array.isArray(kf?.user?.Roles)
          ? kf.user.Roles
          : Array.isArray(kf?.user?.roles)
            ? kf.user.roles
            : []
    const currentRoleRaw = appRoles?.[0]
    const currentRoleName =
        typeof currentRoleRaw === 'string'
            ? currentRoleRaw
            : currentRoleRaw && typeof currentRoleRaw === 'object'
              ? currentRoleRaw.Name || currentRoleRaw.name || ''
              : ''
    const roleLower = String(currentRoleName).trim().toLowerCase()
    const hideExceptionCard = roleLower.includes('l1 manager') || roleLower.includes('l2 manager')

    const now = new Date()
    const currentDateLabel = now.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
    })
    const currentDateLabelShort = `${now.toLocaleDateString('en-US', { weekday: 'short' })} ${now.getDate()} ${now.toLocaleDateString('en-US', { month: 'short' })}`
    const hour = now.getHours()
    const greetingText = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : hour < 21 ? 'Good evening' : 'Good night'

    const openEmployeeDashboard = async () => {
        try {
            kf.app.openPage(EMPLOYEE_DASHBOARD_PAGE_ID)
        } catch (e) {
            console.error('Failed to open employee dashboard page', e)
        }
    }

    const handleScopeSwitch = async (nextScope) => {
        if (nextScope === 'me') {
            await openEmployeeDashboard()
            return
        }
        setScope('team')
    }

    const refreshAll = () => setRefreshNonce((n) => n + 1)

    const scrollToRecords = useCallback(() => {
        const align = () => {
            const el = recordsSectionRef.current
            if (!el) return
            const root =
                typeof document !== 'undefined'
                    ? document.querySelector('.rootDiv') || null
                    : null
            const offset = 16
            if (root) {
                const top =
                    el.getBoundingClientRect().top -
                    root.getBoundingClientRect().top +
                    root.scrollTop -
                    offset
                root.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
                return
            }
            el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
        requestAnimationFrame(() => requestAnimationFrame(align))
    }, [])

    const clearRecordsFocus = useCallback(() => {
        setRecordsFocus(null)
        if (recordsPulseTimerRef.current) {
            clearTimeout(recordsPulseTimerRef.current)
            recordsPulseTimerRef.current = null
        }
    }, [])

    const handleSummarySelect = useCallback(
        (focusKey) => {
            const focus = SUMMARY_FOCUS[focusKey]
            if (!focus) return
            if (recordsFocus?.key === focusKey) {
                clearRecordsFocus()
                return
            }
            const token = Date.now()
            setRecordsFocus({ key: focusKey, token, pulse: true, ...focus })
            scrollToRecords()
            if (recordsPulseTimerRef.current) clearTimeout(recordsPulseTimerRef.current)
            recordsPulseTimerRef.current = setTimeout(() => {
                setRecordsFocus((prev) =>
                    prev?.token === token ? { ...prev, pulse: false } : prev,
                )
            }, 2400)
        },
        [clearRecordsFocus, recordsFocus?.key, scrollToRecords],
    )

    useEffect(
        () => () => {
            if (recordsPulseTimerRef.current) clearTimeout(recordsPulseTimerRef.current)
        },
        [],
    )

    const openCreatePopup = (type) => {
        const popupId = CREATE_POPUPS[type]
        if (!popupId || typeof kf?.app?.page?.openPopup !== 'function') {
            kf?.client?.showInfo?.('Unable to open the create form.')
            return
        }

        try {
            window.__KF_DASH_POPUP_SEQ__ = Number(window.__KF_DASH_POPUP_SEQ__ || 0) + 1
            window.__KF_DASH_POPUP_OPENED_AT__ = Date.now()
            const popup = kf.app.page.openPopup(popupId)
            if (popup && typeof popup.catch === 'function') {
                popup.catch((error) => {
                    console.error('Create popup failed', error)
                    kf?.client?.showInfo?.('Unable to open the create form.')
                })
            }
            setTimeout(refreshAll, 1500)
        } catch (error) {
            console.error('Create popup failed', error)
            kf?.client?.showInfo?.('Unable to open the create form.')
        }
    }

    useEffect(() => {
        const events = kf?.events || kf?.event
        if (!events || typeof events.on !== 'function') return

        const handle = () => refreshAll()
        try {
            events.on('afterTaskSave', handle)
            events.on('afterFormSubmit', handle)
            events.on?.('afterFormSave', handle)
            events.on?.('afterItemSave', handle)
        } catch (e) {
            console.warn('kf events subscription failed', e)
        }

        return () => {
            if (typeof events.off !== 'function') return
            try {
                events.off('afterTaskSave', handle)
                events.off('afterFormSubmit', handle)
                events.off?.('afterFormSave', handle)
                events.off?.('afterItemSave', handle)
            } catch {
                // ignore
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [accountId])

    useEffect(() => {
        let lastHandledSeq = Number(window.__KF_DASH_POPUP_SEQ__ || 0)
        const shouldHandle = () => {
            const seq = Number(window.__KF_DASH_POPUP_SEQ__ || 0)
            const openedAt = Number(window.__KF_DASH_POPUP_OPENED_AT__ || 0)
            if (!seq || seq === lastHandledSeq) return false
            if (!openedAt || Date.now() - openedAt > 10 * 60 * 1000) {
                lastHandledSeq = seq
                return false
            }
            lastHandledSeq = seq
            return true
        }

        const onFocus = () => {
            if (shouldHandle()) refreshAll()
        }
        const onVisibility = () => {
            if (document.visibilityState === 'visible' && shouldHandle()) refreshAll()
        }

        window.addEventListener('focus', onFocus)
        document.addEventListener('visibilitychange', onVisibility)
        return () => {
            window.removeEventListener('focus', onFocus)
            document.removeEventListener('visibilitychange', onVisibility)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        // Summary now comes from PendingApprovalsWidget (My Tasks list),
        // so cards match widget counts exactly.
    }, [accountId, refreshNonce])

    return (
        <div className="min-h-screen bg-gray-50 overflow-y-auto">
            <div className="p-2.5 sm:p-4 lg:p-6">
                <MobileWelcomeCard
                    greetingText={greetingText}
                    userName={userName}
                    scope={scope}
                    onScopeChange={handleScopeSwitch}
                    onRefresh={refreshAll}
                    createOpen={createOpen}
                    onToggleCreate={() => setCreateOpen((open) => !open)}
                    onCreate={(key) => {
                        setCreateOpen(false)
                        openCreatePopup(key)
                    }}
                    period={recordsPeriod}
                    onPeriodChange={setRecordsPeriod}
                />
                <div
                    className="travel-hero rounded-xl sm:rounded-2xl mb-2.5 sm:mb-6 relative animate-fade-in-up border border-white/80"
                    style={{ background: 'radial-gradient(circle at 72% 10%, rgba(255,255,255,0.18), transparent 28%), linear-gradient(105deg, #2f87c8 0%, #51a6d8 58%, #7dbfe4 100%)' }}
                >
                    <div className="travel-hero-art" aria-hidden="true">
                        <span className="travel-cloud travel-cloud-one" />
                        <span className="travel-cloud travel-cloud-two" />
                        <span className="travel-cloud travel-cloud-three" />
                        <svg className="travel-flight-path" viewBox="0 0 250 60">
                            <path d="M4 43 C48 4, 82 52, 121 22 S190 12, 222 32" />
                        </svg>
                        <img className="travel-hero-plane" src={flightIcon} alt="" />
                        <span className="travel-hero-quote">“New places.<br />Greater possibilities.”</span>
                    </div>

                    <div className="travel-hero-content relative z-10">
                        <div className="travel-hero-main">
                            <div className="travel-hero-head">
                                <span className="travel-hero-date">
                                    <span className="travel-hero-date-short">{currentDateLabelShort}</span>
                                    <span className="travel-hero-date-long">{currentDateLabel}</span>
                                </span>
                                <div
                                    className="travel-hero-scope travel-hero-scope--bar inline-flex flex-shrink-0 gap-0.5 rounded-xl p-0.5"
                                    style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.12)' }}
                                    role="group"
                                    aria-label="Dashboard scope"
                                >
                                    {[
                                        { id: 'me', label: 'Me', short: 'Me' },
                                        { id: 'team', label: 'My Team', short: 'Team' },
                                    ].map((opt) => {
                                        const active = scope === opt.id
                                        return (
                                            <button
                                                key={`bar-${opt.id}`}
                                                type="button"
                                                onClick={() => handleScopeSwitch(opt.id)}
                                                className="travel-hero-scope-btn"
                                                style={
                                                    active
                                                        ? {
                                                              background: 'rgba(255,255,255,0.95)',
                                                              color: '#0D1F3C',
                                                              boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                                                          }
                                                        : {
                                                              background: 'transparent',
                                                              color: 'rgba(255,255,255,0.75)',
                                                          }
                                                }
                                            >
                                                <span className="travel-hero-scope-short">{opt.short}</span>
                                                <span className="travel-hero-scope-long">
                                                    {opt.id === 'team' ? <>My<br />Team</> : opt.label}
                                                </span>
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>
                            <div className="travel-hero-copy">
                                <h1 className="travel-hero-title">
                                    <span className="travel-hero-greeting">{greetingText}</span>
                                    <span className="travel-hero-name">{userName}! 👋</span>
                                </h1>
                                <p className="travel-hero-company">
                                    {companyDisplayName}
                                </p>
                            </div>
                        </div>

                        <div className="travel-hero-aside">
                            <div className="travel-hero-period">
                                <RecordsPeriodPicker
                                    variant="icon"
                                    tone="hero"
                                    mode={recordsPeriod.mode}
                                    range={recordsPeriod.range}
                                    ranges={recordsPeriod.ranges}
                                    parts={recordsPeriod.parts}
                                    fyStartYear={recordsPeriod.fyStartYear}
                                    summaryLabel={recordsPeriod.summaryLabel}
                                    onChange={setRecordsPeriod}
                                />
                            </div>
                            <SatelliteCreateMenu onCreate={openCreatePopup} />
                            <div
                                className="travel-hero-scope travel-hero-scope--aside inline-flex flex-shrink-0 gap-0.5 rounded-xl p-0.5"
                                style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.12)' }}
                                role="group"
                                aria-label="Dashboard scope"
                            >
                                {[
                                    { id: 'me', label: 'Me', short: 'Me' },
                                    { id: 'team', label: 'My Team', short: 'Team' },
                                ].map((opt) => {
                                    const active = scope === opt.id
                                    return (
                                        <button
                                            key={`aside-${opt.id}`}
                                            type="button"
                                            onClick={() => handleScopeSwitch(opt.id)}
                                            className="travel-hero-scope-btn"
                                            style={
                                                active
                                                    ? {
                                                          background: 'rgba(255,255,255,0.95)',
                                                          color: '#0D1F3C',
                                                          boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                                                      }
                                                    : {
                                                          background: 'transparent',
                                                          color: 'rgba(255,255,255,0.75)',
                                                      }
                                            }
                                        >
                                            <span className="travel-hero-scope-short">{opt.short}</span>
                                            <span className="travel-hero-scope-long">
                                                {opt.id === 'team' ? <>My<br />Team</> : opt.label}
                                            </span>
                                        </button>
                                    )
                                })}
                            </div>
                        </div>
                    </div>
                </div>

                <div className={`grid grid-cols-1 sm:grid-cols-2 ${hideExceptionCard ? 'lg:grid-cols-3' : 'lg:grid-cols-4'} gap-2 sm:gap-3 mb-4 sm:mb-6`}>
                    <CompactSummaryCard
                        title="Pending Requests"
                        values={pendingCounts}
                        variant="pending"
                        delayClass="delay-75"
                        activeKey={recordsFocus?.key}
                        onSelect={handleSummarySelect}
                    />
                    <CompactSummaryCard
                        title="Nearing SLA"
                        values={slaSummary.nearingSla}
                        variant="nearing"
                        delayClass="delay-100"
                        activeKey={recordsFocus?.key}
                        onSelect={handleSummarySelect}
                    />
                    <CompactSummaryCard
                        title="SLA Breached"
                        values={slaSummary.breachedSla}
                        variant="breached"
                        delayClass="delay-150"
                        activeKey={recordsFocus?.key}
                        onSelect={handleSummarySelect}
                    />
                    {!hideExceptionCard && (
                        <CompactSummaryCard
                            title="Exception"
                            values={slaSummary.exception}
                            variant="exception"
                            delayClass="delay-200"
                            activeKey={recordsFocus?.key}
                            onSelect={handleSummarySelect}
                        />
                    )}
                </div>

                <div ref={recordsSectionRef} className="animate-fade-in-up delay-500 scroll-mt-4">
                    <PendingApprovalsWidget
                        key={`pending-${refreshNonce}`}
                        onPopupClosed={refreshAll}
                        insightFilter={recordsFocus}
                        onClearInsight={clearRecordsFocus}
                        period={recordsPeriod}
                        onSummaryChange={({ pendingCounts: p, nearingSla, breachedSla, exception }) => {
                            if (p) setPendingCounts(p)
                            setSlaSummary({
                                nearingSla: nearingSla || { expense: 0, advance: 0, travel: 0 },
                                breachedSla: breachedSla || { expense: 0, advance: 0, travel: 0 },
                                exception: exception || { expense: 0, advance: 0, travel: 0 },
                            })
                        }}
                    />
                </div>
            </div>
        </div>
    )
}
