# ITAgent for Mac — easy install

## What to send Mac users

Zip folder: `updated_agents/mac_agent/`  
(or `ITAgent_2026/mac` + `ITAgent_2026/node`)

## On the Mac

1. Unzip
2. **Double-click** `Install-ITAgent.command`
3. If macOS blocks it: right-click → **Open** → Open  
   (or: System Settings → Privacy & Security → Allow)
4. If Node isn’t installed, the installer opens nodejs.org / uses Homebrew
5. Done — agent starts at login and keeps polling

Optional:
- `Sync-Once.command` — one inventory push
- `Uninstall-ITAgent.command` — stop Login Agent

API default: `https://asset.refexone.com/api/v1`

Then in the web app: Asset → **Agent** → **Request inventory scan**.
