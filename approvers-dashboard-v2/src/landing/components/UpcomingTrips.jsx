import { useEffect, useState } from 'react'
import { kf } from '../../sdk/index.js'

function formatDate(dateString) {
    const date = new Date(dateString)
    if (Number.isNaN(date.getTime())) return '—'
    const day = date.getDate()
    const month = date.toLocaleString('default', { month: 'short' })

    let dayString = day.toString()
    if (day > 10 && day < 20) {
        dayString += 'th'
    } else {
        const lastDigit = day % 10
        switch (lastDigit) {
            case 1:
                dayString += 'st'
                break
            case 2:
                dayString += 'nd'
                break
            case 3:
                dayString += 'rd'
                break
            default:
                dayString += 'th'
        }
    }
    return `${dayString} ${month}`
}

function formatYear(dateString) {
    const date = new Date(dateString)
    if (Number.isNaN(date.getTime())) return ''
    return String(date.getFullYear())
}

export default function UpcomingTrips() {
    const [loading, setLoading] = useState(true)
    const [rows, setRows] = useState([])
    const [travelPageId, setTravelPageId] = useState('')
    const [fieldMap, setFieldMap] = useState({
        from: '',
        to: '',
        fromDate: '',
        toDate: '',
        description: '',
        mode: '',
    })

    useEffect(() => {
        const fetchData = async () => {
            try {
                const applicationId = kf?.app?._id
                const accountId = kf?.account?._id
                if (!applicationId || !accountId) return

                let travelProcessId = await kf.app.getVariable('travel_process_id')
                let upcomingReportId = await kf.app.getVariable('upcoming_travels_report_id')
                const tripsPage = await kf.app.getVariable('travels_page_id')
                setTravelPageId(tripsPage || '')

                if (!travelProcessId) {
                    const processList = await kf.api(`/flow/2/${accountId}/process?_application_id=${applicationId}`)
                    const travelProcess = (processList || []).find((item) => item?.Name === 'Travel Management')
                    travelProcessId = travelProcess?._id || ''
                    if (travelProcessId) await kf.app.setVariable('travel_process_id', travelProcessId)
                }

                if (!upcomingReportId && travelProcessId) {
                    const reports = await kf.api(`/flow/2/${accountId}/process/${travelProcessId}/report?_application_id=${applicationId}`)
                    const report = (reports || []).find((item) => item?.Name === 'Upcoming travels')
                    upcomingReportId = report?._id || ''
                    if (upcomingReportId) await kf.app.setVariable('upcoming_travels_report_id', upcomingReportId)
                }

                if (!travelProcessId || !upcomingReportId) {
                    setRows([])
                    setLoading(false)
                    return
                }

                const url = `/process-report/2/${accountId}/${travelProcessId}/${upcomingReportId}?_application_id=${applicationId}`
                const response = await kf.api(url)
                const columns = response?.Columns || []

                const colId = (fieldIds) => {
                    for (const fid of fieldIds) {
                        const id = columns.find((col) => col?.FieldId === fid)?.Id
                        if (id) return id
                    }
                    return ''
                }

                setFieldMap({
                    from: colId(['FS_From_City', 'Column_1qX1HxE34f', 'common_From']) || 'Column_1qX1HxE34f',
                    to: colId(['FS_To_City', 'Column_6VWxLVKxdg', 'common_To']) || 'Column_6VWxLVKxdg',
                    fromDate: colId(['FS_Departure_Date', 'Column_T7yk_UT6Hk', 'Common_from_date']) || 'Column_T7yk_UT6Hk',
                    toDate: columns.find((col) => col?.FieldId === 'Common_to_date')?.Id || '',
                    description: columns.find((col) => col?.FieldId === 'Purpose_of_Travel')?.Id || '',
                    mode: columns.find((col) => col?.FieldId === 'Mode_of_Transport')?.Id || '',
                })

                setRows(response?.Data || [])
            } catch (error) {
                console.error('Error fetching upcoming trips:', error)
                setRows([])
            } finally {
                setLoading(false)
            }
        }

        fetchData()
    }, [])

    const viewMoreTravels = () => {
        if (!travelPageId) return
        kf.app.openPage(travelPageId)
    }

    const topRows = rows.slice(0, 2)

    return (
        <div className="bg-white rounded-lg sm:rounded-2xl p-1.5 sm:p-4 lg:p-5" style={{ border: '1px solid #f0f0f0', boxShadow: '0 2px 20px rgba(0,0,0,0.04)' }}>
            <div className="flex items-center justify-between mb-2.5 sm:mb-4">
                <div className="flex items-center gap-2">
                    <h3 className="text-[10px] sm:text-sm font-bold text-gray-800">My upcoming travels</h3>
                </div>
                {rows.length > 2 && (
                    <button type="button" className="text-[9px] sm:text-xs font-medium hover:underline" style={{ color: '#2879b6' }} onClick={viewMoreTravels}>
                        View more
                    </button>
                )}
            </div>

            {loading ? (
                <div
                    className="animate-pulse space-y-3 rounded-xl p-3"
                    style={{
                        border: '1px solid #EEF2F7',
                        background: 'linear-gradient(135deg, #FAFCFF, #FFFFFF)',
                    }}
                >
                    {[0, 1].map((idx) => (
                        <div key={idx} className="rounded-xl border border-gray-100 p-3 flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-gray-200 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                                <div className="h-3 w-2/3 rounded bg-gray-200 mb-2" />
                                <div className="h-3 w-1/2 rounded bg-gray-100" />
                            </div>
                            <div className="w-16">
                                <div className="h-3 w-full rounded bg-gray-200 mb-2" />
                                <div className="h-3 w-2/3 rounded bg-gray-100 ml-auto" />
                            </div>
                        </div>
                    ))}
                </div>
            ) : topRows.length > 0 ? (
                <div className="space-y-1.5 sm:space-y-2.5">
                    {topRows.map((item, idx) => {
                        const fromVal = item?.[fieldMap.from] || '—'
                        const toVal = item?.[fieldMap.to] || '—'
                        const desc = item?.[fieldMap.description] || 'No description'
                        const mode = item?.[fieldMap.mode] || ''
                        const fromDateVal = item?.[fieldMap.fromDate]
                        const toDateVal = item?.[fieldMap.toDate]
                        const isPublicTransport = String(mode).toLowerCase() === 'public transport'

                        return (
                            <div
                                key={item?._id || idx}
                                className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3 p-1.5 sm:p-3 rounded-md sm:rounded-xl transition-all card-lift card-brand-glow animate-fade-in-up"
                                style={{
                                    border: '1px solid #f5f5f5',
                                    background: 'linear-gradient(135deg, #fafafa, #ffffff)',
                                    animationDelay: `${idx * 80}ms`,
                                    '--glow-color': 'rgba(40,121,182,0.45)',
                                }}
                            >
                                <div className="w-6 h-6 sm:w-9 sm:h-9 rounded-md sm:rounded-xl flex items-center justify-center text-white flex-shrink-0" style={{ background: 'linear-gradient(135deg, #2879b6, #1D9AD4)' }}>
                                    <i className={`${isPublicTransport ? 'ri-bus-line' : 'ri-train-line'} text-[10px] sm:text-base`} />
                                </div>

                                <div className="flex-1 min-w-0">
                                    <p className="text-[9px] sm:text-xs font-semibold text-gray-800 truncate">{`${fromVal} - ${toVal}`}</p>
                                    <p className="text-[8px] sm:text-xs text-gray-500 truncate mt-0.5">{desc}</p>
                                </div>

                                <div className="text-left sm:text-right flex-shrink-0 w-full sm:w-auto">
                                    <p className="text-[9px] sm:text-xs font-semibold text-gray-800">{`${formatDate(fromDateVal)} - ${formatDate(toDateVal)}`}</p>
                                    <p className="text-[8px] sm:text-xs text-gray-400">{formatYear(fromDateVal)}</p>
                                </div>
                            </div>
                        )
                    })}
                </div>
            ) : (
                <div className="rounded-xl p-6 text-center" style={{ border: '1px dashed #E4E7EC' }}>
                    <div className="mx-auto mb-2" style={{ width: 80, height: 80 }}>
                        <svg viewBox="0 0 120 120" width="80" height="80" aria-hidden="true">
                            <rect x="18" y="18" width="84" height="84" rx="18" fill="#F8FAFC" stroke="#E4E7EC" />
                            <path d="M34 72h52l-6-18H40l-6 18z" fill="#2879b6" opacity="0.18" />
                            <path d="M42 54h36v10H42z" fill="#2879b6" opacity="0.35" />
                            <circle cx="48" cy="74" r="4" fill="#94A3B8" />
                            <circle cx="72" cy="74" r="4" fill="#94A3B8" />
                        </svg>
                    </div>
                    <p className="text-sm font-semibold text-gray-800">No upcoming travels found</p>
                </div>
            )}
        </div>
    )
}
