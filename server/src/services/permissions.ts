import type { NextFunction, Request, Response } from 'express'
import { all, get, run, now } from '../db/index.js'
import { fail } from '../utils/response.js'

export const MODULES = [
  'assets',
  'licenses',
  'accessories',
  'consumables',
  'components',
  'people',
  'reports',
  'settings',
  'maintenance',
] as const

export type ModuleKey = (typeof MODULES)[number]

export const ACTIONS = ['view', 'create', 'edit', 'delete', 'checkout'] as const
export type ActionKey = (typeof ACTIONS)[number]

/** Actions that apply per module (checkout only for inventory-like modules). */
export const MODULE_ACTIONS: Record<ModuleKey, ActionKey[]> = {
  assets: ['view', 'create', 'edit', 'delete', 'checkout'],
  licenses: ['view', 'create', 'edit', 'delete', 'checkout'],
  accessories: ['view', 'create', 'edit', 'delete', 'checkout'],
  consumables: ['view', 'create', 'edit', 'delete', 'checkout'],
  components: ['view', 'create', 'edit', 'delete', 'checkout'],
  people: ['view', 'create', 'edit', 'delete'],
  reports: ['view'],
  settings: ['view', 'edit'],
  maintenance: ['view', 'create', 'edit', 'delete'],
}

export function permissionCatalog() {
  const keys: { key: string; module: string; action: string; label: string }[] = []
  for (const mod of MODULES) {
    for (const act of MODULE_ACTIONS[mod]) {
      keys.push({
        key: `${mod}.${act}`,
        module: mod,
        action: act,
        label: `${mod} ${act}`,
      })
    }
  }
  keys.push({ key: 'domains.it', module: 'domains', action: 'it', label: 'IT domain' })
  keys.push({ key: 'domains.admin', module: 'domains', action: 'admin', label: 'Admin domain' })
  keys.push({ key: 'notify.ops', module: 'notify', action: 'ops', label: 'Receive ops email alerts' })
  return keys
}

export function allModulePerms(opts?: { notifyOps?: boolean; includeCheckout?: boolean }): Record<string, string> {
  const out: Record<string, string> = {}
  for (const mod of MODULES) {
    for (const act of MODULE_ACTIONS[mod]) {
      if (!opts?.includeCheckout && act === 'checkout') continue
      out[`${mod}.${act}`] = '1'
    }
  }
  // Always include checkout for inventory modules when full access
  if (opts?.includeCheckout !== false) {
    for (const mod of ['assets', 'licenses', 'accessories', 'consumables', 'components'] as ModuleKey[]) {
      out[`${mod}.checkout`] = '1'
    }
  }
  if (opts?.notifyOps) out['notify.ops'] = '1'
  return out
}

export function withDomainPerms(
  perms: Record<string, string>,
  domains: Array<'it' | 'admin'>,
): Record<string, string> {
  const out = { ...perms }
  if (domains.includes('it')) out['domains.it'] = '1'
  if (domains.includes('admin')) out['domains.admin'] = '1'
  return out
}

export function viewerPerms(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const mod of ['assets', 'licenses', 'accessories', 'consumables', 'components', 'people', 'reports', 'maintenance'] as ModuleKey[]) {
    out[`${mod}.view`] = '1'
  }
  return withDomainPerms(out, ['it'])
}

export function itAssetManagerPerms(): Record<string, string> {
  // Full module access including settings.edit (print labels, masters, import)
  // Settings / Reports nav stay Admin-only via client isAdmin flag.
  return withDomainPerms(allModulePerms({ notifyOps: true }), ['it'])
}

export function adminAssetManagerPerms(): Record<string, string> {
  return withDomainPerms(allModulePerms({ notifyOps: true }), ['admin'])
}

export function parsePerms(raw: unknown): Record<string, unknown> {
  if (!raw) return {}
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  if (typeof raw === 'object') return raw as Record<string, unknown>
  return {}
}

export function isTruthyPerm(v: unknown): boolean {
  return v === '1' || v === 1 || v === true || v === 'true'
}

export function hasPermission(perms: Record<string, unknown> | null | undefined, permission: string): boolean {
  const p = perms || {}
  if (isTruthyPerm(p.superuser)) return true
  if (isTruthyPerm(p.admin)) return true
  if (isTruthyPerm(p[permission])) return true
  return false
}

export function mergePermissions(...sets: Record<string, unknown>[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const set of sets) {
    for (const [k, v] of Object.entries(set || {})) {
      if (isTruthyPerm(v)) out[k] = '1'
    }
  }
  return out
}

export async function getUserGroupIds(userId: number): Promise<number[]> {
  const rows = await all<{ group_id: number }>(
    `SELECT group_id FROM users_groups WHERE user_id = ?`,
    [userId],
  )
  return rows.map((r) => Number(r.group_id))
}

export async function syncUserPermissions(userId: number, extra?: Record<string, unknown>) {
  const groups = await all<{ permissions: unknown }>(`
    SELECT g.permissions
    FROM permission_groups g
    INNER JOIN users_groups ug ON ug.group_id = g.id
    WHERE ug.user_id = ?
  `, [userId])
  const merged = mergePermissions(
    ...groups.map((g) => parsePerms(g.permissions)),
    extra || {},
  )
  await run(`UPDATE users SET permissions = ?, updated_at = ? WHERE id = ?`, [
    JSON.stringify(merged),
    now(),
    userId,
  ])
  return merged
}

export async function setUserGroups(userId: number, groupIds: number[]) {
  await run(`DELETE FROM users_groups WHERE user_id = ?`, [userId])
  const unique = [...new Set(groupIds.map(Number).filter((n) => n > 0))]
  for (const gid of unique) {
    await run(`INSERT INTO users_groups (user_id, group_id) VALUES (?, ?)`, [userId, gid])
  }
  // Preserve superuser/admin flags if already on user
  const row = await get<{ permissions: unknown }>(`SELECT permissions FROM users WHERE id = ?`, [userId])
  const existing = parsePerms(row?.permissions)
  const extras: Record<string, string> = {}
  if (isTruthyPerm(existing.superuser)) extras.superuser = '1'
  if (isTruthyPerm(existing.admin)) extras.admin = '1'
  return syncUserPermissions(userId, extras)
}

export async function ensureDefaultRoles() {
  const ts = now()
  const defaults: { name: string; permissions: Record<string, string> }[] = [
    { name: 'Superusers', permissions: { superuser: '1', admin: '1', ...withDomainPerms(allModulePerms({ notifyOps: true }), ['it', 'admin']) } },
    { name: 'Admin', permissions: { admin: '1', ...withDomainPerms(allModulePerms({ notifyOps: true }), ['it', 'admin']) } },
    { name: 'IT Asset Manager', permissions: itAssetManagerPerms() },
    { name: 'Admin Asset Manager', permissions: adminAssetManagerPerms() },
    { name: 'Viewer', permissions: viewerPerms() },
  ]

  for (const d of defaults) {
    const existing = await get<{ id: number }>(`SELECT id FROM permission_groups WHERE name = ?`, [d.name])
    // Only seed missing roles — never overwrite admin customizations from Settings → Roles
    if (!existing) {
      await run(
        `INSERT INTO permission_groups (name, permissions, created_at, updated_at) VALUES (?, ?, ?, ?)`,
        [d.name, JSON.stringify(d.permissions), ts, ts],
      )
    }
  }

  // One-time grants: settings.edit + IT domain on existing IT Asset Manager
  const itam = await get<{ id: number; permissions: unknown }>(
    `SELECT id, permissions FROM permission_groups WHERE name = 'IT Asset Manager' LIMIT 1`,
  )
  if (itam) {
    const p = parsePerms(itam.permissions)
    let changed = false
    if (!isTruthyPerm(p['settings.edit'])) {
      p['settings.edit'] = '1'
      p['settings.view'] = '1'
      changed = true
    }
    if (!isTruthyPerm(p['domains.it']) && !isTruthyPerm(p['domains.admin'])) {
      p['domains.it'] = '1'
      changed = true
    }
    if (changed) {
      await run(`UPDATE permission_groups SET permissions = ?, updated_at = ? WHERE id = ?`, [
        JSON.stringify(mergePermissions(p)),
        ts,
        itam.id,
      ])
      const members = await all<{ user_id: number }>(
        `SELECT user_id FROM users_groups WHERE group_id = ?`,
        [itam.id],
      )
      for (const m of members) {
        await syncUserPermissions(Number(m.user_id))
      }
    }
  }

  const su = await get<{ id: number }>(`SELECT id FROM permission_groups WHERE name = 'Superusers' LIMIT 1`)
  const adminGroup = await get<{ id: number }>(`SELECT id FROM permission_groups WHERE name = 'Admin' LIMIT 1`)

  // Ensure primary admin user is in Superusers
  const admin = await get<{ id: number }>(
    `SELECT id FROM users WHERE email = 'admin@refex.com' AND deleted_at IS NULL LIMIT 1`,
  )
  if (admin && su) {
    const link = await get(`SELECT user_id FROM users_groups WHERE user_id = ? AND group_id = ?`, [admin.id, su.id])
    if (!link) {
      await run(`INSERT INTO users_groups (user_id, group_id) VALUES (?, ?)`, [admin.id, su.id])
    }
    await syncUserPermissions(admin.id, { superuser: '1', admin: '1' })
  }

  // Soft migration: activated users with empty permissions → Admin (keeps existing demos working)
  if (adminGroup) {
    const emptyUsers = await all<{ id: number; permissions: unknown }>(`
      SELECT id, permissions FROM users
      WHERE deleted_at IS NULL AND activated = 1
    `)
    for (const u of emptyUsers) {
      const p = parsePerms(u.permissions)
      if (Object.keys(p).length === 0) {
        const link = await get(`SELECT user_id FROM users_groups WHERE user_id = ? AND group_id = ?`, [u.id, adminGroup.id])
        if (!link) {
          await run(`INSERT INTO users_groups (user_id, group_id) VALUES (?, ?)`, [u.id, adminGroup.id])
        }
        await syncUserPermissions(u.id)
      } else if (isTruthyPerm(p.superuser) && su) {
        const link = await get(`SELECT user_id FROM users_groups WHERE user_id = ? AND group_id = ?`, [u.id, su.id])
        if (!link) {
          await run(`INSERT INTO users_groups (user_id, group_id) VALUES (?, ?)`, [u.id, su.id])
        }
        await syncUserPermissions(u.id, { superuser: '1', admin: '1' })
      }
    }
  }
}

/** Infer module action from HTTP method + path for a resource router. */
export function moduleGate(module: ModuleKey) {
  return (req: Request, res: Response, next: NextFunction) => {
    const path = `${req.baseUrl}${req.path}` || req.path || ''
    let action: ActionKey = 'view'
    if (req.method === 'GET' || req.method === 'HEAD') {
      action = 'view'
    } else if (req.method === 'DELETE') {
      action = 'delete'
    } else if (req.method === 'PUT' || req.method === 'PATCH') {
      action = 'edit'
    } else if (req.method === 'POST') {
      if (/\/(checkout|checkin|replace|checkinbytag)\b/i.test(path) || /\/(checkout|checkin|replace)\b/i.test(req.path)) {
        action = 'checkout'
      } else if (/\/(complete|audit)\b/i.test(req.path)) {
        action = 'edit'
      } else if (/\/labels\b/i.test(path) || /\/labels\b/i.test(req.baseUrl || '')) {
        // Print label is not "create asset" — allow with view or edit
        action = 'view'
      } else {
        action = 'create'
      }
    }
    const permission = `${module}.${action}`
    const perms = req.user?.permissions || {}
    if (hasPermission(perms, permission)) return next()
    return fail(res, `Forbidden: missing ${permission}`, 403)
  }
}

export function requirePerm(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (hasPermission(req.user?.permissions, permission)) return next()
    return fail(res, `Forbidden: missing ${permission}`, 403)
  }
}

/** Activated users who belong to a named permission group (e.g. IT Asset Manager). */
export async function listRoleRecipientEmails(roleName: string): Promise<string[]> {
  const rows = await all<{ email: string | null }>(`
    SELECT DISTINCT u.email
    FROM users u
    INNER JOIN users_groups ug ON ug.user_id = u.id
    INNER JOIN permission_groups g ON g.id = ug.group_id
    WHERE u.deleted_at IS NULL AND u.activated = 1
      AND u.email IS NOT NULL AND u.email != ''
      AND g.name = ?
  `, [roleName])
  const emails = new Set<string>()
  for (const r of rows) {
    const e = String(r.email || '').trim().toLowerCase()
    if (e && e.includes('@')) emails.add(e)
  }
  return [...emails]
}

export async function listOpsRecipientEmails(): Promise<string[]> {
  const rows = await all<{ email: string | null }>(`
    SELECT DISTINCT u.email
    FROM users u
    WHERE u.deleted_at IS NULL AND u.activated = 1 AND u.email IS NOT NULL AND u.email != ''
      AND (
        u.permissions LIKE '%"notify.ops"%'
        OR u.permissions LIKE '%"superuser"%'
        OR u.permissions LIKE '%"admin"%'
      )
  `)
  const emails = new Set<string>()
  for (const r of rows) {
    const e = String(r.email || '').trim().toLowerCase()
    if (e && e.includes('@')) emails.add(e)
  }
  // Also pull from groups with notify.ops in case user.permissions not yet synced
  const groupUsers = await all<{ email: string | null }>(`
    SELECT DISTINCT u.email
    FROM users u
    INNER JOIN users_groups ug ON ug.user_id = u.id
    INNER JOIN permission_groups g ON g.id = ug.group_id
    WHERE u.deleted_at IS NULL AND u.activated = 1
      AND u.email IS NOT NULL AND u.email != ''
      AND (
        CAST(g.permissions AS CHAR) LIKE '%"notify.ops"%'
        OR CAST(g.permissions AS CHAR) LIKE '%"superuser"%'
        OR CAST(g.permissions AS CHAR) LIKE '%"admin"%'
      )
  `)
  for (const r of groupUsers) {
    const e = String(r.email || '').trim().toLowerCase()
    if (e && e.includes('@')) emails.add(e)
  }
  return [...emails]
}
