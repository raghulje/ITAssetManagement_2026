import { useEffect, useState } from 'react'
import { facilitiesApi, type FacilityTreeNode } from '../../api/client'
import { DetailLayout, DetailPanel } from '../../components/DetailLayout'
import FacilityBreadcrumb from './FacilityBreadcrumb'
import FacilityAssetsTab from './FacilityAssetsTab'
import FacilityInventoryTab from './FacilityInventoryTab'
import { errMessages, findNode } from './hierarchyUx'

type Props = {
  trees: FacilityTreeNode[]
  selectedId: number | null
  canEdit: boolean
  showArchived: boolean
  mobileBack?: () => void
  onSelect: (id: number) => void
  onAddChild: () => void
  onMove: () => void
  onArchivedChanged: () => void
}

export default function FacilityNodeDetails({
  trees,
  selectedId,
  canEdit,
  showArchived,
  mobileBack,
  onSelect,
  onAddChild,
  onMove,
  onArchivedChanged,
}: Props) {
  const treeNode = selectedId != null ? findNode(trees, selectedId) : null
  const [tab, setTab] = useState('details')
  const [path, setPath] = useState<Array<Omit<FacilityTreeNode, 'children'>>>([])
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setTab('details')
    setActionError('')
  }, [selectedId])

  useEffect(() => {
    if (selectedId == null) {
      setPath([])
      setDetail(null)
      setError('')
      return
    }
    let cancelled = false
    setLoading(true)
    setError('')
    Promise.all([
      facilitiesApi.getPath(selectedId),
      facilitiesApi.getNode(selectedId).catch(() => null),
    ])
      .then(([pathRes, nodeRes]) => {
        if (cancelled) return
        setPath(pathRes.path || [])
        setDetail(nodeRes)
      })
      .catch((e) => {
        if (!cancelled) setError(errMessages(e).join(', '))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [selectedId])

  if (selectedId == null) {
    return (
      <div className="facility-details-empty">
        {mobileBack ? (
          <button type="button" className="btn btn-default btn-sm mb-10" onClick={mobileBack}>
            <i className="fas fa-arrow-left" /> Back to hierarchy
          </button>
        ) : null}
        <p className="text-muted">Select a facility node to view details.</p>
      </div>
    )
  }

  if (!treeNode && !loading) {
    return (
      <div className="callout callout-warning">
        <p>Node not found in the current hierarchy{showArchived ? '' : ' (try Show archived if it was archived)'}.</p>
        {mobileBack ? <button type="button" className="btn btn-default btn-sm" onClick={mobileBack}>Back</button> : null}
      </div>
    )
  }

  const typeCode = treeNode?.location_type?.code || ''
  const isSpace = typeCode === 'SPACE'
  const isSite = typeCode === 'SITE'
  const archived = Boolean(treeNode?.archived)

  const archive = async () => {
    if (!window.confirm(`Archive “${treeNode?.name}”? This is blocked if the node has children, assets, inventory, or other references.`)) return
    setBusy(true)
    setActionError('')
    try {
      await facilitiesApi.archiveNode(selectedId)
      onArchivedChanged()
    } catch (e) {
      setActionError(errMessages(e).join('\n'))
    } finally {
      setBusy(false)
    }
  }

  const restore = async () => {
    setBusy(true)
    setActionError('')
    try {
      await facilitiesApi.restoreNode(selectedId)
      onArchivedChanged()
    } catch (e) {
      setActionError(errMessages(e).join('\n'))
    } finally {
      setBusy(false)
    }
  }

  const companyName = (() => {
    const co = detail?.company
    if (co && typeof co === 'object' && 'name' in co) return String((co as { name?: string }).name || '—')
    if (treeNode?.company_id != null) return `Company #${treeNode.company_id}`
    return '—'
  })()

  const parentName = path.length > 1 ? path[path.length - 2]?.name : (isSite ? 'Root' : '—')

  return (
    <div className="facility-details">
      {mobileBack ? (
        <button type="button" className="btn btn-default btn-sm mb-10" onClick={mobileBack}>
          <i className="fas fa-arrow-left" /> Back to hierarchy
        </button>
      ) : null}
      {actionError ? (
        <div className="callout callout-danger">
          {actionError.split('\n').map((line) => <p key={line}>{line}</p>)}
        </div>
      ) : null}
      {error ? <div className="callout callout-danger"><p>{error}</p></div> : null}
      {loading && !treeNode ? <p className="text-muted">Loading…</p> : null}
      <FacilityBreadcrumb path={path} onNavigate={onSelect} />
      <DetailLayout
        title={treeNode?.name || 'Facility'}
        status={archived ? 'Archived' : 'Active'}
        meta={[
          { label: 'Type', value: treeNode?.location_type?.name || typeCode || '—' },
          ...(isSpace && treeNode?.space_subtype
            ? [{ label: 'Subtype', value: treeNode.space_subtype.name }]
            : []),
        ]}
        actions={canEdit ? (
          <>
            {!archived && !isSpace ? (
              <button type="button" className="btn btn-theme btn-sm" onClick={onAddChild} disabled={busy}>
                <i className="fas fa-plus" /> Add Child
              </button>
            ) : null}
            {!archived && !isSite ? (
              <button type="button" className="btn btn-default btn-sm" onClick={onMove} disabled={busy}>
                <i className="fas fa-arrows-alt" /> Move
              </button>
            ) : null}
            {!archived ? (
              <button type="button" className="btn btn-warning btn-sm" onClick={() => { void archive() }} disabled={busy}>
                <i className="fas fa-archive" /> Archive
              </button>
            ) : (
              <button type="button" className="btn btn-success btn-sm" onClick={() => { void restore() }} disabled={busy}>
                <i className="fas fa-undo" /> Restore
              </button>
            )}
          </>
        ) : null}
        tabs={[
          { id: 'details', label: 'Details' },
          { id: 'assets', label: 'Assets' },
          { id: 'inventory', label: 'Inventory' },
        ]}
        activeTab={tab}
        onTabChange={setTab}
        fields={tab === 'details' ? [
          { label: 'Name', value: treeNode?.name },
          { label: 'Type', value: treeNode?.location_type?.name || typeCode },
          ...(isSpace ? [{ label: 'Space subtype', value: treeNode?.space_subtype?.name || '—' }] : []),
          { label: 'Company', value: companyName },
          { label: 'Parent', value: parentName },
          { label: 'Status', value: archived ? 'Archived' : 'Active' },
          { label: 'Assets (placement)', value: detail?.assets_count != null ? String(detail.assets_count) : '—' },
          { label: 'Notes', value: detail?.notes != null ? String(detail.notes) : '—', full: true },
        ] : undefined}
      >
        {tab === 'assets' ? (
          <DetailPanel title="Assets at this location">
            <FacilityAssetsTab locationId={selectedId} />
          </DetailPanel>
        ) : null}
        {tab === 'inventory' ? (
          <DetailPanel title="Inventory at this location">
            <FacilityInventoryTab locationId={selectedId} />
          </DetailPanel>
        ) : null}
      </DetailLayout>
    </div>
  )
}
