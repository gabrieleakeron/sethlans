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
everyone with zero extra setup. The Sethlans flows (`/sethlans-onboard` §0-C,
`/sethlans-healthcheck` §3a) wire it **for** the user — the user never types `claude mcp add`.
`sethlans setup` does **not** register integration MCPs; wiring happens per-project during onboarding.

### The golden rule — token as `${PLACEHOLDER}`, never inlined in a config file
A token is a **machine credential**, reused across every repo. It must **never** be written into
`~/.claude.json`, `~/.claude/.mcp.json`, or a project's `.mcp.json` as a literal value — a token
baked into a config file is a plaintext secret sitting on disk (and easily committed by accident).

**MCP servers always receive tokens via the `'${VAR}'` placeholder** (single-quoted so the shell
does not expand it at registration time) — Claude Code resolves it from the environment at server
launch. The secret therefore never lands in any committed config file.

#### Where the token lives: two equivalent paths

**Path A — env var only (manual, traditional):**
The user stores the secret as a persistent environment variable. Windows: `setx VAR "<token>"`.
macOS/Linux: add `export VAR="<token>"` to `~/.zshrc` / `~/.bashrc`. Because `setx` / `export`
only affect new processes, the user must **restart Claude Code and their terminal** after this step
for the variable to resolve. The Sethlans flow then registers the server with the placeholder and
Claude Code picks it up from the environment.

**Path B — Sethlans global token file (managed, preferred when using the integration artifact):**
The Sethlans integration artifact (Preview pane) writes tokens to a single **global file**
`~/.claude/sethlans-tokens.env` (one per line, `KEY=VALUE` format). This file lives **outside
every project repo** and is therefore not committable from any workspace. On POSIX systems it is
written with permissions `0600` (owner-read-only); on Windows/NTFS the `chmod` call is a no-op
(NTFS does not expose POSIX permission bits) so on Windows the file is protected at the OS-user
level instead.

When the companion sources this file into the child process environment before running
`claude mcp add -s local`, the token flows to the MCP via the `'${VAR}'` placeholder exactly as
in Path A — it is never inlined into `.claude.json` or any committable config.

Security trade-off: a file on disk (even with 0600) is readable by anything running as the same
OS user, whereas a pure in-session env var lasts only for the shell's lifetime. The risk is
governed: one file, one owner, outside all repos, auto-generated by a local tool — no worse than
`~/.ssh/id_rsa`. Treat it accordingly: **do not share it**, **rotate tokens** when a machine is
compromised, and do not copy the file into containers or CI.

Both paths are supported; the subagents do not care which was used.

> Non-secret connection bits (an instance URL, an account email) may be passed inline on `-e` —
> only the **token/key** must go through the env-var / file placeholder.

#### Gitignore note
`~/.claude/sethlans-tokens.env` lives in the user's home directory and is not inside any project
repo, so it cannot be accidentally committed. If a project's `.claude/project-profile.yaml`
contains machine-specific paths (e.g. `slots.codeQuality.mount_root`) it should be listed in that
project's `.gitignore` (or kept in `.claude/settings.local.json`, which is already gitignored by
the Sethlans workspace).

### Provider recipe table (code-quality slot)
The definitive code-quality catalog (in priority order, first = default): **codescene** →
**codacy** → **none**. `none` means no external integration: no token, no MCP registration.

The flow picks the row for the chosen provider and walks the user through *create token → store
token → (tool registers)*. `<url>` is the vendor instance URL (non-secret, inline).

| Provider | Env var (token key in `sethlans-tokens.env` or `setx`/`export`) | Where the user creates the token | Registration the flow runs |
|---|---|---|---|
| **codescene** | `CS_ACCESS_TOKEN` (+ `CS_ONPREM_URL` on-prem) | Cloud → **codescene.io/users/me/pat** · on-prem → `https://<your-cs-host>/configuration/user/token` | **Per-workspace** (needs a bind-mount) — see *CodeScene runs in Docker* below; registered `-s local`, **not** `-s user`. |
| **codacy** | `CODACY_API_TOKEN` | Codacy → your avatar → **Account** → **Access Management** → **Create API token** (account token) | `claude mcp add codacy -s local -e CODACY_API_TOKEN='${CODACY_API_TOKEN}' -- npx -y @codacy/codacy-mcp@latest` |
| **none** | — | — | No MCP registered; seth-reviewer omits Code Health silently. |

> Commands are **current templates** — check the vendor's MCP docs for the exact package, transport
> (stdio vs docker vs remote), and env vars; the **placeholder pattern stays the same** regardless.
>
> Note: `sonarqube` is **not** in the Sethlans catalog. If you need SonarQube you can wire it
> manually, but the Sethlans flows will not prompt for it or register it.

The Sethlans `plugin.json` intentionally does **not** ship a code-quality server in its
`mcpServers` (it would fail to connect for users without the vendor/token). It is always wired
on demand by the flows above, at **local scope** (`-s local`), following this golden rule.

### CodeScene runs in Docker — the server is per-workspace, only the token is global
CodeScene's MCP (`codescene/codescene-mcp`) runs in a **Linux Docker container**. To review files it
must **bind-mount the project tree** into the container and be told the host-side root via
`CS_MOUNT_PATH`. Without the mount the container sees nothing — on Windows this surfaces as
*"the MCP runs in a Linux/Docker container that can't see the Windows filesystem `C:\…`"*. So
CodeScene splits across two scopes:

- **Global (one-time, shared by every repo):** the credentials — `CS_ACCESS_TOKEN` (the
  secret) and, for on-prem, `CS_ONPREM_URL` (the instance URL). These can be stored either as
  persistent env vars (`setx`/`export`) or via the integration artifact (which writes them to
  `~/.claude/sethlans-tokens.env` — see *The golden rule* above). Either way they are **never**
  baked into a committed config file. These are set up during `/sethlans-onboard` §0-C —
  `sethlans setup` does **not** register any integration MCP.
- **Per-workspace (registered by `/sethlans-onboard`, scope `-s local`):** the server itself, with
  the project bind-mount. The absolute path is machine-specific, so it goes to `-s local` (the
  per-project `.claude.json`), **never** `-s user` (one global path can't serve every repo) and
  **never** `-s project` (don't commit a machine path):

  ```bash
  # <root> = the workspace root to expose (forward slashes). Token/URL ride through
  # from the global env vars via the '${VAR}' placeholders; CS_MOUNT_PATH + --mount
  # carry the (non-secret) path directly.
  # Token sourced from ~/.claude/sethlans-tokens.env or the OS environment.
  claude mcp add codescene -s local \
    -e CS_ACCESS_TOKEN='${CS_ACCESS_TOKEN}' \
    -e CS_ONPREM_URL='${CS_ONPREM_URL}' \
    -- docker run -i --rm \
       -e CS_ACCESS_TOKEN -e CS_ONPREM_URL \
       -e CS_MOUNT_PATH=<root> \
       --mount type=bind,src=<root>,dst=/mount/,ro \
       codescene/codescene-mcp
  # CodeScene Cloud: drop both CS_ONPREM_URL lines.
  ```

- **Multi-repo workspaces:** `CS_MOUNT_PATH` is a **single** root, so the default is **one container
  mounting the common parent** of the project's repos (e.g. `C:/sviluppo/devgit/alkyra` containing
  `api/`, `ui/`) — then `<root>` = that parent and one `codescene` server covers all repos. Only if
  the repos live under **unrelated roots** does onboard fall back to one server per repo
  (`codescene-<repo>`, each with its own `CS_MOUNT_PATH`). Use forward slashes in the path even on
  Windows.

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
