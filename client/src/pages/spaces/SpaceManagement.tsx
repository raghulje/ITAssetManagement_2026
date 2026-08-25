import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import AppLayout from '../../layout/AppLayout'
import { Box, DataTable, EmployeeSelect, Field } from '../../components/ui'
import { EmptyState } from '../../components/saas'
import { hardwareApi, spacesApi } from '../../api/client'
import { useToast } from '../../components/Toast'

type SpaceKind = 'CABIN' | 'MEETING_ROOM' | 'WORKSTATION' | 'OTHER'

type SpaceRow = {
  id: number
  name: string
  subtype: string
  subtype_name: string
  seat_count: number | null
  occupant_employee_id: number | null
  occupant_name: string | null
  occupant_code?: string | null
  asset_count?: number
}

type Floor = {
  id: number
  name: string
  space_active: boolean
  seat_count: number
  spaces: SpaceRow[]
}

type OfficeRow = {
  id: number
  name: string
  address?: string | null
  company?: { id: number; name: string } | null
  floors_total: number
  floors_active: number
  floors_inactive: number
}

const KINDS: Array<{ value: SpaceKind; label: string; plural: string; icon: string }> = [
  { value: 'CABIN', label: 'Cabin', plural: 'Cabins', icon: 'fas fa-door-closed' },
  { value: 'MEETING_ROOM', label: 'Meeting room', plural: 'Meeting rooms', icon: 'fas fa-users' },
  { value: 'WORKSTATION', label: 'Workstation', plural: 'Workstations', icon: 'fas fa-desktop' },
  { value: 'OTHER', label: 'Other', plural: 'Other spaces', icon: 'fas fa-ellipsis-h' },
]

function kindOf(code: string): SpaceKind {
  const c = String(code || '').toUpperCase()
  if (c === 'CABIN' || c === 'MEETING_ROOM' || c === 'WORKSTATION') return c
  return 'OTHER'
}

function kindMeta(code: string) {
  return KINDS.find((k) => k.value === kindOf(code)) || KINDS[3]
}

function modulePath(row: Record<string, unknown>) {
  const id = String(row.id)
  const module = String(row.module || 'asset')
  if (module === 'accessory') return `/accessories/${id}`
  if (module === 'consumable') return `/consumables/${id}`
  if (module === 'component') return `/components/${id}`
  return `/hardware/${id}`
}

function companyName(office: OfficeRow) {
  return office.company?.name || ''
}

function occupantLabel(s: SpaceRow) {
  if (!s.occupant_name) return ''
  return s.occupant_code ? `${s.occupant_name} (${s.occupant_code})` : s.occupant_name
}

function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() || '').join('') || '?'
}

export default function SpaceManagement() {
  const toast = useToast()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const officeId = params.get('office') || ''
  const floorId = params.get('floor') || ''
  const kind = (params.get('kind') || '') as SpaceKind | ''
  const spaceId = params.get('space') || ''

  const [offices, setOffices] = useState<OfficeRow[]>([])
  const [detail, setDetail] = useState<{
    id: number
    name: string
    address?: string | null
    floors: Floor[]
    floors_total: number
    floors_active: number
    floors_inactive: number
  } | null>(null)
  const [error, setError] = useState('')
  const [loadingOffices, setLoadingOffices] = useState(true)
  const [floorName, setFloorName] = useState('')
  const [floorSeats, setFloorSeats] = useState('')
  const [spaceName, setSpaceName] = useState('')
  const [spaceType, setSpaceType] = useState<SpaceKind>('CABIN')
  const [spaceSeats, setSpaceSeats] = useState('')
  const [assets, setAssets] = useState<Array<Record<string, unknown>>>([])
  const [assetsLoading, setAssetsLoading] = useState(false)
  const [occupantPick, setOccupantPick] = useState('')
  const [occupantBusy, setOccupantBusy] = useState(false)
  const [assigningId, setAssigningId] = useState<number | null>(null)
  const [seatGenCount, setSeatGenCount] = useState('')
  const [seatBusy, setSeatBusy] = useState(false)
  const [tagBusy, setTagBusy] = useState<number | string | null>(null)

  const setDrill = (next: { office?: string; floor?: string; kind?: string; space?: string }) => {
    const q = new URLSearchParams()
    if (next.office) q.set('office', next.office)
    if (next.floor) q.set('floor', next.floor)
    if (next.kind) q.set('kind', next.kind)
    if (next.space) q.set('space', next.space)
    setParams(q)
  }

  const loadOffices = () => {
    setLoadingOffices(true)
    spacesApi.offices()
      .then((r) => setOffices((r.rows || []) as OfficeRow[]))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoadingOffices(false))
  }

  const loadOffice = (id: string) => {
    if (!id) {
      setDetail(null)
      return
    }
    spacesApi.office(id)
      .then((d) => setDetail(d as typeof detail))
      .catch((e: Error) => setError(e.message))
  }

  useEffect(() => { loadOffices() }, [])
  useEffect(() => { loadOffice(officeId) }, [officeId])

  useEffect(() => {
    if (kind && KINDS.some((k) => k.value === kind)) setSpaceType(kind)
  }, [kind])

  useEffect(() => {
    if (!spaceId) {
      setAssets([])
      return
    }
    setAssetsLoading(true)
    spacesApi.spaceAssets(spaceId)
      .then((r) => setAssets(r.rows || []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setAssetsLoading(false))
  }, [spaceId])

  useEffect(() => {
    setOccupantPick('')
    setAssigningId(null)
  }, [spaceId, kind])

  const office = offices.find((o) => String(o.id) === officeId) || null
  const floor = detail?.floors.find((f) => String(f.id) === floorId) || null
  const spacesOnFloor = floor?.spaces || []
  const spacesOfKind = useMemo(
    () => spacesOnFloor.filter((s) => kindOf(s.subtype) === kind),
    [spacesOnFloor, kind],
  )
  const selectedSpace = spacesOnFloor.find((s) => String(s.id) === spaceId) || null

  const kindCounts = useMemo(() => {
    const counts: Record<SpaceKind, { spaces: number; seats: number; occupied: number }> = {
      CABIN: { spaces: 0, seats: 0, occupied: 0 },
      MEETING_ROOM: { spaces: 0, seats: 0, occupied: 0 },
      WORKSTATION: { spaces: 0, seats: 0, occupied: 0 },
      OTHER: { spaces: 0, seats: 0, occupied: 0 },
    }
    for (const s of spacesOnFloor) {
      const k = kindOf(s.subtype)
      counts[k].spaces += 1
      counts[k].seats += Number(s.seat_count || 0)
      if (s.occupant_employee_id || s.occupant_name) counts[k].occupied += 1
    }
    return counts
  }, [spacesOnFloor])

  const createFloor = async () => {
    if (!officeId || !floorName.trim()) return
    try {
      await spacesApi.createFloor(officeId, {
        name: floorName.trim(),
        seat_count: floorSeats ? Number(floorSeats) : null,
        space_active: true,
      })
      toast.success('Floor created')
      setFloorName('')
      setFloorSeats('')
      loadOffice(officeId)
      loadOffices()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create floor failed')
    }
  }

  const createSpace = async () => {
    const targetFloor = floorId || (detail?.floors[0] ? String(detail.floors[0].id) : '')
    if (!targetFloor || !spaceName.trim()) return
    try {
      await spacesApi.createSpace(targetFloor, {
        name: spaceName.trim(),
        subtype: spaceType,
        seat_count: spaceSeats ? Number(spaceSeats) : null,
      })
      toast.success('Space created')
      setSpaceName('')
      setSpaceSeats('')
      loadOffice(officeId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create space failed')
    }
  }

  const toggleFloor = async (f: Floor) => {
    try {
      await spacesApi.updateFloor(f.id, { space_active: !f.space_active })
      toast.success(f.space_active ? 'Floor marked inactive' : 'Floor marked active')
      loadOffice(officeId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update floor failed')
    }
  }

  const assignOccupantTo = async (space: SpaceRow, employeeId: string) => {
    if (!employeeId) return
    setOccupantBusy(true)
    setError('')
    try {
      await spacesApi.updateSpace(space.id, { occupant_employee_id: Number(employeeId) })
      toast.success(`${space.name} assigned`)
      setOccupantPick('')
      setAssigningId(null)
      loadOffice(officeId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Assign failed')
    } finally {
      setOccupantBusy(false)
    }
  }

  const unassignOccupantFrom = async (space: SpaceRow) => {
    setOccupantBusy(true)
    setError('')
    try {
      await spacesApi.updateSpace(space.id, { occupant_employee_id: null })
      toast.success(`${space.name} is now free`)
      loadOffice(officeId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unassign failed')
    } finally {
      setOccupantBusy(false)
    }
  }

  const assignOccupant = async () => {
    if (!selectedSpace || !occupantPick) return
    await assignOccupantTo(selectedSpace, occupantPick)
  }

  const unassignOccupant = async () => {
    if (!selectedSpace) return
    await unassignOccupantFrom(selectedSpace)
  }

  const generateSeats = async () => {
    if (!floorId) return
    const planned = Math.max(Number(floor?.seat_count || 0) - spacesOfKind.length, 0)
    const n = Number(seatGenCount) || planned
    if (!Number.isFinite(n) || n < 1) {
      setError('Enter how many seating records to create')
      return
    }
    setSeatBusy(true)
    setError('')
    try {
      const res = await spacesApi.generateWorkstations(floorId, { count: n, prefix: 'Seat' })
      toast.success(`Created ${res.payload?.count || n} seating record(s)`)
      setSeatGenCount('')
      loadOffice(officeId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create seats')
    } finally {
      setSeatBusy(false)
    }
  }

  const reloadSpaceAssets = () => {
    if (!spaceId) return
    spacesApi.spaceAssets(spaceId).then((r) => setAssets(r.rows || [])).catch(() => undefined)
  }

  const tagAsset = async (row: Record<string, unknown>, mode: 'cabin' | 'occupant') => {
    if (String(row.module || 'asset') !== 'asset') return
    const assetId = Number(row.id)
    if (!selectedSpace || !assetId) return
    if (mode === 'occupant' && !selectedSpace.occupant_employee_id) {
      setError('Assign an occupant to this cabin first')
      return
    }
    setTagBusy(assetId)
    setError('')
    try {
      if (row.assigned_to) {
        await hardwareApi.checkin(assetId, {})
      }
      if (mode === 'cabin') {
        await hardwareApi.checkout(assetId, {
          checkout_to_type: 'location',
          assigned_location: selectedSpace.id,
        })
        toast.success(`${row.identifier || row.name} tagged to this cabin`)
      } else {
        await hardwareApi.checkout(assetId, {
          checkout_to_type: 'employee',
          assigned_employee: selectedSpace.occupant_employee_id,
        })
        toast.success(`${row.identifier || row.name} assigned to ${selectedSpace.occupant_name}`)
      }
      reloadSpaceAssets()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Tagging failed')
    } finally {
      setTagBusy(null)
    }
  }

  const bulkTag = async (mode: 'cabin' | 'occupant') => {
    if (!selectedSpace) return
    if (mode === 'occupant' && !selectedSpace.occupant_employee_id) {
      setError('Assign an occupant to this cabin first')
      return
    }
    const untagged = assets.filter((r) => String(r.module || 'asset') === 'asset' && !r.assigned_to)
    if (!untagged.length) {
      toast.success('No untagged assets in this space')
      return
    }
    setTagBusy(mode)
    setError('')
    try {
      for (const row of untagged) {
        const assetId = Number(row.id)
        if (mode === 'cabin') {
          await hardwareApi.checkout(assetId, {
            checkout_to_type: 'location',
            assigned_location: selectedSpace.id,
          })
        } else {
          await hardwareApi.checkout(assetId, {
            checkout_to_type: 'employee',
            assigned_employee: selectedSpace.occupant_employee_id,
          })
        }
      }
      toast.success(mode === 'cabin'
        ? `Tagged ${untagged.length} item(s) to this space`
        : `Assigned ${untagged.length} item(s) to ${selectedSpace.occupant_name}`)
      reloadSpaceAssets()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Tagging failed')
      reloadSpaceAssets()
    } finally {
      setTagBusy(null)
    }
  }

  const pageTitle = selectedSpace
    ? selectedSpace.name
    : kind
      ? kindMeta(kind).plural
      : floor
        ? floor.name
        : office || detail
          ? (office?.name || detail?.name || 'Office')
          : 'Space Management'

  const pageSubtitle = selectedSpace
    ? selectedSpace.occupant_name
      ? `${kindMeta(selectedSpace.subtype).label} · occupied by ${selectedSpace.occupant_name}`
      : `${kindMeta(selectedSpace.subtype).label} · free to occupy`
    : kind
      ? `${floor?.name || 'Floor'} · ${kindMeta(kind).plural.toLowerCase()}`
      : floor
        ? 'Cabins, meeting rooms, workstations and other spaces'
        : office || detail
          ? 'Floors in this office'
          : 'Office floors, cabins, meeting rooms and workstations'

  const goBack = () => {
    if (selectedSpace) {
      setDrill({ office: officeId, floor: floorId, kind: kind || kindOf(selectedSpace.subtype) })
      return
    }
    if (kind) {
      setDrill({ office: officeId, floor: floorId })
      return
    }
    if (floorId) {
      setDrill({ office: officeId })
      return
    }
    if (officeId) {
      setDrill({})
      return
    }
    navigate('/')
  }

  const backLabel = selectedSpace
    ? `Back to ${kindMeta(kind || selectedSpace.subtype).plural}`
    : kind
      ? `Back to ${floor?.name || 'floor'}`
      : floorId
        ? 'Back to floors'
        : officeId
          ? 'Back to offices'
          : 'Back'

  return (
    <AppLayout title={pageTitle} subtitle={pageSubtitle} backTo="/" backLabel={backLabel} onBack={goBack}>
      {error ? <div className="callout callout-danger"><p>{error}</p></div> : null}

      <nav className="space-drill-crumbs" aria-label="Space path">
        <button type="button" className={!officeId ? 'is-current' : ''} onClick={() => setDrill({})}>
          Offices
        </button>
        {officeId ? (
          <>
            <span aria-hidden>/</span>
            <button
              type="button"
              className={!floorId ? 'is-current' : ''}
              onClick={() => setDrill({ office: officeId })}
            >
              {office?.name || detail?.name || 'Office'}
            </button>
          </>
        ) : null}
        {floor ? (
          <>
            <span aria-hidden>/</span>
            <button
              type="button"
              className={!kind ? 'is-current' : ''}
              onClick={() => setDrill({ office: officeId, floor: floorId })}
            >
              {floor.name}
            </button>
          </>
        ) : null}
        {kind ? (
          <>
            <span aria-hidden>/</span>
            <button
              type="button"
              className={!spaceId ? 'is-current' : ''}
              onClick={() => setDrill({ office: officeId, floor: floorId, kind })}
            >
              {kindMeta(kind).plural}
            </button>
          </>
        ) : null}
        {selectedSpace ? (
          <>
            <span aria-hidden>/</span>
            <span className="is-current">{selectedSpace.name}</span>
          </>
        ) : null}
      </nav>

      {!officeId ? (
        <Box title="Offices" type="primary">
          {loadingOffices ? <p className="text-muted mb-0">Loading offices…</p> : null}
          {!loadingOffices && offices.length === 0 ? (
            <EmptyState
              icon="fas fa-building"
              title="No office locations yet"
              description="Mark a location as an office under Masters → Locations, then manage floors and spaces here."
              action={<Link to="/locations" className="btn btn-theme">Open Locations</Link>}
            />
          ) : (
            <div className="space-card-grid">
              {offices.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className="space-nav-card"
                  onClick={() => setDrill({ office: String(o.id) })}
                >
                  <span className="space-nav-card-icon" aria-hidden>
                    <i className="fas fa-building" />
                  </span>
                  <span className="space-nav-card-body">
                    <span className="space-nav-card-kicker">{companyName(o) || 'Office'}</span>
                    <strong className="space-nav-card-title">{o.name}</strong>
                    <span className="space-nav-card-meta">
                      {o.floors_total} floor{o.floors_total === 1 ? '' : 's'}
                      {o.floors_inactive ? ` · ${o.floors_inactive} inactive` : ''}
                      {o.address ? ` · ${o.address}` : ''}
                    </span>
                  </span>
                  <span className="space-nav-card-chevron" aria-hidden>
                    <i className="fas fa-chevron-right" />
                  </span>
                </button>
              ))}
            </div>
          )}
        </Box>
      ) : null}

      {officeId && !detail && !error ? <p className="text-muted">Loading office…</p> : null}

      {officeId && detail && !floorId ? (
        <>
          <Box title={`Floors · ${detail.name}`} type="primary">
            {detail.floors.length === 0 ? (
              <EmptyState
                icon="fas fa-layer-group"
                title="No floors yet"
                description="Add the first floor for this office, then create cabins, meeting rooms and workstations on it."
              />
            ) : (
              <div className="table-responsive">
                <table className="table table-hover space-floor-table">
                  <thead>
                    <tr>
                      <th>Floor</th>
                      <th>Status</th>
                      <th>Cabins</th>
                      <th>Meeting</th>
                      <th>Workstations</th>
                      <th>Seats</th>
                      <th>Items</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.floors.map((f) => {
                      const cabins = f.spaces.filter((s) => kindOf(s.subtype) === 'CABIN')
                      const rooms = f.spaces.filter((s) => kindOf(s.subtype) === 'MEETING_ROOM')
                      const desks = f.spaces.filter((s) => kindOf(s.subtype) === 'WORKSTATION')
                      const items = f.spaces.reduce((n, s) => n + Number(s.asset_count || 0), 0)
                      return (
                        <tr
                          key={f.id}
                          className={f.space_active ? '' : 'is-muted'}
                          onClick={() => setDrill({ office: officeId, floor: String(f.id) })}
                        >
                          <td>
                            <strong>{f.name}</strong>
                            <div className="text-muted" style={{ fontSize: 12 }}>{detail.name}</div>
                          </td>
                          <td>
                            <span className={`space-occupancy-pill ${f.space_active ? 'is-free' : 'is-occupied'}`}>
                              {f.space_active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td>{cabins.length}</td>
                          <td>{rooms.length}</td>
                          <td>{desks.length}</td>
                          <td>{f.seat_count || desks.length || '—'}</td>
                          <td>{items || '—'}</td>
                          <td className="space-table-actions" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              className="btn btn-xs btn-theme"
                              onClick={() => setDrill({ office: officeId, floor: String(f.id) })}
                            >
                              Open
                            </button>
                            <button
                              type="button"
                              className="btn btn-xs btn-default"
                              onClick={() => { void toggleFloor(f) }}
                            >
                              {f.space_active ? 'Mark inactive' : 'Mark active'}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Box>
          <Box title="Add floor">
            <div className="space-add-row">
              <input
                className="form-control"
                placeholder="Floor name (e.g. Floor 1)"
                value={floorName}
                onChange={(e) => setFloorName(e.target.value)}
              />
              <input
                className="form-control space-add-seats"
                placeholder="Seats"
                value={floorSeats}
                onChange={(e) => setFloorSeats(e.target.value)}
              />
              <button type="button" className="btn btn-theme" onClick={() => { void createFloor() }}>
                Add floor
              </button>
            </div>
          </Box>
        </>
      ) : null}

      {floor && !kind ? (
        <Box title={`${floor.name} · spaces`} type="primary">
          <div className="space-card-grid space-card-grid-kinds">
            {KINDS.map((k) => {
              const count = kindCounts[k.value]
              return (
                <button
                  key={k.value}
                  type="button"
                  className={`space-nav-card${count.spaces ? '' : ' is-muted'}`}
                  onClick={() => setDrill({ office: officeId, floor: floorId, kind: k.value })}
                >
                  <span className="space-nav-card-icon" aria-hidden>
                    <i className={k.icon} />
                  </span>
                  <span className="space-nav-card-body">
                    <span className="space-nav-card-kicker">Space type</span>
                    <strong className="space-nav-card-title">{k.plural}</strong>
                    <span className="space-nav-card-meta">
                      <span className="space-stat-chips">
                        <span>{count.spaces} {count.spaces === 1 ? k.label.toLowerCase() : k.plural.toLowerCase()}</span>
                        {count.seats ? <span>{count.seats} seats</span> : null}
                        {k.value === 'CABIN' || k.value === 'WORKSTATION' ? (
                          <>
                            <span>{count.occupied} occupied</span>
                            <span>{Math.max(0, count.spaces - count.occupied)} free</span>
                          </>
                        ) : null}
                      </span>
                    </span>
                  </span>
                  <span className="space-nav-card-chevron" aria-hidden>
                    <i className="fas fa-chevron-right" />
                  </span>
                </button>
              )
            })}
          </div>
        </Box>
      ) : null}

      {floor && kind ? (
        <>
          <Box
            title={`${detail?.name || office?.name || 'Office'} · ${floor.name} · ${kindMeta(kind).plural}`}
            type="primary"
          >
            {kind === 'WORKSTATION' ? (
              <div className="space-seat-toolbar">
                <p className="help-block" style={{ margin: 0, flex: 1 }}>
                  Each seating position is its own record. Assign an employee from Actions — this is the desk, not the whole floor.
                </p>
                <input
                  className="form-control space-add-seats"
                  type="number"
                  min={1}
                  max={200}
                  placeholder="Count"
                  value={seatGenCount || (Math.max(Number(floor.seat_count || 0) - spacesOfKind.length, 0) || '')}
                  onChange={(e) => setSeatGenCount(e.target.value)}
                />
                <button type="button" className="btn btn-theme" disabled={seatBusy} onClick={() => { void generateSeats() }}>
                  {seatBusy ? 'Creating…' : 'Create seating records'}
                </button>
              </div>
            ) : null}
            {spacesOfKind.length === 0 ? (
              <EmptyState
                icon={kindMeta(kind).icon}
                title={`No ${kindMeta(kind).plural.toLowerCase()} on this floor`}
                description={kind === 'WORKSTATION'
                  ? 'Create seating records for this floor, then assign each seat to an employee.'
                  : 'Add one below, then open it to occupy it and tag assets.'}
              />
            ) : (
              <DataTable
                selectable={false}
                exportName={kindMeta(kind).plural.toLowerCase().replace(/\s+/g, '-')}
                storageKey={`space_${kind.toLowerCase()}_columns`}
                columns={[
                  {
                    key: 'name',
                    label: kind === 'WORKSTATION' ? 'Seat' : kindMeta(kind).label,
                    render: (r) => (
                      <button
                        type="button"
                        className="btn-link"
                        onClick={() => setDrill({
                          office: officeId,
                          floor: floorId,
                          kind,
                          space: String(r.id),
                        })}
                      >
                        {String(r.name)}
                      </button>
                    ),
                  },
                  {
                    key: 'occupant',
                    label: 'Occupant',
                    render: (r) => r.occupant_name
                      ? occupantLabel(r as unknown as SpaceRow)
                      : '—',
                  },
                  {
                    key: 'status',
                    label: 'Status',
                    render: (r) => (
                      <span className={`space-occupancy-pill ${r.occupant_name ? 'is-occupied' : 'is-free'}`}>
                        {r.occupant_name ? 'Occupied' : 'Free'}
                      </span>
                    ),
                  },
                  {
                    key: 'asset_count',
                    label: 'Items',
                    render: (r) => String(r.asset_count || 0),
                  },
                  {
                    key: 'actions',
                    label: 'Actions',
                    exportable: false,
                    render: (r) => {
                      const space = r as unknown as SpaceRow
                      const openAssign = assigningId === space.id
                      return (
                        <div className="space-table-actions" onClick={(e) => e.stopPropagation()}>
                          {openAssign ? (
                            <>
                              <EmployeeSelect
                                value={occupantPick}
                                onChange={setOccupantPick}
                                placeholder="Select employee…"
                                excludeId={space.occupant_employee_id}
                              />
                              <button
                                type="button"
                                className="btn btn-xs btn-theme"
                                disabled={occupantBusy || !occupantPick}
                                onClick={() => { void assignOccupantTo(space, occupantPick) }}
                              >
                                {occupantBusy ? 'Saving…' : 'Save'}
                              </button>
                              <button type="button" className="btn btn-xs btn-default" onClick={() => { setAssigningId(null); setOccupantPick('') }}>
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="btn btn-xs btn-theme"
                                onClick={() => { setAssigningId(space.id); setOccupantPick('') }}
                              >
                                {space.occupant_name ? 'Reassign' : 'Assign'}
                              </button>
                              {space.occupant_name ? (
                                <button
                                  type="button"
                                  className="btn btn-xs btn-default"
                                  disabled={occupantBusy}
                                  onClick={() => { void unassignOccupantFrom(space) }}
                                >
                                  Unassign
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className="btn btn-xs btn-default"
                                onClick={() => setDrill({
                                  office: officeId,
                                  floor: floorId,
                                  kind,
                                  space: String(space.id),
                                })}
                              >
                                Open
                              </button>
                            </>
                          )}
                        </div>
                      )
                    },
                  },
                ]}
                rows={spacesOfKind as unknown as Array<Record<string, unknown>>}
              />
            )}
          </Box>

          {selectedSpace ? (
            <>
              <Box title={`Occupancy · ${selectedSpace.name}`} type="primary">
                {selectedSpace.occupant_name ? (
                  <div className="space-occupancy">
                    <div className="space-occupancy-person">
                      <span className="space-occupancy-avatar" aria-hidden>
                        {initials(selectedSpace.occupant_name)}
                      </span>
                      <div>
                        <strong>
                          {selectedSpace.occupant_employee_id ? (
                            <Link to={`/employees/${selectedSpace.occupant_employee_id}`}>
                              {occupantLabel(selectedSpace)}
                            </Link>
                          ) : occupantLabel(selectedSpace)}
                        </strong>
                        <span className="space-occupancy-pill is-occupied">Occupied</span>
                      </div>
                    </div>
                    <p className="help-block" style={{ marginTop: 0 }}>
                      This {kindMeta(selectedSpace.subtype).label.toLowerCase()} is assigned to{' '}
                      <strong>{selectedSpace.occupant_name}</strong>. Unassign to make it free, or pick another employee to reassign.
                    </p>
                    <div className="space-occupancy-actions">
                      <EmployeeSelect
                        value={occupantPick}
                        onChange={setOccupantPick}
                        placeholder="Reassign to another employee…"
                        excludeId={selectedSpace.occupant_employee_id}
                      />
                      <button
                        type="button"
                        className="btn btn-theme"
                        disabled={occupantBusy || !occupantPick}
                        onClick={() => { void assignOccupant() }}
                      >
                        {occupantBusy ? 'Saving…' : 'Reassign'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-default"
                        disabled={occupantBusy}
                        onClick={() => { void unassignOccupant() }}
                      >
                        Unassign
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-occupancy">
                    <span className="space-occupancy-pill is-free">Free to occupy</span>
                    <p className="help-block">
                      Assign this {kindMeta(selectedSpace.subtype).label.toLowerCase()} to an employee (for example CTO Cabin → Gowtham S).
                    </p>
                    <div className="space-occupancy-actions">
                      <EmployeeSelect
                        value={occupantPick}
                        onChange={setOccupantPick}
                        placeholder="Select employee…"
                      />
                      <button
                        type="button"
                        className="btn btn-theme"
                        disabled={occupantBusy || !occupantPick}
                        onClick={() => { void assignOccupant() }}
                      >
                        {occupantBusy ? 'Assigning…' : 'Assign'}
                      </button>
                    </div>
                  </div>
                )}
              </Box>
              <Box title={`Items in ${selectedSpace.name}`} type="primary">
              <p className="help-block">
                {kind === 'CABIN'
                  ? 'Tag room fixtures (TV, AC, cupboard, remotes, charging point) to this cabin so they stay with the room. Assign laptops and phones to the occupant.'
                  : 'Assets whose location is this space appear here. Tag fixtures to the space, or assign personal items to the occupant.'}
              </p>
              {selectedSpace.occupant_employee_id || assets.some((r) => !r.assigned_to && String(r.module || 'asset') === 'asset') ? (
                <div className="space-tag-actions">
                  <button
                    type="button"
                    className="btn btn-xs btn-default"
                    disabled={tagBusy != null}
                    onClick={() => { void bulkTag('cabin') }}
                  >
                    {tagBusy === 'cabin' ? 'Tagging…' : 'Tag unassigned items to this space'}
                  </button>
                  {selectedSpace.occupant_employee_id ? (
                    <button
                      type="button"
                      className="btn btn-xs btn-theme"
                      disabled={tagBusy != null}
                      onClick={() => { void bulkTag('occupant') }}
                    >
                      {tagBusy === 'occupant' ? 'Assigning…' : `Give unassigned items to ${selectedSpace.occupant_name}`}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {assetsLoading ? <p className="text-muted mb-0">Loading items…</p> : null}
              {!assetsLoading && assets.length === 0 ? (
                <p className="text-muted mb-0">
                  No assets here yet. On the asset, set Default Location (or assign to this location) so the TV / AC / laptop shows up on this cabin or seat.
                </p>
              ) : null}
              {!assetsLoading && assets.length > 0 ? (
                <DataTable
                  selectable={false}
                  exportName="space-items"
                  columns={[
                    {
                      key: 'identifier',
                      label: 'Tag / ID',
                      render: (r) => String(r.identifier || r.id || '—'),
                    },
                    {
                      key: 'name',
                      label: 'Name',
                      render: (r) => [r.name, r.model].filter(Boolean).map(String).join(' · ') || '—',
                    },
                    {
                      key: 'tag',
                      label: 'Tagged to',
                      render: (r) => {
                        const tag = String(r.tag || (r.assigned_type === 'employee' || r.assigned_type === 'user' ? 'occupant' : r.assigned_to ? 'cabin' : 'untagged'))
                        if (tag === 'cabin') return <span className="space-occupancy-pill is-free">Cabin fixture</span>
                        if (tag === 'occupant') return <span className="space-occupancy-pill is-occupied">{String(r.assigned_name || 'Occupant')}</span>
                        return <span className="text-muted">Not tagged</span>
                      },
                    },
                    {
                      key: 'actions',
                      label: 'Actions',
                      exportable: false,
                      render: (r) => String(r.module || 'asset') !== 'asset' ? (
                        <Link to={modulePath(r)} className="btn btn-xs btn-default">Open</Link>
                      ) : (
                        <div className="space-table-actions">
                          <button
                            type="button"
                            className="btn btn-xs btn-default"
                            disabled={tagBusy != null}
                            onClick={() => { void tagAsset(r, 'cabin') }}
                          >
                            Tag to cabin
                          </button>
                          {selectedSpace.occupant_employee_id ? (
                            <button
                              type="button"
                              className="btn btn-xs btn-theme"
                              disabled={tagBusy != null}
                              onClick={() => { void tagAsset(r, 'occupant') }}
                            >
                              Give to occupant
                            </button>
                          ) : null}
                          <Link to={modulePath(r)} className="btn btn-xs btn-default">Open</Link>
                        </div>
                      ),
                    },
                  ]}
                  rows={assets}
                />
              ) : null}
            </Box>
            </>
          ) : null}

          <Box title={`Add ${kindMeta(kind).label.toLowerCase()}`}>
            <div className="space-add-row">
              <Field label="Type">
                <select
                  className="form-control"
                  value={spaceType}
                  onChange={(e) => setSpaceType(e.target.value as SpaceKind)}
                >
                  {KINDS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </Field>
              <Field label="Name">
                <input
                  className="form-control"
                  value={spaceName}
                  onChange={(e) => setSpaceName(e.target.value)}
                  placeholder={kind === 'CABIN' ? 'Cabin 03' : kindMeta(kind).label}
                />
              </Field>
              <Field label="Seats">
                <input
                  className="form-control"
                  value={spaceSeats}
                  onChange={(e) => setSpaceSeats(e.target.value)}
                />
              </Field>
              <button type="button" className="btn btn-theme" onClick={() => { void createSpace() }}>
                Add space
              </button>
            </div>
          </Box>
        </>
      ) : null}
    </AppLayout>
  )
}
