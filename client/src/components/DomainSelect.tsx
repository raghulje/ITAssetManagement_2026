import { Field } from './ui'

export type DomainCode = 'it' | 'admin'

type Props = {
  value: string
  onChange: (code: DomainCode) => void
  allowed: DomainCode[]
  disabled?: boolean
  label?: string
  required?: boolean
}

export function DomainSelect({ value, onChange, allowed, disabled, label = 'Domain', required }: Props) {
  const locked = allowed.length <= 1 || disabled
  const current = allowed.includes(value as DomainCode) ? value : (allowed[0] || 'it')

  if (locked) {
    const code = (allowed[0] || current || 'it') as DomainCode
    return (
      <Field label={label} required={required}>
        <input className="form-control" value={code === 'admin' ? 'ADMIN' : 'IT'} disabled readOnly />
        <p className="help-block" style={{ marginBottom: 0 }}>
          Domain is set by your role and cannot be changed.
        </p>
      </Field>
    )
  }

  return (
    <Field label={label} required={required}>
      <select
        className="form-control"
        value={current}
        onChange={(e) => onChange(e.target.value as DomainCode)}
      >
        {allowed.includes('it') ? <option value="it">IT</option> : null}
        {allowed.includes('admin') ? <option value="admin">ADMIN</option> : null}
      </select>
    </Field>
  )
}

type FilterProps = {
  value: string
  onChange: (code: string) => void
  allowed: DomainCode[]
}

export function DomainFilter({ value, onChange, allowed }: FilterProps) {
  if (allowed.length <= 1) return null
  return (
    <select
      className="form-control"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Domain"
      style={{ minWidth: 140 }}
    >
      <option value="">All Domains</option>
      {allowed.includes('it') ? <option value="it">IT</option> : null}
      {allowed.includes('admin') ? <option value="admin">Admin</option> : null}
    </select>
  )
}
