import { Router } from 'express'
import { fail, okItem } from '../utils/response.js'

/**
 * Geocoding + map provider.
 * - GOOGLE_MAPS_API_KEY set → Google Places / Geocoding (Maps-style addresses)
 * - otherwise OpenStreetMap Nominatim (no key)
 */
export const geoRouter = Router()

const NOMINATIM = 'https://nominatim.openstreetmap.org'
const GOOGLE_GEOCODE = 'https://maps.googleapis.com/maps/api/geocode/json'
const GOOGLE_NEARBY = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json'
const GOOGLE_DETAILS = 'https://maps.googleapis.com/maps/api/place/details/json'
const GOOGLE_PLACES_NEARBY_NEW = 'https://places.googleapis.com/v1/places:searchNearby'
const GOOGLE_STATIC_MAP = 'https://maps.googleapis.com/maps/api/staticmap'
const UA = process.env.NOMINATIM_USER_AGENT
  || `RefexITAM/1.0 (${process.env.PUBLIC_APP_URL || 'https://asset.refexone.com'}; itam@refex.co.in)`

function googleServerKey() {
  return String(process.env.GOOGLE_MAPS_API_KEY || '').trim()
}

function googleBrowserKey() {
  return String(process.env.GOOGLE_MAPS_BROWSER_KEY || process.env.GOOGLE_MAPS_API_KEY || '').trim()
}

function useGoogle() {
  return Boolean(googleServerKey())
}

type SearchHit = { lat: number; lng: number; address: string; place_id: string }

type GoogleResult = {
  place_id?: string
  formatted_address?: string
  types?: string[]
  geometry?: {
    location?: { lat: number; lng: number }
    location_type?: string
  }
  address_components?: Array<{ long_name: string; short_name: string; types: string[] }>
}

type PlaceHit = {
  place_id: string
  name: string | null
  address: string
  location_type: string | null
  locality_header?: string | null
}

function componentOf(components: GoogleResult['address_components'], type: string) {
  return components?.find((c) => c.types.includes(type))?.long_name || ''
}

/** "Chennai, Tamil Nadu, India" — GPS Map Camera style city header */
function buildLocalityHeader(
  address: string,
  components?: GoogleResult['address_components'],
): string {
  if (components?.length) {
    const city = componentOf(components, 'locality')
      || componentOf(components, 'administrative_area_level_2')
      || componentOf(components, 'sublocality')
    const state = componentOf(components, 'administrative_area_level_1')
    const country = componentOf(components, 'country')
    const parts = [city, state, country].filter(Boolean)
    if (parts.length >= 2) return parts.join(', ')
  }
  const parts = address.split(',').map((s) => s.trim()).filter(Boolean)
  if (parts.length < 3) return address
  const country = parts[parts.length - 1]
  const stateZip = parts[parts.length - 2].replace(/\s+\d{4,6}$/, '').trim()
  let city = parts[parts.length - 3]
  if (/^greater\b/i.test(city) && parts.length >= 4) city = parts[parts.length - 4]
  return [city, stateZip, country].filter(Boolean).join(', ')
}

async function nominatim(path: string, params: Record<string, string>) {
  const url = new URL(path, NOMINATIM)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  url.searchParams.set('format', 'json')
  const res = await fetch(url.toString(), {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
    },
  })
  if (!res.ok) throw new Error(`Geocoding failed (${res.status})`)
  return res.json()
}

async function googleGeocode(params: Record<string, string>) {
  const url = new URL(GOOGLE_GEOCODE)
  url.searchParams.set('key', googleServerKey())
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Google Geocoding failed (${res.status})`)
  const data = await res.json() as {
    status: string
    error_message?: string
    results?: GoogleResult[]
  }
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new Error(data.error_message || `Google Geocoding: ${data.status}`)
  }
  return data.results || []
}

/** Prefer Google Maps listing address (formatted_address), never rebuild from parts. */
function pickMapsStyleGeocode(results: GoogleResult[]): PlaceHit | null {
  const usable = results.filter((r) => {
    const types = r.types || []
    if (!r.formatted_address) return false
    if (types.length === 1 && types[0] === 'plus_code') return false
    return true
  })
  const pool = usable.length ? usable : results.filter((r) => r.formatted_address)
  if (!pool.length) return null

  const rank = (r: GoogleResult) => {
    const types = r.types || []
    let score = 0
    if (types.includes('street_address')) score += 50
    if (types.includes('premise')) score += 48
    if (types.includes('subpremise')) score += 46
    if (types.includes('establishment')) score += 40
    if (types.includes('point_of_interest')) score += 38
    if (types.includes('route')) score += 20
    const loc = r.geometry?.location_type
    if (loc === 'ROOFTOP') score += 25
    if (loc === 'RANGE_INTERPOLATED') score += 15
    return score
  }

  const best = pool.slice().sort((a, b) => rank(b) - rank(a))[0]
  return {
    place_id: String(best.place_id || ''),
    name: null,
    address: String(best.formatted_address),
    location_type: best.geometry?.location_type || null,
    locality_header: buildLocalityHeader(String(best.formatted_address), best.address_components),
  }
}

/** Places API (New) — same place cards Google Maps shows. */
async function placesNearbyNew(lat: number, lng: number): Promise<PlaceHit | null> {
  try {
    const res = await fetch(GOOGLE_PLACES_NEARBY_NEW, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': googleServerKey(),
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location',
      },
      body: JSON.stringify({
        maxResultCount: 5,
        rankPreference: 'DISTANCE',
        locationRestriction: {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius: 75.0,
          },
        },
      }),
    })
    if (!res.ok) return null
    const data = await res.json() as {
      places?: Array<{
        id?: string
        displayName?: { text?: string }
        formattedAddress?: string
      }>
    }
    const place = (data.places || []).find((p) => p.formattedAddress)
    if (!place?.formattedAddress) return null
    return {
      place_id: String(place.id || ''),
      name: place.displayName?.text || null,
      address: place.formattedAddress,
      location_type: 'PLACES_NEARBY',
      locality_header: buildLocalityHeader(place.formattedAddress),
    }
  } catch {
    return null
  }
}

/** Legacy Places Nearby + Details — formatted_address matches Maps listing. */
async function placesNearbyLegacy(lat: number, lng: number): Promise<PlaceHit | null> {
  try {
    const nearbyUrl = new URL(GOOGLE_NEARBY)
    nearbyUrl.searchParams.set('location', `${lat},${lng}`)
    nearbyUrl.searchParams.set('rankby', 'distance')
    nearbyUrl.searchParams.set('key', googleServerKey())
    const nearbyRes = await fetch(nearbyUrl.toString(), { headers: { Accept: 'application/json' } })
    if (!nearbyRes.ok) return null
    const nearby = await nearbyRes.json() as {
      status: string
      results?: Array<{ place_id?: string; name?: string; vicinity?: string }>
    }
    if (nearby.status !== 'OK' && nearby.status !== 'ZERO_RESULTS') return null
    const first = (nearby.results || [])[0]
    if (!first?.place_id) return null

    const detailsUrl = new URL(GOOGLE_DETAILS)
    detailsUrl.searchParams.set('place_id', first.place_id)
    detailsUrl.searchParams.set('fields', 'place_id,name,formatted_address,geometry')
    detailsUrl.searchParams.set('language', 'en')
    detailsUrl.searchParams.set('key', googleServerKey())
    const detailsRes = await fetch(detailsUrl.toString(), { headers: { Accept: 'application/json' } })
    if (!detailsRes.ok) return null
    const details = await detailsRes.json() as {
      status: string
      result?: { place_id?: string; name?: string; formatted_address?: string }
    }
    if (details.status !== 'OK' || !details.result?.formatted_address) {
      if (first.vicinity) {
        return {
          place_id: first.place_id,
          name: first.name || null,
          address: first.vicinity,
          location_type: 'PLACES_LEGACY_VICINITY',
          locality_header: buildLocalityHeader(first.vicinity),
        }
      }
      return null
    }
    return {
      place_id: String(details.result.place_id || first.place_id),
      name: details.result.name || first.name || null,
      address: details.result.formatted_address,
      location_type: 'PLACES_LEGACY',
      locality_header: buildLocalityHeader(details.result.formatted_address),
    }
  } catch {
    return null
  }
}

async function resolveGoogleMapsAddress(lat: number, lng: number): Promise<PlaceHit & { provider: string }> {
  const nearbyNew = await placesNearbyNew(lat, lng)
  if (nearbyNew?.address) return { ...nearbyNew, provider: 'google_places' }

  const nearbyLegacy = await placesNearbyLegacy(lat, lng)
  if (nearbyLegacy?.address) return { ...nearbyLegacy, provider: 'google_places' }

  const results = await googleGeocode({
    latlng: `${lat},${lng}`,
    language: 'en',
  })
  const geo = pickMapsStyleGeocode(results)
  if (geo?.address) return { ...geo, provider: 'google' }

  return {
    place_id: '',
    name: null,
    address: `${lat.toFixed(7)}, ${lng.toFixed(7)}`,
    location_type: null,
    provider: 'google',
  }
}

/** Public map config for the picker (browser key is referrer-restricted). */
geoRouter.get('/config', (_req, res) => {
  const browserKey = googleBrowserKey()
  return okItem(res, {
    provider: useGoogle() && browserKey ? 'google' : 'osm',
    browser_key: useGoogle() && browserKey ? browserKey : null,
  })
})

/** Proxy Google Static Maps (satellite pin) for GPS Map Camera–style stamps. */
geoRouter.get('/static-map', async (req, res) => {
  const lat = Number(req.query.lat)
  const lng = Number(req.query.lng ?? req.query.lon)
  const size = Math.min(640, Math.max(120, Number(req.query.size) || 400))
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return fail(res, 'lat and lng are required')
  }
  if (!useGoogle()) {
    return fail(res, 'Google Maps is not configured', 503)
  }
  try {
    const url = new URL(GOOGLE_STATIC_MAP)
    url.searchParams.set('center', `${lat},${lng}`)
    url.searchParams.set('zoom', '18')
    url.searchParams.set('size', `${size}x${size}`)
    url.searchParams.set('scale', '2')
    url.searchParams.set('maptype', 'hybrid')
    url.searchParams.set('markers', `color:0xE53935|${lat},${lng}`)
    url.searchParams.set('key', googleServerKey())
    const upstream = await fetch(url.toString())
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '')
      return fail(res, text || `Static map failed (${upstream.status})`, 502)
    }
    const buf = Buffer.from(await upstream.arrayBuffer())
    const ctype = upstream.headers.get('content-type') || 'image/png'
    res.setHeader('Content-Type', ctype)
    res.setHeader('Cache-Control', 'private, max-age=300')
    return res.send(buf)
  } catch (e) {
    return fail(res, e instanceof Error ? e.message : 'Static map failed', 502)
  }
})

geoRouter.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim()
  if (q.length < 3) return fail(res, 'Enter at least 3 characters')
  const country = String(req.query.country || 'in').toLowerCase()
  try {
    if (useGoogle()) {
      const results = await googleGeocode({
        address: q,
        components: `country:${country.toUpperCase()}`,
        language: 'en',
        region: country,
      })
      const hits: SearchHit[] = results.slice(0, 6).map((r) => ({
        lat: Number(r.geometry?.location?.lat),
        lng: Number(r.geometry?.location?.lng),
        address: String(r.formatted_address || q),
        place_id: String(r.place_id || ''),
      })).filter((h) => Number.isFinite(h.lat) && Number.isFinite(h.lng))
      return okItem(res, { results: hits, provider: 'google' })
    }

    const data = await nominatim('/search', {
      q,
      addressdetails: '0',
      limit: '6',
      countrycodes: country,
    }) as Array<{ lat: string; lon: string; display_name: string; place_id: number }>
    const results = (Array.isArray(data) ? data : []).map((r) => ({
      lat: Number(r.lat),
      lng: Number(r.lon),
      address: r.display_name,
      place_id: String(r.place_id),
    }))
    return okItem(res, { results, provider: 'osm' })
  } catch (e) {
    return fail(res, e instanceof Error ? e.message : 'Search failed', 502)
  }
})

geoRouter.get('/reverse', async (req, res) => {
  const lat = Number(req.query.lat)
  const lng = Number(req.query.lng ?? req.query.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return fail(res, 'lat and lng are required')
  }
  try {
    if (useGoogle()) {
      const hit = await resolveGoogleMapsAddress(lat, lng)
      const locality_header = hit.locality_header || buildLocalityHeader(hit.address)
      return okItem(res, {
        lat,
        lng,
        address: hit.address,
        formatted_address: hit.address,
        locality_header,
        place_name: hit.name,
        location_type: hit.location_type,
        place_id: hit.place_id || null,
        provider: hit.provider,
      })
    }
    const data = await nominatim('/reverse', {
      lat: String(lat),
      lon: String(lng),
      zoom: '18',
      addressdetails: '1',
    }) as {
      display_name?: string
      address?: {
        city?: string
        town?: string
        state?: string
        country?: string
      }
    }
    const address = data.display_name || `${lat.toFixed(7)}, ${lng.toFixed(7)}`
    const locality_header = [data.address?.city || data.address?.town, data.address?.state, data.address?.country]
      .filter(Boolean).join(', ') || buildLocalityHeader(address)
    return okItem(res, {
      lat,
      lng,
      address,
      locality_header,
      provider: 'osm',
    })
  } catch (e) {
    return fail(res, e instanceof Error ? e.message : 'Reverse geocode failed', 502)
  }
})
