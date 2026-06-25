# Code Quality Protocol — optional Code Health / static-analysis MCP

This document defines the **convention** by which the Sethlans subagents (primarily the
**seth-reviewer**) consume an **optional code-quality MCP server**: Code Health / static-analysis
tools such as **CodeScene**, **SonarQube/SonarCloud**, **Codacy**, **Qodana** or **Semgrep**,
each of which ships its own MCP server.

It is **cross-project**: it lives in the global home (`~/.claude/`) and does not depend on any
specific workspace. It is the counterpart of [`board-protocol.md`](board-protocol.md) for the
analysis side.

## Guiding principle — optional, best-effort, never blocking
A code-quality MCP is **enrichment**, not a prerequisite for reviewing.
- If **no** code-quality MCP is configured (no matching `mcp__<server>__*` tools available),
  the seth-reviewer performs the review normally and simply **omits** the Code Health section —
  it does **not** ask the user to install anything and does **not** block.
- If the MCP **is** configured but does not respond (auth error, project not found, timeout),
  treat it like Sethlans Board being down: proceed with the review, and **flag in the report**
  that the Code Health data could not be retrieved.
- Never fail a review turn over a code-quality MCP error.

## Discovery — how the seth-reviewer knows a tool is available
There is **no fixed server name**: the slot is generic. At review time, the seth-reviewer detects
whether any code-quality tools are exposed (tool names typically prefixed `mcp__<server>__*`,
e.g. `mcp__codescene__*`, `mcp__sonarqube__*`, `mcp__codacy__*`). If present, use them
best-effort; otherwise skip the Code Health section silently.

## What to ask the tool (when available)
Keep the analysis **scoped to the diff/PR under review**, not the whole repo, and fold the
result into the report's structure:
- **Code Health / hotspots / complexity trend** on the changed files → informs SUGGESTIONS
  (maintainability) and, when a regression is severe, a BLOCKER.
- **Quality-gate / new-issues** (Sonar, Codacy) introduced by the change → BLOCKERS if the gate
  fails on new code; SUGGESTIONS otherwise.
- **Security findings** (Semgrep, Sonar) → BLOCKERS (the seth-reviewer already prioritises security).

Append a short **Code Health** subsection to the review report (and to the Sethlans Board task
`md`, per `board-protocol.md`), citing the tool used and the headline metric. If the section is
omitted, no note is needed unless the tool was configured-but-unreachable.

## Configuration — wiring a code-quality MCP (adapt to your vendor)
The slot is **user-configured**: nothing is shipped enabled by default, so the plugin works for
everyone with zero extra setup. To enable it, register the vendor's MCP server with Claude Code.
Pass the API URL/token via **environment variables** — never hardcode secrets.

> The commands below are **illustrative templates**. Check each vendor's MCP documentation for
> the exact package/command, transport (stdio vs remote), and required env vars.

> `-s user` registers the server at the global ("user") scope — available in every project, not
> just the one you happen to run the command from. Omit it (or use `-s project`) if you want a
> per-project `.mcp.json` entry instead — see below.

```bash
# CodeScene (Code Health, hotspots, behavioral code analysis)
claude mcp add codescene -s user \
  -e CODESCENE_API_URL=https://<your-codescene-host> \
  -e CODESCENE_API_TOKEN=<token> \
  -- <codescene-mcp-launch-command>

# SonarQube / SonarCloud (quality gate, new-code issues, SAST)
claude mcp add sonarqube -s user \
  -e SONARQUBE_URL=https://<your-sonar-host> \
  -e SONARQUBE_TOKEN=<token> \
  -- <sonar-mcp-launch-command>

# Codacy (quality + security)
claude mcp add codacy -s user \
  -e CODACY_ACCOUNT_TOKEN=<token> \
  -- <codacy-mcp-launch-command>
```

Equivalent project-scoped `.mcp.json` entry (committed to the repo, secrets via env):

```json
{
  "mcpServers": {
    "codescene": {
      "command": "<codescene-mcp-launch-command>",
      "env": {
        "CODESCENE_API_URL": "${CODESCENE_API_URL}",
        "CODESCENE_API_TOKEN": "${CODESCENE_API_TOKEN}"
      }
    }
  }
}
```

The Sethlans `plugin.json` intentionally does **not** ship a code-quality server in its
`mcpServers` (it would fail to connect for users without the vendor/token). Enable it per-user
(`claude mcp add`) or per-project (`.mcp.json`) using the templates above.
