/** Split workflow step text into parts (e.g. multiple steps joined with commas). */
function parseStepParts(raw) {
    if (raw === null || raw === undefined) return []
    const s = String(raw).trim()
    if (!s) return []
    return s
        .split(',')
        .map((p) => p.replace(/^["'\s]+|["'\s]+$/g, '').trim())
        .filter(Boolean)
}

/** Map step label to badge colors (order: specific → general). */
function stepVisual(label) {
    const t = String(label || '').toLowerCase()

    if (t.includes('rejected')) {
        return { bg: 'rgba(229,57,53,.1)', color: '#c62828', dot: '#E53935', border: 'rgba(229,57,53,.24)' }
    }
    if (t.includes('withdrawn')) {
        return { bg: 'rgba(241,245,249,.9)', color: '#475569', dot: '#64748b', border: 'rgba(148,163,184,.3)' }
    }
    if (t.includes('exception')) {
        return { bg: 'rgba(124,58,237,.09)', color: '#6d28d9', dot: '#7c3aed', border: 'rgba(124,58,237,.22)' }
    }
    if (t.includes('manager') || /\bl[123]\b/.test(t) || (t.includes('approval') && !t.includes('rejected'))) {
        return { process: true }
    }
    if (t.includes('complete') || (t.includes('approved') && !t.includes('approval')) || t.includes('paid') || t.includes('booked')) {
        return { bg: 'rgba(67,160,71,.1)', color: '#2e7d32', dot: '#43A047', border: 'rgba(67,160,71,.23)' }
    }
    if (t.includes('pending') || t.includes('submitted') || t.includes('review') || t.includes('progress') || t.includes('draft')) {
        return { bg: 'rgba(251,140,0,.1)', color: '#b86200', dot: '#FB8C00', border: 'rgba(251,140,0,.23)' }
    }
    return { process: true }
}

export default function CurrentStepBadges({ text, size = 'sm', accent = '#2879b6' }) {
    const parts = parseStepParts(text)
    const pad = size === 'sm' ? 'px-2 py-0.5' : 'px-2.5 py-1'
    const textClass = size === 'sm' ? 'text-[11px]' : 'text-xs'

    if (!parts.length) {
        return <span className={`${textClass} text-gray-400 font-medium`}>—</span>
    }

    return (
        <div className="workflow-step-list">
            {parts.map((label, i) => {
                const v = stepVisual(label)
                return (
                    <span
                        key={`${label}-${i}`}
                        className={`workflow-step-badge ${v.process ? 'is-process' : ''} ${textClass} ${pad}`}
                        style={{
                            '--step-bg': v.bg,
                            '--step-color': v.color,
                            '--step-dot': v.dot,
                            '--step-border': v.border,
                            '--step-accent': accent,
                        }}
                        title={label}
                    >
                        <span className="workflow-step-dot" />
                        {label}
                    </span>
                )
            })}
        </div>
    )
}
