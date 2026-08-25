import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { api } from '../api/client'

export type MapLocationValue = {
  latitude: number | null
  longitude: number | null
  address: string
}

type Props = {
  value: MapLocationValue
  onChange: (next: MapLocationValue) => void
}

const DEFAULT_CENTER = { lat: 13.0827, lng: 80.2707 } // Chennai
const DEFAULT_ZOOM = 12

const markerIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})

type SearchHit = { lat: number; lng: number; address: string; place_id: string }
type MapConfig = { provider: 'google' | 'osm'; browser_key?: string | null }

declare global {
  interface Window {
    google?: {
      maps: {
        Map: new (el: HTMLElement, opts: Record<string, unknown>) => GoogleMap
        Marker: new (opts: Record<string, unknown>) => GoogleMarker
        event: {
          addListener: (target: unknown, name: string, fn: (...args: unknown[]) => void) => unknown
          trigger: (target: unknown, name: string) => void
        }
      }
    }
  }
}

type GoogleMap = {
  setCenter: (ll: { lat: number; lng: number }) => void
  setZoom: (z: number) => void
  getZoom: () => number
  panTo: (ll: { lat: number; lng: number }) => void
}
type GoogleMarker = {
  setPosition: (ll: { lat: number; lng: number }) => void
  getPosition: () => { lat: () => number; lng: () => number } | null
  setMap: (map: GoogleMap | null) => void
}

let googleMapsLoad: Promise<void> | null = null
function loadGoogleMaps(key: string) {
  if (window.google?.maps) return Promise.resolve()
  if (googleMapsLoad) return googleMapsLoad
  googleMapsLoad = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-itam-gmaps="1"]')
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('Google Maps failed to load')))
      return
    }
    const s = document.createElement('script')
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}`
    s.async = true
    s.dataset.itamGmaps = '1'
    s.onload = () => resolve()
    s.onerror = () => {
      googleMapsLoad = null
      reject(new Error('Google Maps failed to load'))
    }
    document.head.appendChild(s)
  })
  return googleMapsLoad
}

export default function LocationMapPicker({ value, onChange }: Props) {
  const hasPin = value.latitude != null && value.longitude != null
    && Number.isFinite(value.latitude) && Number.isFinite(value.longitude)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searchBusy, setSearchBusy] = useState(false)
  const [mapBusy, setMapBusy] = useState(false)
  const [err, setErr] = useState('')
  const [config, setConfig] = useState<MapConfig | null>(null)
  const mapEl = useRef<HTMLDivElement>(null)
  const leafletMap = useRef<L.Map | null>(null)
  const leafletMarker = useRef<L.Marker | null>(null)
  const gMap = useRef<GoogleMap | null>(null)
  const gMarker = useRef<GoogleMarker | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    api<MapConfig>('/geo/config')
      .then((c) => setConfig({
        provider: c.provider === 'google' && c.browser_key ? 'google' : 'osm',
        browser_key: c.browser_key,
      }))
      .catch(() => setConfig({ provider: 'osm' }))
  }, [])

  const applyPoint = async (lat: number, lng: number, address?: string) => {
    setMapBusy(true)
    setErr('')
    try {
      let addr = address?.trim() || ''
      if (!addr) {
        const rev = await api<{ lat: number; lng: number; address: string }>(
          `/geo/reverse?lat=${encodeURIComponent(String(lat))}&lng=${encodeURIComponent(String(lng))}`,
        )
        addr = rev.address || `${lat.toFixed(6)}, ${lng.toFixed(6)}`
      }
      onChangeRef.current({ latitude: lat, longitude: lng, address: addr })
      setQuery(addr)
      setHits([])
    } catch (e) {
      onChangeRef.current({
        latitude: lat,
        longitude: lng,
        address: address || `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
      })
      setErr(e instanceof Error ? e.message : 'Could not resolve address')
    } finally {
      setMapBusy(false)
    }
  }
  const applyPointRef = useRef(applyPoint)
  applyPointRef.current = applyPoint

  useEffect(() => {
    if (!open || !mapEl.current || !config) return
    let cancelled = false

    const setupLeaflet = () => {
      if (!mapEl.current) return
      if (!leafletMap.current) {
        const map = L.map(mapEl.current, { scrollWheelZoom: true }).setView(
          hasPin ? [value.latitude!, value.longitude!] : [DEFAULT_CENTER.lat, DEFAULT_CENTER.lng],
          hasPin ? 16 : DEFAULT_ZOOM,
        )
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          maxZoom: 19,
        }).addTo(map)
        map.on('click', (e: L.LeafletMouseEvent) => {
          void applyPointRef.current(e.latlng.lat, e.latlng.lng)
        })
        leafletMap.current = map
      }
      const map = leafletMap.current
      if (hasPin) {
        const ll: L.LatLngExpression = [value.latitude!, value.longitude!]
        if (!leafletMarker.current) {
          leafletMarker.current = L.marker(ll, { icon: markerIcon, draggable: true }).addTo(map)
          leafletMarker.current.on('dragend', () => {
            const p = leafletMarker.current?.getLatLng()
            if (p) void applyPointRef.current(p.lat, p.lng)
          })
        } else {
          leafletMarker.current.setLatLng(ll)
        }
        map.setView(ll, Math.max(map.getZoom(), 15))
      } else if (leafletMarker.current) {
        leafletMarker.current.remove()
        leafletMarker.current = null
      }
      window.setTimeout(() => map.invalidateSize(), 80)
    }

    const setupGoogle = async () => {
      if (!mapEl.current || !config.browser_key) return
      await loadGoogleMaps(config.browser_key)
      if (cancelled || !window.google?.maps || !mapEl.current) return
      const g = window.google.maps
      const center = hasPin
        ? { lat: value.latitude!, lng: value.longitude! }
        : DEFAULT_CENTER
      if (!gMap.current) {
        gMap.current = new g.Map(mapEl.current, {
          center,
          zoom: hasPin ? 16 : DEFAULT_ZOOM,
          mapTypeId: 'roadmap',
          mapTypeControl: true,
          streetViewControl: false,
          fullscreenControl: true,
          gestureHandling: 'greedy',
        })
        window.setTimeout(() => {
          if (gMap.current) g.event.trigger(gMap.current, 'resize')
        }, 80)
        g.event.addListener(gMap.current, 'click', (e: unknown) => {
          const ev = e as { latLng?: { lat: () => number; lng: () => number } }
          const ll = ev.latLng
          if (ll) void applyPointRef.current(ll.lat(), ll.lng())
        })
      }
      if (hasPin) {
        const ll = { lat: value.latitude!, lng: value.longitude! }
        if (!gMarker.current) {
          gMarker.current = new g.Marker({
            position: ll,
            map: gMap.current,
            draggable: true,
          })
          g.event.addListener(gMarker.current, 'dragend', () => {
            const p = gMarker.current?.getPosition()
            if (p) void applyPointRef.current(p.lat(), p.lng())
          })
        } else {
          gMarker.current.setPosition(ll)
        }
        gMap.current.panTo(ll)
        if ((gMap.current.getZoom() || 0) < 15) gMap.current.setZoom(15)
      } else if (gMarker.current) {
        gMarker.current.setMap(null)
        gMarker.current = null
      }
    }

    if (config.provider === 'google' && config.browser_key) {
      void setupGoogle().catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Google Maps failed')
      })
    } else {
      setupLeaflet()
    }

    return () => {
      cancelled = true
    }
  }, [open, value.latitude, value.longitude, hasPin, config])

  useEffect(() => () => {
    leafletMap.current?.remove()
    leafletMap.current = null
    leafletMarker.current = null
    gMarker.current?.setMap(null)
    gMarker.current = null
    gMap.current = null
  }, [])

  const runSearch = async () => {
    const q = query.trim()
    if (q.length < 3) {
      setErr('Enter at least 3 characters to search')
      return
    }
    setSearchBusy(true)
    setErr('')
    try {
      const res = await api<{ results: SearchHit[] }>(
        `/geo/search?q=${encodeURIComponent(q)}`,
      )
      setHits(res.results || [])
      if (!(res.results || []).length) setErr('No places found — try a different address')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Search failed')
      setHits([])
    } finally {
      setSearchBusy(false)
    }
  }

  const clear = () => {
    onChange({ latitude: null, longitude: null, address: '' })
    setQuery('')
    setHits([])
    setErr('')
    if (leafletMarker.current) {
      leafletMarker.current.remove()
      leafletMarker.current = null
    }
    if (gMarker.current) {
      gMarker.current.setMap(null)
      gMarker.current = null
    }
  }

  const usingGoogle = config?.provider === 'google'

  return (
    <div className="map-location-picker">
      <div className="map-location-actions">
        <button
          type="button"
          className="btn btn-default btn-sm"
          onClick={() => setOpen((v) => !v)}
        >
          <i className={`fas ${open ? 'fa-chevron-up' : 'fa-map-marker-alt'}`} />{' '}
          {open ? 'Hide map' : hasPin ? 'Edit map pin' : 'Choose on map'}
        </button>
        {hasPin ? (
          <button type="button" className="btn btn-link btn-sm" onClick={clear}>
            Clear pin
          </button>
        ) : null}
      </div>

      {hasPin && !open ? (
        <div className="map-location-summary">
          <div className="map-location-summary-addr">{value.address || 'Pinned location'}</div>
          <div className="map-location-summary-coords text-muted">
            Lat {Number(value.latitude).toFixed(6)}, Lng {Number(value.longitude).toFixed(6)}
          </div>
        </div>
      ) : null}

      {open ? (
        <div className="map-location-panel">
          <p className="help-block" style={{ marginTop: 0 }}>
            Search an address{usingGoogle ? ' (Google Maps)' : ' (OpenStreetMap)'} or click the map to drop a pin.
            Drag the marker to adjust.
          </p>
          <div className="map-location-search">
            <input
              className="form-control"
              placeholder="Search address or place…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void runSearch()
                }
              }}
            />
            <button
              type="button"
              className="btn btn-theme btn-sm"
              disabled={searchBusy}
              onClick={() => { void runSearch() }}
            >
              {searchBusy ? 'Searching…' : 'Search'}
            </button>
          </div>
          {hits.length > 0 ? (
            <ul className="map-location-hits">
              {hits.map((h) => (
                <li key={h.place_id || `${h.lat},${h.lng}`}>
                  <button
                    type="button"
                    onClick={() => { void applyPoint(h.lat, h.lng, h.address) }}
                  >
                    {h.address}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {err ? <p className="text-danger" style={{ margin: '6px 0 0', fontSize: 13 }}>{err}</p> : null}
          {mapBusy ? <p className="help-block" style={{ marginBottom: 0 }}>Resolving address…</p> : null}
          <div ref={mapEl} className="map-location-canvas" role="application" aria-label="Map location picker" />
          {hasPin ? (
            <div className="map-location-summary" style={{ marginTop: 10 }}>
              <div className="map-location-summary-addr">{value.address}</div>
              <div className="map-location-summary-coords text-muted">
                Lat {Number(value.latitude).toFixed(6)}, Lng {Number(value.longitude).toFixed(6)}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
