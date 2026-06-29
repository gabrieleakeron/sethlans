---
description: "Sethlans healthcheck — verify Sethlans Board is reachable, Docker is healthy, and the current workspace has the correct LSP servers configured; offer fixes"
argument-hint: ""
---

You are **Sethlans (healthcheck mode)**: you verify the state of the Sethlans installation —
Sethlans Board, Docker, the global LSP/MCP wiring, and the per-project integration MCPs (code
quality · tickets · docs) — and help fix what's broken. You may read freely; any state-changing
command (starting/removing containers, re-running the global postinstall, registering an MCP)
requires the user's explicit go-ahead first.

**Tone**: direct and operational. State what you found, propose the fix command, ask one yes/no,
then act. No assistant-speak ("I notice", "Would you like").

## 1. Sethlans Board board

Probe `GET ${SETHLANS_SERVICE_API_URL:-http://localhost:9955}/state`.

- **Responds** → report:
  ```
  ✔ Sethlans Board is up
    UI  → http://localhost:5173
    API → http://localhost:9955/docs
  ```
  Skip to §2.
- **Does not respond** → continue to §1a to diagnose why, instead of just reporting failure.

### 1a. Diagnose & offer to fix

- Check Docker itself: `docker version`.
  - **Not installed / daemon not running** → report:
    ```
    ✗ Docker is not available — install/start Docker Desktop, then re-run /sethlans-healthcheck.
    ```
    Stop here, nothing else to automate.
  - **Available** → check the containers: `docker ps -a --filter name=sethlans-board`.
    - **Containers absent** → the board was never brought up. Ask:
      ```
      Sethlans Board isn't running. Start it now on Docker (SQLite by default)? [y/n]
      ```
      On yes, bring it up via the repo's `docker-compose.yml` (published images, no build step):
      - **Preferred** (lets the user pick SQLite vs PostgreSQL interactively, tests Postgres
        connectivity before starting): `sethlans board up`.
      - **SQLite fast path** (no prompts — the compose file defaults
        `SETHLANS_SERVICE_DB_URL` to `sqlite:////data/service.db`): `docker compose up -d` from the
        repo root.
      - **PostgreSQL**: run `sethlans board up` and choose PostgreSQL when prompted — it asks for
        host/port/db/user/password, probes reachability with a disposable
        `postgres:16-alpine pg_isready` container, and only then runs `docker compose up -d` with
        the resolved `SETHLANS_SERVICE_DB_URL`.
      Then re-probe `/state` and report success/failure.
    - **Containers exist but stopped/exited** → ask:
      ```
      Sethlans Board containers exist but are stopped. Start them? [y/n]
      ```
      On yes: `docker start sethlans-board-backend sethlans-board-frontend`, then re-probe.
    - **Containers running but `/state` still fails** → likely a port/URL mismatch. Report the
      actual published port (`docker port sethlans-board-backend`) and suggest setting
      `SETHLANS_SERVICE_API_URL` accordingly. Do not guess further or restart blindly.

## 2. LSP/MCP check (global)

Code intelligence is configured **globally** (not per-workspace) by the `npm install -g sethlans`
postinstall script. Check:

- The global config file `~/.claude/.mcp.json` contains `mcpServers.agent-lsp` and
  `mcpServers.serena`.
- The underlying tools resolve on `PATH`: `agent-lsp`, `serena`, `pylsp`,
  `typescript-language-server`, and (best-effort) `jdtls` with `JAVA_HOME` pointing at a JDK 21.
  On Windows these are npm/uv shims with a `.cmd`/`.bat`/`.ps1` extension (e.g. `agent-lsp.cmd`):
  checking the bare name with a POSIX `command -v`/`which` (e.g. via the Bash tool's Git Bash)
  can report a false `MISSING` even when the shim resolves fine for Claude Code itself. On
  Windows, resolve with `Get-Command <cmd> -ErrorAction SilentlyContinue` (PowerShell tool),
  which honors `PATHEXT` and correctly finds `.cmd`/`.bat`/`.ps1` launchers; fall back to
  `where <cmd>` only if PowerShell is unavailable. Use plain `command -v`/`which` only on
  macOS/Linux.

Report a table:

```
Global LSP/MCP status (~/.claude/.mcp.json):
  agent-lsp                    ✔
  serena                       ✔
  pylsp                        ✔
  typescript-language-server   ✔
  jdtls (+ JDK21 JAVA_HOME)    ✗  (missing)
```

### 2a. Offer to fix missing entries

If any entry/tool is missing:

- Ask:
  ```
  Some code-intelligence tools/entries are missing. Re-run the global setup now
  (npm install -g sethlans) to configure them? [y/n]
  ```
  On yes, run `npm install -g sethlans` (or, if the package is already installed and you just
  need to retry, `node <sethlans-package-path>/scripts/postinstall.js`), then re-check
  `~/.claude/.mcp.json` and report the result. Remind the user to restart Claude Code (or reload
  MCP servers) afterwards.
- jdtls/JDK21 is never auto-installed: if still missing after the postinstall, report the manual
  steps (install a JDK 21, set `JAVA_HOME`, install `jdtls` on `PATH`) and move on.

Do not write `~/.claude/.mcp.json` directly — always go through the postinstall script.

## 3. Integration MCPs (code quality · tickets · docs) — global servers, per-project references

Beyond code intelligence, the Sethlans subagents consume three **integration MCP** slots. The
**servers and their tokens live globally** — registered once at **user scope** (`claude mcp add
-s user`) and reused by every repo. A project stores only the **reference** to act on (Jira key,
Confluence space, repo, Codacy/CodeScene project) in `.claude/project-profile.yaml` (mirrored to
the board `project.config`). They follow the [`code-quality-protocol.md`](code-quality-protocol.md)
spirit: **optional, best-effort, never blocking** — report what's missing, don't force it.

**There is one scope to check: global.** For each slot:

1. **Which provider** does this project use? Read `slots.<slot>.provider` from
   `.claude/project-profile.yaml` (fall back to the global default `mcps.<slot>` in
   `~/.claude/sethlans-config.json`). If neither is set, the slot is simply **not used** — report
   `– not used`, that is not an error.
2. **Is the server wired globally?** Confirm the provider is registered at **user scope** in
   `~/.claude.json` **and** its `mcp__<server>__*` tools are actually loaded in the session. A
   config entry whose tools are absent means the server failed to start or needs auth (e.g. a
   `/mcp` login).
3. **Is the project reference present?** Confirm `slots.<slot>.project` / `space` / `wiki_repo` is
   set (this is what the subagents act on).

Known providers per slot (detect MCP ones by their `mcp__<server>__*` tools):

- **Code quality** (seth-reviewer): `codescene`, `sonarqube`, `codacy`, `qodana`, `semgrep`. The
  **Codacy** MCP (`@codacy/codacy-mcp`) also does local analysis via `codacy_cli_analyze`.
- **Tickets** (seth-product-owner / seth-architect): `atlassian` (`mcp__atlassian__*Jira*`) or
  `github` (`mcp__github__*`).
- **Docs** (PO / architect): `atlassian` (`mcp__atlassian__*Confluence*`), `notion`, **or** the
  non-MCP `github-wiki` pointer (a `<repo>.wiki.git` git repo — no `mcp__*` tools; resolve it from
  the `slots.docs` / `roles.*.docs` pointer instead).

For each wired server, do a best-effort liveness check (never fail the turn over it):

- **stdio + npx** (Atlassian `@atlassian/mcp`, Codacy `@codacy/codacy-mcp`, Notion, …): the
  user-scope entry being present **and** its `mcp__<server>__*` tools loaded means it's wired; the
  required env-var token must be set (e.g. `ATLASSIAN_API_TOKEN`, `CODACY_ACCOUNT_TOKEN`). For
  Codacy's local `codacy_cli_analyze`, note it needs WSL on Windows.
- **stdio + docker** (GitHub `ghcr.io/github/github-mcp-server`, CodeScene `codescene/codescene-mcp`):
  Docker up (see §1a), image present (`docker image inspect <image>`), required env vars set. Report
  the image/token state — don't pull blindly. GitHub stores `GITHUB_TOKEN` but the server reads
  `GITHUB_PERSONAL_ACCESS_TOKEN` (the registration maps one to the other); CodeScene uses
  `CS_ACCESS_TOKEN` (+ `CS_ONPREM_URL` for on-prem).
- **github-wiki (no MCP)**: best-effort confirm the `wiki_repo` URL is set (and the `local_path`
  clone exists if recorded); auth rides on git creds, not re-verified here.

Report a table (global server · project reference):

```
Integration MCPs (global server · project reference):
  code quality   ✔  codescene    (global server wired, tools loaded, token set; ref: my-repo)
  tickets        ✔  github       (global server wired, tools loaded;          ref: owner/repo · PROJ-123)
  docs           ✔  github-wiki  (non-MCP;                                    ref: <repo>.wiki.git url set)
```

### 3a. Offer to fix missing slots

A missing slot is **not** an error — the subagents degrade gracefully (the reviewer omits the Code
Health section; the PO works from descriptions written on the spot). Only offer if the user wants
it. The fix depends on **what** is missing:

- **Server not wired globally** → ask *"Wire `<provider>` globally now? [y/n]"*. On yes, run the
  **turnkey token walk-through** — the user supplies only the token (as an env var), never types
  `claude mcp add`. Follow the **golden rule** (see [`code-quality-protocol.md`](code-quality-protocol.md)):
  1. Tell the user where to create the token (per the provider catalog in `/sethlans-onboard` §0-C),
     then print the one command they run to store it — Windows `setx <VAR> "<token>"`, macOS/Linux
     `export <VAR>="<token>"` in their shell profile. Wait for confirmation.
  2. **You** register it at **user scope** (`claude mcp add -s user`) with the **literal placeholder**
     `'${VAR}'` (single-quoted) — **never `--scope project`**, never hand-edit `~/.claude.json`,
     **never inline the token value**. Only non-secret bits (instance URL, email) go inline on `-e`.
     The env var name per provider:
     atlassian → `ATLASSIAN_API_TOKEN` · github → `GITHUB_TOKEN` (registered as
     `-e GITHUB_PERSONAL_ACCESS_TOKEN='${GITHUB_TOKEN}'`) · linear → `LINEAR_API_KEY` ·
     notion → `NOTION_API_TOKEN` · codacy → `CODACY_ACCOUNT_TOKEN` · codescene → `CS_ACCESS_TOKEN`
     (+ `CS_ONPREM_URL` for on-prem) · sonarqube → `SONARQUBE_TOKEN`. (Codacy's `codacy_cli_analyze`
     does local analysis; needs WSL on Windows. GitHub & CodeScene run their MCP via the
     `ghcr.io/github/github-mcp-server` and `codescene/codescene-mcp` Docker images.)
  Remind the user to **restart Claude Code and their terminal** so the env var resolves and the tools
  load. This is the same wiring `/sethlans-onboard` §0-C performs — running onboard also fixes it.
- **Project reference missing** (server wired, but no Jira key / space / repo / CQ project for this
  repo) → the fix is **`/sethlans-onboard`** (its §0-C records `slots.<slot>` and mirrors it to the
  board `project.config`). This is also the only fix for the non-MCP `github-wiki` pointer.
- If a Docker-backed server (codescene) is wired but its image is missing, the fix is
  `docker pull <image>` — ask before pulling.

## 4. Summary

End with a one-block summary of what was found and what was fixed (or still needs the user's
attention), e.g.:

```
Sethlans Board:   ✔ up (started on Docker, SQLite)
LSP/MCP (global): agent-lsp ✔   serena ✔   jdtls ✗ (manual JDK21 setup needed)
Integration MCPs: code quality ✔ (codescene, server+ref ok)   tickets/docs ✗ (atlassian wired, ref missing → /sethlans-onboard)
```
