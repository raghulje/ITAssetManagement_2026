# ITAgent_2026

Cross-platform ITAM inventory agent for Refex Asset Management.

After install, the agent **registers**, sends **heartbeats**, and runs a full inventory sync when you click **Run agent scan** on an asset in the web app (or on a slow periodic schedule).

## Architecture

```
[Admin UI] --queue scan--> [MySQL agent_commands]
                                ^
[Agent on PC] --heartbeat/poll--┘
      |              |
      +-- register --+
      +-- sync inventory --> assets + asset_agent_snapshots
```

| API | Auth | Purpose |
|-----|------|---------|
| `POST /api/v1/agent/register` | `X-Agent-Key` (optional) | Create agent uuid + token; bind to asset by serial |
| `POST /api/v1/agent/heartbeat` | `X-Agent-Id` + `X-Agent-Token` | Liveness; returns claimed commands |
| `POST /api/v1/agent/sync` | Agent token or shared key | Push inventory; completes scan commands |
| `POST /api/v1/agent/commands/:id/ack` | Agent token | Mark command failed/done |
| `POST /api/v1/hardware/:id/agent/scan` | Admin session | Queue remote scan from the UI |
| `GET /api/v1/hardware/:id/agent` | Admin session | Presence + command history |

Match order for assets: **serial → asset_tag → hostname**. QR tokens are never changed.

## Windows (recommended) — single EXE

Build once (developer PC):

```powershell
cd ITAgent_2026\windows
.\Build-ITAgentExe.ps1
# → dist\ITAgent_2026.exe
```

On each laptop/desktop: copy **`ITAgent_2026.exe`** only, double‑click:

1. Confirm API URL (default: `https://asset.refexone.com/api/v1`)
2. Click **Install & Start** (approve UAC) — registers agent + startup task for remote scan
3. Or **Sync once** for a single inventory push
4. **Uninstall** removes the startup task

State / logs: `%ProgramData%\ITAgent_2026\`  
Task name: `ITAgent_2026`

### Advanced (raw PowerShell scripts — still available)

| Script | Purpose |
|--------|---------|
| `ITAgent_2026_App.ps1` | Same GUI/CLI as the EXE (source) |
| `Install-ITAgent.ps1` | Install startup task only |
| `ITAgent_2026.ps1` | One-shot sync |
| `ITAgent_2026_Service.ps1` | Long-running service loop |

```powershell
.\Install-ITAgent.ps1 -ApiUrl "https://asset.refexone.com/api/v1"
.\ITAgent_2026.ps1
.\ITAgent_2026_Service.ps1
```

## Node (Windows / macOS / Linux)

```bash
cd ITAgent_2026/node
npm install
export REFEX_API_URL="https://asset.refexone.com/api/v1"
npm run watch   # register + heartbeat + remote scan
# npm run sync  # one-shot
```

## macOS — easy Install & Start (recommended)

Send Mac users the `mac` + `node` folders (or `updated_agents/mac_agent`):

1. Double-click **`Install-ITAgent.command`**
2. Approve “Open” if Gatekeeper asks
3. Agent installs a Login Agent (launchd) that keeps polling — same idea as Windows Install & Start

Also: `Sync-Once.command`, `Uninstall-ITAgent.command`. See `mac/README.md`.

```bash
# Advanced (same as double-click install)
cd ITAgent_2026/mac
./Install-ITAgent.command
```

## From the web app

1. Open the asset → **Agent** tab  
2. Presence should show **Online** when the agent is polling  
3. Click **Request inventory scan** (or **Run agent scan** in the toolbar)  
4. Within ~30s the agent collects and syncs; **Last inventory** updates

## Env vars

| Variable | Default | Notes |
|----------|---------|--------|
| `REFEX_API_URL` | `https://asset.refexone.com/api/v1` | Server API base (override only for local/dev) |
| `REFEX_AGENT_KEY` | _(empty)_ | Must match server `AGENT_API_KEY` when set |
| `REFEX_ASSET_TAG` | _(empty)_ | Force bind to a tag |
| `REFEX_AGENT_POLL_MS` | `30000` | Heartbeat / command poll |
| `REFEX_AGENT_INTERVAL_MS` | `3600000` | Periodic full sync |
| `REFEX_AGENT_STATE_DIR` | `%ProgramData%\ITAgent_2026` | Where `agent.json` is stored |

## Payload shape (legacy HSAgent-compatible)

```json
{
  "Computer_Name": "LAPTOP-01",
  "Serial_Number": "PF2XXXX",
  "OS_Name": "Microsoft Windows 11 Pro",
  "System_Manufacturer": "LENOVO",
  "System_Model": "ThinkPad T14",
  "Processor": "…",
  "Total_Physical_RAM": "17179869184",
  "platform": "windows",
  "create_if_missing": true
}
```
