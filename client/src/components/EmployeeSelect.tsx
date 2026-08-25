import { useEffect, useState } from 'react'
import { AppSelect, type AppSelectOption } from './formControls'
import { employeesApi } from '../api/employees'

type EmployeeSelectProps = {
  value: string
  onChange: (value: string) => void
  required?: boolean
  disabled?: boolean
  placeholder?: string
  searchPlaceholder?: string
  emptyOption?: string
  excludeId?: string | number | null
  id?: string
}

/** HRMS directory picker — same employees for IT and Admin assignments. */
export function EmployeeSelect({
  value,
  onChange,
  required,
  disabled,
  placeholder = 'Search active employee name or ID…',
  searchPlaceholder = 'Type a name or employee ID…',
  emptyOption,
  excludeId,
  id,
}: EmployeeSelectProps) {
  const [options, setOptions] = useState<AppSelectOption[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    employeesApi
      .selectlist(query || undefined)
      .then((r) => {
        if (cancelled) return
        const skip = excludeId != null && excludeId !== '' ? String(excludeId) : ''
        const list = (r.results || [])
          .filter((o) => !skip || String(o.id) !== skip)
          .map((o) => ({ value: String(o.id), label: o.text }))
        setOptions(emptyOption ? [{ value: '', label: emptyOption }, ...list] : list)
      })
      .catch(() => {
        if (!cancelled) setOptions(emptyOption ? [{ value: '', label: emptyOption }] : [])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [query, emptyOption, excludeId])

  return (
    <AppSelect
      id={id}
      value={value}
      onChange={onChange}
      required={required}
      disabled={disabled}
      searchable
      loading={loading}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      onSearch={setQuery}
      options={options}
    />
  )
}
