type PathEntry = {
  id: number
  name: string
  location_type?: { code: string; name: string } | null
}

export default function FacilityBreadcrumb({
  path,
  onNavigate,
}: {
  path: PathEntry[]
  onNavigate?: (id: number) => void
}) {
  if (!path.length) return null
  return (
    <nav className="facility-breadcrumb" aria-label="Facility path">
      {path.map((p, i) => (
        <span key={p.id} className="facility-breadcrumb-seg">
          {i > 0 ? <span className="facility-breadcrumb-sep">/</span> : null}
          {onNavigate && i < path.length - 1 ? (
            <button type="button" className="facility-breadcrumb-link" onClick={() => onNavigate(p.id)}>
              {p.name}
            </button>
          ) : (
            <span className="facility-breadcrumb-current">{p.name}</span>
          )}
        </span>
      ))}
    </nav>
  )
}
