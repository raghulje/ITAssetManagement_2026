/** Click bursts from the P2P / VMS KPI cards. */

type FxVariant =
  | 'all'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'draft'
  | 'returned'
  | 'overdue'
  | 'ready'
  | 'payments'

function rectOf(el: HTMLElement) {
  return el.getBoundingClientRect()
}

function overlay(el: HTMLElement, className: string, html: string, ms = 1600) {
  const r = rectOf(el)
  const ov = document.createElement('div')
  ov.className = `fx-ov ${className}`
  ov.style.left = `${r.left}px`
  ov.style.top = `${r.top}px`
  ov.style.width = `${r.width}px`
  ov.style.height = `${r.height}px`
  ov.innerHTML = html
  document.body.appendChild(ov)
  window.setTimeout(() => ov.remove(), ms)
}

function pulse(el: HTMLElement, cls: string, ms = 700) {
  el.classList.add(cls)
  window.setTimeout(() => el.classList.remove(cls), ms)
}

function confetti(el: HTMLElement, n = 28) {
  const r = rectOf(el)
  const cx = r.left + r.width / 2
  const cy = r.top + r.height / 2
  const colors = ['#34d9a0', '#5fe0e6', '#ffbe55', '#ff7b8a', '#17a2b4', '#0f6b7a', '#2cc4d4']
  for (let i = 0; i < n; i += 1) {
    const p = document.createElement('i')
    p.className = 'fx-confetti'
    p.style.background = colors[i % colors.length]
    document.body.appendChild(p)
    const angle = (Math.PI * 2 * i) / n + Math.random() * 0.45
    const dist = 70 + Math.random() * 130
    const rot = 120 + Math.random() * 220
    p.animate(
      [
        { transform: `translate(${cx}px, ${cy}px) rotate(0deg)`, opacity: 1 },
        {
          transform: `translate(${cx + Math.cos(angle) * dist}px, ${cy + Math.sin(angle) * dist - 36}px) rotate(${rot}deg)`,
          opacity: 0,
        },
      ],
      { duration: 820 + Math.random() * 420, easing: 'cubic-bezier(.2,.7,.3,1)' },
    ).finished.then(() => p.remove()).catch(() => p.remove())
  }
}

function allFx(el: HTMLElement) {
  pulse(el, 'fx-bounce')
  overlay(el, '', '<span class="fx-all-glow"></span>', 1200)
  const r = rectOf(el)
  const cx = r.left + r.width / 2
  const cy = r.top + r.height / 2
  for (let i = 0; i < 5; i += 1) {
    const d = document.createElement('div')
    d.className = 'fx-doc'
    d.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2.5H7A2.5 2.5 0 0 0 4.5 5v14A2.5 2.5 0 0 0 7 21.5h10a2.5 2.5 0 0 0 2.5-2.5V8z"/><path d="M14 2.5V8h5.5"/></svg>'
    document.body.appendChild(d)
    const dx = (i - 2) * 28
    d.animate(
      [
        { transform: `translate(${cx - 19}px, ${cy - 10}px) rotate(0deg) scale(.6)`, opacity: 0 },
        { transform: `translate(${cx - 19 + dx}px, ${cy - 58}px) rotate(${dx * 0.4}deg) scale(1)`, opacity: 1, offset: 0.35 },
        { transform: `translate(${cx - 19 + dx}px, ${cy - 90}px) rotate(${dx * 0.55}deg) scale(.85)`, opacity: 0 },
      ],
      { duration: 1100, easing: 'cubic-bezier(.2,.8,.2,1)' },
    ).finished.then(() => d.remove()).catch(() => d.remove())
  }
}

function pendingFx(el: HTMLElement) {
  pulse(el, 'fx-breathe', 1350)
  overlay(
    el,
    'fx-pending',
    `<span class="fx-ring"></span><span class="fx-ring r2"></span><span class="fx-ring r3"></span>
     <div class="fx-clock">
       <svg viewBox="0 0 48 48"><circle class="face" cx="24" cy="24" r="16"/><line class="tick" x1="24" y1="10" x2="24" y2="13"/><line class="tick" x1="24" y1="35" x2="24" y2="38"/><line class="tick" x1="10" y1="24" x2="13" y2="24"/><line class="tick" x1="35" y1="24" x2="38" y2="24"/><line class="hand h" x1="24" y1="24" x2="24" y2="14"/><line class="hand m" x1="24" y1="24" x2="32" y2="24"/><circle class="pin" cx="24" cy="24" r="2.2"/></svg>
       <div class="fx-dots"><b></b><b></b><b></b></div>
     </div>`,
    1650,
  )
}

function rejectFx(el: HTMLElement) {
  pulse(el, 'fx-reject-shake', 650)
  const r = rectOf(el)
  const ring = document.createElement('div')
  ring.className = 'fx-reject-ring'
  ring.style.left = `${r.left}px`
  ring.style.top = `${r.top}px`
  ring.style.width = `${r.width}px`
  ring.style.height = `${r.height}px`
  document.body.appendChild(ring)
  window.setTimeout(() => ring.remove(), 850)

  const stamp = document.createElement('div')
  stamp.className = 'fx-reject-stamp'
  stamp.style.left = `${r.left + r.width / 2}px`
  stamp.style.top = `${r.top + r.height / 2}px`
  stamp.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path class="x1" d="M8 8l8 8"/><path class="x2" d="M16 8l-8 8"/></svg>NO'
  document.body.appendChild(stamp)
  window.setTimeout(() => stamp.remove(), 1450)
}

function draftFx(el: HTMLElement) {
  pulse(el, 'fx-bounce')
  overlay(
    el,
    '',
    `<div class="fx-sheet">
      <svg class="fx-lines" viewBox="0 0 134 84"><path class="l l1" d="M12 16h110"/><path class="l l2" d="M12 34h96"/><path class="l l3" d="M12 52h78"/></svg>
      <span class="fx-pen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></span>
      <i class="fx-spark s1">✦</i><i class="fx-spark s2">✦</i><i class="fx-spark s3">✦</i>
    </div>`,
    1750,
  )
}

function returnedFx(el: HTMLElement) {
  pulse(el, 'fx-nudge-back', 750)
  overlay(
    el,
    '',
    `<svg class="fx-uturn" viewBox="0 0 170 96"><path class="trail" d="M150 22 H70 a28 28 0 0 0 0 56 h70"/><path class="head" d="M86 64 l-18 14 18 14"/></svg>
     <i class="fx-wind w1"></i><i class="fx-wind w2"></i><i class="fx-wind w3"></i>`,
    1500,
  )
}

function overdueFx(el: HTMLElement) {
  pulse(el, 'fx-bounce')
  overlay(
    el,
    'fx-overdue',
    `<span class="fx-wave"></span><span class="fx-wave v2"></span><span class="fx-wave v3"></span>
     <div class="fx-alarm"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.5 1.5M4 5l3-2.5M20 5l-3-2.5"/></svg></div>`,
    1550,
  )
}

const CLICK_FX: Record<FxVariant, (el: HTMLElement) => void> = {
  all: allFx,
  pending_approval: pendingFx,
  approved: (el) => { pulse(el, 'fx-bounce'); confetti(el, 36) },
  rejected: rejectFx,
  draft: draftFx,
  returned: returnedFx,
  overdue: overdueFx,
  ready: (el) => { pulse(el, 'fx-bounce'); confetti(el, 36) },
  payments: (el) => { pulse(el, 'fx-bounce'); confetti(el, 30) },
}

export function fxVariantFromColor(color: string): FxVariant {
  if (color.includes('maroon') || color.includes('red')) return 'rejected'
  if (color.includes('orange') || color.includes('yellow')) return 'overdue'
  if (color.includes('green') || color.includes('olive')) return 'approved'
  if (color.includes('navy') || color.includes('purple')) return 'draft'
  if (color.includes('aqua')) return 'pending_approval'
  return 'all'
}

export function playKpiClick(variant: string, el: HTMLElement | null) {
  if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const run = CLICK_FX[variant as FxVariant] || allFx
  run(el)
}
