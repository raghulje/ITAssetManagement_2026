import type { FacilityCounts } from './hierarchyUx'

export default function FacilityMetrics({ counts }: { counts: FacilityCounts }) {
  const items = [
    { key: 'SITE', label: 'Sites', icon: 'fas fa-map-marker-alt', value: counts.SITE },
    { key: 'BUILDING', label: 'Buildings', icon: 'fas fa-building', value: counts.BUILDING },
    { key: 'FLOOR', label: 'Floors', icon: 'fas fa-layer-group', value: counts.FLOOR },
    { key: 'SPACE', label: 'Spaces', icon: 'fas fa-door-open', value: counts.SPACE },
  ]
  return (
    <div className="facility-metrics">
      {items.map((item) => (
        <div key={item.key} className="facility-metric">
          <i className={item.icon} aria-hidden />
          <div>
            <strong>{item.value.toLocaleString()}</strong>
            <span>{item.label}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
