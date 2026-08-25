import type { FacilityTreeNode } from '../../api/client'
import FacilityTreeNodeRow from './FacilityTreeNode'

type Props = {
  trees: FacilityTreeNode[]
  selectedId: number | null
  expandedIds: Set<number>
  loading: boolean
  error: string
  canEdit: boolean
  searchQuery?: string
  companyFilter?: string
  emptyUnfiltered?: boolean
  onSelect: (id: number) => void
  onToggle: (id: number) => void
  onRetry: () => void
  onAddFacility: () => void
}

export default function FacilityHierarchyTree({
  trees,
  selectedId,
  expandedIds,
  loading,
  error,
  canEdit,
  searchQuery = '',
  companyFilter = '',
  emptyUnfiltered = false,
  onSelect,
  onToggle,
  onRetry,
  onAddFacility,
}: Props) {
  if (loading) {
    return <p className="text-muted facility-panel-msg">Loading facilities…</p>
  }
  if (error) {
    return (
      <div className="callout callout-danger">
        <p>{error}</p>
        <button type="button" className="btn btn-default btn-sm" onClick={onRetry}>Retry</button>
      </div>
    )
  }
  if (!trees.length) {
    if (searchQuery.trim() && !emptyUnfiltered) {
      return (
        <div className="facility-empty">
          <h4>No facilities match your search.</h4>
          <p className="text-muted">Try a different name, type, or clear the search box.</p>
        </div>
      )
    }
    if (companyFilter) {
      return (
        <div className="facility-empty">
          <h4>No physical facilities for this company.</h4>
          <p className="text-muted">
            Sites are filtered by their company. Clear the company filter or create a Site for this company.
          </p>
          {canEdit ? (
            <button type="button" className="btn btn-theme btn-sm" onClick={onAddFacility}>
              <i className="fas fa-plus" /> Add Facility
            </button>
          ) : null}
        </div>
      )
    }
    return (
      <div className="facility-empty">
        <h4>No physical facilities have been created yet.</h4>
        <p className="text-muted">
          Create a <strong>Site</strong> (with company) to begin: Site → Building → Floor → Zone / Department Area / Space.
          Operational HRMS places (including Refex Tower-Nungambakkam used for asset placement) stay under
          Operational Locations and are not mixed into this tree.
        </p>
        {canEdit ? (
          <button type="button" className="btn btn-theme btn-sm" onClick={onAddFacility}>
            <i className="fas fa-plus" /> Add Facility
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <ul className="facility-tree" role="tree" aria-label="Physical facility hierarchy">
      {trees.map((node) => (
        <FacilityTreeNodeRow
          key={node.id}
          node={node}
          depth={0}
          selectedId={selectedId}
          expandedIds={expandedIds}
          searchQuery={searchQuery}
          onSelect={onSelect}
          onToggle={onToggle}
        />
      ))}
    </ul>
  )
}
