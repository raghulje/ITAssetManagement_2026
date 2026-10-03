import { Router } from 'express'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { get, run, now } from '../db/index.js'
import { fail, okItem } from '../utils/response.js'
import { signToken } from '../middleware/auth.js'
import { logAction } from '../services/actionLog.js'
import { transformUser } from '../services/transformers.js'
import {
  createSaml,
  idpConfigured,
  profileEmail,
  samlEnabled,
  samlPortalFields,
  samlSpConfig,
} from '../services/saml.js'
import { publicAppBase, safeAppPath } from '../services/appLinks.js'

function resolveRelayDest(relay: string, home: string) {
  const fallback = `${home}login/sso/callback`
  const raw = String(relay || '').trim()
  if (!raw) return fallback
  if (raw.startsWith('/') && !raw.startsWith('//')) {
    const path = safeAppPath(raw, '')
    return path ? `${home.replace(/\/$/, '')}${path}` : fallback
  }
  try {
    const url = new URL(raw)
    const allowed = new URL(publicAppBase())
    if (url.origin !== allowed.origin) return fallback
    const path = safeAppPath(`${url.pathname}${url.search}`, '')
    return path ? `${allowed.origin}${path}` : fallback
  } catch {
    return fallback
  }
}

const router = Router()

function htmlError(res: import('express').Response, message: string, status = 400) {
  const home = samlSpConfig().home_url
  res.status(status).type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"/><title>SSO error</title>
<style>body{font-family:system-ui,sans-serif;max-width:520px;margin:48px auto;padding:0 16px;color:#0f172a}
a{color:#0b6e66}</style></head>
<body><h1>SSO sign-in failed</h1><p>${message.replace(/</g, '&lt;')}</p>
<p><a href="${home}login">Back to login</a></p></body></html>`)
}

/** Public: whether SSO button should show + portal field preview for admins via settings. */
router.get('/status', (_req, res) => {
  const sp = samlSpConfig()
  return okItem(res, {
    enabled: samlEnabled(),
    idp_configured: idpConfigured(),
    label: process.env.SAML_BUTTON_LABEL || 'RefexOne SSO',
    login_path: '/api/v1/auth/saml/login',
    home_url: sp.home_url,
  })
})

/** Values to enter in RefexOne portal (public enough for IT setup; no secrets). */
router.get('/sp-config', (_req, res) => {
  return okItem(res, {
    enabled: samlEnabled(),
    idp_configured: idpConfigured(),
    ...samlSpConfig(),
    portal_fields: samlPortalFields(),
  })
})

router.get('/metadata', (_req, res) => {
  try {
    if (!idpConfigured()) {
      // Minimal SP descriptor without IdP cert — enough for many portals
      const sp = samlSpConfig()
      const xml = `<?xml version="1.0"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${sp.entity_id}">
  <SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol" AuthnRequestsSigned="false" WantAssertionsSigned="true">
    <NameIDFormat>${sp.name_id_format}</NameIDFormat>
    <AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${sp.acs_url}" index="0" isDefault="true"/>
    <SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${sp.slo_url}"/>
    <SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${sp.slo_url}"/>
  </SPSSODescriptor>
</EntityDescriptor>`
      res.type('application/samlmetadata+xml').send(xml)
      return
    }
    const saml = createSaml()
    const xml = saml.generateServiceProviderMetadata(null, null)
    res.type('application/samlmetadata+xml').send(xml)
  } catch (e) {
    return fail(res, e instanceof Error ? e.message : 'Metadata error', 500)
  }
})

router.get('/login', async (req, res) => {
  try {
    if (!samlEnabled()) return htmlError(res, 'SAML SSO is disabled (set SAML_ENABLED=true).', 503)
    if (!idpConfigured()) {
      return htmlError(res, 'SAML IdP is not configured yet. Ask IT to set SAML_IDP_ENTRY_POINT and SAML_IDP_CERT.', 503)
    }
    const saml = createSaml()
    const relay = safeAppPath(String(req.query.RelayState || req.query.returnTo || ''), '')
      || String(req.query.RelayState || req.query.returnTo || '')
    const url = await saml.getAuthorizeUrlAsync(relay, undefined, {})
    return res.redirect(url)
  } catch (e) {
    console.error('[saml/login]', e)
    return htmlError(res, e instanceof Error ? e.message : 'Could not start SSO', 500)
  }
})

router.post('/acs', async (req, res) => {
  try {
    if (!samlEnabled()) return htmlError(res, 'SAML SSO is disabled.', 503)
    const saml = createSaml()
    const body = req.body as Record<string, string>
    const { profile, loggedOut } = await saml.validatePostResponseAsync(body)
    if (loggedOut) {
      return res.redirect(`${samlSpConfig().home_url}login`)
    }
    if (!profile) return htmlError(res, 'Empty SAML profile from IdP.')

    const email = profileEmail(profile)
    if (!email) return htmlError(res, 'SAML assertion did not include an email NameID.')

    let user = await get<Record<string, unknown>>(`
      SELECT * FROM users WHERE LOWER(email) = ? AND deleted_at IS NULL
    `, [email])

    if (!user && process.env.SAML_AUTO_PROVISION === 'true') {
      const ts = now()
      const local = email.split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 40) || 'user'
      let username = local
      let n = 0
      while (await get(`SELECT id FROM users WHERE username = ?`, [username])) {
        n += 1
        username = `${local}${n}`
      }
      const password = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 10)
      const first = String(profile.firstName || profile.givenName || profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname'] || local)
      const last = String(profile.lastName || profile.surname || profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname'] || '')
      const info = await run(`
        INSERT INTO users (first_name, last_name, username, email, password, activated, permissions, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
      `, [first, last, username, email, password, JSON.stringify({}), ts, ts])
      user = await get(`SELECT * FROM users WHERE id = ?`, [info.insertId])
    }

    if (!user || !user.activated) {
      return htmlError(res, `No activated App User for ${email}. Create the user in Settings → Users first (or enable SAML_AUTO_PROVISION).`)
    }

    const token = signToken({ id: Number(user.id), username: String(user.username) })
    await logAction({ userId: Number(user.id), actionType: 'login_saml', itemType: 'user', itemId: Number(user.id) })
    await transformUser(Number(user.id))

    const home = samlSpConfig().home_url
    const dest = resolveRelayDest(String(body.RelayState || ''), home)
    const sep = dest.includes('?') ? '&' : '?'
    return res.redirect(`${dest}${sep}token=${encodeURIComponent(token)}`)
  } catch (e) {
    console.error('[saml/acs]', e)
    return htmlError(res, e instanceof Error ? e.message : 'SAML assertion validation failed', 400)
  }
})

router.post('/slo', async (req, res) => {
  try {
    if (!samlEnabled() || !idpConfigured()) return res.redirect(`${samlSpConfig().home_url}login`)
    const saml = createSaml()
    try {
      await saml.validatePostResponseAsync(req.body as Record<string, string>)
    } catch {
      try {
        await saml.validatePostRequestAsync(req.body as Record<string, string>)
      } catch (e) {
        console.warn('[saml/slo]', e instanceof Error ? e.message : e)
      }
    }
    return res.redirect(`${samlSpConfig().home_url}login`)
  } catch {
    return res.redirect(`${samlSpConfig().home_url}login`)
  }
})

router.get('/slo', (_req, res) => {
  return res.redirect(`${samlSpConfig().home_url}login`)
})

export default router
