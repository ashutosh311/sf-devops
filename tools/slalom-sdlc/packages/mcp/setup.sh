#!/usr/bin/env bash
# Slalom SDLC MCP Server — one-time setup script
# Run this once per machine to build the server and register it with Claude Code.
# See DESIGN-mcp.md §15 for full context.

set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; RESET='\033[0m'
ok()   { echo -e "${GREEN}✓${RESET} $1"; }
warn() { echo -e "${YELLOW}⚠${RESET}  $1"; }
die()  { echo -e "${RED}✗${RESET}  $1" >&2; exit 1; }

echo ""
echo "  Slalom SDLC — MCP Server Setup"
echo "  ================================"
echo ""

# ── Locate the repo root ──────────────────────────────────────────────────────
# Resolve the repo root regardless of where the script is invoked from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDLC_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"    # tools/slalom-sdlc/
MCP_DIR="$SCRIPT_DIR"                            # tools/slalom-sdlc/packages/mcp/
SERVER_JS="$MCP_DIR/dist/server.js"

ok "Repo root: $SDLC_ROOT"

# ── Check prerequisites ───────────────────────────────────────────────────────
echo ""
echo "  Checking prerequisites..."

if ! command -v node &>/dev/null; then
  die "Node.js is not installed. Install Node.js ≥ 20 from https://nodejs.org"
fi
NODE_VER=$(node --version)
NODE_MAJOR="${NODE_VER#v}"; NODE_MAJOR="${NODE_MAJOR%%.*}"
if [ "$NODE_MAJOR" -lt 20 ]; then
  die "Node.js $NODE_VER is too old. Install Node.js ≥ 20."
fi
ok "Node.js $NODE_VER"

if ! command -v pnpm &>/dev/null; then
  warn "pnpm not found — installing globally via npm..."
  npm install -g pnpm || die "Failed to install pnpm. Run: npm i -g pnpm"
fi
ok "pnpm $(pnpm --version)"

if ! command -v claude &>/dev/null; then
  die "Claude Code CLI not found. Install it from https://claude.ai/code then re-run this script."
fi
ok "Claude Code $(claude --version 2>/dev/null | head -1)"

# ── Install dependencies ──────────────────────────────────────────────────────
echo ""
echo "  Installing workspace dependencies..."
(cd "$SDLC_ROOT" && pnpm install --frozen-lockfile 2>&1 | tail -3)
ok "Dependencies installed"

# ── Build @sdlc/core ─────────────────────────────────────────────────────────
echo ""
echo "  Building @sdlc/core (bakes prompt templates into bundle)..."
(cd "$SDLC_ROOT" && pnpm --filter @sdlc/core build 2>&1 | tail -3)
ok "@sdlc/core built"

# ── Build the MCP server ──────────────────────────────────────────────────────
echo ""
echo "  Building MCP server..."
(cd "$MCP_DIR" && node esbuild.mjs 2>&1)
ok "dist/server.js ready ($(du -sh "$SERVER_JS" | cut -f1))"

# ── Register with Claude Code ─────────────────────────────────────────────────
echo ""
echo "  Registering with Claude Code (user scope)..."

# Remove any existing registration for slalom-sdlc to avoid duplicates
claude mcp remove slalom-sdlc 2>/dev/null || true

claude mcp add --scope user slalom-sdlc -- node "$SERVER_JS"
ok "Registered: slalom-sdlc → node $SERVER_JS"

# ── Verify ────────────────────────────────────────────────────────────────────
echo ""
echo "  Verifying server starts correctly..."
RESPONSE=$(printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"setup-check","version":"1"}}}\n' \
  | node "$SERVER_JS" 2>/dev/null | head -1)

if echo "$RESPONSE" | grep -q '"slalom-sdlc"'; then
  ok "Server responds correctly"
else
  warn "Could not verify server response — check manually with: claude mcp list"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "  ✅  Setup complete!"
echo ""
echo "     The slalom-sdlc MCP server is now available in all Claude Code sessions."
echo ""
echo "  Next steps:"
echo "    1. Open Claude Code in any Salesforce project directory"
echo "    2. Run: /mcp__slalom-sdlc__about   (confirm it works)"
echo "    3. Run: /mcp__slalom-sdlc__init    (set up a new project)"
echo ""
echo "  To update the server after a git pull:"
echo "    cd $SDLC_ROOT"
echo "    pnpm --filter @sdlc/core build"
echo "    pnpm --filter slalom-sdlc-mcp build"
echo ""
