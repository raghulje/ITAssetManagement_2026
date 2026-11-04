import { forwardRef, type CSSProperties, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

const openSpring = { type: 'spring' as const, stiffness: 300, damping: 22, mass: 0.85 }
const closeEase = { duration: 0.16, ease: [0.4, 0, 1, 1] as [number, number, number, number] }

type MotionMenuProps = {
  origin?: 'top' | 'bottom'
  className?: string
  style?: CSSProperties
  children?: ReactNode
  id?: string
  role?: string
  'aria-label'?: string
}

/** Open/close motion for a menu that is already shown and hidden by the caller. */
export const MotionMenu = forwardRef<HTMLDivElement, MotionMenuProps>(function MotionMenu({
  origin = 'top',
  className,
  style,
  children,
  id,
  role,
  'aria-label': ariaLabel,
}, ref) {
  const reduce = useReducedMotion()
  const fromTop = origin !== 'bottom'
  const motionProps = reduce
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: 0.14 },
      }
    : {
        initial: { opacity: 0, scale: 0.92, y: fromTop ? -8 : 8 },
        animate: { opacity: 1, scale: 1, y: 0 },
        exit: {
          opacity: 0,
          scale: 0.96,
          y: fromTop ? -4 : 4,
          transition: closeEase,
        },
        transition: openSpring,
      }
  return (
    <motion.div
      ref={ref}
      id={id}
      role={role}
      aria-label={ariaLabel}
      className={className}
      style={{ ...style, transformOrigin: fromTop ? 'top center' : 'bottom center' }}
      {...motionProps}
    >
      {children}
    </motion.div>
  )
})
