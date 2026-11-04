import { useId } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

/** One shared pill per toggle group. Two groups on a page must not reuse an id. */
export function useJellyGroup(name: string) {
  const id = useId()
  return `${name}-${id}`
}

const standardLayout = { type: 'spring' as const, stiffness: 177, damping: 15, mass: 0.9 }
const standardSquash = { type: 'spring' as const, stiffness: 121, damping: 7.5, mass: 0.6 }
const quickLayout = { type: 'spring' as const, stiffness: 430, damping: 31, mass: 0.72 }
const quickSquash = { type: 'spring' as const, stiffness: 347, damping: 20, mass: 0.6 }

type JellyPillProps = {
  group: string
  /** Corner radius in pixels so the pill stays round while it stretches. */
  radius: number
  /** Existing active fill for this control. */
  className: string
  /** `cover` paints over the option border. `line` is an underline tab indicator. */
  inset?: 'inset' | 'cover' | 'line'
  /** Shorter travel for pagination and long option rows. */
  quick?: boolean
}

export function JellyPill({
  group,
  radius,
  className,
  inset = 'inset',
  quick = false,
}: JellyPillProps) {
  const reduce = useReducedMotion()
  const insetClass = inset === 'cover' ? 'is-cover' : inset === 'line' ? 'is-line' : 'is-inset'
  if (reduce) {
    return (
      <motion.span
        aria-hidden
        className={`jelly-pill ${insetClass} ${className}`}
        style={{ borderRadius: radius }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.14 }}
      />
    )
  }
  const layout = quick ? quickLayout : standardLayout
  const squash = quick ? quickSquash : standardSquash
  return (
    <motion.span
      aria-hidden
      layoutId={group}
      className={`jelly-pill ${insetClass} ${className}`}
      style={{ borderRadius: radius }}
      initial={quick ? { scaleX: 1.04, scaleY: 0.94 } : { scaleX: 1.08, scaleY: 0.84 }}
      animate={{ scaleX: 1, scaleY: 1 }}
      transition={{ layout, scaleX: squash, scaleY: squash }}
    />
  )
}
