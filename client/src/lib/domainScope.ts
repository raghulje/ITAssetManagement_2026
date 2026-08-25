export type DomainCode = 'it' | 'admin'

export type DomainScope = {
  codes: DomainCode[]
  all: boolean
}

export function isTruthyPerm(v: unknown) {
  return v === '1' || v === 1 || v === true || v === 'true'
}

export function domainScopeFromPermissions(perms: Record<string, unknown> | null | undefined): DomainScope {
  const p = perms || {}
  if (isTruthyPerm(p.superuser) || isTruthyPerm(p.admin)) {
    return { codes: ['it', 'admin'], all: true }
  }
  const codes: DomainCode[] = []
  if (isTruthyPerm(p['domains.it'])) codes.push('it')
  if (isTruthyPerm(p['domains.admin'])) codes.push('admin')
  if (!codes.length) codes.push('it')
  return { codes, all: codes.length > 1 }
}

export function defaultDomainCode(scope: DomainScope): DomainCode {
  return scope.codes[0] || 'it'
}

export function domainLabel(code: string | null | undefined) {
  if (!code) return 'IT'
  const c = String(code).toLowerCase()
  if (c === 'admin') return 'Admin'
  return 'IT'
}

/** Software licenses are IT inventory — hide nav, cards, and reports in Admin domain. */
export function softwareLicensesInDomain(domain: string | null | undefined) {
  return String(domain || 'it').toLowerCase() !== 'admin'
}
