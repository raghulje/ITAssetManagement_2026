import { useEffect, useState, type ReactNode } from 'react'
import { api } from '../api/client'
import { getApiBase } from '../api/baseUrl'
import { openAuthedFile } from '../lib/openAuthedFile'
import { Box } from './ui'

export type AttachmentKind = 'invoice' | 'po' | 'other'

export const ATTACHMENT_SLOTS: { kind: AttachmentKind; label: string; hint: string; accept?: string }[] = [
  { kind: 'invoice', label: 'Tax Invoice', hint: 'PDF or image of the tax invoice (optional)', accept: '.pdf,image/*' },
  { kind: 'po', label: 'Purchase Order (PO)', hint: 'PO document, PDF preferred (optional)', accept: '.pdf,image/*' },
  { kind: 'other', label: 'Other documents', hint: 'Warranty, delivery note, etc. (optional)', accept: undefined },
]

export type PendingAttachment = { kind: AttachmentKind; file: File; key: string }

/** Document uploads are optional. Purchase Cost and Purchase Order Number stay required on the asset form. */
export const REQUIRED_CREATE_ATTACHMENT_KINDS: AttachmentKind[] = []

type Props = {
  /** When set, uploads go to the server immediately */
  assetId?: string | number | null
  /** Staged files for create flow (before asset exists) */
  pending?: PendingAttachment[]
  onPendingChange?: (files: PendingAttachment[]) => void
  /** Create mode: no asset id yet */
  stagingMode?: boolean
  /** View-only: list attachments, no upload */
  readOnly?: boolean
  /** Show Delete on a view-only list (asset record). Edit screens always can delete. */
  allowDelete?: boolean
  /** Create flow: mark Invoice / PO as required */
  requireCreateDocs?: boolean
  /** Called after OCR/parse of a PO file */
  onPoExtracted?: (fields: PoParseResult) => void | Promise<void>
  /** Hide slots managed elsewhere (e.g. PO on Details tab) */
  hideKinds?: AttachmentKind[]
  /** Create form: sections under the details fields, with no tab or nested card */
  embedded?: boolean
}

function AttachmentFrame({ embedded, children }: { embedded: boolean; children: ReactNode }) {
  if (embedded) {
    return (
      <section className="asset-attach-sections">
        <h3 className="asset-attach-sections-title">Attachments</h3>
        {children}
      </section>
    )
  }
  return <Box title="Attachments" type="primary">{children}</Box>
}

function kindLabel(k: string) {
  if (k === 'po') return 'PO'
  if (k === 'invoice') return 'Invoice'
  if (k === 'label') return 'Print Label'
  if (k === 'other') return 'Other'
  if (k === 'received') return 'Received condition'
  return k
}

export async function uploadAssetFile(
  assetId: string | number,
  file: File,
  kind: AttachmentKind | 'image' | 'received',
) {
  const fd = new FormData()
  fd.append('file', file)
  const t = localStorage.getItem('refex_token')
  const res = await fetch(`${getApiBase()}/hardware/${assetId}/files?kind=${kind}`, {
    method: 'POST',
    headers: t ? { Authorization: `Bearer ${t}` } : {},
    body: fd,
  })
  const data = await res.json()
  if (!res.ok) throw new Error((data.messages || []).join(', ') || 'Upload failed')
  return data
}

export type PoParseResult = {
  order_number: string | null
  purchase_date: string | null
  purchase_cost: number | null
  warranty_months: number | null
  supplier_name: string | null
  supplier_id: number | null
  create_suggested: boolean
  confidence: 'high' | 'medium' | 'low'
  method: string
  warnings?: string[]
  raw_preview?: string
}

export async function parsePoFile(file: File): Promise<PoParseResult> {
  const fd = new FormData()
  fd.append('file', file)
  const t = localStorage.getItem('refex_token')
  const res = await fetch(`${getApiBase()}/hardware/parse-po`, {
    method: 'POST',
    headers: t ? { Authorization: `Bearer ${t}` } : {},
    body: fd,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((data.messages || []).join(', ') || 'PO parse failed')
  }
  return (data.payload || data) as PoParseResult
}

export default function AssetAttachments({
  assetId,
  pending = [],
  onPendingChange,
  stagingMode = false,
  readOnly = false,
  allowDelete = false,
  requireCreateDocs = false,
  onPoExtracted,
  hideKinds = [],
  embedded = false,
}: Props) {
  const [files, setFiles] = useState<Record<string, unknown>[]>([])
  const [uploading, setUploading] = useState('')
  const [ocrBusy, setOcrBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  const load = () => {
    if (!assetId) {
      setFiles([])
      return
    }
    api<{ rows: Record<string, unknown>[] }>(`/hardware/${assetId}/files`)
      .then((r) => setFiles(r.rows || []))
      .catch((e) => {
        setFiles([])
        setError(e instanceof Error ? e.message : 'Could not load attachments')
      })
  }

  useEffect(() => { load() }, [assetId])

  const filesFor = (kind: string) => files.filter((f) => String(f.kind) === kind)
  const pendingFor = (kind: string) => pending.filter((p) => p.kind === kind)
  const docFiles = files.filter((f) => {
    const k = String(f.kind)
    return k !== 'image' && k !== 'received'
  })

  const uploadNow = async (file: File, kind: AttachmentKind) => {
    if (!assetId) return
    setUploading(kind)
    setMsg('')
    setError('')
    try {
      await uploadAssetFile(assetId, file, kind)
      setMsg(`${kind === 'po' ? 'PO' : kind.charAt(0).toUpperCase() + kind.slice(1)} uploaded`)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading('')
    }
  }

  const stageFile = (file: File, kind: AttachmentKind) => {
    onPendingChange?.([
      ...pending,
      { kind, file, key: `${kind}-${file.name}-${Date.now()}` },
    ])
    setMsg(`${file.name} queued — will upload when you create the asset`)
  }

  const removePending = (key: string) => {
    onPendingChange?.(pending.filter((p) => p.key !== key))
  }

  const deleteFile = async (fileId: number) => {
    if (!window.confirm('Delete this attachment?')) return
    try {
      await api(`/files/${fileId}`, { method: 'DELETE' })
      setMsg('Attachment deleted')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  const onPick = (file: File | undefined, kind: AttachmentKind, input: HTMLInputElement) => {
    input.value = ''
    if (!file) return
    if (stagingMode || !assetId) stageFile(file, kind)
    else void uploadNow(file, kind)
  }

  const runPoOcr = async () => {
    if (!onPoExtracted) return
    setOcrBusy(true)
    setMsg('')
    setError('')
    try {
      const staged = pendingFor('po')[0]
      let file: File | null = staged?.file || null
      if (!file && !stagingMode) {
        const row = filesFor('po')[0]
        if (!row?.id) throw new Error('Attach a PO file first')
        const t = localStorage.getItem('refex_token')
        const res = await fetch(`${getApiBase()}/files/${row.id}/download`, {
          headers: t ? { Authorization: `Bearer ${t}` } : {},
        })
        if (!res.ok) throw new Error('Could not download PO for OCR')
        const blob = await res.blob()
        const name = String(row.original_filename || row.filename || 'po.pdf')
        file = new File([blob], name, { type: blob.type || 'application/pdf' })
      }
      if (!file) throw new Error('Attach a PO file first')
      const parsed = await parsePoFile(file)
      setMsg(`PO parsed (${parsed.confidence} confidence via ${parsed.method}) — check Details fields`)
      await onPoExtracted(parsed)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PO OCR failed')
    } finally {
      setOcrBusy(false)
    }
  }

  const hasPo = pendingFor('po').length > 0 || (!stagingMode && filesFor('po').length > 0)
  const canDelete = !readOnly || allowDelete

  const openFile = (fileId: number, fileName: string) => {
    setError('')
    openAuthedFile(fileId, fileName).catch((e: Error) => {
      setError(e.message || 'Could not open file')
    })
  }

  return (
    <div className="asset-attachments">
      {msg && <div className="callout callout-info"><p>{msg}</p></div>}
      {error && <div className="callout callout-danger"><p>{error}</p></div>}

      <AttachmentFrame embedded={embedded}>
        <p className="help-block" style={{ marginTop: 0, marginBottom: 14 }}>
          {readOnly
            ? (allowDelete
              ? 'Documents attached to this asset. Use Edit to upload a file. Delete removes it from this asset.'
              : 'Documents attached to this asset. Use Edit to upload or remove files.')
            : hideKinds.includes('po')
              ? (stagingMode
                ? 'Tax Invoice and other documents are optional. They upload when you create the asset.'
                : 'Tax Invoice and other documents are optional. The Purchase Order file is on the Details tab.')
              : stagingMode
                ? 'Tax Invoice, Purchase Order, and other documents are optional. They upload when you create the asset.'
                : 'Tax Invoice, Purchase Order, and other documents are optional.'}
        </p>

        <div className="attachment-grid">
          {ATTACHMENT_SLOTS.filter((slot) => !hideKinds.includes(slot.kind)).map((slot) => {
            const rows = filesFor(slot.kind)
            const staged = pendingFor(slot.kind)
            const busy = uploading === slot.kind
            const hasFiles = rows.length > 0 || staged.length > 0
            const required =
              requireCreateDocs && stagingMode && REQUIRED_CREATE_ATTACHMENT_KINDS.includes(slot.kind)
            const missingRequired = required && staged.length === 0

            return (
              <div className={`attachment-slot${missingRequired ? ' is-required-missing' : ''}`} key={slot.kind}>
                <div>
                  <h4 className="attachment-slot-title">
                    {slot.label}
                    {required ? <span className="text-danger" title="Required"> *</span> : null}
                  </h4>
                  <p className="attachment-slot-hint">
                    {slot.hint}
                    {missingRequired ? ' — required' : ''}
                  </p>
                </div>

                {!readOnly ? (
                  <label
                    className={`attachment-dropzone${busy ? ' is-busy' : ''}${uploading && !busy ? ' is-disabled' : ''}`}
                  >
                    <span className="attachment-dropzone-icon" aria-hidden>
                      <i className={`fas ${busy ? 'fa-spinner fa-spin' : 'fa-cloud-upload-alt'}`} />
                    </span>
                    <span className="attachment-dropzone-label">
                      {busy ? 'Uploading…' : 'Choose file'}
                    </span>
                    <span className="attachment-dropzone-meta">PDF, PNG, or JPG</span>
                    <input
                      type="file"
                      className="sr-only"
                      accept={slot.accept}
                      disabled={Boolean(uploading)}
                      onChange={(e) => onPick(e.target.files?.[0], slot.kind, e.target)}
                    />
                  </label>
                ) : null}

                {!readOnly && staged.length > 0 && (
                  <ul className="attachment-list">
                    {staged.map((p) => (
                      <li key={p.key}>
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.file.name}
                        </span>
                        <span className="label label-default">Queued</span>
                        <button
                          type="button"
                          className="btn btn-xs btn-danger"
                          onClick={() => removePending(p.key)}
                          aria-label={`Remove ${p.file.name}`}
                        >
                          <i className="fas fa-times" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {!stagingMode && rows.length > 0 && (
                  <ul className="attachment-list">
                    {rows.map((f) => (
                      <li key={String(f.id)}>
                        <button
                          type="button"
                          className="attachment-open"
                          onClick={() => openFile(Number(f.id), String(f.original_filename || f.filename))}
                        >
                          {String(f.original_filename || f.filename)}
                        </button>
                        <span className="attachment-size">
                          {f.filesize ? `${Math.round(Number(f.filesize) / 1024)} KB` : ''}
                        </span>
                        {canDelete ? (
                          <button
                            type="button"
                            className="btn btn-xs btn-danger"
                            onClick={() => { void deleteFile(Number(f.id)) }}
                            aria-label="Delete attachment"
                          >
                            <i className="fas fa-trash" />
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}

                {readOnly && !hasFiles ? (
                  <p className="attachment-empty">No files</p>
                ) : null}

                {!readOnly && slot.kind === 'po' && hasPo && onPoExtracted ? (
                  <button
                    type="button"
                    className="btn btn-info btn-sm"
                    disabled={ocrBusy || Boolean(uploading)}
                    onClick={() => { void runPoOcr() }}
                  >
                    <i className={`fas ${ocrBusy ? 'fa-spinner fa-spin' : 'fa-magic'}`} />{' '}
                    {ocrBusy ? 'Reading PO…' : 'Fill form from PO'}
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>
      </AttachmentFrame>

      {!stagingMode && (
        <Box title={`All documents (${docFiles.length})`}>
          <table className="table table-striped">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Size</th>
                {canDelete ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {docFiles.length === 0 && (
                <tr>
                  <td colSpan={canDelete ? 4 : 3} className="text-muted">
                    {readOnly ? 'No attachments' : 'No attachments yet — use Choose file above'}
                  </td>
                </tr>
              )}
              {docFiles.map((f) => (
                <tr key={String(f.id)}>
                  <td>
                    <button
                      type="button"
                      className="attachment-open"
                      onClick={() => openFile(Number(f.id), String(f.original_filename || f.filename))}
                    >
                      {String(f.original_filename || f.filename)}
                    </button>
                  </td>
                  <td><span className="label label-default">{kindLabel(String(f.kind))}</span></td>
                  <td>{f.filesize ? `${Math.round(Number(f.filesize) / 1024)} KB` : '—'}</td>
                  {canDelete ? (
                    <td>
                      <button type="button" className="btn btn-xs btn-danger" onClick={() => { void deleteFile(Number(f.id)) }}>
                        Delete
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
      )}
    </div>
  )
}
