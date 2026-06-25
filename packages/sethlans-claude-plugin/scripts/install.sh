#!/usr/bin/env bash
# Installs the Sethlans toolkit into Claude Code's global home (~/.claude).
# Copies the /sethlans skill, the generic subagents, and the Sethlans Board protocol.
# Source of truth: this package (packages/sethlans-claude-plugin/).
#
# Usage:
#   ./install.sh            # copy (skips files that already exist)
#   ./install.sh --force    # overwrite
#
# Preferred: use the npm package instead (handles MCP registration interactively):
#   npm install -g sethlans
#   sethlans setup
#
# Or use the Claude Code plugin system:
#   /plugin install sethlans@claude-community
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${HOME}/.claude"
FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

echo "Installing Sethlans toolkit -> $DEST"
mkdir -p "$DEST/commands" "$DEST/agents"

copy_safe() {
  local from="$1" to="$2"
  if [[ -e "$to" && $FORCE -eq 0 ]]; then
    echo "  already exists: $to (use --force to overwrite) - skipping"
    return
  fi
  cp "$from" "$to"
  echo "  copied: $to"
}

for f in "$SRC"/commands/*.md; do
  copy_safe "$f" "$DEST/commands/$(basename "$f")"
done
copy_safe "$SRC/board-protocol.md"  "$DEST/board-protocol.md"
copy_safe "$SRC/code-quality-protocol.md"  "$DEST/code-quality-protocol.md"
for f in "$SRC"/agents/*.md; do
  copy_safe "$f" "$DEST/agents/$(basename "$f")"
done

# Server MCP `sethlans-board` (wrapper sui REST). La registrazione non può essere fatta
# da una semplice copia: va aggiunta ai settings di Claude Code (vedi nota sotto).
mkdir -p "$DEST/mcp"
copy_safe "$SRC/mcp/server.mjs" "$DEST/mcp/server.mjs"

echo "Done. Restart Claude Code and type /sethlans to use it."
echo
echo "Optional — register the Sethlans Board MCP server (cross-platform tools for the board):"
echo "  claude mcp add sethlans-board -s user -e SETHLANS_SERVICE_API_URL=http://localhost:9955 -- node \"$DEST/mcp/server.mjs\""
echo "(The Claude Code plugin install wires this automatically; this is only for the manual install.)"
echo
echo "Optional — wire a code-quality MCP for the seth-reviewer (CodeScene / SonarQube / Codacy ...):"
echo "  see \"$DEST/code-quality-protocol.md\" for adaptable 'claude mcp add' templates."
echo "  It is fully optional: with no such MCP, the seth-reviewer just omits the Code Health section."
