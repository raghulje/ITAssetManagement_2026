import { useEffect, useState } from 'react'

/** e.g. `16 Jul 2026, 11:27:25 AM` */
export function formatSlaDeadline(deadlineAtMsOrDate) {
    const d = new Date(deadlineAtMsOrDate)
    if (Number.isNaN(d.getTime())) return '—'
    const day = d.getDate()
    const month = d.toLocaleString('en-US', { month: 'short' })
    const year = d.getFullYear()
    const time = d.toLocaleString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
    })
    return `${day} ${month} ${year}, ${time}`
}

/**
 * Two-unit precision that shrinks with magnitude:
 * - seconds only → `30 sec`
 * - minutes      → `10m 12s`
 * - hours        → `12h 32m`
 * - days         → `1d 12h` (stops at hours; e.g. `120d 21h`)
 */
export function formatSlaCompactDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '0 sec'
    const totalSec = Math.floor(ms / 1000)
    const days = Math.floor(totalSec / 86400)
    const hours = Math.floor((totalSec % 86400) / 3600)
    const minutes = Math.floor((totalSec % 3600) / 60)
    const seconds = totalSec % 60

    if (days > 0) return `${days}d ${hours}h`
    if (hours > 0) return `${hours}h ${minutes}m`
    if (minutes > 0) return `${minutes}m ${seconds}s`
    return `${seconds} sec`
}

/** Green (≥24h) · Yellow (<24h) · Orange (<1h) · Red (breached). */
export function getSlaPillStyle(remainingMs, breached) {
    if (breached) {
        return { bg: 'rgba(229,57,53,.1)', color: '#c62828', dot: '#E53935', border: 'rgba(229,57,53,.24)' }
    }
    const hours = remainingMs / 3600000
    if (hours < 1) {
        return { bg: 'rgba(238,106,49,.12)', color: '#c45122', dot: '#ee6a31', border: 'rgba(238,106,49,.26)' }
    }
    if (hours < 24) {
        return { bg: 'rgba(251,140,0,.11)', color: '#b86200', dot: '#FB8C00', border: 'rgba(251,140,0,.24)' }
    }
    return { bg: 'rgba(67,160,71,.1)', color: '#2e7d32', dot: '#43A047', border: 'rgba(67,160,71,.23)' }
}

export default function SlaCell({ deadlineAtMs, deadlineLabel, size = 'sm' }) {
    const [, setTick] = useState(0)

    useEffect(() => {
        if (deadlineAtMs == null || !Number.isFinite(deadlineAtMs)) return undefined
        let timeoutId
        const schedule = () => {
            // Under an hour (either side) the display shows seconds, so tick every second; otherwise every 30s.
            const absDiff = Math.abs(deadlineAtMs - Date.now())
            const delay = absDiff < 3600000 ? 1000 : 30000
            timeoutId = setTimeout(() => {
                setTick((t) => t + 1)
                schedule()
            }, delay)
        }
        schedule()
        return () => clearTimeout(timeoutId)
    }, [deadlineAtMs])

    const pad = size === 'sm' ? 'px-2 py-0.5' : 'px-2.5 py-1'
    const textClass = size === 'sm' ? 'text-[10px]' : 'text-[11px]'

    const hasDeadlineMs = deadlineAtMs != null && Number.isFinite(deadlineAtMs)
    const deadlineText =
        deadlineLabel && deadlineLabel !== '—'
            ? deadlineLabel
            : hasDeadlineMs
              ? formatSlaDeadline(deadlineAtMs)
              : '—'

    if (!hasDeadlineMs && deadlineText === '—') {
        return <span className={`${textClass} text-gray-400 font-medium`}>—</span>
    }

    const now = Date.now()
    const breached = hasDeadlineMs && now > deadlineAtMs
    const diffMs = breached ? now - deadlineAtMs : hasDeadlineMs ? deadlineAtMs - now : 0
    const duration = formatSlaCompactDuration(diffMs)
    const pillText = breached ? `+${duration}` : `${duration} left`
    const pillStyle = getSlaPillStyle(diffMs, breached)

    return (
        <div className="sla-cell">
            <span className="sla-deadline">{deadlineText}</span>
            {hasDeadlineMs && (
                <span
                    className={`sla-pill ${textClass} ${pad}`}
                    style={{
                        '--sla-bg': pillStyle.bg,
                        '--sla-color': pillStyle.color,
                        '--sla-dot': pillStyle.dot,
                        '--sla-border': pillStyle.border,
                    }}
                    title={breached ? 'SLA breached' : 'Time remaining'}
                >
                    <span className="sla-dot" />
                    {pillText}
                </span>
            )}
        </div>
    )
}
