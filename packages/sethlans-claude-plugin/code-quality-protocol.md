# Code Quality Protocol — optional Code Health / static analysis

This document defines the **convention** by which the Sethlans subagents (primarily the
**seth-reviewer**) consume an **optional code-quality MCP server**: Code Health / static-analysis
tools such as **CodeScene**, **SonarQube/SonarCloud**, **Codacy**, **Qodana** or **Semgrep**,
each of which ships its own MCP server. Some (notably **Codacy**, via `codacy_cli_analyze`) also
run analysis **locally** through the MCP — see *Local analysis through an MCP* below.

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
everyone with zero extra setup. The Sethlans flows (`sethlans setup` Step 3, `/sethlans-onboard`
§0-C, `/sethlans-healthcheck` §3a) wire it **for** the user — the user never types `claude mcp add`.

### The golden rule — token in an env var, registered as a `${PLACEHOLDER}`, never in a file
A token is a **machine credential**, reused across every repo. It must **never** be written into
`~/.claude.json`, `~/.claude/.mcp.json`, or a project's `.mcp.json` as a literal value — a token
baked into a config file is a plaintext secret sitting on disk (and easily committed by accident).

The turnkey contract, identical for every provider:

1. **The user** stores the secret once, as a persistent **environment variable** named exactly as
   the MCP expects (see the table). Windows: `setx CODACY_ACCOUNT_TOKEN "<token>"`. macOS/Linux:
   add `export CODACY_ACCOUNT_TOKEN="<token>"` to `~/.zshrc` / `~/.bashrc`.
2. **The Sethlans flow** registers the server with the **literal placeholder** `'${VAR}'`
   (single-quoted so the shell does not expand it at registration time) — Claude Code resolves it
   from the environment at server launch. The secret therefore never lands in any config file:
   ```bash
   claude mcp add codacy -s user -e CODACY_ACCOUNT_TOKEN='${CODACY_ACCOUNT_TOKEN}' -- npx -y @codacy/codacy-mcp@latest
   ```
3. Because `setx` / a shell-profile `export` only affects **new** processes, the user must
   **restart Claude Code (and their terminal)** after step 1 for the variable to resolve.

> Non-secret connection bits (an instance URL, an account email) may be passed inline on `-e` —
> only the **token/key** must go through the env-var placeholder.

### Provider recipe table (code-quality slot)
The flow picks the row for the chosen provider and walks the user through *create token → set env
var → (tool registers)*. `<url>` is the vendor instance URL (non-secret, inline).

| Provider | Env var (set via `setx`/`export`) | Where the user creates the token | Registration the flow runs |
|---|---|---|---|
| **codacy** | `CODACY_ACCOUNT_TOKEN` | Codacy → your avatar → **Account** → **Access Management** → **Create API token** (account token) | `claude mcp add codacy -s user -e CODACY_ACCOUNT_TOKEN='${CODACY_ACCOUNT_TOKEN}' -- npx -y @codacy/codacy-mcp@latest` |
| **codescene** | `CODESCENE_API_TOKEN` | CodeScene → **User settings** → **API / Personal access tokens** → generate | `claude mcp add codescene -s user -e CODESCENE_API_URL=<url> -e CODESCENE_API_TOKEN='${CODESCENE_API_TOKEN}' -- docker run -i --rm -e CODESCENE_API_URL -e CODESCENE_API_TOKEN codescene/codescene-mcp` |
| **sonarqube** | `SONARQUBE_TOKEN` | Sonar → **My Account** → **Security** → **Generate Tokens** | `claude mcp add sonarqube -s user -e SONARQUBE_URL=<url> -e SONARQUBE_TOKEN='${SONARQUBE_TOKEN}' -- <sonar-mcp-launch-command>` |

> Commands are **current templates** — check the vendor's MCP docs for the exact package, transport
> (stdio vs docker vs remote), and env vars; the **placeholder pattern stays the same** regardless.

The Sethlans `plugin.json` intentionally does **not** ship a code-quality server in its
`mcpServers` (it would fail to connect for users without the vendor/token). It is always wired
on demand by the flows above, at **user scope**, following this golden rule.

## Local analysis through an MCP — Codacy `codacy_cli_analyze`

The official **Codacy** MCP (`@codacy/codacy-mcp`) exposes a `codacy_cli_analyze` tool that runs
analysis **locally** via the Codacy CLI v2 (the MCP installs it on first use), returning results
without waiting on cloud processing. This stays within the MCP convention — it is discovered as
`mcp__codacy__*` like any other code-quality MCP — so the seth-reviewer needs no special handling:
when present, call `codacy_cli_analyze` scoped to the diff/PR under review.

Caveats (same best-effort, never-blocking spirit):
- The account token (`CODACY_ACCOUNT_TOKEN`) is **required even for local analysis** — the CLI
  initializes with it. There is no token-free MCP path.
- On **Windows** the local CLI runs **only under WSL**. If it can't run, fall back to the MCP's
  cloud tools, or flag that Code Health could not be retrieved — never block the review.

> A standalone, account-free option still exists outside the MCP: this repo's `docker/codacy/`
> analyzer (image `codacy/codacy-analysis-cli`, `analyze.ps1` / `analyze.sh` → SARIF in `results/`)
> for manual ad-hoc runs. It is not wired into the reviewer flow.
