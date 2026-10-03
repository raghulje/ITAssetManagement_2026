import { get, run, now } from '../db/index.js'

const FALLBACK_AGENT_ID = '6abe1d312713e05e957c8eb4'

export type BatteryAdminConfig = {
  agent_id: string
  notify_email: string
  webhook_url: string
}

const FALLBACK_WEBHOOK_URL = 'https://development-refexgroup.kissflow.com/integration/2/AcCMptp3yqcn/webhook/J1VLVRMG2wXYcRkvDBHLxx0L5fNELbNtFYhPNtUg7kMbhvZSFxJL44ZEjn0htxhGqNCWqOntb7ZcbAz4MNWtQ'

const DEFAULTS: BatteryAdminConfig = {
  agent_id: FALLBACK_AGENT_ID,
  notify_email: '',
  webhook_url: FALLBACK_WEBHOOK_URL,
}

let cache: { at: number; value: BatteryAdminConfig } | null = null
const TTL_MS = 10_000

export function invalidateBatteryConfigCache() {
  cache = null
}

function parseConfig(raw: unknown): BatteryAdminConfig {
  let obj: Record<string, unknown> = {}
  if (typeof raw === 'string' && raw.trim()) {
    try { obj = JSON.parse(raw) as Record<string, unknown> } catch { obj = {} }
  } else if (raw && typeof raw === 'object') {
    obj = raw as Record<string, unknown>
  }
  const agentId = String(obj.agent_id ?? obj.agentId ?? '').trim()
  const notify = String(obj.notify_email ?? obj.notifyEmail ?? '').trim()
  const webhook = String(obj.webhook_url ?? obj.webhookUrl ?? '').trim()
  return {
    agent_id: agentId || String(process.env.ELLO_AGENT_ID || '').trim() || DEFAULTS.agent_id,
    notify_email: notify,
    webhook_url: webhook || DEFAULTS.webhook_url,
  }
}

export async function getBatteryAdminConfig(): Promise<BatteryAdminConfig> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value
  try {
    const row = await get<{ battery_config?: unknown }>(`SELECT battery_config FROM settings WHERE id = 1`)
    const value = parseConfig(row?.battery_config)
    cache = { at: Date.now(), value }
    return value
  } catch {
    const value = parseConfig(null)
    cache = { at: Date.now(), value }
    return value
  }
}

export async function saveBatteryAdminConfig(partial: Partial<BatteryAdminConfig>): Promise<BatteryAdminConfig> {
  const current = await getBatteryAdminConfig()
  const next: BatteryAdminConfig = {
    agent_id: partial.agent_id !== undefined
      ? String(partial.agent_id || '').trim() || DEFAULTS.agent_id
      : current.agent_id,
    notify_email: partial.notify_email !== undefined
      ? String(partial.notify_email || '').trim()
      : current.notify_email,
    webhook_url: partial.webhook_url !== undefined
      ? String(partial.webhook_url || '').trim()
      : current.webhook_url,
  }
  await run(`UPDATE settings SET battery_config = ?, updated_at = ? WHERE id = 1`, [
    JSON.stringify(next),
    now(),
  ])
  invalidateBatteryConfigCache()
  cache = { at: Date.now(), value: next }
  return next
}

export async function batteryNotifyEmails(): Promise<string[]> {
  const cfg = await getBatteryAdminConfig()
  return cfg.notify_email
    .split(/[,;\n]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes('@'))
}

export async function resolvedBatteryAgentId(): Promise<string> {
  const cfg = await getBatteryAdminConfig()
  return cfg.agent_id || FALLBACK_AGENT_ID
}
