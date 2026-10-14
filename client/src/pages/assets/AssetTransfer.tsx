import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import AppLayout from '../../layout/AppLayout'
import { Box, Field } from '../../components/ui'
import { MasterSelect, masterPayloadId } from '../../components/MasterSelect'
import { hardwareApi, mastersApi, type SelectOption } from '../../api/client'
import { useToast } from '../../components/Toast'

function placeName(asset: Record<string, unknown> | null) {
  if (!asset) return '—'
  const text = String(asset.location_text || '').trim()
  if (text) return text
  const loc = asset.location
  if (loc && typeof loc === 'object' && 'name' in loc && (loc as { name?: string }).name) {
    return String((loc as { name?: string }).name)
  }
  const home = asset.rtd_location
  if (home && typeof home === 'object' && 'name' in home && (home as { name?: string }).name) {
    return String((home as { name?: string }).name)
  }
  return 'Not set'
}

export default function AssetTransfer() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [params] = useSearchParams()
  const fromEmployeeId = params.get('from') === 'employee' ? params.get('employee_id') : null
  const returnQs = useMemo(() => {
    if (!fromEmployeeId) return ''
    return `?from=employee&employee_id=${encodeURIComponent(fromEmployeeId)}`
  }, [fromEmployeeId])
  const assetPath = `/hardware/${id}${returnQs}`

  const [asset, setAsset] = useState<Record<string, unknown> | null>(null)
  const [destination, setDestination] = useState<'office' | 'other'>('office')
  const [locationId, setLocationId] = useState('')
  const [place, setPlace] = useState('')
  const [reason, setReason] = useState('')
  const [locations, setLocations] = useState<SelectOption[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!id) return
    hardwareApi.get(id).then(setAsset).catch(() => setAsset(null))
    mastersApi.locations().then((r) => setLocations(r.results || [])).catch(() => setLocations([]))
  }, [id])

  if (!asset) {
    return (
      <AppLayout title="Transfer asset">
        <Box title="Transfer"><p className="text-muted">Loading…</p></Box>
      </AppLayout>
    )
  }

  const assetTag = String(asset.asset_tag || id || '')

  return (
    <AppLayout title="Transfer asset" subtitle={assetTag}>
      <div className="row">
        <div className="col-md-7">
          <Box title={`Move ${assetTag}`} type="primary">
            {error ? <div className="callout callout-danger"><p>{error}</p></div> : null}
            <form
              className="form-horizontal"
              onSubmit={async (e) => {
                e.preventDefault()
                setError('')
                if (!reason.trim()) {
                  setError('Enter why this asset is moving')
                  return
                }
                if (destination === 'office' && !locationId) {
                  setError('Choose the office, or switch to another place')
                  return
                }
                if (destination === 'other' && !place.trim()) {
                  setError('Enter the place this asset is moving to')
                  return
                }
                setBusy(true)
                try {
                  await hardwareApi.transfer(id || '', {
                    destination,
                    location_id: destination === 'office' ? Number(locationId) : null,
                    location_text: destination === 'other' ? place.trim() : null,
                    reason: reason.trim(),
                  })
                  toast.success('Asset transferred')
                  navigate(assetPath)
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Transfer failed')
                } finally {
                  setBusy(false)
                }
              }}
            >
              <Field label="Currently at">
                <p className="form-control-static" style={{ paddingTop: 7 }}>{placeName(asset)}</p>
              </Field>
              <Field label="Move to" required>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  <label className="radio">
                    <input
                      type="radio"
                      name="destination"
                      checked={destination === 'office'}
                      onChange={() => setDestination('office')}
                    />{' '}
                    Office location
                  </label>
                  <label className="radio">
                    <input
                      type="radio"
                      name="destination"
                      checked={destination === 'other'}
                      onChange={() => setDestination('other')}
                    />{' '}
                    Another place
                  </label>
                </div>
              </Field>
              {destination === 'office' ? (
                <MasterSelect
                  label="Office"
                  required
                  value={locationId}
                  options={locations}
                  onChange={setLocationId}
                  onOptionsChange={setLocations}
                  allowEmpty={false}
                  emptyLabel="Select office, floor or seat…"
                  help="Bazullah Road, Nungambakkam, Delhi, Mumbai — pick a location, or add one."
                  create={async (name) => {
                    const res = await mastersApi.createLocation({ name })
                    return masterPayloadId(res, name)
                  }}
                />
              ) : (
                <Field label="Place" required>
                  <input
                    className="form-control"
                    value={place}
                    onChange={(e) => setPlace(e.target.value)}
                    placeholder="e.g. Delhi, Mumbai, Nungambakkam Chennai"
                    required
                  />
                  <p className="help-block">A place that is not an office in Masters.</p>
                </Field>
              )}
              <Field label="Reason" required>
                <textarea
                  className="form-control"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Employee relieved — asset shifting to the Delhi office"
                  rows={3}
                  required
                />
              </Field>
              <div className="form-actions">
                <button type="submit" className="btn btn-theme" disabled={busy}>
                  {busy ? 'Transferring…' : 'Transfer'}
                </button>
                <Link to={assetPath} className="btn btn-default">Cancel</Link>
              </div>
            </form>
          </Box>
        </div>
        <div className="col-md-5">
          <div className="callout callout-info">
            <h4>What this does</h4>
            <p>
              Moves the asset from where it is now to another office, or to any other place you type.
              Assignment to an employee stays as it is. Unassign separately when the person is relieved.
            </p>
            <p>The reason is stored on the asset activity log.</p>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
