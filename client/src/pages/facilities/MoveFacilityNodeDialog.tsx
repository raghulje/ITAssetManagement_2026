import { useEffect, useMemo, useState } from 'react'
import { facilitiesApi, type FacilityTreeNode } from '../../api/client'
import { Field } from '../../components/ui'
import {
  collectDescendantIds,
  errMessages,
  findNode,
  flattenTypedNodes,
} from './hierarchyUx'

type Props = {
  open: boolean
  trees: FacilityTreeNode[]
  nodeId: number
  onClose: () => void
  onSuccess: () => void
}

export default function MoveFacilityNodeDialog({
  open,
  trees,
  nodeId,
  onClose,
  onSuccess,
}: Props) {
  const node = findNode(trees, nodeId)
  const [parentId, setParentId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open || !node) return
    setParentId(node.parent_id != null ? String(node.parent_id) : '')
    setError('')
  }, [open, node])

  const options = useMemo(() => {
    if (!node) return []
    const blocked = collectDescendantIds(node)
    blocked.add(node.id)
    return flattenTypedNodes(trees).filter(
      (n) => !n.archived && !blocked.has(n.id) && n.location_type?.code !== 'SPACE',
    )
  }, [trees, node])

  if (!open || !node) return null

  const currentParent = node.parent_id != null ? findNode(trees, node.parent_id) : null
  const typeCode = node.location_type?.code

  const submit = async () => {
    if (typeCode === 'SITE') {
      setError('SITE must remain a root node')
      return
    }
    const pid = parentId === '' ? null : Number(parentId)
    setBusy(true)
    setError('')
    try {
      await facilitiesApi.validateParentMove(nodeId, pid)
      await facilitiesApi.moveNode(nodeId, pid)
      onSuccess()
    } catch (e) {
      setError(errMessages(e).join('\n'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="facility-modal-backdrop" role="presentation" onClick={onClose}>
      <div className="facility-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="facility-modal-head">
          <h3>Move facility</h3>
          <button type="button" className="btn btn-default btn-sm" onClick={onClose} aria-label="Close">
            <i className="fas fa-times" />
          </button>
        </div>
        <p className="help-block">
          Moving changes hierarchy only. Asset and inventory placements stay on the same location ID.
        </p>
        <p><strong>{node.name}</strong> <span className="label label-default">{typeCode}</span></p>
        <p className="text-muted">Current parent: {currentParent?.name || (node.parent_id == null ? 'Root' : `ID ${node.parent_id}`)}</p>
        {error ? (
          <div className="callout callout-danger">
            {error.split('\n').map((line) => <p key={line}>{line}</p>)}
          </div>
        ) : null}
        <Field label="New parent" required>
          <select className="form-control" value={parentId} onChange={(e) => setParentId(e.target.value)} disabled={typeCode === 'SITE'}>
            <option value="">— Root (SITE only) —</option>
            {options.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name} ({n.location_type?.code || '—'})
              </option>
            ))}
          </select>
        </Field>
        <div className="facility-modal-actions">
          <button type="button" className="btn btn-default" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-theme" onClick={() => { void submit() }} disabled={busy || typeCode === 'SITE'}>
            {busy ? 'Moving…' : 'Move'}
          </button>
        </div>
      </div>
    </div>
  )
}
