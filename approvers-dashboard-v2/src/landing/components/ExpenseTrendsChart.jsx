import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useMemo, useState, useEffect } from 'react'
import { kf } from '../../sdk/index.js'

const APP_ID = 'Expense_and_Travel_Management_A00'
const PAGE_SIZE = 2000
const MAX_PAGES = 15
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const EXPENSE_REPORT = {
    processId: 'Expense_Management_A03',
    reportId: 'All_Items_Power_BI_A00',
    dateColId: 'Column_Q3pwSWdDMB',
    amountColId: 'Column_YurZEJAmpg',
}

const ADVANCE_REPORT = {
    processId: 'Advance_Payment_Request_Process_A01',
    reportId: 'ALL_ITEMS_WITH_TABLE_A00',
    dateColId: 'Column_RmtnLwNoFB',
    amountColId: 'Column_rMCWa-_7NO',
}

const TRAVEL_REPORT = {
    processId: 'Travel_Management_A02',
    reportId: 'All_Items_A00',
    dateColId: 'Column_nkXmq53c-i',
    amountColId: 'Column_TamP5ek9Lg',
}

function buildListUrl({ accountId, processId, reportId, pageNumber }) {
    const params = new URLSearchParams()
    params.set('_application_id', APP_ID)
    params.set('$status', 'Completed')
    params.set('page_number', String(pageNumber))
    params.set('page_size', String(PAGE_SIZE))
    return `/process-report/2/${accountId}/${processId}/${reportId}?${params.toString()}`
}

function parseAmount(raw) {
    if (raw === null || raw === undefined || raw === '') return 0
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0
    if (typeof raw === 'string') {
        const m = raw.match(/-?\d+(\.\d+)?/)
        return m ? Number(m[0]) || 0 : 0
    }
    if (typeof raw === 'object') {
        const v = raw?.value ?? raw?.Value ?? raw?.amount ?? raw?.Amount
        return parseAmount(v)
    }
    return 0
}

function monthIndexFromDate(raw) {
    if (raw === null || raw === undefined || raw === '') return null

    const n = Number(raw)
    if (!Number.isNaN(n) && n >= 1 && n <= 12) return n - 1

    const d = new Date(raw)
    if (!Number.isNaN(d.getTime())) return d.getMonth()

    if (typeof raw === 'string' && raw.includes('-')) {
        const parts = raw.split('-')
        if (parts.length === 3) {
            const mm = Number(parts[1])
            if (!Number.isNaN(mm) && mm >= 1 && mm <= 12) return mm - 1
        }
    }

    if (typeof raw === 'string') {
        const idx = MONTHS.findIndex((m) => m.toLowerCase() === raw.trim().slice(0, 3).toLowerCase())
        if (idx >= 0) return idx
    }

    return null
}

async function fetchAllRows({ accountId, processId, reportId }) {
    const all = []
    for (let page = 1; page <= MAX_PAGES; page++) {
        const url = buildListUrl({ accountId, processId, reportId, pageNumber: page })
        const resp = await kf.api(url)
        const rows = resp?.Data || []
        if (!rows.length) break
        all.push(...rows)
        if (rows.length < PAGE_SIZE) break
    }
    return all
}

function sumByMonth(rows, dateColId, amountColId) {
    const totals = Array(12).fill(0)
    for (const r of rows) {
        const mi = monthIndexFromDate(r?.[dateColId])
        if (mi === null) continue
        totals[mi] += parseAmount(r?.[amountColId])
    }
    return totals.map((v) => Math.round(v * 100) / 100)
}

const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-white rounded-xl px-4 py-3 animate-scale-in" style={{ border: '1px solid #f0f0f0', boxShadow: '0 12px 40px rgba(0,0,0,0.12)' }}>
                <p className="text-xs font-semibold text-gray-500 mb-2">{label} 2026</p>
                {payload.map((p) => (
                    <div key={p.dataKey} className="flex items-center gap-2 mb-1 last:mb-0">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
                        <p className="text-xs text-gray-600">
                            {p.name}: <span className="font-bold" style={{ color: p.color }}>₹{p.value.toLocaleString('en-IN')}</span>
                        </p>
                    </div>
                ))}
            </div>
        )
    }
    return null
}

const ranges = [
    { label: 'Last Quarter', months: 3 },
    { label: 'Last 6 Months', months: 6 },
    { label: 'This Year', months: 12 },
]

const series = [
    { key: 'travel', name: 'Travel Booking', color: '#2879b6', gradId: 'blueGrad' },
    { key: 'advance', name: 'Travel Advance', color: '#7dc244', gradId: 'greenGrad' },
    { key: 'expense', name: 'Travel Expense', color: '#ee6a31', gradId: 'orangeGrad' },
]

export default function ExpenseTrendsChart() {
    const [activeRange, setActiveRange] = useState(0)

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

    const isFinanceApprover = roleLower.includes('finance') && roleLower.includes('approver')
    const isFinanceChecker = roleLower.includes('finance') && roleLower.includes('checker')
    const isTreasuryExecutive = roleLower.includes('treasury') && roleLower.includes('executive')
    const isTravelDesk = roleLower.includes('travel') && roleLower.includes('desk')

    const lockedHiddenKeys = isFinanceApprover || isFinanceChecker || isTreasuryExecutive ? ['travel'] : isTravelDesk ? ['expense', 'advance'] : []
    const seriesVisible = series.filter((s) => !lockedHiddenKeys.includes(s.key))
    const subtitle = `${seriesVisible.map((s) => s.name).join(' · ')} overview`

    const [hidden, setHidden] = useState([])
    const [expenseData, setExpenseData] = useState(Array(12).fill(0))
    const [advanceData, setAdvanceData] = useState(Array(12).fill(0))
    const [travelData, setTravelData] = useState(Array(12).fill(0))

    const toggle = (key) => setHidden((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))

    useEffect(() => {
        // Reset any user toggles when role-based visibility changes.
        setHidden([])
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lockedHiddenKeys.join('|')])

    useEffect(() => {
        const load = async () => {
            const accountId = kf?.account?._id
            if (!accountId) return

            let expTotals = Array(12).fill(0)
            let advTotals = Array(12).fill(0)
            let trvTotals = Array(12).fill(0)

            try {
                const expRows = await fetchAllRows({
                    accountId,
                    processId: EXPENSE_REPORT.processId,
                    reportId: EXPENSE_REPORT.reportId,
                })
                expTotals = sumByMonth(expRows, EXPENSE_REPORT.dateColId, EXPENSE_REPORT.amountColId)
            } catch (e) {
                console.warn('Expense fetch failed, showing zeros:', e)
            }

            try {
                const advRows = await fetchAllRows({
                    accountId,
                    processId: ADVANCE_REPORT.processId,
                    reportId: ADVANCE_REPORT.reportId,
                })
                advTotals = sumByMonth(advRows, ADVANCE_REPORT.dateColId, ADVANCE_REPORT.amountColId)
            } catch (e) {
                console.warn('Advance fetch failed, showing zeros:', e)
            }

            try {
                const trvRows = await fetchAllRows({
                    accountId,
                    processId: TRAVEL_REPORT.processId,
                    reportId: TRAVEL_REPORT.reportId,
                })
                trvTotals = sumByMonth(trvRows, TRAVEL_REPORT.dateColId, TRAVEL_REPORT.amountColId)
            } catch (e) {
                console.warn('Travel fetch failed, showing zeros:', e)
            }

            setExpenseData(expTotals)
            setAdvanceData(advTotals)
            setTravelData(trvTotals)
        }

        load()
        const stopWatching = kf?.context?.watchParams?.(() => {
            load()
        })

        return () => {
            if (typeof stopWatching === 'function') stopWatching()
        }
    }, [])

    const chartData = useMemo(() => {
        const selectedMonths = ranges[activeRange]?.months || 12
        const thisMonth = new Date().getMonth()

        const points = []
        for (let i = selectedMonths - 1; i >= 0; i--) {
            const monthIndex = (thisMonth - i + 12) % 12
            points.push({
                month: MONTHS[monthIndex],
                expense: expenseData[monthIndex] || 0,
                advance: advanceData[monthIndex] || 0,
                travel: travelData[monthIndex] || 0,
            })
        }
        return points
    }, [activeRange, expenseData, advanceData, travelData])

    return (
        <div className="bg-white rounded-lg sm:rounded-2xl p-1.5 sm:p-4 lg:p-5 h-full" style={{ border: '1px solid #f0f0f0', boxShadow: '0 2px 20px rgba(0,0,0,0.04)' }}>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 mb-2.5 sm:mb-4">
                <div>
                    <h3 className="text-[10px] sm:text-sm font-bold text-gray-800">Monthly Trends</h3>
                    <p className="text-[8px] sm:text-xs text-gray-400 mt-0.5">{subtitle}</p>
                </div>
                <div className="w-full sm:w-auto overflow-x-auto">
                <div className="inline-flex items-center gap-1 p-1 rounded-xl min-w-max" style={{ background: '#f5f5f5' }}>
                    {ranges.map((r, i) => (
                        <button
                            key={r.label}
                            onClick={() => setActiveRange(i)}
                            className="text-[8px] sm:text-xs font-medium px-1 sm:px-3 py-0.5 sm:py-1.5 rounded-lg transition-all cursor-pointer whitespace-nowrap"
                            style={
                                activeRange === i
                                    ? { background: '#2879b6', color: '#fff', boxShadow: '0 1px 4px rgba(40,121,182,0.3)' }
                                    : { color: '#9CA3AF' }
                            }
                        >
                            {r.label}
                        </button>
                    ))}
                </div>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 sm:gap-4 mb-2.5 sm:mb-4">
                {seriesVisible.map((s) => {
                    const isHidden = hidden.includes(s.key)
                    return (
                        <button
                            key={s.key}
                            onClick={() => toggle(s.key)}
                            className="flex items-center gap-1.5 cursor-pointer transition-opacity"
                            style={{ opacity: isHidden ? 0.35 : 1 }}
                        >
                            <span className="w-4 sm:w-8 h-1 rounded-full transition-all" style={{ background: isHidden ? '#d1d5db' : s.color }} />
                            <span className="text-[8px] sm:text-xs font-medium" style={{ color: isHidden ? '#9CA3AF' : '#374151' }}>
                                {s.name}
                            </span>
                        </button>
                    )
                })}
            </div>

            <ResponsiveContainer width="100%" height={155}>
                <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
                    <defs>
                        {seriesVisible.map((s) => (
                            <linearGradient key={s.gradId} id={s.gradId} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={s.color} stopOpacity={0.2} />
                                <stop offset="95%" stopColor={s.color} stopOpacity={0.01} />
                            </linearGradient>
                        ))}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F5F5F5" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${v / 1000}k`} />
                    <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#f0f0f0', strokeWidth: 1 }} />
                    {seriesVisible.map((s) => (
                        <Area
                            key={s.key}
                            type="monotone"
                            dataKey={s.key}
                            name={s.name}
                            stroke={s.color}
                            strokeWidth={hidden.includes(s.key) ? 0 : 2.5}
                            fill={`url(#${s.gradId})`}
                            fillOpacity={hidden.includes(s.key) ? 0 : 1}
                            dot={false}
                            activeDot={hidden.includes(s.key) ? false : { r: 5, strokeWidth: 2, stroke: '#fff', fill: s.color }}
                        />
                    ))}
                </AreaChart>
            </ResponsiveContainer>
        </div>
    )
}
