<#
  Installs the Sethlans toolkit into Claude Code's global home (~/.claude).
  Copies the /sethlans skill, the generic subagents, and the Sethlans Board protocol.
  Source of truth: this package (packages/sethlans-claude-plugin/).

  Usage:
    pwsh ./install.ps1            # copy (prompts for confirmation if overwriting)
    pwsh ./install.ps1 -Force     # overwrite without prompting

  Preferred: use the npm package instead (handles MCP registration interactively):
    npm install -g sethlans
    sethlans setup

  Or use the Claude Code plugin system:
    /plugin install sethlans@claude-community
#>
param([switch]$Force)

$ErrorActionPreference = 'Stop'
$src  = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $env:USERPROFILE '.claude'

Write-Host "Installing Sethlans toolkit -> $dest" -ForegroundColor Cyan

New-Item -ItemType Directory -Force -Path (Join-Path $dest 'commands') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $dest 'agents')   | Out-Null

function Copy-Item-Safe($from, $to) {
    if ((Test-Path $to) -and -not $Force) {
        Write-Host "  already exists: $to (use -Force to overwrite) - skipping" -ForegroundColor Yellow
        return
    }
    Copy-Item $from $to -Force
    Write-Host "  copied: $to" -ForegroundColor Green
}

Get-ChildItem (Join-Path $src 'commands') -Filter *.md | ForEach-Object {
    Copy-Item-Safe $_.FullName (Join-Path $dest "commands\$($_.Name)")
}
Copy-Item-Safe (Join-Path $src 'board-protocol.md') (Join-Path $dest 'board-protocol.md')
Copy-Item-Safe (Join-Path $src 'code-quality-protocol.md') (Join-Path $dest 'code-quality-protocol.md')

Get-ChildItem (Join-Path $src 'agents') -Filter *.md | ForEach-Object {
    Copy-Item-Safe $_.FullName (Join-Path $dest "agents\$($_.Name)")
}

# Server MCP `sethlans-board` (wrapper sui REST). La registrazione non può essere fatta
# da una semplice copia: va aggiunta ai settings di Claude Code (vedi nota sotto).
New-Item -ItemType Directory -Force -Path (Join-Path $dest 'mcp') | Out-Null
Copy-Item-Safe (Join-Path $src 'mcp\server.mjs') (Join-Path $dest 'mcp\server.mjs')

Write-Host "Done. Restart Claude Code and type /sethlans to use it." -ForegroundColor Cyan
Write-Host ""
Write-Host "Optional - register the Sethlans Board MCP server (cross-platform tools for the board):" -ForegroundColor Cyan
Write-Host "  claude mcp add sethlans-board -s user -e SETHLANS_SERVICE_API_URL=http://localhost:9955 -- node `"$dest\mcp\server.mjs`""
Write-Host "(The Claude Code plugin install wires this automatically; this is only for the manual install.)"
Write-Host ""
Write-Host "Optional - wire a code-quality MCP for the seth-reviewer (CodeScene / SonarQube / Codacy ...):" -ForegroundColor Cyan
Write-Host "  see `"$dest\code-quality-protocol.md`" for adaptable 'claude mcp add' templates."
Write-Host "  It is fully optional: with no such MCP, the seth-reviewer just omits the Code Health section."
