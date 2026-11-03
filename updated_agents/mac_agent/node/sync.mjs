/**
 * ITAgent_2026 — cross-platform desktop agent (Windows / macOS / Linux)
 * One-shot: npm run sync
 * Service loop (register + heartbeat + remote scan): npm run watch
 */
import si from 'systeminformation'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const apiBase = (process.env.REFEX_API_URL || 'https://asset.refexone.com/api/v1').replace(/\/$/, '')
const agentKey = process.env.REFEX_AGENT_KEY || ''
const assetTag = process.env.REFEX_ASSET_TAG || ''
const agentVersion = '2026.1'
const pollMs = Number(process.env.REFEX_AGENT_POLL_MS || 30000)
const fullSyncMs = Number(process.env.REFEX_AGENT_INTERVAL_MS || 3600000)
const stateDir = process.env.REFEX_AGENT_STATE_DIR
  || path.join(process.env.PROGRAMDATA || process.env.HOME || '.', 'ITAgent_2026')
const stateFile = path.join(stateDir, 'agent.json')

function clean(s) {
  return String(s || '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim()
}

async function collectMacApps() {
  try {
    const { stdout } = await execFileAsync('system_profiler', ['SPApplicationsDataType', '-json'], {
      maxBuffer: 20 * 1024 * 1024,
      timeout: 120000,
    })
    const parsed = JSON.parse(stdout)
    const rows = parsed?.SPApplicationsDataType || []
    const apps = []
    for (const row of rows) {
      const name = clean(row._name || row.name)
      if (!name) continue
      apps.push({
        name,
        publisher: clean(row.obtained_from || row.info || ''),
        version: clean(row.version),
        install_date: clean(row.lastModified || ''),
      })
      if (apps.length >= 500) break
    }
    return apps
  } catch {
    return []
  }
}

async function collectLinuxApps() {
  try {
    const { stdout } = await execFileAsync('bash', ['-lc', 'dpkg-query -W -f=\'${Package}\\t${Version}\\n\' 2>/dev/null | head -n 500'], {
      timeout: 60000,
    })
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, version] = line.split('\t')
        return { name: clean(name), version: clean(version) }
      })
      .filter((a) => a.name)
  } catch {
    return []
  }
}

async function collectSoftware() {
  if (process.platform === 'darwin') return collectMacApps()
  if (process.platform === 'linux') return collectLinuxApps()
  // Windows Node path: keep light; prefer Windows EXE/PS1 for full registry list
  try {
    const apps = await si.versions()
    return Object.entries(apps || {})
      .filter(([, v]) => v)
      .slice(0, 200)
      .map(([name, version]) => ({ name: clean(name), version: clean(version) }))
  } catch {
    return []
  }
}

async function collect() {
  const [system, bios, cpu, mem, osInfo] = await Promise.all([
    si.system(),
    si.bios(),
    si.cpu(),
    si.mem(),
    si.osInfo(),
  ])

  const list = await collectSoftware()
  const legacyCsv = list
    .map((a) => `"${a.name}", "${a.publisher || ''}", "${a.version || ''}", "${a.install_date || ''}"`)
    .join(', ')

  return {
    Computer_Name: os.hostname(),
    Host_Name: os.hostname(),
    Serial_Number: system.serial || bios.serial || '',
    OS_Name: `${osInfo.distro || osInfo.platform} ${osInfo.release || ''}`.trim(),
    OS_Version: osInfo.release || osInfo.kernel || '',
    OS_Manufacturer: osInfo.platform,
    System_Manufacturer: system.manufacturer || '',
    System_Model: system.model || '',
    Processor: cpu.brand || '',
    Domain: osInfo.domain || '',
    BIOS_Version: bios.version || '',
    Total_Physical_RAM: String(mem.total || ''),
    Virtual_RAM_Available: String(mem.available || ''),
    Installed_Software: legacyCsv,
    Installed_Software_List: list,
    Installed_Software_Count: list.length,
    platform: process.platform,
    Created_By: 'ITAgent_2026',
    agent_version: agentVersion,
    create_if_missing: true,
    ...(assetTag ? { asset_tag: assetTag } : {}),
  }
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  } catch {
    return null
  }
}

function saveState(state) {
  fs.mkdirSync(stateDir, { recursive: true })
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2))
}

function headers(state) {
  const h = { 'Content-Type': 'application/json' }
  if (agentKey) h['X-Agent-Key'] = agentKey
  if (state?.agent_uuid && state?.agent_token) {
    h['X-Agent-Id'] = state.agent_uuid
    h['X-Agent-Token'] = state.agent_token
  }
  return h
}

async function post(pathname, body, state) {
  const res = await fetch(`${apiBase}${pathname}`, {
    method: 'POST',
    headers: headers(state),
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = data?.messages?.[0] || res.statusText
    const err = new Error(msg)
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}

async function register() {
  const inv = await collect()
  const data = await post('/agent/register', {
    Computer_Name: inv.Computer_Name,
    Serial_Number: inv.Serial_Number,
    platform: process.platform,
    agent_version: agentVersion,
    ...(assetTag ? { asset_tag: assetTag } : {}),
  }, null)
  const p = data.payload || {}
  if (!p.agent_uuid || !p.agent_token) throw new Error('Register missing credentials')
  const state = {
    agent_uuid: p.agent_uuid,
    agent_token: p.agent_token,
    asset_id: p.asset_id,
    registered_at: new Date().toISOString(),
    api_base: apiBase,
  }
  saveState(state)
  console.log('Registered', state.agent_uuid)
  return state
}

async function ensureRegistered() {
  let state = loadState()
  if (!state?.agent_uuid || !state?.agent_token || (state.api_base && state.api_base !== apiBase)) {
    state = await register()
  }
  return state
}

async function syncOnce(state, commandId = null) {
  const payload = await collect()
  if (commandId) payload.command_id = commandId
  console.log(`Inventory sync… software=${payload.Installed_Software_Count}`)
  const data = await post('/agent/sync', payload, state)
  console.log('Sync OK', JSON.stringify({
    action: data.payload?.action,
    matched_by: data.payload?.matched_by,
    asset_id: data.payload?.asset?.id,
    software: payload.Installed_Software_Count,
  }))
  return data
}

async function heartbeat(state) {
  return post('/agent/heartbeat', {
    hostname: os.hostname(),
    platform: process.platform,
    agent_version: agentVersion,
  }, state)
}

async function ackFailed(state, commandId, error) {
  try {
    await post(`/agent/commands/${commandId}/ack`, { ok: false, error: String(error) }, state)
  } catch {
    /* ignore */
  }
}

const loop = process.argv.includes('--loop') || process.argv.includes('watch')

if (!loop) {
  let state = loadState()
  if (process.env.REFEX_AGENT_REGISTER === '1' || !state) {
    try { state = await ensureRegistered() } catch (e) {
      console.warn('Register skipped/failed:', e.message)
      state = null
    }
  }
  await syncOnce(state)
  process.exit(process.exitCode || 0)
}

console.log(`ITAgent_2026 service → ${apiBase} (poll ${pollMs}ms)`)
console.log('State:', stateFile)

let state = await ensureRegistered()
// Heartbeat first so remote scans are claimed quickly; inventory follows.
let lastFull = Date.now() - fullSyncMs
let hbCount = 0

async function tick() {
  try {
    const hb = await heartbeat(state)
    hbCount += 1
    const cmds = hb.payload?.commands || []
    if (hbCount === 1 || hbCount % 10 === 0) {
      console.log(new Date().toISOString(), `Heartbeat OK (#${hbCount}) commands=${cmds.length}`)
    }
    for (const cmd of cmds) {
      console.log(new Date().toISOString(), `Command #${cmd.id}: ${cmd.command}`)
      if (cmd.command === 'scan' || cmd.command === 'rerun') {
        try {
          await syncOnce(state, cmd.id)
        } catch (e) {
          await ackFailed(state, cmd.id, e.message)
          console.error('Command failed', e.message)
        }
      }
    }
    if (Date.now() - lastFull >= fullSyncMs) {
      try {
        await syncOnce(state)
        lastFull = Date.now()
      } catch (e) {
        console.error('Periodic sync failed', e.message)
      }
    }
  } catch (e) {
    console.error(new Date().toISOString(), 'Loop error', e.message)
    if (e.status === 401) {
      try { state = await register() } catch (re) { console.error('Re-register failed', re.message) }
    }
  }
}

await tick()
setInterval(() => { void tick() }, pollMs)
