import { useMemo, useState } from 'react'
import { Field } from './ui'
import { AppSelect } from './formControls'
import type { SelectOption } from '../api/client'

type Props = {
  label: string
  value: string
  options: SelectOption[]
  onChange: (id: string) => void
  onOptionsChange: (opts: SelectOption[]) => void
  create: (name: string) => Promise<SelectOption>
  required?: boolean
  help?: string
  allowEmpty?: boolean
  emptyLabel?: string
  disabled?: boolean
}

/** Select tied to a master, with inline “Add new” for user-created entries */
export function MasterSelect({
  label,
  value,
  options,
  onChange,
  onOptionsChange,
  create,
  required,
  help,
  allowEmpty = true,
  emptyLabel = '—',
  disabled,
}: Props) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const selectOptions = useMemo(
    () => [
      ...(allowEmpty ? [{ value: '', label: emptyLabel }] : []),
      ...options.map((o) => ({ value: String(o.id), label: o.text })),
    ],
    [allowEmpty, emptyLabel, options],
  )

  const save = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Name is required')
      return
    }
    setBusy(true)
    setError('')
    try {
      const opt = await create(trimmed)
      const next = [...options.filter((o) => o.id !== opt.id), opt].sort((a, b) =>
        a.text.localeCompare(b.text),
      )
      onOptionsChange(next)
      onChange(String(opt.id))
      setName('')
      setAdding(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Field label={label} required={required}>
      <div className="master-select-row">
        <AppSelect
          value={value}
          onChange={onChange}
          options={selectOptions}
          required={required}
          disabled={disabled || adding}
          placeholder={emptyLabel}
          searchable
        />
        {!adding ? (
          <button
            type="button"
            className="btn btn-default"
            disabled={disabled}
            onClick={() => { setAdding(true); setError('') }}
            title={`Add new ${label.toLowerCase()}`}
          >
            <i className="fas fa-plus" /> Add
          </button>
        ) : null}
      </div>

      {adding ? (
        <div className="master-select-add">
          <input
            className="form-control"
            placeholder={`New ${label.toLowerCase()} name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void save()
              }
            }}
          />
          <button type="button" className="btn btn-theme" disabled={busy} onClick={() => { void save() }}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            className="btn btn-default"
            disabled={busy}
            onClick={() => { setAdding(false); setName(''); setError('') }}
          >
            Cancel
          </button>
        </div>
      ) : null}

      {error ? <p className="text-danger" style={{ marginTop: 6 }}>{error}</p> : null}
      {help ? <p className="help-block">{help}</p> : null}
    </Field>
  )
}

export function masterPayloadId(res: { payload?: { id?: number }; id?: number }, name: string): SelectOption {
  const id = Number(res.payload?.id ?? res.id)
  if (!id) throw new Error('Create succeeded but no id returned')
  return { id, text: name }
}
