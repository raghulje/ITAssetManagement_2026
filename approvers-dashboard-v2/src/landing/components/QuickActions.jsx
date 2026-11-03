import { useState } from 'react'
import { kf } from '../../sdk/index.js'

const POPUPS = {
    expense: 'Popup_E4xarw8lLE',
    advance: 'Popup_J0C5lIdWCL',
    travel: 'Popup_rCILSrY8KF',
}

const actions = [
    {
        label: 'Create Travel Request',
        sub: 'Plan a business trip',
        icon: 'ri-flight-takeoff-line',
        actionType: 'popup',
        actionKey: 'travel',
        from: '#2879b6',
        to: '#3a9ad9',
        shadow: 'rgba(40,121,182,0.35)',
    },
    {
        label: 'Request Travel Advance',
        sub: 'Get funds before your trip',
        icon: 'ri-wallet-3-line',
        actionType: 'popup',
        actionKey: 'advance',
        from: '#7dc244',
        to: '#a3d96a',
        shadow: 'rgba(125,194,68,0.35)',
    },
    {
        label: 'Submit Travel Expense',
        sub: 'Add a new expense claim',
        icon: 'ri-add-circle-line',
        actionType: 'popup',
        actionKey: 'expense',
        from: '#ee6a31',
        to: '#f5924e',
        shadow: 'rgba(238,106,49,0.35)',
    },
    {
        label: 'View Pending Approvals',
        sub: 'Review awaiting items',
        icon: 'ri-checkbox-circle-line',
        actionType: 'page',
        from: '#235EAC',
        to: '#2879b6',
        shadow: 'rgba(35,94,172,0.3)',
    },
]

export default function QuickActions({ onPopupClosed } = {}) {
    const [hovered, setHovered] = useState(null)

    const markPopupOpened = () => {
        try {
            window.__KF_DASH_POPUP_SEQ__ = Number(window.__KF_DASH_POPUP_SEQ__ || 0) + 1
            window.__KF_DASH_POPUP_OPENED_AT__ = Date.now()
        } catch {
            // ignore
        }
    }

    const handleActionClick = async (action) => {
        if (action.actionType === 'popup') {
            const popupId = POPUPS[action.actionKey]
            if (!popupId) return
            try {
                markPopupOpened()
                kf.app.page.openPopup(popupId)
            } catch (e) {
                console.error('QuickActions openPopup failed', e)
                return
            }
            // Parent dashboard refreshes on focus/visibility regain.
            if (typeof onPopupClosed === 'function') setTimeout(() => onPopupClosed(), 1500)
            return
        }

        if (action.actionType === 'page') {
            const pendingApprovalsPageId = (await kf.app.getVariable('pending_approvals_page_id')) || (await kf.app.getVariable('approvals_page_id'))
            if (pendingApprovalsPageId) {
                kf.app.openPage(pendingApprovalsPageId)
            } else {
                kf.client.showInfo('Configure pending approvals page id variable to navigate.')
            }
        }
    }

    return (
        <div className="bg-white rounded-lg sm:rounded-2xl p-1.5 sm:p-4 lg:p-5 h-full" style={{ border: '1px solid #f0f0f0', boxShadow: '0 2px 20px rgba(0,0,0,0.04)' }}>
            <div className="flex items-center justify-between mb-2.5 sm:mb-4">
                <h3 className="text-[10px] sm:text-sm font-bold text-gray-800">Quick Actions</h3>
                <div className="w-5 h-5 sm:w-7 sm:h-7 flex items-center justify-center rounded-lg" style={{ background: '#f5f5f5' }}>
                    <i className="ri-flashlight-line text-gray-500 text-[9px] sm:text-sm" />
                </div>
            </div>

            <div className="space-y-1 sm:space-y-2">
                {actions.map((action, idx) => {
                    const isHovered = hovered === idx
                    return (
                        <button
                            key={action.label}
                            onMouseEnter={() => setHovered(idx)}
                            onMouseLeave={() => setHovered(null)}
                            onClick={() => handleActionClick(action)}
                            className="w-full flex items-center gap-1.5 sm:gap-3 px-1.5 sm:px-3 py-1 sm:py-2.5 rounded-md sm:rounded-xl text-left cursor-pointer relative overflow-hidden animate-fade-in-up"
                            style={{
                                border: isHovered ? `1px solid ${action.from}35` : '1px solid #f0f0f0',
                                background: isHovered ? `linear-gradient(135deg, ${action.from}0d 0%, ${action.to}07 100%)` : '#ffffff',
                                transform: isHovered ? 'translateY(-2px)' : 'translateY(0px)',
                                boxShadow: isHovered ? `0 8px 24px ${action.shadow}` : 'none',
                                transition: 'all 0.28s cubic-bezier(0.34, 1.56, 0.64, 1)',
                                animationDelay: `${idx * 80}ms`,
                            }}
                        >
                            <div
                                className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full"
                                style={{
                                    background: `linear-gradient(180deg, ${action.from}, ${action.to})`,
                                    opacity: isHovered ? 1 : 0,
                                    transform: isHovered ? 'scaleY(1)' : 'scaleY(0)',
                                    transformOrigin: 'center',
                                    transition: 'opacity 0.2s ease, transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)',
                                }}
                            />
                            <div
                                className="w-6 h-6 sm:w-9 sm:h-9 rounded-md sm:rounded-xl flex items-center justify-center flex-shrink-0"
                                style={{
                                    background: `linear-gradient(135deg, ${action.from}, ${action.to})`,
                                    boxShadow: isHovered ? `0 8px 22px ${action.shadow}` : `0 3px 10px ${action.shadow}`,
                                    transform: isHovered ? 'scale(1.18) rotate(-6deg)' : 'scale(1) rotate(0deg)',
                                    transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
                                }}
                            >
                                <i className={`${action.icon} text-white text-[10px] sm:text-base`} />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p
                                    className="text-[10px] sm:text-sm font-semibold truncate"
                                    style={{ color: isHovered ? action.from : '#111827', transition: 'color 0.2s ease' }}
                                >
                                    {action.label}
                                </p>
                                <p className="text-[8px] sm:text-xs text-gray-400 truncate mt-0.5">{action.sub}</p>
                            </div>
                            <div
                                className="w-4.5 h-4.5 sm:w-6 sm:h-6 flex items-center justify-center rounded-lg flex-shrink-0"
                                style={{
                                    background: isHovered ? `${action.from}18` : 'transparent',
                                    opacity: isHovered ? 1 : 0,
                                    transform: isHovered ? 'translateX(0px)' : 'translateX(10px)',
                                    transition: 'all 0.22s ease',
                                }}
                            >
                                <i className="ri-arrow-right-line text-[10px] sm:text-sm" style={{ color: action.from }} />
                            </div>
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
