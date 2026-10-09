import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { get } from '../db/index.js'
import { fail } from '../utils/response.js'
import { hasPermission } from '../services/permissions.js'

export type AuthUser = {
  id: number
  username: string
  first_name: string
  last_name: string
  email: string | null
  company_id: number | null
  permissions: Record<string, unknown>
  activated: number
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

const secret = () => process.env.JWT_SECRET || 'dev-secret'

export function signToken(user: { id: number; username: string }) {
  return jwt.sign({ sub: user.id, username: user.username }, secret(), { expiresIn: '7d' })
}

function bearerOrQueryToken(req: Request) {
  const header = req.headers.authorization
  if (header?.startsWith('Bearer ')) return header.slice(7)
  // <img>/<video> cannot send Authorization; GET file routes accept access_token.
  if (req.method === 'GET') {
    const q = req.query.access_token
    if (typeof q === 'string' && q.trim()) return q.trim()
  }
  return ''
}

export async function authRequired(req: Request, res: Response, next: NextFunction) {
  const token = bearerOrQueryToken(req)
  if (!token) {
    return fail(res, 'Unauthorized', 401)
  }
  try {
    const decoded = jwt.verify(token, secret()) as unknown as { sub: number }
    const row = await get<AuthUser>(`
      SELECT id, username, first_name, last_name, email, company_id, permissions, activated
      FROM users WHERE id = ? AND deleted_at IS NULL
    `, [decoded.sub])

    if (!row || !row.activated) return fail(res, 'Unauthorized', 401)
    row.permissions = typeof row.permissions === 'string'
      ? JSON.parse(row.permissions as unknown as string)
      : (row.permissions || {})
    req.user = row
    next()
  } catch {
    return fail(res, 'Unauthorized', 401)
  }
}

/** Permission gate — superuser / admin bypass; empty perms no longer allow all. */
export function can(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (hasPermission(req.user?.permissions, permission)) return next()
    return fail(res, `Forbidden: missing ${permission}`, 403)
  }
}
