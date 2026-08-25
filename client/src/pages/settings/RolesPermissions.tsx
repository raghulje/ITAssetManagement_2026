import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import AppLayout from '../../layout/AppLayout'
import { Box } from '../../components/ui'
import { groupsApi, usersApi } from '../../api/client'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../api/AuthContext'

type Role = {
  id: number
  name: string
  permissions: Record<string, unknown>
  users_count?: number
}

const MODULE_LABELS: Record<string, string> = {
  assets: 'Assets',
  licenses: 'Licenses',
  accessories: 'Accessories',
  consumables: 'Consumables',
  components: 'Components',
  people: 'People',
  reports: 'Reports',
  settings: 'Settings',
  maintenance: 'Maintenance',
}

const ACTION_LABELS: Record<string, string> = {
  view: 'View',
  create: 'Create',
  edit: 'Edit',
  delete: 'Delete',
  checkout: 'Assign / Unassign',
}

const BUILTIN = new Set(['Superusers', 'Admin', 'IT Asset Manager', 'Admin Asset Manager', 'Viewer'])
const ACTIONS = ['view', 'create', 'edit', 'delete', 'checkout'] as const

function userCountLabel(n: number) {
  const count = Number(n) || 0
  return count === 1 ? '1 user' : `${count} users`
}

function permsEqual(a: Record<string, boolean>, b: Record<string, boolean>) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) {
    if (Boolean(a[k]) !== Boolean(b[k])) return false
  }
  return true
}

export default function RolesPermissions() {
  const toast = useToast()
  const { can, refreshUser } = useAuth()
  const canEdit = can('settings.edit')

  const [roles, setRoles] = useState<Role[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [moduleActions, setModuleActions] = useState<Record<string, string[]>>({})
  const [perms, setPerms] = useState<Record<string, boolean>>({})
  const [savedPerms, setSavedPerms] = useState<Record<string, boolean>>({})
  const [name, setName] = useState('')
  const [savedName, setSavedName] = useState('')
  const [members, setMembers] = useState<Array<{ id: number; email: string | null; first_name: string; last_name: string; username: string }>>([])
  const [allUsers, setAllUsers] = useState<Array<{ id: number; label: string }>>([])
  const [memberIds, setMemberIds] = useState<number[]>([])
  const [savedMemberIds, setSavedMemberIds] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [newRoleName, setNewRoleName] = useState('')
  const [memberFilter, setMemberFilter] = useState('')

  const selected = useMemo(() => roles.find((r) => r.id === selectedId) || null, [roles, selectedId])

  const dirty = useMemo(() => {
    if (!selectedId) return false
    const membersChanged =
      memberIds.length !== savedMemberIds.length
      || memberIds.some((id) => !savedMemberIds.includes(id))
    return name.trim() !== savedName.trim() || !permsEqual(perms, savedPerms) || membersChanged
  }, [selectedId, name, savedName, perms, savedPerms, memberIds, savedMemberIds])

  const loadRoles = async () => {
    const [catalog, list] = await Promise.all([
      groupsApi.catalog(),
      groupsApi.list(),
    ])
    setModuleActions(catalog.module_actions || {})
    const rows = (list.rows || []) as Role[]
    setRoles(rows.map((r) => ({
      ...r,
      id: Number(r.id),
      permissions: (r.permissions && typeof r.permissions === 'object')
        ? r.permissions as Record<string, unknown>
        : {},
    })))
    if (!selectedId && rows.length) setSelectedId(Number(rows[0].id))
  }

  useEffect(() => {
    loadRoles().catch((e: Error) => setError(e.message))
    usersApi.list({ limit: 500 }).then((r) => {
      setAllUsers((r.rows || []).map((u) => ({
        id: Number(u.id),
        label: `${String(u.first_name || '')} ${String(u.last_name || '')}`.trim() || String(u.username || u.email || u.id),
      })))
    }).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!selectedId) return
    setError('')
    groupsApi.get(selectedId)
      .then((role) => {
        const roleName = String(role.name || '')
        setName(roleName)
        setSavedName(roleName)
        const p = (role.permissions && typeof role.permissions === 'object')
          ? role.permissions as Record<string, unknown>
          : {}
        const map: Record<string, boolean> = {}
        for (const [k, v] of Object.entries(p)) {
          map[k] = v === '1' || v === 1 || v === true || v === 'true'
        }
        setPerms(map)
        setSavedPerms({ ...map })
        const mem = (role.members as typeof members) || []
        setMembers(mem)
        const ids = mem.map((m) => Number(m.id))
        setMemberIds(ids)
        setSavedMemberIds(ids)
      })
      .catch((e: Error) => setError(e.message))
  }, [selectedId])

  const toggle = (key: string) => {
    if (!canEdit) return
    setPerms((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const setModuleAll = (mod: string, on: boolean) => {
    if (!canEdit) return
    const actions = moduleActions[mod] || []
    setPerms((prev) => {
      const next = { ...prev }
      for (const act of actions) next[`${mod}.${act}`] = on
      return next
    })
  }

  const saveRole = async () => {
    if (!selectedId || !canEdit) return
    setBusy(true)
    setError('')
    try {
      const permissions: Record<string, string> = {}
      for (const [k, v] of Object.entries(perms)) {
        if (v) permissions[k] = '1'
      }
      // Preserve role flags even if not shown in the grid
      if (perms.admin) permissions.admin = '1'
      if (perms.superuser) permissions.superuser = '1'

      const body: { name?: string; permissions: Record<string, string> } = { permissions }
      if (!BUILTIN.has(selected?.name || '') && name.trim()) body.name = name.trim()

      await groupsApi.update(selectedId, body)
      await groupsApi.setMembers(selectedId, memberIds)
      toast.success(`Saved permissions for “${selected?.name || 'role'}”`)
      setSavedPerms({ ...perms })
      setSavedName(name.trim())
      setSavedMemberIds([...memberIds])
      await loadRoles()
      await refreshUser()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const createRole = async () => {
    if (!canEdit || !newRoleName.trim()) return
    setBusy(true)
    try {
      const res = await groupsApi.create({ name: newRoleName.trim(), permissions: { 'assets.view': '1' } })
      const id = Number(res.payload?.id)
      setNewRoleName('')
      await loadRoles()
      if (id) setSelectedId(id)
      toast.success('Role created — customize module permissions below')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setBusy(false)
    }
  }

  const deleteRole = async () => {
    if (!selectedId || !selected || BUILTIN.has(selected.name) || !canEdit) return
    if (!window.confirm(`Delete role “${selected.name}”?`)) return
    setBusy(true)
    try {
      await groupsApi.remove(selectedId)
      setSelectedId(null)
      await loadRoles()
      toast.success('Role deleted')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  const modules = Object.keys(moduleActions)
  const filteredUsers = useMemo(() => {
    const q = memberFilter.trim().toLowerCase()
    if (!q) return allUsers
    return allUsers.filter((u) => u.label.toLowerCase().includes(q))
  }, [allUsers, memberFilter])

  return (
    <AppLayout title="Roles & permissions" subtitle="Choose a role, tick module permissions, then Save" backTo="/settings">
      {error ? <div className="callout callout-danger"><p>{error}</p></div> : null}

      <div className="roles-layout">
        <aside className="roles-sidebar">
          <div className="roles-sidebar-head">
            <h3>Roles</h3>
            <p className="help-block" style={{ margin: 0 }}>Select a role to customize access</p>
          </div>

          {canEdit ? (
            <div className="roles-create">
              <input
                className="form-control"
                placeholder="New role name…"
                value={newRoleName}
                onChange={(e) => setNewRoleName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void createRole()
                  }
                }}
              />
              <button type="button" className="btn btn-theme" disabled={busy || !newRoleName.trim()} onClick={() => { void createRole() }}>
                Add
              </button>
            </div>
          ) : null}

          <div className="roles-card-list" role="list">
            {roles.map((r) => {
              const active = selectedId === r.id
              const count = Number(r.users_count ?? 0)
              return (
                <button
                  key={r.id}
                  type="button"
                  role="listitem"
                  className={`roles-card${active ? ' is-active' : ''}`}
                  onClick={() => {
                    if (dirty && !window.confirm('You have unsaved permission changes. Discard them?')) return
                    setSelectedId(r.id)
                  }}
                >
                  <span className="roles-card-name">{r.name}</span>
                  <span className="roles-card-meta">
                    <span className="roles-card-count">{userCountLabel(count)}</span>
                    {BUILTIN.has(r.name) ? <span className="roles-card-tag">Built-in</span> : null}
                  </span>
                </button>
              )
            })}
            {roles.length === 0 ? <p className="text-muted" style={{ padding: '8px 4px' }}>No roles yet.</p> : null}
          </div>
        </aside>

        <section className="roles-detail">
          {selected ? (
            <Box
              title={`Edit: ${selected.name}`}
              type="default"
              tools={(
                <>
                  {canEdit && !BUILTIN.has(selected.name) ? (
                    <button type="button" className="btn btn-xs btn-danger" disabled={busy} onClick={() => { void deleteRole() }}>
                      Delete
                    </button>
                  ) : null}
                  {' '}
                  {canEdit ? (
                    <button
                      type="button"
                      className="btn btn-xs btn-theme"
                      disabled={busy || !dirty}
                      onClick={() => { void saveRole() }}
                    >
                      {busy ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
                    </button>
                  ) : (
                    <span className="text-muted">View only</span>
                  )}
                </>
              )}
            >
              <div className="roles-detail-summary">
                <div>
                  <label className="control-label">Role name</label>
                  <input
                    className="form-control"
                    value={name}
                    disabled={!canEdit || BUILTIN.has(selected.name)}
                    onChange={(e) => setName(e.target.value)}
                  />
                  {BUILTIN.has(selected.name) ? (
                    <p className="help-block" style={{ marginBottom: 0 }}>Built-in role name is fixed — module permissions below are fully editable.</p>
                  ) : null}
                </div>
                <div className="roles-detail-stat">
                  <span className="roles-detail-stat-label">Assigned users</span>
                  <strong className="roles-detail-stat-value">{userCountLabel(memberIds.length || Number(selected.users_count || 0))}</strong>
                </div>
              </div>

              <label className="checkbox-inline roles-notify">
                <input
                  type="checkbox"
                  checked={Boolean(perms['notify.ops'])}
                  disabled={!canEdit}
                  onChange={() => toggle('notify.ops')}
                />
                {' '}Receive ops workflow emails (assign, maintenance, inventory alerts)
              </label>

              <div className="roles-perm-head" style={{ marginTop: 16 }}>
                <h4 className="roles-section-title" style={{ margin: 0 }}>Asset domains</h4>
              </div>
              <p className="help-block" style={{ marginTop: 6 }}>
                Domain access is enforced by the API. Superusers and Admin roles can always access IT and ADMIN.
              </p>
              <label className="checkbox-inline roles-notify">
                <input
                  type="checkbox"
                  checked={Boolean(perms['domains.it'])}
                  disabled={!canEdit}
                  onChange={() => toggle('domains.it')}
                />
                {' '}IT
              </label>
              {' '}
              <label className="checkbox-inline roles-notify">
                <input
                  type="checkbox"
                  checked={Boolean(perms['domains.admin'])}
                  disabled={!canEdit}
                  onChange={() => toggle('domains.admin')}
                />
                {' '}ADMIN
              </label>

              <div className="roles-perm-head">
                <h4 className="roles-section-title" style={{ margin: 0 }}>Module permissions</h4>
                {canEdit ? (
                  <button
                    type="button"
                    className="btn btn-theme btn-sm"
                    disabled={busy || !dirty}
                    onClick={() => { void saveRole() }}
                  >
                    {busy ? 'Saving…' : dirty ? 'Save permissions' : 'All saved'}
                  </button>
                ) : null}
              </div>
              <p className="help-block" style={{ marginTop: 6 }}>
                Tick or untick any box, then click <strong>Save permissions</strong>. Changes apply to every user in this role.
              </p>

              <div className="table-responsive">
                <table className="table table-bordered table-condensed roles-perm-table">
                  <thead>
                    <tr>
                      <th>Module</th>
                      {ACTIONS.map((a) => (
                        <th key={a} style={{ textAlign: 'center' }}>{ACTION_LABELS[a] || a}</th>
                      ))}
                      {canEdit ? <th style={{ textAlign: 'center', width: 120 }}>Quick</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {modules.map((mod) => {
                      const actions = moduleActions[mod] || []
                      const allOn = actions.length > 0 && actions.every((act) => perms[`${mod}.${act}`])
                      return (
                        <tr key={mod}>
                          <td><strong>{MODULE_LABELS[mod] || mod}</strong></td>
                          {ACTIONS.map((act) => {
                            const key = `${mod}.${act}`
                            const allowed = actions.includes(act)
                            return (
                              <td key={act} style={{ textAlign: 'center' }}>
                                {allowed ? (
                                  <label className="roles-perm-check">
                                    <input
                                      type="checkbox"
                                      checked={Boolean(perms[key])}
                                      disabled={!canEdit}
                                      onChange={() => toggle(key)}
                                    />
                                  </label>
                                ) : (
                                  <span className="text-muted">—</span>
                                )}
                              </td>
                            )
                          })}
                          {canEdit ? (
                            <td style={{ textAlign: 'center' }}>
                              <button
                                type="button"
                                className="btn btn-default btn-xs"
                                onClick={() => setModuleAll(mod, !allOn)}
                              >
                                {allOn ? 'Clear' : 'All'}
                              </button>
                            </td>
                          ) : null}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {dirty && canEdit ? (
                <div className="roles-save-bar">
                  <span>Unsaved changes for <strong>{selected.name}</strong></span>
                  <button type="button" className="btn btn-theme" disabled={busy} onClick={() => { void saveRole() }}>
                    {busy ? 'Saving…' : 'Save permissions'}
                  </button>
                </div>
              ) : null}

              <h4 className="roles-section-title">Members</h4>
              <p className="help-block" style={{ marginTop: 0 }}>
                Users in this role inherit the permissions above. {memberIds.length} selected.
              </p>
              <input
                className="form-control"
                style={{ maxWidth: 320, marginBottom: 10 }}
                placeholder="Filter users…"
                value={memberFilter}
                onChange={(e) => setMemberFilter(e.target.value)}
              />
              <div className="roles-members">
                {filteredUsers.map((u) => (
                  <label key={u.id} className="roles-member-row">
                    <input
                      type="checkbox"
                      checked={memberIds.includes(u.id)}
                      disabled={!canEdit}
                      onChange={(e) => {
                        setMemberIds((prev) => e.target.checked
                          ? [...prev, u.id]
                          : prev.filter((x) => x !== u.id))
                      }}
                    />
                    <span>{u.label}</span>
                  </label>
                ))}
                {filteredUsers.length === 0 ? <p className="text-muted">No users match.</p> : null}
              </div>
              <p style={{ marginTop: 12 }}>
                <Link to="/users">Manage app users</Link>
              </p>
            </Box>
          ) : (
            <div className="roles-empty">
              <p className="text-muted">Select a role on the left to view and edit permissions.</p>
            </div>
          )}
        </section>
      </div>
    </AppLayout>
  )
}
