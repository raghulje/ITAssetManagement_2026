/**
 * High-accuracy device GPS for mobile + desktop browsers.
 * Lat/lng always come from the device (or EXIF) — never from reverse-geocode centroids.
 */

export type PrecisePosition = {
  latitude: number
  longitude: number
  accuracyM: number
  altitude: number | null
  capturedAt: Date
  source?: 'device' | 'exif' | 'cached'
}

export type LocationPermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported' | 'insecure'

type ReadOpts = {
  targetAccuracyM?: number
  timeoutMs?: number
  maximumAgeMs?: number
  enableHighAccuracy?: boolean
}

function toPrecise(pos: GeolocationPosition, source: PrecisePosition['source'] = 'device'): PrecisePosition {
  return {
    latitude: pos.coords.latitude,
    longitude: pos.coords.longitude,
    accuracyM: pos.coords.accuracy,
    altitude: pos.coords.altitude,
    capturedAt: new Date(pos.timestamp || Date.now()),
    source,
  }
}

export function isGeolocationAvailable(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.geolocation)
}

/** Geolocation requires a secure context (HTTPS or localhost). */
export function isSecureGeoContext(): boolean {
  if (typeof window === 'undefined') return false
  if (window.isSecureContext) return true
  // Some LAN http://10.x hosts are used in field — browser will still block geo
  return false
}

export async function queryLocationPermission(): Promise<LocationPermissionState> {
  if (!isGeolocationAvailable()) return 'unsupported'
  if (!isSecureGeoContext()) return 'insecure'
  try {
    const perms = navigator.permissions
    if (!perms?.query) return 'prompt'
    const status = await perms.query({ name: 'geolocation' as PermissionName })
    if (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt') {
      return status.state
    }
    return 'prompt'
  } catch {
    return 'prompt'
  }
}

export function locationHelpMessage(state: LocationPermissionState): string {
  switch (state) {
    case 'denied':
      return 'Location is blocked. Open browser site settings → allow Location, then try again.'
    case 'insecure':
      return 'Location needs HTTPS (or localhost). Open the app via https:// so GPS can work on phone.'
    case 'unsupported':
      return 'This browser cannot share GPS. Try Chrome or Safari on your phone.'
    default:
      return 'Allow Location when prompted so each photo is GPS-stamped.'
  }
}

function sampleOnce(opts: {
  timeoutMs: number
  maximumAgeMs: number
  enableHighAccuracy: boolean
}): Promise<GeolocationPosition | null> {
  if (!navigator.geolocation) return Promise.resolve(null)
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      () => resolve(null),
      {
        enableHighAccuracy: opts.enableHighAccuracy,
        maximumAge: opts.maximumAgeMs,
        timeout: opts.timeoutMs,
      },
    )
  })
}

function sampleOnceDetailed(opts: {
  timeoutMs: number
  maximumAgeMs: number
  enableHighAccuracy: boolean
}): Promise<{ pos: GeolocationPosition | null; code?: number; message?: string }> {
  if (!navigator.geolocation) return Promise.resolve({ pos: null, message: 'unsupported' })
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ pos }),
      (err) => resolve({ pos: null, code: err.code, message: err.message }),
      {
        enableHighAccuracy: opts.enableHighAccuracy,
        maximumAge: opts.maximumAgeMs,
        timeout: opts.timeoutMs,
      },
    )
  })
}

/**
 * Call from a user gesture (button tap) so mobile browsers show the permission prompt.
 */
export async function requestLocationAccess(): Promise<{
  ok: boolean
  position: PrecisePosition | null
  permission: LocationPermissionState
  message: string
}> {
  const permission = await queryLocationPermission()
  if (permission === 'unsupported' || permission === 'insecure') {
    return { ok: false, position: null, permission, message: locationHelpMessage(permission) }
  }
  if (permission === 'denied') {
    return { ok: false, position: null, permission, message: locationHelpMessage(permission) }
  }

  // High accuracy first (GPS), then network fallback — both from this gesture chain
  const hi = await sampleOnceDetailed({
    timeoutMs: 20000,
    maximumAgeMs: 0,
    enableHighAccuracy: true,
  })
  if (hi.pos) {
    return {
      ok: true,
      position: toPrecise(hi.pos),
      permission: 'granted',
      message: `GPS ±${Math.round(hi.pos.coords.accuracy)} m`,
    }
  }

  const soft = await sampleOnceDetailed({
    timeoutMs: 12000,
    maximumAgeMs: 60_000,
    enableHighAccuracy: false,
  })
  if (soft.pos) {
    return {
      ok: true,
      position: toPrecise(soft.pos),
      permission: 'granted',
      message: `Approx. location ±${Math.round(soft.pos.coords.accuracy)} m`,
    }
  }

  const denied = hi.code === 1 || soft.code === 1
  const nextPerm: LocationPermissionState = denied ? 'denied' : permission
  return {
    ok: false,
    position: null,
    permission: nextPerm,
    message: denied
      ? locationHelpMessage('denied')
      : 'Could not get GPS yet. Stand outdoors / turn on Location services and try again.',
  }
}

export function readPrecisePosition(opts: ReadOpts = {}): Promise<PrecisePosition | null> {
  if (!navigator.geolocation) return Promise.resolve(null)
  if (!isSecureGeoContext()) return Promise.resolve(null)

  const targetAccuracyM = opts.targetAccuracyM ?? 20
  const timeoutMs = opts.timeoutMs ?? 18000
  const maximumAgeMs = opts.maximumAgeMs ?? 0
  const enableHighAccuracy = opts.enableHighAccuracy ?? true

  return new Promise((resolve) => {
    let best: GeolocationPosition | null = null
    let settled = false
    let watcher: number | null = null

    const finish = (pos: GeolocationPosition | null) => {
      if (settled) return
      settled = true
      try { watcher != null && navigator.geolocation.clearWatch(watcher) } catch { /* ignore */ }
      clearTimeout(timer)
      resolve(pos ? toPrecise(pos) : null)
    }

    const consider = (pos: GeolocationPosition) => {
      if (!best || pos.coords.accuracy < best.coords.accuracy) best = pos
      if (pos.coords.accuracy <= targetAccuracyM) finish(pos)
    }

    try {
      watcher = navigator.geolocation.watchPosition(
        consider,
        () => undefined,
        { enableHighAccuracy, maximumAge: maximumAgeMs, timeout: timeoutMs },
      )
    } catch {
      watcher = null
    }

    void sampleOnce({ timeoutMs, maximumAgeMs, enableHighAccuracy }).then((pos) => {
      if (pos) consider(pos)
    })

    const timer = setTimeout(async () => {
      if (best) {
        finish(best)
        return
      }
      const soft = await sampleOnce({
        timeoutMs: 8000,
        maximumAgeMs: 60_000,
        enableHighAccuracy: false,
      })
      finish(soft || best)
    }, timeoutMs)
  })
}

/** Prefer any existing position; otherwise take a fresh reading. */
export async function resolveCapturePosition(
  known?: PrecisePosition | null,
  opts?: ReadOpts,
): Promise<PrecisePosition | null> {
  if (known && Number.isFinite(known.latitude) && Number.isFinite(known.longitude)) {
    return known
  }
  return readPrecisePosition({
    targetAccuracyM: opts?.targetAccuracyM ?? 50,
    timeoutMs: opts?.timeoutMs ?? 15000,
    maximumAgeMs: opts?.maximumAgeMs ?? 30_000,
    enableHighAccuracy: opts?.enableHighAccuracy ?? true,
  })
}

export function preferNativePhoneCamera(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return true
  try {
    return window.matchMedia('(pointer: coarse) and (max-width: 900px)').matches
  } catch {
    return false
  }
}
