import { Link } from 'react-router-dom'
import { formatAppDateTime } from '../../../lib/datetime'
import { Field } from './helpers'

const GROUPS: Array<{ title: string; keys: string[] }> = [
  { title: 'Endpoint', keys: ['Endpoint Name', 'Site', 'Account', 'Domain', 'Group', 'Tags', 'Locations', 'Operational State'] },
  { title: 'User', keys: ['Last Logged In User', 'EMPLOYEE_ID', 'EMAIL_ADDRESS', 'OS Username'] },
  { title: 'Device', keys: ['Device Type', 'Model Name', 'Serial Number', 'OS', 'OS Version', 'Architecture', 'Memory', 'CPU Type', 'CPU Count', 'Core Count', 'Storage Type', 'Storage Name'] },
  { title: 'Network', keys: ['MAC Addresses', 'IP Addresses', 'Last Reported IP', 'Console Visible IP', 'Network Status', 'Management Connectivity'] },
  { title: 'Agent health', keys: ['Health Status', 'Agent Version', 'Last Active', 'Subscribed On', 'Update Status', 'Scan Status', 'Disk Encryption', 'Last Reboot Date', 'Installer Type', 'Pending Uninstall', 'Is Uninstalled', 'Decommissioned at', 'Reboot Required due to Threat', 'User Action Required', 'Remote Profiling State', 'Agent UUID', 'Agent ID', 'Customer Identifier', 'Console Migration Status', 'Missing Permissions'] },
]

type Details = {
  source?: string
  imported_at?: string
  endpoint?: string
  fields?: Record<string, string>
}

export default function AssetAdditionalTab({ asset }: { asset: Record<string, unknown> }) {
  const raw = asset.additional_details
  const details = raw && typeof raw === 'object' ? raw as Details : null
  const fields = details?.fields && typeof details.fields === 'object' ? details.fields : null
  const keys = fields ? Object.keys(fields) : []

  if (!fields || !keys.length) {
    return (
      <div className="vad-panel">
        <div className="vad-empty">
          <strong>No additional details yet</strong>
          Upload the latest endpoint report from Assets, compare it, and apply the updates. Extra columns from that report are kept here.
          <div style={{ marginTop: 12 }}>
            <Link to="/hardware/latest-data" className="btn btn-primary btn-sm">Compare latest data</Link>
          </div>
        </div>
      </div>
    )
  }

  const used = new Set<string>()
  const groups = GROUPS.map((group) => {
    const present = group.keys.filter((key) => fields[key])
    present.forEach((key) => used.add(key))
    return { title: group.title, keys: present }
  }).filter((group) => group.keys.length > 0)
  const other = keys.filter((key) => !used.has(key)).sort()
  if (other.length) groups.push({ title: 'Other', keys: other })

  return (
    <div className="vad-panel">
      <div className="vad-panel__bar">
        <h3>Additional details</h3>
        <span className="text-muted">
          {details?.source || 'Endpoint report'}
          {details?.imported_at ? ` · ${formatAppDateTime(details.imported_at)}` : ''}
          {` · ${keys.length} fields`}
        </span>
      </div>
      <p className="help-block">
        These are the extra columns from the latest endpoint report. Processor, RAM, operating system, MAC, and IP are also written into the asset specifications when they differ.
      </p>
      <div className="vad-detail-groups">
        {groups.map((group) => (
          <article key={group.title} className="vad-card">
            <div className="vad-card__head">
              <h3>{group.title}</h3>
            </div>
            <dl className="vad-info-grid">
              {group.keys.map((key) => (
                <Field key={key} label={key}>{fields[key]}</Field>
              ))}
            </dl>
          </article>
        ))}
      </div>
    </div>
  )
}
