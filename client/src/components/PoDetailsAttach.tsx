import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { getApiBase } from '../api/baseUrl'
import { FileInput, Field } from './ui'
import {
  parsePoFile,
  uploadAssetFile,
  type PendingAttachment,
  type PoParseResult,
} from './AssetAttachments'

type Props = {
  /** Create mode: staged attachments */
  pending: PendingAttachment[]
  onPendingChange: (files: PendingAttachment[]) => void
  stagingMode: boolean
  assetId?: string | number | null
  required?: boolean
  onAttachedChange?: (attached: boolean) => void
  onPoExtracted: (fields: PoParseResult) => void | Promise<void>
}

export default function PoDetailsAttach({
  pending,
  onPendingChange,
  stagingMode,
  assetId,
  required = false,
  onAttachedChange,
  onPoExtracted,
}: Props) {
  const stagedPo = pending.filter((p) => p.kind === 'po')
  const poFile = stagedPo[0]?.file || null
  const [ocrBusy, setOcrBusy] = useState(false)
  const [uploadBusy, setUploadBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [serverPoName, setServerPoName] = useState<string | null>(null)
  const [serverPoId, setServerPoId] = useState<number | null>(null)

  useEffect(() => {
    if (stagingMode || !assetId) return
    let cancelled = false
    api<{ rows: Record<string, unknown>[] }>(`/hardware/${assetId}/files`)
      .then((r) => {
        if (cancelled) return
        const po = (r.rows || []).find((f) => String(f.kind) === 'po')
        if (po) {
          setServerPoId(Number(po.id))
          setServerPoName(String(po.original_filename || po.filename || 'PO file'))
        }
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [assetId, stagingMode])

  const runOcr = async (file: File) => {
    setOcrBusy(true)
    setError('')
    setMsg('Reading PO with OCR…')
    try {
      const parsed = await parsePoFile(file)
      setMsg(`PO parsed (${parsed.confidence} confidence via ${parsed.method}) — fields below updated`)
      await onPoExtracted(parsed)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PO OCR failed')
      setMsg('')
    } finally {
      setOcrBusy(false)
    }
  }

  const setPoFile = async (file: File | null) => {
    setError('')
    setMsg('')
    if (!file) {
      onPendingChange(pending.filter((p) => p.kind !== 'po'))
      setServerPoName(null)
      return
    }

    const next: PendingAttachment = {
      kind: 'po',
      file,
      key: `po-${file.name}-${Date.now()}`,
    }
    onPendingChange([...pending.filter((p) => p.kind !== 'po'), next])

    if (!stagingMode && assetId) {
      setUploadBusy(true)
      try {
        await uploadAssetFile(assetId, file, 'po')
        setServerPoName(file.name)
        setMsg(`${file.name} uploaded`)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'PO upload failed')
        setUploadBusy(false)
        return
      } finally {
        setUploadBusy(false)
      }
    } else {
      setMsg(`${file.name} attached — running OCR…`)
    }

    await runOcr(file)
  }

  const runOcrFromServer = async () => {
    if (!assetId || !serverPoId) return
    setOcrBusy(true)
    setError('')
    setMsg('Downloading PO for OCR…')
    try {
      const t = localStorage.getItem('refex_token')
      const res = await fetch(`${getApiBase()}/files/${serverPoId}/download`, {
        headers: t ? { Authorization: `Bearer ${t}` } : {},
      })
      if (!res.ok) throw new Error('Could not download PO for OCR')
      const blob = await res.blob()
      const file = new File([blob], serverPoName || 'po.pdf', { type: blob.type || 'application/pdf' })
      await runOcr(file)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PO OCR failed')
      setMsg('')
      setOcrBusy(false)
    }
  }

  const displayName = poFile?.name || serverPoName

  useEffect(() => {
    onAttachedChange?.(Boolean(displayName))
  }, [displayName, onAttachedChange])
  const busy = ocrBusy || uploadBusy

  return (
    <Field label="Purchase Order (PO)" required={required}>
      <div className={`po-details-attach${required && !displayName ? ' is-required-missing' : ''}`}>
        <p className="help-block" style={{ marginTop: 0 }}>
          Attach the PO here — OCR fills Supplier, Purchase Date, Cost, PO Number, and Warranty below.
          The same file counts for create attachments.
        </p>
        <FileInput
          accept=".pdf,image/*"
          disabled={busy}
          fileName={displayName}
          label="Choose PO file"
          onChange={(f) => { void setPoFile(f) }}
        />
        <div className="po-details-attach-actions">
          {poFile ? (
            <button
              type="button"
              className="btn btn-info btn-sm"
              disabled={busy}
              onClick={() => { void runOcr(poFile) }}
            >
              <i className={`fas ${ocrBusy ? 'fa-spinner fa-spin' : 'fa-magic'}`} />{' '}
              {ocrBusy ? 'Reading PO…' : 'Re-run OCR'}
            </button>
          ) : serverPoId ? (
            <button
              type="button"
              className="btn btn-info btn-sm"
              disabled={busy}
              onClick={() => { void runOcrFromServer() }}
            >
              <i className={`fas ${ocrBusy ? 'fa-spinner fa-spin' : 'fa-magic'}`} />{' '}
              {ocrBusy ? 'Reading PO…' : 'Fill form from PO'}
            </button>
          ) : null}
        </div>
        {msg ? <p className="help-block" style={{ marginBottom: 0 }}>{msg}</p> : null}
        {error ? <p className="text-danger" style={{ margin: '6px 0 0', fontSize: 13 }}>{error}</p> : null}
      </div>
    </Field>
  )
}
