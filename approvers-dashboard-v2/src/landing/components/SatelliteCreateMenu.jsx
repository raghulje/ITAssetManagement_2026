import { useEffect, useState } from 'react'

const ACTIONS = [
    {
        key: 'travel',
        label: 'Travel Booking',
        color: '#1E88E5',
        to: '#42A5F5',
        soft: 'rgba(30,136,229,.28)',
        offset: '-42px',
        delay: '0ms',
    },
    {
        key: 'advance',
        label: 'Travel Advance',
        color: '#43A047',
        to: '#66BB6A',
        soft: 'rgba(67,160,71,.28)',
        offset: '0px',
        delay: '55ms',
    },
    {
        key: 'expense',
        label: 'Travel Expense',
        color: '#FB8C00',
        to: '#FFA726',
        soft: 'rgba(251,140,0,.28)',
        offset: '42px',
        delay: '110ms',
    },
]

function useCompactHero() {
    const [isCompact, setIsCompact] = useState(() =>
        typeof window !== 'undefined' ? window.innerWidth <= 860 : false
    )

    useEffect(() => {
        const media = window.matchMedia('(max-width: 860px)')
        const sync = () => setIsCompact(media.matches)
        sync()
        if (media.addEventListener) media.addEventListener('change', sync)
        else media.addListener(sync)
        return () => {
            if (media.removeEventListener) media.removeEventListener('change', sync)
            else media.removeListener(sync)
        }
    }, [])

    return isCompact
}

export default function SatelliteCreateMenu({ onCreate }) {
    const [isOpen, setIsOpen] = useState(false)
    const [hoveredKey, setHoveredKey] = useState('')
    const isCompact = useCompactHero()

    const closeMenu = () => {
        setIsOpen(false)
        setHoveredKey('')
    }

    const handleCreate = (key) => {
        onCreate?.(key)
        closeMenu()
    }

    if (isCompact) {
        return (
            <div className={`create-tray ${isOpen ? 'is-open' : ''}`}>
                <button
                    type="button"
                    className="create-tray-toggle"
                    aria-label={isOpen ? 'Close create menu' : 'Create a new request'}
                    aria-expanded={isOpen}
                    onClick={() => setIsOpen((open) => !open)}
                >
                    <i className={`ri-add-line ${isOpen ? 'is-open' : ''}`} aria-hidden="true" />
                    <span>{isOpen ? 'Close' : 'New request'}</span>
                </button>
                {isOpen ? (
                    <div className="create-tray-list" role="menu" aria-label="Create request">
                        {ACTIONS.map((action) => (
                            <button
                                key={action.key}
                                type="button"
                                role="menuitem"
                                className="create-tray-item"
                                style={{
                                    '--satellite-accent': action.color,
                                    '--satellite-accent-to': action.to,
                                }}
                                onClick={() => handleCreate(action.key)}
                            >
                                {action.label}
                            </button>
                        ))}
                    </div>
                ) : null}
            </div>
        )
    }

    return (
        <div
            className={`satellite-create ${isOpen ? 'is-open' : ''}`}
            onMouseEnter={() => setIsOpen(true)}
            onMouseLeave={closeMenu}
            onFocus={() => setIsOpen(true)}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) closeMenu()
            }}
        >
            <div className="satellite-orbit relative shrink-0">
                {ACTIONS.map((action) => {
                    const isHovered = hoveredKey === action.key
                    return (
                        <button
                            key={action.key}
                            type="button"
                            className="satellite-pill satellite-action absolute right-[18px] top-[42px] z-20 flex h-10 origin-right items-center whitespace-nowrap rounded-2xl text-left text-white"
                            style={{
                                '--satellite-accent': action.color,
                                '--satellite-accent-to': action.to,
                                '--satellite-soft': action.soft,
                                opacity: isOpen ? 1 : 0,
                                pointerEvents: isOpen ? 'auto' : 'none',
                                transform: isOpen
                                    ? `translate(-92px, ${action.offset}) scale(${isHovered ? 1.06 : 1})`
                                    : 'translate(0, 0) scale(.3)',
                                transitionDelay: isOpen ? action.delay : '0ms',
                            }}
                            onMouseEnter={() => setHoveredKey(action.key)}
                            onMouseLeave={() => setHoveredKey('')}
                            onClick={() => handleCreate(action.key)}
                        >
                            <span className="satellite-action-label">{action.label}</span>
                        </button>
                    )
                })}

                {isOpen ? (
                    <span className="pointer-events-none absolute right-[12px] top-9 h-14 w-14 animate-ping rounded-full border border-white/35" />
                ) : null}

                <button
                    type="button"
                    className="satellite-hub absolute right-[18px] top-[36px] z-30 flex h-12 w-12 items-center justify-center rounded-full text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    aria-label={isOpen ? 'Close create menu' : 'Open create menu'}
                    aria-expanded={isOpen}
                    onClick={() => setIsOpen((open) => !open)}
                >
                    <i
                        className="ri-add-line text-2xl"
                        aria-hidden="true"
                        style={{
                            transform: isOpen ? 'rotate(135deg)' : 'rotate(0deg)',
                            transition: 'transform .35s cubic-bezier(.34,1.56,.64,1)',
                        }}
                    />
                </button>
            </div>
        </div>
    )
}
