import { Link, useNavigate, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import AppLayout from '../../layout/AppLayout'
import { Box, DataTable, Field, PageForm } from '../../components/ui'
import { useToast } from '../../components/Toast'
import { consultantsApi } from '../../api/client'

type Row = Record<string, unknown>

export function ConsultantsList() {
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = () => {
    setLoading(true)
    consultantsApi.list({ search: search || undefined, limit: 200 })
      .then((res) => {
        setRows(res.rows || [])
        setTotal(res.total || 0)
        setError('')
      })
      .catch((e: Error) => {
        setError(e.message)
        setRows([])
        setTotal(0)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  return (
    <AppLayout title="Consultants" subtitle={loading ? 'Loading…' : `${total} consultants`}>
      {error ? <div className="callout callout-danger"><p>{error}</p></div> : null}
      <Box
        title="Consultants"
        type="primary"
        tools={(
          <Link to="/consultants/create" className="btn btn-theme btn-sm">
            <i className="fas fa-plus" /> Create New
          </Link>
        )}
      >
        <DataTable
          search={search}
          onSearch={setSearch}
          rows={rows}
          exportName="consultants"
          storageKey="consultants_columns"
          onRefresh={load}
          onBulkDelete={async (ids) => {
            for (const id of ids) await consultantsApi.remove(id)
          }}
          columns={[
            { key: 'consultant_code', label: 'Consultant ID' },
            { key: 'name', label: 'Name' },
            { key: 'email', label: 'Email' },
            { key: 'phone', label: 'Phone' },
            { key: 'company_name', label: 'Company' },
            {
              key: 'actions',
              label: '',
              exportable: false,
              render: (row) => (
                <Link to={`/consultants/${row.id}/edit`} className="btn btn-default btn-sm">Edit</Link>
              ),
            },
          ]}
        />
      </Box>
    </AppLayout>
  )
}

export function ConsultantForm() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const toast = useToast()
  const [code, setCode] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [company, setCompany] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!id) return
    consultantsApi.get(id).then((row) => {
      setCode(String(row.consultant_code || ''))
      setFirstName(String(row.first_name || ''))
      setLastName(String(row.last_name || ''))
      setEmail(String(row.email || ''))
      setPhone(String(row.phone || ''))
      setCompany(String(row.company_name || ''))
      setNotes(String(row.notes || ''))
    }).catch((e: Error) => setError(e.message))
  }, [id])

  const submit = () => {
    setBusy(true)
    setError('')
    const body = {
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      email: email.trim(),
      phone: phone.trim(),
      company_name: company.trim(),
      notes: notes.trim(),
    }
    const req = isEdit && id ? consultantsApi.update(id, body) : consultantsApi.create(body)
    req.then((res) => {
      const created = String(res.payload?.consultant_code || code || '')
      toast.success(res.messages?.[0] || (isEdit ? 'Consultant updated' : `Consultant ${created} created`))
      navigate('/consultants')
    }).catch((err: Error) => {
      setError(err.message)
    }).finally(() => setBusy(false))
  }

  return (
    <AppLayout
      title={isEdit ? 'Edit consultant' : 'New consultant'}
      subtitle={code || 'ID is generated as CON-0001'}
      backTo="/consultants"
    >
      {error ? <div className="callout callout-danger"><p>{error}</p></div> : null}
      <PageForm
        cancelTo="/consultants"
        onSubmit={submit}
        submitLabel={busy ? 'Saving…' : 'Save'}
        submitDisabled={busy}
      >
        {code ? <Field label="Consultant ID"><input className="form-control" value={code} readOnly disabled /></Field> : (
          <p className="help-block">The consultant ID is created automatically, for example CON-0001.</p>
        )}
        <Field label="First name" required>
          <input className="form-control" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
        </Field>
        <Field label="Last name">
          <input className="form-control" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </Field>
        <Field label="Email">
          <input className="form-control" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Phone">
          <input className="form-control" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Company">
          <input className="form-control" value={company} onChange={(e) => setCompany(e.target.value)} />
        </Field>
        <Field label="Notes" full>
          <textarea className="form-control" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </PageForm>
    </AppLayout>
  )
}
