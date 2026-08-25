import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { assetImageSrc, getApiBase } from '../api/baseUrl'
import { FileInput } from './ui'
import { uploadAssetFile } from './AssetAttachments'

export type PendingReceivedImage = { key: string; file: File; preview: string }

type Props = {
  assetId?: string | number | null
  stagingMode?: boolean
  description: string
  onDescriptionChange: (value: string) => void
  pending: PendingReceivedImage[]
  onPendingChange: (files: PendingReceivedImage[]) => void
}

export default function AssetReceivedCondition({
  assetId,
  stagingMode = false,
  description,
  onDescriptionChange,
  pending,
  onPendingChange,
}: Props) {
  const [serverImages, setServerImages] = useState<Record<string, unknown>[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  const load = () => {
    if (!assetId || stagingMode) {
      setServerImages([])
      return
    }
    api<{ rows: Record<string, unknown>[] }>(`/hardware/${assetId}/files`)
      .then((r) => setServerImages((r.rows || []).filter((f) => String(f.kind) === 'received')))
      .catch(() => setServerImages([]))
  }

  useEffect(() => { load() }, [assetId, stagingMode])

  useEffect(() => () => {
    pending.forEach((p) => URL.revokeObjectURL(p.preview))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const addFiles = async (picked: FileList | File[] | null) => {
    const list = picked ? Array.from(picked) : []
    const images = list.filter((f) => f.type.startsWith('image/'))
    if (!images.length) return
    setError('')
    setMsg('')

    if (stagingMode || !assetId) {
      const next = [
        ...pending,
        ...images.map((file) => ({
          key: `recv-${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          file,
          preview: URL.createObjectURL(file),
        })),
      ]
      onPendingChange(next)
      setMsg(`${images.length} image(s) queued — upload on create`)
      return
    }

    setBusy(true)
    try {
      for (const file of images) {
        await uploadAssetFile(assetId, file, 'received')
      }
      setMsg(`${images.length} condition photo(s) uploaded`)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  const removePending = (key: string) => {
    const row = pending.find((p) => p.key === key)
    if (row) URL.revokeObjectURL(row.preview)
    onPendingChange(pending.filter((p) => p.key !== key))
  }

  const deleteServer = async (fileId: number) => {
    if (!window.confirm('Remove this condition photo?')) return
    try {
      await api(`/files/${fileId}`, { method: 'DELETE' })
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  const serverSrc = (f: Record<string, unknown>) => {
    const url = f.url ? String(f.url) : null
    if (url) return assetImageSrc(url) || `${getApiBase().replace(/\/api\/v1$/, '')}${url.startsWith('/') ? url : `/${url}`}`
    return `${getApiBase()}/files/${f.id}/download`
  }

  return (
    <div className="received-condition">
      <p className="help-block" style={{ marginTop: 0 }}>
        Describe the condition when the asset was received (scratches, packaging, accessories, etc.) and attach photos.
      </p>
      <textarea
        className="form-control"
        rows={3}
        value={description}
        onChange={(e) => onDescriptionChange(e.target.value)}
        placeholder="e.g. Box sealed, slight scratch on lid, charger included…"
      />

      <div className="received-condition-gallery">
        {pending.map((p) => (
          <div className="received-condition-thumb" key={p.key}>
            <img src={p.preview} alt={p.file.name} />
            <button
              type="button"
              className="btn btn-xs btn-danger"
              onClick={() => removePending(p.key)}
              aria-label={`Remove ${p.file.name}`}
            >
              <i className="fas fa-times" />
            </button>
            <span className="received-condition-caption">{p.file.name}</span>
          </div>
        ))}
        {!stagingMode && serverImages.map((f) => (
          <div className="received-condition-thumb" key={String(f.id)}>
            <a href={serverSrc(f)} target="_blank" rel="noreferrer">
              <img src={serverSrc(f)} alt={String(f.original_filename || f.filename)} />
            </a>
            <button
              type="button"
              className="btn btn-xs btn-danger"
              onClick={() => { void deleteServer(Number(f.id)) }}
              aria-label="Delete photo"
            >
              <i className="fas fa-trash" />
            </button>
            <span className="received-condition-caption">{String(f.original_filename || f.filename)}</span>
          </div>
        ))}
      </div>

      <div className="received-condition-uploads">
        <label className="received-condition-multi">
          <input
            type="file"
            accept="image/*"
            multiple
            disabled={busy}
            className="sr-only"
            onChange={(e) => {
              void addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <span className={`btn btn-default btn-sm${busy ? ' disabled' : ''}`}>
            <i className={`fas ${busy ? 'fa-spinner fa-spin' : 'fa-images'}`} />{' '}
            {busy ? 'Uploading…' : 'Choose multiple images'}
          </span>
        </label>
        <FileInput
          accept="image/*"
          disabled={busy}
          label={busy ? 'Uploading…' : 'Add one photo'}
          onChange={(f) => {
            if (f) void addFiles([f])
          }}
        />
      </div>
      {msg ? <span className="help-block">{msg}</span> : null}
      {error ? <p className="text-danger" style={{ margin: '6px 0 0', fontSize: 13 }}>{error}</p> : null}
    </div>
  )
}
