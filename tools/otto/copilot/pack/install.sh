#!/usr/bin/env bash
#
# Installs the Slalom Otto commands for GitHub Copilot (CLI + desktop app).
#
# What it does (all idempotent, safe to re-run):
#   1. Copies the bundled MCP server to  $COPILOT_HOME/otto/server.js
#   2. Installs the custom agents into   $COPILOT_HOME/agents/*.agent.md
#      (rewriting the server path token to the absolute installed path)
#   3. Registers/merges the `otto` MCP server into
#      $COPILOT_HOME/mcp-config.json  with  --surface=copilot
#   4. Migrates off any previous `slalom-sdlc` install — removes the old server
#      dir and drops the stale `slalom-sdlc` MCP server key.
#
# After this, open Copilot in any project and run  /agent otto-about  (or
# discover / refine / design / build / test / release).
#
# Environment:
#   COPILOT_HOME   Override the Copilot home directory (default: ~/.copilot)
#
# Requirements: node (used both to run the server and to merge JSON safely).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COPILOT_HOME="${COPILOT_HOME:-$HOME/.copilot}"
INSTALL_DIR="$COPILOT_HOME/otto"
LEGACY_INSTALL_DIR="$COPILOT_HOME/slalom-sdlc"
AGENTS_DIR="$COPILOT_HOME/agents"
MCP_CONFIG="$COPILOT_HOME/mcp-config.json"
SERVER_TOKEN="__OTTO_SERVER__"

VERSION="$(cat "$SCRIPT_DIR/VERSION" 2>/dev/null || echo unknown)"

if ! command -v node >/dev/null 2>&1; then
  echo "error: node is required (it runs the MCP server) but was not found on PATH." >&2
  exit 1
fi

echo "Installing Slalom Otto for GitHub Copilot (v${VERSION})"
echo "  Copilot home: $COPILOT_HOME"

# ── 1. Server ───────────────────────────────────────────────────────────────────
mkdir -p "$INSTALL_DIR"
cp "$SCRIPT_DIR/server/server.js" "$INSTALL_DIR/server.js"
SERVER_PATH="$INSTALL_DIR/server.js"
echo "  ✓ server → $SERVER_PATH"

# ── 2. Agents ───────────────────────────────────────────────────────────────────
mkdir -p "$AGENTS_DIR"
# Escape characters that are special in a sed replacement (backslash first, then
# the `&` match-reference and the `|` delimiter) so paths containing them are
# substituted literally.
SERVER_PATH_ESC="$SERVER_PATH"
SERVER_PATH_ESC="${SERVER_PATH_ESC//\\/\\\\}"
SERVER_PATH_ESC="${SERVER_PATH_ESC//&/\\&}"
SERVER_PATH_ESC="${SERVER_PATH_ESC//|/\\|}"
agent_count=0
for src in "$SCRIPT_DIR"/agents/*.agent.md; do
  [ -e "$src" ] || continue
  name="$(basename "$src")"
  # Rewrite the server-path token to the absolute installed path.
  sed "s|${SERVER_TOKEN}|${SERVER_PATH_ESC}|g" "$src" > "$AGENTS_DIR/$name"
  agent_count=$((agent_count + 1))
done
echo "  ✓ agents → $AGENTS_DIR ($agent_count installed)"

# ── Migrate off any previous slalom-sdlc install ────────────────────────────────
if [ -d "$LEGACY_INSTALL_DIR" ]; then
  rm -rf "$LEGACY_INSTALL_DIR"
  echo "  ✓ removed legacy server dir $LEGACY_INSTALL_DIR"
fi

# ── 3. Register the MCP server (idempotent JSON merge) ──────────────────────────
SERVER_PATH="$SERVER_PATH" MCP_CONFIG="$MCP_CONFIG" node <<'NODE'
const fs = require("fs");
const path = require("path");

const cfgPath = process.env.MCP_CONFIG;
const serverPath = process.env.SERVER_PATH;

let cfg = {};
if (fs.existsSync(cfgPath)) {
  try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")); }
  catch (e) { console.error(`  ! ${cfgPath} is not valid JSON — leaving it untouched.`); process.exit(0); }
}

// Copilot CLI keys servers under "mcpServers".
cfg.mcpServers = cfg.mcpServers || {};
// Migrate off the previous name if present.
if (cfg.mcpServers["slalom-sdlc"]) {
  delete cfg.mcpServers["slalom-sdlc"];
  console.log(`  ✓ removed legacy slalom-sdlc server key`);
}
cfg.mcpServers["otto"] = {
  type: "local",
  command: "node",
  args: [serverPath, "--surface=copilot"],
  tools: ["*"],
};

fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
console.log(`  ✓ registered otto in ${cfgPath}`);
NODE

echo
echo "Done. In any project, run:  copilot  then  /agent otto-about"
echo "Available agents: otto-about, otto-init, otto-discover, otto-refine,"
echo "                  otto-design, otto-build, otto-test, otto-release"
