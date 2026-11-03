#!/bin/bash
# Double-click to uninstall ITAgent_2026 Login Agent on macOS.

set -euo pipefail

LABEL="com.refex.itagent2026"
AGENT_HOME="${HOME}/Library/Application Support/ITAgent_2026"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"

echo "Uninstalling ITAgent_2026…"
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl unload "${PLIST}" 2>/dev/null || true
rm -f "${PLIST}"
echo "Stopped Login Agent."
echo "State kept at: ${AGENT_HOME} (delete that folder if you also want credentials removed)."
read -r -p "Press Enter to close…"
