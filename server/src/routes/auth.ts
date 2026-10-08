import { Router } from 'express'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { all, get, run, now } from '../db/index.js'
import { authRequired, signToken } from '../middleware/auth.js'
import { fail, okItem, okMessage } from '../utils/response.js'
import { transformUser } from '../services/transformers.js'
import { logAction } from '../services/actionLog.js'
import { mailConfigured, sendMail } from '../services/mail.js'

const router = Router()

const RESET_TTL_MS = 60 * 60 * 1000 // 1 hour

/** Public site origin for emails/links — never use raw CLIENT_ORIGIN (may be a CSV list). */
function clientOrigin() {
  const fromEnv = (process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || '').trim()
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  const first = String(process.env.CLIENT_ORIGIN || 'http://localhost:5173')
    .split(',')[0]
    .trim()
  return first.replace(/\/$/, '')
}

router.post('/login', async (req, res) => {
  const email = String(req.body?.email || req.body?.username || '').trim()
  const { password } = req.body || {}
  if (!email || !password) return fail(res, 'Email and password required')

  const emailNorm = email.toLowerCase()
  const user = await get<Record<string, unknown>>(`
    SELECT * FROM users WHERE LOWER(email) = ? AND deleted_at IS NULL
  `, [emailNorm])

  // Any activated App User can sign in (admin-created accounts included)
  if (!user || !user.activated) return fail(res, 'Invalid credentials', 401)
  if (!bcrypt.compareSync(String(password), String(user.password))) {
    return fail(res, 'Invalid credentials', 401)
  }

  const token = signToken({ id: Number(user.id), username: String(user.username) })
  await logAction({ userId: Number(user.id), actionType: 'login', itemType: 'user', itemId: Number(user.id) })

  return okItem(res, {
    status: 'success',
    token,
    token_type: 'Bearer',
    expires_in: 604800,
    user: await transformUser(Number(user.id)),
  })
})

router.get('/user', authRequired, async (req, res) => {
  return okItem(res, await transformUser(req.user!.id))
})

router.post('/logout', authRequired, (_req, res) => okMessage(res, 'Logged out'))

/** Request a password-reset email. Always returns success to avoid email enumeration. */
router.post('/password/forgot', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  if (!email) return fail(res, 'Email is required')

  const generic = 'If that email is registered, a reset link has been sent.'

  try {
    const user = await get<{ id: number; email: string; first_name: string; activated: number }>(`
      SELECT id, email, first_name, activated FROM users
      WHERE LOWER(email) = ? AND deleted_at IS NULL
    `, [email])

    if (!user || !user.activated) {
      return okMessage(res, generic)
    }

    if (!mailConfigured()) {
      console.error('[password/forgot] SMTP is not configured')
      return fail(res, 'Email service is not configured. Contact an administrator.', 503)
    }

    const plain = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(plain).digest('hex')
    const expires = new Date(Date.now() + RESET_TTL_MS)
    const expiresSql = expires.toISOString().slice(0, 19).replace('T', ' ')

    await run(`UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL`, [now(), user.id])
    await run(`
      INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `, [user.id, tokenHash, expiresSql, now()])

    const link = `${clientOrigin()}/reset-password?token=${plain}`
    const name = user.first_name || 'there'
    await sendMail({
      to: String(user.email),
      subject: 'Reset your Refex IT Asset password',
      emailType: 'password_reset',
      relatedType: 'user',
      relatedId: Number(user.id),
      text: [
        `Hi ${name},`,
        '',
        'We received a request to reset your password for Refex IT Asset Management.',
        'Open this link to choose a new password (valid for 1 hour):',
        '',
        link,
        '',
        'If you did not request this, you can ignore this email.',
      ].join('\n'),
      html: `
        <p>Hi ${name},</p>
        <p>We received a request to reset your password for <strong>Refex IT Asset Management</strong>.</p>
        <p><a href="${link}" style="display:inline-block;padding:10px 16px;background:#0b6e66;color:#fff;text-decoration:none;border-radius:8px;font-weight:700">Reset password</a></p>
        <p style="color:#64748b;font-size:13px">Or copy this link:<br/><a href="${link}">${link}</a></p>
        <p style="color:#64748b;font-size:13px">This link expires in 1 hour. If you did not request this, ignore this email.</p>
      `,
    })

    await logAction({ userId: Number(user.id), actionType: 'password_reset_request', itemType: 'user', itemId: Number(user.id) })
  } catch (e) {
    console.error('[password/forgot]', e)
    return fail(res, 'Could not send reset email. Try again later.', 500)
  }

  return okMessage(res, generic)
})

router.get('/password/reset/:token', async (req, res) => {
  const plain = String(req.params.token || '').trim()
  if (!plain) return fail(res, 'Invalid token', 400)
  const tokenHash = crypto.createHash('sha256').update(plain).digest('hex')
  const row = await get<{ id: number }>(`
    SELECT id FROM password_reset_tokens
    WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
    LIMIT 1
  `, [tokenHash, now()])
  if (!row) return fail(res, 'This reset link is invalid or has expired', 400)
  return okMessage(res, 'Token is valid')
})

router.post('/password/reset', async (req, res) => {
  const plain = String(req.body?.token || '').trim()
  const password = String(req.body?.password || '')
  const confirm = req.body?.password_confirmation != null ? String(req.body.password_confirmation) : password

  if (!plain) return fail(res, 'Reset token is required')
  if (password.length < 8) return fail(res, 'Password must be at least 8 characters')
  if (password !== confirm) return fail(res, 'Passwords do not match')

  const tokenHash = crypto.createHash('sha256').update(plain).digest('hex')
  const row = await get<{ id: number; user_id: number }>(`
    SELECT id, user_id FROM password_reset_tokens
    WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
    LIMIT 1
  `, [tokenHash, now()])

  if (!row) return fail(res, 'This reset link is invalid or has expired', 400)

  const ts = now()
  await run(`UPDATE users SET password = ?, updated_at = ? WHERE id = ?`, [
    bcrypt.hashSync(password, 10), ts, row.user_id,
  ])
  await run(`UPDATE password_reset_tokens SET used_at = ? WHERE id = ?`, [ts, row.id])
  await run(`UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL`, [ts, row.user_id])

  await logAction({ userId: Number(row.user_id), actionType: 'password_reset', itemType: 'user', itemId: Number(row.user_id) })
  return okMessage(res, 'Password has been reset. You can sign in now.')
})

router.get('/personal-access-tokens', authRequired, async (req, res) => {
  const rows = await all(`
    SELECT id, name, last_used_at, expires_at, created_at FROM api_tokens WHERE user_id = ? ORDER BY id DESC
  `, [req.user!.id])
  return res.json({ total: rows.length, rows })
})

router.post('/personal-access-tokens', authRequired, async (req, res) => {
  const name = req.body?.name || 'API Token'
  const plain = `refex_${crypto.randomBytes(24).toString('hex')}`
  const hash = bcrypt.hashSync(plain, 8)
  const info = await run(`
    INSERT INTO api_tokens (user_id, name, token_hash, created_at) VALUES (?, ?, ?, ?)
  `, [req.user!.id, name, hash, now()])
  return okMessage(res, 'Token created', { id: info.insertId, name, token: plain }, 201)
})

router.delete('/personal-access-tokens/:id', authRequired, async (req, res) => {
  await run(`DELETE FROM api_tokens WHERE id = ? AND user_id = ?`, [req.params.id, req.user!.id])
  return okMessage(res, 'Token revoked')
})

export default router
