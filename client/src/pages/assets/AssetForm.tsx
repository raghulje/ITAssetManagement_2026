import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import AppLayout from '../../layout/AppLayout'
import { DateField, EmployeeSelect, Field, FileInput, PageForm } from '../../components/ui'
import { MasterSelect, masterPayloadId } from '../../components/MasterSelect'
import { CompanyEntityFields } from '../../components/CompanyEntityFields'
import AssetAttachments, {
  hasRequiredCreateAttachments,
  uploadAssetFile,
  type PendingAttachment,
  type PoParseResult,
} from '../../components/AssetAttachments'
import PoDetailsAttach from '../../components/PoDetailsAttach'
import AssetReceivedCondition, {
  type PendingReceivedImage,
} from '../../components/AssetReceivedCondition'
import LocationMapPicker, { type MapLocationValue } from '../../components/LocationMapPicker'
import { hardwareApi, mastersApi, type SelectOption } from '../../api/client'
import { assetImageSrc, getApiBase } from '../../api/baseUrl'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../api/AuthContext'
import { DomainSelect } from '../../components/DomainSelect'
import { defaultDomainCode } from '../../lib/domainScope'

type FormState = {
  company_id: string
  legal_entity_id: string
  department_id: string
  asset_tag: string
  old_asset_tag: string
  serial: string
  category_id: string
  model_id: string
  status_id: string
  rtd_location_id: string
  map_latitude: string
  map_longitude: string
  map_address: string
  supplier_id: string
  purchase_date: string
  purchase_cost: string
  order_number: string
  warranty_months: string
  asset_eol_date: string
  notes: string
  received_condition: string
  assign_employee_id: string
  domain: string
  processor: string
  ram: string
  storage: string
  os: string
  mac_address: string
  ip_address: string
  color: string
  material: string
  spec_condition: string
}

const empty: FormState = {
  company_id: '',
  legal_entity_id: '',
  department_id: '',
  asset_tag: '',
  old_asset_tag: '',
  serial: '',
  category_id: '',
  model_id: '',
  status_id: '',
  rtd_location_id: '',
  map_latitude: '',
  map_longitude: '',
  map_address: '',
  supplier_id: '',
  purchase_date: '',
  purchase_cost: '',
  order_number: '',
  warranty_months: '12',
  asset_eol_date: '',
  notes: '',
  received_condition: '',
  assign_employee_id: '',
  domain: 'it',
  processor: '',
  ram: '',
  storage: '',
  os: '',
  mac_address: '',
  ip_address: '',
  color: '',
  material: '',
  spec_condition: '',
}

function nestId(v: unknown): string {
  if (v == null || v === '') return ''
  if (typeof v === 'object' && v && 'id' in v) return String((v as { id: number }).id ?? '')
  return String(v)
}

function dateVal(v: unknown): string {
  if (v == null || v === '') return ''
  if (typeof v === 'object' && v && 'date' in v) return String((v as { date: string }).date || '').slice(0, 10)
  return String(v).slice(0, 10)
}

export default function AssetForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const toast = useToast()
  const { domainScope, activeDomain } = useAuth()
  const isEdit = Boolean(id)
  const fromEmployeeId = params.get('from') === 'employee' ? params.get('employee_id') : null
  const returnQs = useMemo(() => {
    if (!fromEmployeeId) return ''
    return `?from=employee&employee_id=${encodeURIComponent(fromEmployeeId)}`
  }, [fromEmployeeId])
  const assetReturnPath = id
    ? (fromEmployeeId ? `/employees/${fromEmployeeId}` : `/hardware/${id}${returnQs}`)
    : '/hardware'
  const [tab, setTab] = useState<'details' | 'attachments'>('details')
  const [form, setForm] = useState<FormState>({
    ...empty,
    domain: activeDomain || defaultDomainCode(domainScope),
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(isEdit)
  const [pendingFiles, setPendingFiles] = useState<PendingAttachment[]>([])
  const [imagePath, setImagePath] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [pendingImage, setPendingImage] = useState<File | null>(null)
  const [pendingImagePreview, setPendingImagePreview] = useState<string | null>(null)
  const [imageBusy, setImageBusy] = useState(false)
  const [imageMsg, setImageMsg] = useState('')
  const [pendingReceived, setPendingReceived] = useState<PendingReceivedImage[]>([])

  const [companies, setCompanies] = useState<SelectOption[]>([])
  const [departments, setDepartments] = useState<SelectOption[]>([])
  const [locations, setLocations] = useState<SelectOption[]>([])
  const [assetTypes, setAssetTypes] = useState<SelectOption[]>([])
  const [models, setModels] = useState<SelectOption[]>([])
  const [statuses, setStatuses] = useState<SelectOption[]>([])
  const [suppliers, setSuppliers] = useState<SelectOption[]>([])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  useEffect(() => {
    Promise.all([
      mastersApi.companies(),
      mastersApi.departments(),
      mastersApi.locations(),
      mastersApi.assetTypes(undefined, form.domain || defaultDomainCode(domainScope)),
      mastersApi.statuslabels(),
      mastersApi.suppliers(),
    ])
      .then(([c, d, l, types, s, sup]) => {
        setCompanies(c.results || [])
        setDepartments(d.results || [])
        setLocations(l.results || [])
        setAssetTypes(types.results || [])
        setStatuses(s.results || [])
        setSuppliers(sup.results || [])
        if (!isEdit) {
          const defaultType = types.results?.find((t) => /laptop/i.test(t.text)) || types.results?.[0]
          setForm((f) => ({
            ...f,
            company_id: f.company_id || (c.results?.[0] ? String(c.results[0].id) : ''),
            department_id: f.department_id || '',
            rtd_location_id: f.rtd_location_id || (l.results?.[0] ? String(l.results[0].id) : ''),
            category_id: f.category_id || (defaultType ? String(defaultType.id) : ''),
            status_id: f.status_id || (s.results?.[0] ? String(s.results[0].id) : ''),
          }))
        }
      })
      .catch((e: Error) => setError(e.message))
  }, [isEdit])

  useEffect(() => {
    let cancelled = false
    mastersApi
      .assetTypes(undefined, form.domain || defaultDomainCode(domainScope))
      .then((types) => {
        if (cancelled) return
        setAssetTypes(types.results || [])
        if (!isEdit) {
          const defaultType = types.results?.find((t) => /laptop/i.test(t.text)) || types.results?.[0]
          setForm((f) => ({
            ...f,
            category_id: defaultType ? String(defaultType.id) : '',
            model_id: '',
          }))
        }
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [form.domain, isEdit, domainScope])

  // Models for the selected asset type (Laptop / Desktop / …)
  useEffect(() => {
    if (!form.category_id) {
      setModels([])
      return
    }
    let cancelled = false
    mastersApi
      .models(undefined, form.category_id)
      .then((m) => {
        if (cancelled) return
        const rows = m.results || []
        setModels(rows)
        setForm((f) => {
          if (f.model_id && rows.some((r) => String(r.id) === String(f.model_id))) return f
          return { ...f, model_id: '' }
        })
      })
      .catch(() => {
        if (!cancelled) setModels([])
      })
    return () => { cancelled = true }
  }, [form.category_id])

  useEffect(() => {
    if (!id) return
    setLoading(true)
    hardwareApi
      .get(id)
      .then((a) => {
        setForm({
          company_id: nestId(a.company),
          legal_entity_id: nestId(a.legal_entity),
          department_id: nestId(a.department),
          asset_tag: String(a.asset_tag || ''),
          old_asset_tag: String(a.old_asset_tag || ''),
          serial: String(a.serial || ''),
          category_id: nestId(a.category),
          model_id: nestId(a.model),
          status_id: nestId(a.status),
          rtd_location_id: nestId(a.rtd_location) || nestId(a.location),
          map_latitude: a.map_latitude != null && a.map_latitude !== '' ? String(a.map_latitude) : '',
          map_longitude: a.map_longitude != null && a.map_longitude !== '' ? String(a.map_longitude) : '',
          map_address: String(a.map_address || ''),
          supplier_id: nestId(a.supplier),
          purchase_date: dateVal(a.purchase_date),
          purchase_cost: a.purchase_cost != null ? String(a.purchase_cost) : '',
          order_number: String(a.order_number || ''),
          warranty_months: a.warranty_months != null ? String(a.warranty_months) : '12',
          asset_eol_date: dateVal(a.asset_eol_date),
          notes: String(a.notes || ''),
          received_condition: String(a.received_condition || ''),
          assign_employee_id: '',
          domain: String((a.domain as { code?: string } | null)?.code || defaultDomainCode(domainScope)),
          processor: String((a.domain_attrs as Record<string, string> | null)?.processor || ''),
          ram: String((a.domain_attrs as Record<string, string> | null)?.ram || ''),
          storage: String((a.domain_attrs as Record<string, string> | null)?.storage || ''),
          os: String((a.domain_attrs as Record<string, string> | null)?.os || ''),
          mac_address: String((a.domain_attrs as Record<string, string> | null)?.mac_address || ''),
          ip_address: String((a.domain_attrs as Record<string, string> | null)?.ip_address || ''),
          color: String((a.domain_attrs as Record<string, string> | null)?.color || ''),
          material: String((a.domain_attrs as Record<string, string> | null)?.material || ''),
          spec_condition: String((a.domain_attrs as Record<string, string> | null)?.condition || ''),
        })
        setImagePath(a.image ? String(a.image) : null)
        setImageUrl(a.image_url ? String(a.image_url) : null)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  // Preview auto-generated tag when creating (company/entity + asset type)
  useEffect(() => {
    if (isEdit) return
    const companyId = form.company_id
    const legalEntityId = form.legal_entity_id
    const categoryId = form.category_id
    if (!categoryId || (!companyId && !legalEntityId)) {
      setForm((f) => (f.asset_tag ? { ...f, asset_tag: '' } : f))
      return
    }
    let cancelled = false
    const t = window.setTimeout(() => {
      hardwareApi
        .nextTag({
          company_id: companyId || undefined,
          legal_entity_id: legalEntityId || undefined,
          category_id: categoryId,
        })
        .then((r) => {
          if (cancelled) return
          const tag = String((r as { asset_tag?: string }).asset_tag || '')
          setForm((f) => ({ ...f, asset_tag: tag }))
        })
        .catch(() => {
          if (!cancelled) setForm((f) => ({ ...f, asset_tag: '' }))
        })
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [isEdit, form.company_id, form.legal_entity_id, form.category_id])

  useEffect(() => {
    if (!pendingImage) {
      setPendingImagePreview(null)
      return
    }
    const url = URL.createObjectURL(pendingImage)
    setPendingImagePreview(url)
    return () => URL.revokeObjectURL(url)
  }, [pendingImage])

  const uploadImage = async (file: File, assetId: string | number = id || '') => {
    if (!assetId) return
    setImageBusy(true)
    setImageMsg('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const t = localStorage.getItem('refex_token')
      const res = await fetch(`${getApiBase()}/hardware/${assetId}/files?kind=image`, {
        method: 'POST',
        headers: t ? { Authorization: `Bearer ${t}` } : {},
        body: fd,
      })
      const data = await res.json()
      if (!res.ok) throw new Error((data.messages || []).join(', ') || 'Upload failed')
      const a = await hardwareApi.get(assetId)
      setImagePath(a.image ? String(a.image) : null)
      setImageUrl(a.image_url ? String(a.image_url) : (data?.payload?.url ? String(data.payload.url) : null))
      setPendingImage(null)
      setImageMsg('Image uploaded')
      toast.success('Image uploaded')
    } catch (e) {
      setImageMsg(e instanceof Error ? e.message : 'Upload failed')
      toast.error(e instanceof Error ? e.message : 'Upload failed')
      throw e
    } finally {
      setImageBusy(false)
    }
  }

  const onPickImage = (f: File | null) => {
    if (!f) return
    if (isEdit && id) {
      void uploadImage(f)
      return
    }
    setPendingImage(f)
    setImageMsg(`${f.name} queued — will upload when you create the asset`)
  }

  const applyPoExtracted = async (parsed: PoParseResult) => {
    const targetsFilled = Boolean(
      form.supplier_id
      || form.purchase_date
      || form.purchase_cost
      || form.order_number
      || (form.warranty_months && form.warranty_months !== '12'),
    )
    if (targetsFilled) {
      const ok = window.confirm(
        'Some purchase fields already have values. Replace them with values from the PO?',
      )
      if (!ok) return
    }

    let supplierId = parsed.supplier_id != null ? String(parsed.supplier_id) : ''
    if (!supplierId && parsed.supplier_name && parsed.create_suggested) {
      const create = window.confirm(
        `Supplier “${parsed.supplier_name}” was not found in Masters.\n\nCreate it now and select it?`,
      )
      if (create) {
        try {
          const res = await mastersApi.createSupplier({ name: parsed.supplier_name })
          const created = masterPayloadId(res, parsed.supplier_name)
          supplierId = String(created.id)
          const list = await mastersApi.suppliers()
          setSuppliers(list.results || [])
          if (!list.results?.some((s) => String(s.id) === supplierId)) {
            setSuppliers((prev) => [...prev, created])
          }
          toast.success(`Supplier “${parsed.supplier_name}” created`)
        } catch (e) {
          toast.error(e instanceof Error ? e.message : 'Could not create supplier')
        }
      }
    } else if (!supplierId && parsed.supplier_name) {
      toast.error(`Supplier “${parsed.supplier_name}” not matched — add under Masters → Suppliers`)
    }

    const filled: string[] = []
    setForm((f) => {
      const next = { ...f }
      if (supplierId) {
        next.supplier_id = supplierId
        filled.push('Supplier')
      }
      if (parsed.purchase_date) {
        next.purchase_date = parsed.purchase_date
        filled.push('Purchase Date')
      }
      if (parsed.purchase_cost != null) {
        next.purchase_cost = String(parsed.purchase_cost)
        filled.push('Purchase Cost')
      }
      if (parsed.order_number) {
        next.order_number = parsed.order_number
        filled.push('Purchase Order Number')
      }
      if (parsed.warranty_months != null) {
        next.warranty_months = String(parsed.warranty_months)
        filled.push('Warranty')
      }
      return next
    })

    if (tab !== 'details') setTab('details')
    if (filled.length) {
      toast.success(`Filled from PO: ${filled.join(', ')}`)
    } else {
      toast.error('Could not read purchase fields from this PO — enter them manually')
    }
    if (parsed.warnings?.length) {
      setError(parsed.warnings.slice(0, 3).join(' · '))
    }
  }

  const submit = async () => {
    setError('')
    if (!form.category_id || !form.model_id || !form.status_id) {
      setError('Asset type, model, and status are required')
      setTab('details')
      return
    }
    if (!isEdit && !form.company_id && !form.legal_entity_id) {
      setError('Company or legal entity is required to generate the asset tag')
      setTab('details')
      return
    }
    if (!isEdit && !hasRequiredCreateAttachments(pendingFiles)) {
      const missingPo = !pendingFiles.some((p) => p.kind === 'po')
      if (missingPo) {
        setError('Purchase Order (PO) is required — attach it above the purchase fields')
        setTab('details')
        return
      }
      setError('Attachments are required: Invoice and Other documents (PO is on Details)')
      setTab('attachments')
      return
    }
    setBusy(true)
    try {
      const body: Record<string, unknown> = {
        serial: form.serial || null,
        category_id: form.category_id ? Number(form.category_id) : null,
        model_id: Number(form.model_id),
        status_id: Number(form.status_id),
        company_id: form.company_id ? Number(form.company_id) : null,
        legal_entity_id: form.legal_entity_id ? Number(form.legal_entity_id) : null,
        department_id: form.department_id ? Number(form.department_id) : null,
        rtd_location_id: form.rtd_location_id ? Number(form.rtd_location_id) : null,
        location_id: form.rtd_location_id ? Number(form.rtd_location_id) : null,
        map_latitude: form.map_latitude ? Number(form.map_latitude) : null,
        map_longitude: form.map_longitude ? Number(form.map_longitude) : null,
        map_address: form.map_address.trim() || null,
        supplier_id: form.supplier_id ? Number(form.supplier_id) : null,
        purchase_date: form.purchase_date || null,
        purchase_cost: form.purchase_cost ? Number(form.purchase_cost) : null,
        order_number: form.order_number || null,
        warranty_months: form.warranty_months ? Number(form.warranty_months) : null,
        asset_eol_date: form.asset_eol_date || null,
        notes: form.notes || null,
        received_condition: form.received_condition.trim() || null,
        old_asset_tag: form.old_asset_tag.trim() || null,
        domain: form.domain || defaultDomainCode(domainScope),
        domain_attrs: form.domain === 'admin'
          ? { color: form.color, material: form.material, condition: form.spec_condition }
          : {
            processor: form.processor,
            ram: form.ram,
            storage: form.storage,
            os: form.os,
            mac_address: form.mac_address,
            ip_address: form.ip_address,
          },
      }

      if (isEdit && id) {
        await hardwareApi.update(id, body)
        toast.success('Asset updated')
        navigate(fromEmployeeId ? `/employees/${fromEmployeeId}` : `/hardware/${id}${returnQs}`)
        return
      }

      const created = await hardwareApi.create(body) as {
        payload?: { id?: number }
        id?: number
      }
      const newId = Number(created.payload?.id || created.id)
      if (newId && form.assign_employee_id) {
        await hardwareApi.checkout(newId, {
          checkout_to_type: 'employee',
          assigned_employee: Number(form.assign_employee_id),
        })
      }
      if (newId && pendingFiles.length) {
        for (const p of pendingFiles) {
          await uploadAssetFile(newId, p.file, p.kind)
        }
      }
      if (newId && pendingImage) {
        try {
          await uploadImage(pendingImage, newId)
        } catch {
          toast.error('Asset created, but image upload failed — use Edit to retry')
        }
      }
      if (newId && pendingReceived.length) {
        try {
          for (const p of pendingReceived) {
            await uploadAssetFile(newId, p.file, 'received')
          }
        } catch {
          toast.error('Asset created, but some received-condition photos failed — use Edit to retry')
        }
      }
      toast.success(form.assign_employee_id ? 'Asset created and assigned' : 'Asset created')
      navigate(newId ? `/hardware/${newId}` : '/hardware')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <AppLayout title={isEdit ? 'Update Asset' : 'Create Asset'}>
        <p className="text-muted">Loading…</p>
      </AppLayout>
    )
  }

  return (
    <AppLayout title={isEdit ? 'Update Asset' : 'Create Asset'} subtitle="Company, department & location masters">
      {error ? <div className="callout callout-danger"><p>{error}</p></div> : null}

      <div className="nav-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'details'}
          className={tab === 'details' ? 'active' : ''}
          onClick={() => setTab('details')}
        >
          Details
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'attachments'}
          className={tab === 'attachments' ? 'active' : ''}
          onClick={() => setTab('attachments')}
        >
          Attachments
          {!isEdit && pendingFiles.length > 0 ? ` (${pendingFiles.length})` : ''}
        </button>
      </div>

      {tab === 'details' && (
        <PageForm
          cancelTo={isEdit ? assetReturnPath : '/hardware'}
          onSubmit={() => { void submit() }}
          submitLabel={busy ? 'Saving…' : isEdit ? 'Update' : 'Create'}
          submitDisabled={busy}
        >
          <DomainSelect
            value={form.domain}
            allowed={domainScope.codes}
            onChange={(code) => set('domain', code)}
            required
          />

          <CompanyEntityFields
            required
            companyId={form.company_id}
            legalEntityId={form.legal_entity_id}
            companies={companies}
            onCompaniesChange={setCompanies}
            onCompanyChange={(v) => set('company_id', v)}
            onLegalEntityChange={(v) => set('legal_entity_id', v)}
          />

          <MasterSelect
            label="Department"
            value={form.department_id}
            options={departments}
            onChange={(v) => set('department_id', v)}
            onOptionsChange={setDepartments}
            emptyLabel="— Select department —"
            help="From HRMS department names, or add manually"
            create={async (name) => {
              const res = await mastersApi.createDepartment({
                name,
                company_id: form.company_id ? Number(form.company_id) : null,
              })
              return masterPayloadId(res, name)
            }}
          />

          <MasterSelect
            label="Default Location"
            required
            value={form.rtd_location_id}
            options={locations}
            onChange={(v) => set('rtd_location_id', v)}
            onOptionsChange={setLocations}
            allowEmpty={false}
            emptyLabel="Select location…"
            help="Shows office · floor · cabin/seat. Pick the exact space, not just Floor 1."
            create={async (name) => {
              const res = await mastersApi.createLocation({
                name,
                company_id: form.company_id ? Number(form.company_id) : null,
              })
              return masterPayloadId(res, name)
            }}
          />

          <Field label="Map location (optional)" full>
            <LocationMapPicker
              value={{
                latitude: form.map_latitude ? Number(form.map_latitude) : null,
                longitude: form.map_longitude ? Number(form.map_longitude) : null,
                address: form.map_address,
              }}
              onChange={(next: MapLocationValue) => {
                setForm((f) => ({
                  ...f,
                  map_latitude: next.latitude != null ? String(next.latitude) : '',
                  map_longitude: next.longitude != null ? String(next.longitude) : '',
                  map_address: next.address || '',
                }))
              }}
            />
            <span className="help-block">
              Pin a precise place with Google Maps — shown only when a pin is set.
            </span>
          </Field>

          <MasterSelect
            label="Asset type"
            required
            value={form.category_id}
            options={assetTypes}
            onChange={(v) => {
              set('category_id', v)
              set('model_id', '')
            }}
            onOptionsChange={setAssetTypes}
            allowEmpty={false}
            emptyLabel="Select type…"
            help="Laptop, Desktop, Tablet, Mobile, Monitor, Printer, …"
            create={async (name) => {
              const res = await mastersApi.createCategory({
                name,
                category_type: 'asset',
                domain: form.domain || defaultDomainCode(domainScope),
              })
              return masterPayloadId(res, name)
            }}
          />

          <Field label="Asset Tag">
            <input
              className="form-control"
              value={form.asset_tag || (isEdit ? '' : 'Select company & asset type…')}
              readOnly
              disabled
            />
            <p className="help-block" style={{ marginBottom: 0 }}>
              {isEdit
                ? 'Auto-generated — not editable'
                : 'Auto-generated from company/entity + asset type + FY + sequence (e.g. MEMF-LAPTOP-2026-27-0001)'}
            </p>
          </Field>

          <Field label="Old Asset Tag">
            <input
              className="form-control"
              value={form.old_asset_tag}
              onChange={(e) => set('old_asset_tag', e.target.value)}
              placeholder="Previous / imported tag"
            />
            <p className="help-block" style={{ marginBottom: 0 }}>
              Legacy tag from import or previous system (optional)
            </p>
          </Field>

          <Field label="Serial">
            <input className="form-control" value={form.serial} onChange={(e) => set('serial', e.target.value)} />
          </Field>

          {form.domain === 'admin' ? (
            <>
              <Field label="Color">
                <input className="form-control" value={form.color} onChange={(e) => set('color', e.target.value)} />
              </Field>
              <Field label="Material">
                <input className="form-control" value={form.material} onChange={(e) => set('material', e.target.value)} />
              </Field>
              <Field label="Condition">
                <input className="form-control" value={form.spec_condition} onChange={(e) => set('spec_condition', e.target.value)} />
              </Field>
            </>
          ) : (
            <>
              <Field label="Processor">
                <input className="form-control" value={form.processor} onChange={(e) => set('processor', e.target.value)} />
              </Field>
              <Field label="RAM">
                <input className="form-control" value={form.ram} onChange={(e) => set('ram', e.target.value)} />
              </Field>
              <Field label="Storage">
                <input className="form-control" value={form.storage} onChange={(e) => set('storage', e.target.value)} />
              </Field>
              <Field label="Operating System">
                <input className="form-control" value={form.os} onChange={(e) => set('os', e.target.value)} />
              </Field>
              <Field label="MAC Address">
                <input className="form-control" value={form.mac_address} onChange={(e) => set('mac_address', e.target.value)} />
              </Field>
              <Field label="IP Address">
                <input className="form-control" value={form.ip_address} onChange={(e) => set('ip_address', e.target.value)} />
              </Field>
            </>
          )}

          <MasterSelect
            label="Model"
            required
            value={form.model_id}
            options={models}
            onChange={(v) => set('model_id', v)}
            onOptionsChange={setModels}
            allowEmpty={false}
            emptyLabel={form.category_id ? 'Select model…' : 'Select asset type first…'}
            disabled={!form.category_id}
            help="Models for the selected asset type (or add a new model)"
            create={async (name) => {
              if (!form.category_id) throw new Error('Select asset type first')
              const res = await mastersApi.createModel({
                name,
                category_id: Number(form.category_id),
              })
              return masterPayloadId(res, name)
            }}
          />

          <Field label="Status" required>
            <select
              className="form-control"
              value={form.status_id}
              onChange={(e) => set('status_id', e.target.value)}
              required
            >
              <option value="">Select status…</option>
              {statuses.map((o) => (
                <option key={o.id} value={o.id}>{o.text}</option>
              ))}
            </select>
          </Field>

          {!isEdit && (
            <Field label="Assign to Employee (optional)">
              <EmployeeSelect
                value={form.assign_employee_id}
                onChange={(v) => set('assign_employee_id', v)}
                emptyOption="— Do not assign yet —"
              />
              <p className="help-block">Assigns this asset to the HRMS employee after create. Same directory for IT and Admin assets.</p>
            </Field>
          )}

          <PoDetailsAttach
            pending={pendingFiles}
            onPendingChange={setPendingFiles}
            stagingMode={!isEdit}
            assetId={isEdit ? id : null}
            required={!isEdit}
            onPoExtracted={applyPoExtracted}
          />

          <MasterSelect
            label="Supplier / Vendor"
            value={form.supplier_id}
            options={suppliers}
            onChange={(v) => set('supplier_id', v)}
            onOptionsChange={setSuppliers}
            emptyLabel="— Select supplier —"
            help="Add a vendor here, or manage / import under Masters → Suppliers"
            create={async (name) => {
              const res = await mastersApi.createSupplier({ name })
              return masterPayloadId(res, name)
            }}
          />

          <Field label="Purchase Date">
            <DateField
              value={form.purchase_date}
              onChange={(v) => set('purchase_date', v)}
            />
          </Field>

          <Field label="Purchase Cost (INR)">
            <input
              type="number"
              className="form-control"
              value={form.purchase_cost}
              onChange={(e) => set('purchase_cost', e.target.value)}
              placeholder="e.g. 45000"
            />
          </Field>

          <Field label="Purchase Order Number">
            <input
              className="form-control"
              value={form.order_number}
              onChange={(e) => set('order_number', e.target.value)}
              placeholder="e.g. PO-2026-00123"
            />
          </Field>

          <Field label="Warranty (months)">
            <input
              type="number"
              className="form-control"
              value={form.warranty_months}
              onChange={(e) => set('warranty_months', e.target.value)}
            />
          </Field>

          <Field label="EOL Date">
            <DateField
              value={form.asset_eol_date}
              onChange={(v) => set('asset_eol_date', v)}
              placeholder="Optional EOL date"
            />
            <span className="help-block">Optional override. If empty, EOL is purchase date + model EOL months.</span>
          </Field>

          <Field label="Notes" full>
            <textarea
              className="form-control"
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
            />
          </Field>

          <Field label="Asset image" full>
            {(() => {
              const src = assetImageSrc(imageUrl || imagePath) || pendingImagePreview
              return src ? (
                <img
                  src={src}
                  alt=""
                  style={{ display: 'block', maxWidth: '100%', maxHeight: 200, marginBottom: 10 }}
                />
              ) : (
                <p className="help-block" style={{ marginTop: 0 }}>No image yet</p>
              )
            })()}
            <FileInput
              accept="image/*"
              disabled={imageBusy}
              label={isEdit ? 'Upload image' : 'Choose image'}
              onChange={(f) => onPickImage(f)}
            />
            {imageMsg ? <span className="help-block">{imageMsg}</span> : null}
          </Field>

          <Field label="Asset received condition" full>
            <AssetReceivedCondition
              assetId={isEdit ? id : null}
              stagingMode={!isEdit}
              description={form.received_condition}
              onDescriptionChange={(v) => set('received_condition', v)}
              pending={pendingReceived}
              onPendingChange={setPendingReceived}
            />
          </Field>
        </PageForm>
      )}

      {tab === 'attachments' && (
        <>
          <AssetAttachments
            assetId={isEdit ? id : null}
            stagingMode={!isEdit}
            requireCreateDocs={!isEdit}
            pending={pendingFiles}
            onPendingChange={setPendingFiles}
            hideKinds={['po']}
          />
          <div className="box-footer" style={{ marginTop: 8, padding: '12px 0' }}>
            {isEdit ? (
              <>
                <button
                  type="button"
                  className="btn btn-theme"
                  disabled={busy}
                  onClick={() => { void submit() }}
                >
                  <i className="fas fa-check" /> {busy ? 'Saving…' : 'Update'}
                </button>
                {' '}
                <button type="button" className="btn btn-default" onClick={() => setTab('details')}>
                  Back to Details
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn-theme"
                  disabled={busy}
                  onClick={() => { void submit() }}
                >
                  <i className="fas fa-check" /> {busy ? 'Saving…' : 'Create asset & upload'}
                </button>
                {' '}
                <button type="button" className="btn btn-default" onClick={() => setTab('details')}>
                  Back to Details
                </button>
              </>
            )}
          </div>
        </>
      )}
    </AppLayout>
  )
}
