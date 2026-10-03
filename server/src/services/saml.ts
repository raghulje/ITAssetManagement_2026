import { SAML, ValidateInResponseTo } from '@node-saml/node-saml'
import { clientBase } from './assetQr.js'

const NAME_ID_FORMAT = 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress'

export function samlEnabled() {
  return String(process.env.SAML_ENABLED || '').toLowerCase() === 'true'
}

/** Public browser origin (no :PORT). */
export function publicBase() {
  return clientBase()
}

export function samlSpConfig() {
  const base = publicBase()
  const entityId = (process.env.SAML_SP_ENTITY_ID || `${base}/saml/sp`).replace(/\/$/, '')
  const acsUrl = (process.env.SAML_ACS_URL || `${base}/api/v1/auth/saml/acs`).replace(/\/$/, '')
  const sloUrl = (process.env.SAML_SLO_URL || `${base}/api/v1/auth/saml/slo`).replace(/\/$/, '')
  const homeUrl = (process.env.SAML_HOME_URL || `${base}/`).replace(/\/?$/, '/')
  const metadataUrl = `${base}/api/v1/auth/saml/metadata`
  return {
    entity_id: entityId,
    audience: entityId,
    acs_url: acsUrl,
    slo_url: sloUrl,
    home_url: homeUrl,
    metadata_url: metadataUrl,
    name_id_format: NAME_ID_FORMAT,
    name_id_format_label: 'Email Address',
  }
}

/** Values to paste into RefexOne / IdP app registration. */
export function samlPortalFields() {
  const sp = samlSpConfig()
  return {
    'Entity ID / Audience': sp.entity_id,
    'ACS URL (Assertion Consumer Service)': sp.acs_url,
    'Home URL (Post-SSO Redirect)': sp.home_url,
    'SLO URL': sp.slo_url,
    'Name ID Format': sp.name_id_format,
    'SP Metadata URL': sp.metadata_url,
    'RefexOne portal SSO': refexOnePortalSsoUrl(sp.home_url) || '(set SAML_IDP_ENTRY_POINT to https://refexone.com/api/saml/<app-id>)',
  }
}

function normalizeCert(raw: string) {
  let cert = raw.trim().replace(/\\n/g, '\n')
  if (!cert) return ''
  if (!cert.includes('BEGIN CERTIFICATE')) {
    cert = `-----BEGIN CERTIFICATE-----\n${cert.replace(/\s+/g, '\n')}\n-----END CERTIFICATE-----`
  }
  return cert
}

export function idpConfigured() {
  return Boolean(
    String(process.env.SAML_IDP_ENTRY_POINT || '').trim()
    && String(process.env.SAML_IDP_CERT || '').trim(),
  )
}

export function refexOneWebBase() {
  const raw = String(process.env.REFEXONE_WEB_URL || process.env.REFEXONE_API_URL || 'https://refexone.com').trim()
  return raw.replace(/\/api\/?$/i, '').replace(/\/$/, '') || 'https://refexone.com'
}

/** App UUID from RefexOne portal (`/api/saml/{id}` or `/api/saml/{id}/sso`). */
export function refexOneSamlAppId() {
  const explicit = String(process.env.REFEXONE_SAML_APP_ID || process.env.SAML_APP_ID || '').trim()
  if (explicit) return explicit
  const from = [
    process.env.SAML_IDP_ENTRY_POINT,
    process.env.SAML_IDP_ISSUER,
  ].map((v) => String(v || '').trim()).find(Boolean) || ''
  const match = from.match(/\/saml\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)
  return match?.[1] || ''
}

export function isRefexOnePortalIdp() {
  const entry = String(process.env.SAML_IDP_ENTRY_POINT || '').trim()
  if (!entry) return Boolean(refexOneSamlAppId())
  try {
    const url = new URL(entry)
    return /refexone\.com$/i.test(url.hostname) && /\/api\/saml\/[^/]+/i.test(url.pathname)
  } catch {
    return /refexone\.com\/api\/saml\//i.test(entry)
  }
}

/**
 * RefexOne launcher (not a SAML IdP SSO URL):
 * https://refexone.com/api/saml/{APP_ID}/sso?RelayState={absolute return URL}
 */
export function refexOnePortalSsoUrl(relayAbsolute: string) {
  const appId = refexOneSamlAppId()
  const dest = String(relayAbsolute || '').trim()
  if (!appId || !dest) return ''
  const url = new URL(`${refexOneWebBase()}/api/saml/${encodeURIComponent(appId)}/sso`)
  url.searchParams.set('RelayState', dest)
  return url.toString()
}

export function createSaml(): SAML {
  const sp = samlSpConfig()
  const entryPoint = String(process.env.SAML_IDP_ENTRY_POINT || '').trim()
  const idpCert = normalizeCert(String(process.env.SAML_IDP_CERT || ''))
  if (!entryPoint || !idpCert) {
    throw new Error('SAML IdP is not configured (set SAML_IDP_ENTRY_POINT and SAML_IDP_CERT)')
  }

  // RefexOne / Kissflow IAM signs the Assertion, not the Response wrapper
  const wantResponseSigned = process.env.SAML_WANT_RESPONSE_SIGNED === 'true'
  const idpIssuer = String(process.env.SAML_IDP_ISSUER || entryPoint).trim()

  return new SAML({
    callbackUrl: sp.acs_url,
    entryPoint,
    logoutUrl: String(process.env.SAML_IDP_SLO_URL || '').trim() || undefined,
    issuer: sp.entity_id,
    idpIssuer,
    idpCert,
    audience: sp.entity_id,
    identifierFormat: NAME_ID_FORMAT,
    disableRequestedAuthnContext: true,
    wantAssertionsSigned: process.env.SAML_WANT_ASSERTIONS_SIGNED !== 'false',
    wantAuthnResponseSigned: wantResponseSigned,
    acceptedClockSkewMs: Number(process.env.SAML_CLOCK_SKEW_MS || 120000),
    validateInResponseTo: ValidateInResponseTo.never,
  })
}

export function profileEmail(profile: {
  nameID?: string
  email?: string
  mail?: string
  [k: string]: unknown
}): string {
  const candidates = [
    profile.email,
    profile.mail,
    profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'],
    profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'],
    profile.nameID,
  ]
  for (const c of candidates) {
    const s = String(c || '').trim().toLowerCase()
    if (s.includes('@')) return s
  }
  return ''
}
