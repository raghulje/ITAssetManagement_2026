import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import AppLayout from '../../layout/AppLayout'
import { Box } from '../../components/ui'
import { useAuth } from '../../api/AuthContext'
import { useToast } from '../../components/Toast'
import {
  facilitiesApi,
  mastersApi,
  type FacilityTreeNode,
  type SelectOption,
} from '../../api/client'
import FacilityMetrics from './FacilityMetrics'
import FacilityHierarchyTree from './FacilityHierarchyTree'
import FacilityNodeDetails from './FacilityNodeDetails'
import FacilityNodeFormDialog from './FacilityNodeFormDialog'
import MoveFacilityNodeDialog from './MoveFacilityNodeDialog'
import OperationalLocationsView from './OperationalLocationsView'
import {
  ancestorIdsToExpand,
  countTypes,
  defaultExpandedIds,
  emptyCounts,
  errMessages,
  expandIdsForSearch,
  filterTreeByName,
  findNode,
} from './hierarchyUx'

const NARROW_MQ = '(max-width: 991px)'

function useIsNarrow() {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(NARROW_MQ).matches : false,
  )
  useEffect(() => {
    const mq = window.matchMedia(NARROW_MQ)
    const onChange = () => setNarrow(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return narrow
}

type Props = { mode: 'physical' | 'operational' }

export default function FacilityManagementPage({ mode }: Props) {
  const { can } = useAuth()
  const canView = can('settings.view')
  const canEdit = can('settings.edit')
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const isNarrow = useIsNarrow()

  const selectedId = (() => {
    const raw = searchParams.get('node')
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  })()

  const [trees, setTrees] = useState<FacilityTreeNode[]>([])
  const [treeLoading, setTreeLoading] = useState(mode === 'physical')
  const [treeError, setTreeError] = useState('')
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const [showArchived, setShowArchived] = useState(false)
  const [companyFilter, setCompanyFilter] = useState('')
  const [treeSearch, setTreeSearch] = useState('')
  const [companies, setCompanies] = useState<SelectOption[]>([])
  const [mobileView, setMobileView] = useState<'tree' | 'detail'>('tree')

  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'create' | 'child'>('create')
  const [formParentId, setFormParentId] = useState<number | null>(null)
  const [moveOpen, setMoveOpen] = useState(false)

  useEffect(() => {
    if (mode !== 'physical') return
    mastersApi.companies()
      .then((res) => setCompanies(res.results || []))
      .catch(() => setCompanies([]))
  }, [mode])

  const loadTree = useCallback(async (selectId?: number | null) => {
    setTreeLoading(true)
    setTreeError('')
    try {
      const res = await facilitiesApi.getTree({
        include_archived: showArchived ? 'true' : undefined,
        company_id: companyFilter || undefined,
      })
      const next = res.trees || []
      setTrees(next)
      const focusId = selectId !== undefined ? selectId : selectedId
      setExpandedIds((prev) => {
        const base = prev.size === 0 ? defaultExpandedIds(next) : new Set(prev)
        if (focusId != null) {
          for (const id of ancestorIdsToExpand(next, focusId)) base.add(id)
          base.add(focusId)
        }
        return base
      })
      if (focusId != null && !findNode(next, focusId)) {
        setSearchParams({}, { replace: true })
      } else if (selectId != null) {
        setSearchParams({ node: String(selectId) }, { replace: true })
      }
    } catch (e) {
      setTreeError(errMessages(e).join(', '))
      setTrees([])
    } finally {
      setTreeLoading(false)
    }
  }, [showArchived, companyFilter, selectedId, setSearchParams])

  useEffect(() => {
    if (mode !== 'physical') return
    void loadTree()
  }, [mode, showArchived, companyFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isNarrow) setMobileView('tree')
  }, [isNarrow])

  const displayTrees = useMemo(
    () => filterTreeByName(trees, treeSearch),
    [trees, treeSearch],
  )

  useEffect(() => {
    if (!treeSearch.trim()) return
    const expand = expandIdsForSearch(trees, treeSearch)
    if (!expand.length) return
    setExpandedIds((prev) => {
      const next = new Set(prev)
      for (const id of expand) next.add(id)
      return next
    })
  }, [treeSearch, trees])

  const counts = useMemo(
    () => (displayTrees.length ? countTypes(displayTrees) : emptyCounts()),
    [displayTrees],
  )

  const selectNode = (id: number) => {
    setSearchParams({ node: String(id) }, { replace: true })
    setExpandedIds((prev) => {
      const next = new Set(prev)
      for (const a of ancestorIdsToExpand(trees, id)) next.add(a)
      next.add(id)
      return next
    })
    if (isNarrow) setMobileView('detail')
  }

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (!canView) {
    return (
      <AppLayout title="Facility Management" backTo="/">
        <div className="callout callout-danger">
          <p>You do not have permission to view Facility Management.</p>
        </div>
      </AppLayout>
    )
  }

  if (mode === 'operational') {
    return (
      <AppLayout
        title="Facility Management"
        subtitle="Operational / HRMS locations — separate from the physical hierarchy"
        backTo="/"
      >
        <OperationalLocationsView />
      </AppLayout>
    )
  }

  const openCreate = () => {
    setFormMode('create')
    setFormParentId(null)
    setFormOpen(true)
  }

  const openAddChild = () => {
    if (selectedId == null) return
    setFormMode('child')
    setFormParentId(selectedId)
    setFormOpen(true)
  }

  const showTreePane = !isNarrow || mobileView === 'tree'
  const showDetailPane = !isNarrow || mobileView === 'detail'

  return (
    <AppLayout
      title="Facility Management"
      subtitle="Manage physical sites, buildings, floors, zones, department areas, and spaces"
      backTo="/"
    >
      <div className="callout callout-info facility-dual-model-note">
        <p>
          <strong>Physical hierarchy</strong> (this tab) is for typed Sites, Buildings, Floors, and Spaces.
          It is separate from <strong>operational</strong> locations used for IT asset placement.
          Creating a physical “Tower” building does not move assets off the operational Refex Tower location.
        </p>
      </div>

      <div className="facility-toolbar">
        <div className="facility-toolbar-actions">
          {canEdit ? (
            <button type="button" className="btn btn-theme btn-sm" onClick={openCreate}>
              <i className="fas fa-plus" /> Add Facility
            </button>
          ) : null}
          <label className="facility-archived-toggle">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            {' '}Show archived
          </label>
        </div>
      </div>

      <FacilityMetrics counts={counts} />

      <div className={`facility-workspace${isNarrow ? ' is-narrow' : ''}`}>
        {showTreePane ? (
          <Box title="Physical Hierarchy" type="primary">
            <div className="facility-tree-filters">
              <div className="facility-tree-filter">
                <label htmlFor="facility-tree-search">Search</label>
                <input
                  id="facility-tree-search"
                  className="form-control input-sm"
                  type="search"
                  placeholder="Name, type, or subtype…"
                  value={treeSearch}
                  onChange={(e) => setTreeSearch(e.target.value)}
                />
              </div>
              <div className="facility-tree-filter">
                <label htmlFor="facility-company-filter">Company</label>
                <select
                  id="facility-company-filter"
                  className="form-control input-sm"
                  value={companyFilter}
                  onChange={(e) => setCompanyFilter(e.target.value)}
                >
                  <option value="">All companies</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.text}</option>
                  ))}
                </select>
              </div>
            </div>
            <FacilityHierarchyTree
              trees={displayTrees}
              selectedId={selectedId}
              expandedIds={expandedIds}
              loading={treeLoading}
              error={treeError}
              canEdit={canEdit}
              searchQuery={treeSearch}
              companyFilter={companyFilter}
              emptyUnfiltered={trees.length === 0}
              onSelect={selectNode}
              onToggle={toggleExpand}
              onRetry={() => { void loadTree() }}
              onAddFacility={openCreate}
            />
          </Box>
        ) : null}

        {showDetailPane ? (
          <Box title="Facility Details" type="default">
            <FacilityNodeDetails
              trees={trees}
              selectedId={selectedId}
              canEdit={canEdit}
              showArchived={showArchived}
              mobileBack={isNarrow ? () => setMobileView('tree') : undefined}
              onSelect={selectNode}
              onAddChild={openAddChild}
              onMove={() => setMoveOpen(true)}
              onArchivedChanged={() => {
                toast.success('Hierarchy updated')
                void loadTree(null)
                if (isNarrow) setMobileView('tree')
              }}
            />
          </Box>
        ) : null}
      </div>

      <FacilityNodeFormDialog
        open={formOpen}
        mode={formMode}
        trees={trees}
        parentId={formParentId}
        parentName={formParentId != null ? findNode(trees, formParentId)?.name : undefined}
        parentTypeCode={formParentId != null ? findNode(trees, formParentId)?.location_type?.code : null}
        onClose={() => setFormOpen(false)}
        onSuccess={(newId) => {
          setFormOpen(false)
          toast.success('Facility created')
          void loadTree(newId).then(() => {
            if (isNarrow) setMobileView('detail')
          })
        }}
      />

      {selectedId != null ? (
        <MoveFacilityNodeDialog
          open={moveOpen}
          trees={trees}
          nodeId={selectedId}
          onClose={() => setMoveOpen(false)}
          onSuccess={() => {
            setMoveOpen(false)
            toast.success('Facility moved')
            void loadTree(selectedId)
          }}
        />
      ) : null}
    </AppLayout>
  )
}
