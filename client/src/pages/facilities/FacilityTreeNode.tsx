import type { FacilityTreeNode } from '../../api/client'
import { TYPE_ICON, nodeMatchesSearch } from './hierarchyUx'

type Props = {
  node: FacilityTreeNode
  depth: number
  selectedId: number | null
  expandedIds: Set<number>
  searchQuery?: string
  onSelect: (id: number) => void
  onToggle: (id: number) => void
}

function highlightName(name: string, query: string) {
  const q = query.trim()
  if (!q) return name
  const lower = name.toLowerCase()
  const idx = lower.indexOf(q.toLowerCase())
  if (idx < 0) return name
  return (
    <>
      {name.slice(0, idx)}
      <mark className="facility-tree-mark">{name.slice(idx, idx + q.length)}</mark>
      {name.slice(idx + q.length)}
    </>
  )
}

export default function FacilityTreeNode({
  node,
  depth,
  selectedId,
  expandedIds,
  searchQuery = '',
  onSelect,
  onToggle,
}: Props) {
  const code = node.location_type?.code || ''
  const hasChildren = (node.children?.length || 0) > 0
  const expanded = expandedIds.has(node.id)
  const selected = selectedId === node.id
  const icon = TYPE_ICON[code] || 'fas fa-map-pin'
  const subtype = node.space_subtype?.name
  const match = nodeMatchesSearch(node, searchQuery)

  return (
    <li
      className={`facility-tree-item${selected ? ' is-selected' : ''}${node.archived ? ' is-archived' : ''}${match ? ' is-match' : ''}`}
    >
      <div
        className="facility-tree-row"
        style={{ paddingLeft: 8 + depth * 14 }}
        role="treeitem"
        aria-selected={selected}
        aria-expanded={hasChildren ? expanded : undefined}
      >
        <button
          type="button"
          className="facility-tree-twist"
          disabled={!hasChildren}
          aria-label={expanded ? 'Collapse' : 'Expand'}
          onClick={() => hasChildren && onToggle(node.id)}
        >
          {hasChildren ? <i className={`fas fa-caret-${expanded ? 'down' : 'right'}`} /> : <span className="facility-tree-twist-spacer" />}
        </button>
        <button type="button" className="facility-tree-label" onClick={() => onSelect(node.id)}>
          <i className={`${icon} facility-tree-icon`} aria-hidden />
          <span className="facility-tree-name">{highlightName(node.name, searchQuery)}</span>
          <span className="label label-default facility-tree-type">
            {node.location_type?.name || code || '—'}
            {subtype ? ` · ${subtype}` : ''}
          </span>
          {node.archived ? <span className="label label-warning">Archived</span> : null}
        </button>
      </div>
      {hasChildren && expanded ? (
        <ul className="facility-tree-children" role="group">
          {node.children.map((child) => (
            <FacilityTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              expandedIds={expandedIds}
              searchQuery={searchQuery}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}
