#!/bin/bash
# ITAgent_2026 — macOS installer (double-click Install-ITAgent.command)
# Installs Node deps, registers a Login launchd agent for continuous polling,
# and points at https://asset.refexone.com/api/v1 by default.

set -euo pipefail

API_URL="${REFEX_API_URL:-https://asset.refexone.com/api/v1}"
LABEL="com.refex.itagent2026"
AGENT_HOME="${HOME}/Library/Application Support/ITAgent_2026"
LOG_DIR="${HOME}/Library/Logs/ITAgent_2026"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"

# Resolve paths: this script lives in ITAgent_2026/mac/
MAC_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${MAC_DIR}/.." && pwd)"
NODE_DIR="${ROOT_DIR}/node"

if [[ ! -f "${NODE_DIR}/sync.mjs" ]]; then
  # Packaged layout: updated_agents/mac_agent/node + mac/
  if [[ -f "${MAC_DIR}/../node/sync.mjs" ]]; then
    NODE_DIR="$(cd "${MAC_DIR}/../node" && pwd)"
  else
    echo "ERROR: cannot find node/sync.mjs next to this installer."
    echo "Expected: ITAgent_2026/node or mac_agent/node"
    read -r -p "Press Enter to close…"
    exit 1
  fi
fi

echo ""
echo "========================================"
echo "  ITAgent_2026 — macOS Install & Start"
echo "========================================"
echo "API     : ${API_URL}"
echo "Node dir: ${NODE_DIR}"
echo "State   : ${AGENT_HOME}"
echo ""

need_node=0
if ! command -v node >/dev/null 2>&1; then
  need_node=1
elif [[ "$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)" -lt 18 ]]; then
  need_node=1
fi

if [[ "${need_node}" -eq 1 ]]; then
  echo "Node.js 18+ is required."
  if command -v brew >/dev/null 2>&1; then
    echo "Installing Node via Homebrew…"
    brew install node
  else
    echo "Install Node from https://nodejs.org (LTS), then run this installer again."
    open "https://nodejs.org/en/download" 2>/dev/null || true
    read -r -p "Press Enter to close…"
    exit 1
  fi
fi

echo "Node $(node -v) / npm $(npm -v)"
mkdir -p "${AGENT_HOME}" "${LOG_DIR}"

echo "Installing agent dependencies…"
cd "${NODE_DIR}"
npm install --omit=dev

# Persist env for launchd
cat > "${AGENT_HOME}/env.sh" <<EOF
export REFEX_API_URL="${API_URL}"
export REFEX_AGENT_STATE_DIR="${AGENT_HOME}"
export REFEX_AGENT_POLL_MS="30000"
export REFEX_AGENT_INTERVAL_MS="3600000"
EOF

# Wrapper the launchd job runs
cat > "${AGENT_HOME}/run.sh" <<EOF
#!/bin/bash
set -euo pipefail
# shellcheck disable=SC1091
source "${AGENT_HOME}/env.sh"
cd "${NODE_DIR}"
exec /usr/bin/env node sync.mjs --loop
EOF
chmod +x "${AGENT_HOME}/run.sh"

# Stop previous job if any
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl unload "${PLIST}" 2>/dev/null || true

NODE_BIN="$(command -v node)"
cat > "${PLIST}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${AGENT_HOME}/run.sh</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>${NODE_DIR}</string>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>REFEX_API_URL</key>
    <string>${API_URL}</string>
    <key>REFEX_AGENT_STATE_DIR</key>
    <string>${AGENT_HOME}</string>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$(dirname "${NODE_BIN}")</string>
  </dict>
</dict>
</plist>
EOF

launchctl bootstrap "gui/$(id -u)" "${PLIST}" 2>/dev/null || launchctl load -w "${PLIST}"
launchctl kickstart -k "gui/$(id -u)/${LABEL}" 2>/dev/null || true

# Immediate one-shot so asset shows up now
echo "Running first inventory sync…"
# shellcheck disable=SC1091
source "${AGENT_HOME}/env.sh"
cd "${NODE_DIR}"
REFEX_AGENT_REGISTER=1 node sync.mjs || true

echo ""
echo "Installed."
echo "  LaunchAgent : ${LABEL} (starts at login, keeps polling)"
echo "  Logs        : ${LOG_DIR}/"
echo "  In the app  : open the asset → Agent → Request inventory scan"
echo ""
read -r -p "Press Enter to close…"
