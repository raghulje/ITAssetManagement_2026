import exifr from 'exifr'
import type { PrecisePosition } from './preciseLocation'

/** Read GPS embedded by the phone camera (common after native capture + tick). */
export async function readGpsFromImageFile(file: File): Promise<PrecisePosition | null> {
  try {
    const gps = await exifr.gps(file)
    if (!gps) return null
    const latitude = Number(gps.latitude)
    const longitude = Number(gps.longitude)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null
    return {
      latitude,
      longitude,
      accuracyM: 25,
      altitude: null,
      capturedAt: new Date(),
      source: 'exif',
    }
  } catch {
    return null
  }
}
