import { useEffect, useMemo, useState } from 'react'
import { Field } from './ui'
import { MasterSelect, masterPayloadId } from './MasterSelect'
import { AppSelect } from './formControls'
import { mastersApi, type SelectOption } from '../api/client'

export type EntityOption = SelectOption & { code?: string | null; company_id?: number }

type Props = {
  companyId: string
  legalEntityId: string
  companies: SelectOption[]
  onCompaniesChange: (opts: SelectOption[]) => void
  onCompanyChange: (companyId: string) => void
  onLegalEntityChange: (legalEntityId: string) => void
  required?: boolean
  disabled?: boolean
}

/**
 * Company master + HRMS legal-entity child.
 * Choosing a company loads entity codes and auto-selects when there is only one.
 */
export function CompanyEntityFields({
  companyId,
  legalEntityId,
  companies,
  onCompaniesChange,
  onCompanyChange,
  onLegalEntityChange,
  required,
  disabled,
}: Props) {
  const [entities, setEntities] = useState<EntityOption[]>([])
  const [loadingEntities, setLoadingEntities] = useState(false)

  useEffect(() => {
    if (!companyId) {
      setEntities([])
      if (legalEntityId) onLegalEntityChange('')
      return
    }
    let cancelled = false
    setLoadingEntities(true)
    mastersApi
      .legalEntities(companyId)
      .then((r) => {
        if (cancelled) return
        const rows = (r.results || []) as EntityOption[]
        setEntities(rows)
        if (rows.length === 1) {
          onLegalEntityChange(String(rows[0].id))
        } else if (legalEntityId && !rows.some((e) => String(e.id) === String(legalEntityId))) {
          onLegalEntityChange('')
        }
      })
      .catch(() => {
        if (!cancelled) setEntities([])
      })
      .finally(() => {
        if (!cancelled) setLoadingEntities(false)
      })
    return () => { cancelled = true }
    // intentionally re-run when company changes; entity id cleared by handlers above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  const selectedCompany = useMemo(
    () => companies.find((c) => String(c.id) === String(companyId)),
    [companies, companyId],
  )
  const selectedEntity = useMemo(
    () => entities.find((e) => String(e.id) === String(legalEntityId)),
    [entities, legalEntityId],
  )

  const autoCode = selectedEntity?.code
    || (selectedEntity?.text?.includes(' — ')
      ? String(selectedEntity.text).split(' — ')[0]
      : selectedEntity?.text)
    || (selectedCompany as EntityOption | undefined)?.code
    || ''

  const entityOptions = useMemo(
    () => [
      { value: '', label: loadingEntities ? 'Loading entity codes…' : (entities.length ? 'Select entity code…' : 'No entity codes for this company') },
      ...entities.map((e) => ({ value: String(e.id), label: e.text })),
    ],
    [entities, loadingEntities],
  )

  return (
    <>
      <MasterSelect
        label="Company"
        required={required}
        value={companyId}
        options={companies}
        onChange={(v) => {
          onCompanyChange(v)
          onLegalEntityChange('')
        }}
        onOptionsChange={onCompaniesChange}
        allowEmpty={!required}
        emptyLabel="Select company…"
        disabled={disabled}
        help="HRMS company name — entity / company code fills from LEGAL_ENTITY_CODE"
        create={async (name) => {
          const res = await mastersApi.createCompany({ name })
          return masterPayloadId(res, name)
        }}
      />

      <Field label="Entity / company code">
        <AppSelect
          value={legalEntityId}
          onChange={onLegalEntityChange}
          options={entityOptions}
          disabled={disabled || !companyId || loadingEntities || entities.length === 0}
          placeholder="Entity code"
        />
        <p className="help-block" style={{ marginBottom: 0 }}>
          {autoCode
            ? <>Selected code: <strong>{autoCode}</strong> (from HRMS)</>
            : 'Synced from Adrenalin LEGAL_ENTITY_CODE when you Sync HRMS / Sync masters'}
        </p>
      </Field>
    </>
  )
}
