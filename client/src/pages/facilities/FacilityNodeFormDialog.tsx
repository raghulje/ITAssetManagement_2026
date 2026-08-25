import { useEffect, useMemo, useState } from 'react'
import {
  facilitiesApi,
  mastersApi,
  type FacilityTreeNode,
  type FacilityTypeRow,
  type FacilitySubtypeRow,
  type SelectOption,
} from '../../api/client'
import { Field } from '../../components/ui'
import {
  SUGGESTED_CHILD_TYPES,
  type PhysicalTypeCode,
  errMessages,
  flattenTypedNodes,
} from './hierarchyUx'

type Mode = 'create' | 'child'

type Props = {
  open: boolean
  mode: Mode
  trees: FacilityTreeNode[]
  parentId: number | null
  parentName?: string
  parentTypeCode?: string | null
  onClose: () => void
  onSuccess: (newId: number) => void
}

export default function FacilityNodeFormDialog({
  open,
  mode,
  trees,
  parentId,
  parentName,
  parentTypeCode,
  onClose,
  onSuccess,
}: Props) {
  const [types, setTypes] = useState<FacilityTypeRow[]>([])
  const [subtypes, setSubtypes] = useState<FacilitySubtypeRow[]>([])
  const [companies, setCompanies] = useState<SelectOption[]>([])
  const [name, setName] = useState('')
  const [typeId, setTypeId] = useState('')
  const [subtypeId, setSubtypeId] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [selectedParentId, setSelectedParentId] = useState<string>(parentId != null ? String(parentId) : '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setName('')
    setSubtypeId('')
    setCompanyId('')
    setError('')
    setSelectedParentId(parentId != null ? String(parentId) : '')
    Promise.all([
      facilitiesApi.listTypes(),
      facilitiesApi.listSubtypes(),
      mastersApi.companies(),
    ])
      .then(([t, s, c]) => {
        const physical = (t.rows || []).filter((r) => r.code !== 'UNSPECIFIED')
        setTypes(physical)
        setSubtypes(s.rows || [])
        setCompanies(c.results || [])
        if (mode === 'child' && parentTypeCode && parentTypeCode in SUGGESTED_CHILD_TYPES) {
          const suggested = SUGGESTED_CHILD_TYPES[parentTypeCode as PhysicalTypeCode]
          const first = physical.find((r) => suggested.includes(r.code as PhysicalTypeCode))
          setTypeId(first ? String(first.id) : '')
        } else {
          const site = physical.find((r) => r.code === 'SITE')
          setTypeId(site ? String(site.id) : physical[0] ? String(physical[0].id) : '')
        }
      })
      .catch((e) => setError(errMessages(e).join(', ')))
  }, [open, mode, parentId, parentTypeCode])

  const selectedType = types.find((t) => String(t.id) === typeId)
  const isSpace = selectedType?.code === 'SPACE'
  const isSite = selectedType?.code === 'SITE'

  const allowedTypeOptions = useMemo(() => {
    if (mode !== 'child' || !parentTypeCode) return types
    const suggested = SUGGESTED_CHILD_TYPES[parentTypeCode as PhysicalTypeCode] || []
    if (!suggested.length) return []
    return types.filter((t) => suggested.includes(t.code as PhysicalTypeCode))
  }, [mode, parentTypeCode, types])

  const parentOptions = useMemo(() => {
    return flattenTypedNodes(trees).filter((n) => !n.archived && n.location_type?.code !== 'SPACE')
  }, [trees])

  if (!open) return null

  const submit = async () => {
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    if (!typeId) {
      setError('Type is required')
      return
    }
    const typeRow = types.find((t) => String(t.id) === typeId)
    if (!typeRow) {
      setError('Invalid type')
      return
    }
    const pid = isSite
      ? null
      : mode === 'child'
        ? parentId
        : selectedParentId
          ? Number(selectedParentId)
          : null
    if (!isSite && pid == null) {
      setError('Parent is required for this type')
      return
    }
    if (isSite && !companyId) {
      setError('Company is required for a Site')
      return
    }
    setBusy(true)
    setError('')
    try {
      await facilitiesApi.validateParentCreate({
        parent_id: pid,
        location_type_id: Number(typeId),
      })
      const res = await facilitiesApi.createNode({
        name: name.trim(),
        location_type_id: Number(typeId),
        parent_id: pid,
        company_id: isSite && companyId ? Number(companyId) : null,
        space_subtype_id: isSpace && subtypeId ? Number(subtypeId) : null,
      })
      const newId = Number((res.payload as { id?: number })?.id)
      if (!newId) throw new Error('Created node id missing')
      onSuccess(newId)
    } catch (e) {
      setError(errMessages(e).join('\n'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="facility-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="facility-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="facility-node-form-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="facility-modal-head">
          <h3 id="facility-node-form-title">{mode === 'child' ? 'Add Child Facility' : 'Add Facility'}</h3>
          <button type="button" className="btn btn-default btn-sm" onClick={onClose} aria-label="Close">
            <i className="fas fa-times" />
          </button>
        </div>
        {error ? (
          <div className="callout callout-danger">
            {error.split('\n').map((line) => <p key={line}>{line}</p>)}
          </div>
        ) : null}
        {isSite ? (
          <div className="callout callout-info">
            <p>
              A Site is the root of a <strong>physical</strong> campus tree. It does not replace operational /
              HRMS locations used for asset placement (for example “Refex Tower-Nungambakkam”).
            </p>
          </div>
        ) : null}
        <Field label="Name" required>
          <input className="form-control" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Type" required>
          <select
            className="form-control"
            value={typeId}
            onChange={(e) => {
              setTypeId(e.target.value)
              setSubtypeId('')
              const next = types.find((t) => String(t.id) === e.target.value)
              if (next?.code !== 'SITE') setCompanyId('')
            }}
          >
            <option value="">—</option>
            {(mode === 'child' ? allowedTypeOptions : types).map((t) => (
              <option key={t.id} value={t.id}>{t.name} ({t.code})</option>
            ))}
          </select>
        </Field>
        {mode === 'child' ? (
          <Field label="Parent">
            <input className="form-control" value={parentName || `ID ${parentId}`} disabled />
          </Field>
        ) : !isSite ? (
          <Field label="Parent" required>
            <select className="form-control" value={selectedParentId} onChange={(e) => setSelectedParentId(e.target.value)}>
              <option value="">—</option>
              {parentOptions.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name} ({n.location_type?.code || '—'})
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        {isSite ? (
          <Field label="Company" required>
            <select className="form-control" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">— Select company —</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.text}</option>)}
            </select>
            <p className="help-block">Required for Sites. Buildings and floors inherit company context from their Site.</p>
          </Field>
        ) : null}
        {isSpace ? (
          <Field label="Space subtype">
            <select className="form-control" value={subtypeId} onChange={(e) => setSubtypeId(e.target.value)}>
              <option value="">— Optional —</option>
              {subtypes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        ) : null}
        <div className="facility-modal-actions">
          <button type="button" className="btn btn-default" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-theme" onClick={() => { void submit() }} disabled={busy}>
            {busy ? 'Saving…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
