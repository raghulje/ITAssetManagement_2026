#!/bin/bash
# Double-click for a one-shot inventory sync (no continuous polling).

set -euo pipefail

API_URL="${REFEX_API_URL:-https://asset.refexone.com/api/v1}"
MAC_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${MAC_DIR}/.." && pwd)"
NODE_DIR="${ROOT_DIR}/node"
AGENT_HOME="${HOME}/Library/Application Support/ITAgent_2026"

if [[ ! -f "${NODE_DIR}/sync.mjs" && -f "${MAC_DIR}/../node/sync.mjs" ]]; then
  NODE_DIR="$(cd "${MAC_DIR}/../node" && pwd)"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Run Install-ITAgent.command first (or install Node 18+)."
  read -r -p "Press Enter to close…"
  exit 1
fi

mkdir -p "${AGENT_HOME}"
cd "${NODE_DIR}"
[[ -d node_modules ]] || npm install --omit=dev

export REFEX_API_URL="${API_URL}"
export REFEX_AGENT_STATE_DIR="${AGENT_HOME}"
export REFEX_AGENT_REGISTER=1

echo "Syncing once → ${API_URL}"
node sync.mjs
echo ""
read -r -p "Press Enter to close…"
