import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

export type CaptureMediaItem = {
  key: string
  src: string
  isVideo?: boolean
  caption?: string
  coords?: string | null
}

type ThumbProps = {
  item: CaptureMediaItem
  onOpen: () => void
}

export function CaptureThumb({ item, onOpen }: ThumbProps) {
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setReady(false)
    setFailed(false)
  }, [item.src])

  return (
    <button
      type="button"
      className={`qr-capture-thumb${item.isVideo ? ' qr-capture-thumb--video' : ''}`}
      onClick={onOpen}
      aria-label={item.isVideo ? 'Play full video' : 'View full photo'}
    >
      {!ready && !failed ? <span className="qr-capture-card__ph">Loading…</span> : null}
      {failed ? <span className="qr-capture-card__ph">Unavailable</span> : null}
      {item.isVideo ? (
        <video
          src={item.src}
          muted
          playsInline
          preload="metadata"
          className={ready ? 'is-ready' : ''}
          onLoadedMetadata={() => setReady(true)}
          onError={() => setFailed(true)}
        />
      ) : (
        <img
          src={item.src}
          alt=""
          decoding="async"
          className={ready ? 'is-ready' : ''}
          onLoad={() => setReady(true)}
          onError={() => setFailed(true)}
        />
      )}
      {item.isVideo && ready ? <span className="qr-capture-thumb__play" aria-hidden>▶</span> : null}
    </button>
  )
}

type LightboxProps = {
  items: CaptureMediaItem[]
  index: number
  onClose: () => void
  onIndex: (index: number) => void
}

export function CaptureLightbox({ items, index, onClose, onIndex }: LightboxProps) {
  const item = items[index]
  const hasMany = items.length > 1

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && hasMany) onIndex((index - 1 + items.length) % items.length)
      if (e.key === 'ArrowRight' && hasMany) onIndex((index + 1) % items.length)
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [hasMany, index, items.length, onClose, onIndex])

  if (!item || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="qr-capture-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Full capture preview"
      onClick={onClose}
    >
      <button type="button" className="qr-capture-lightbox__close" aria-label="Close preview" onClick={onClose}>
        ×
      </button>
      {hasMany ? (
        <>
          <button
            type="button"
            className="qr-capture-lightbox__nav qr-capture-lightbox__nav--prev"
            aria-label="Previous capture"
            onClick={(e) => {
              e.stopPropagation()
              onIndex((index - 1 + items.length) % items.length)
            }}
          >
            ‹
          </button>
          <button
            type="button"
            className="qr-capture-lightbox__nav qr-capture-lightbox__nav--next"
            aria-label="Next capture"
            onClick={(e) => {
              e.stopPropagation()
              onIndex((index + 1) % items.length)
            }}
          >
            ›
          </button>
        </>
      ) : null}
      <div className="qr-capture-lightbox__stage" onClick={(e) => e.stopPropagation()}>
        {item.isVideo ? (
          <video src={item.src} controls autoPlay playsInline preload="metadata" />
        ) : (
          <img src={item.src} alt={item.caption || 'Capture'} />
        )}
        {item.caption || item.coords ? (
          <p className="qr-capture-lightbox__cap">
            {item.caption}
            {item.coords ? ` · ${item.coords}` : ''}
          </p>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
