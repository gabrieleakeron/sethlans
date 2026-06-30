# sethlans

CLI to install and configure the **Sethlans** toolkit for Claude Code — the subagent orchestration
system that runs the PO → UX → architect → dev → review/test pipeline.

## Install

Download the latest release from [GitHub Releases](https://github.com/gabrieleakeron/sethlans/releases):

```bash
npm install -g https://github.com/gabrieleakeron/sethlans/releases/latest/download/sethlans-latest.tgz
```

## Usage

### `sethlans setup` — global installation wizard

Run once after installing the package:

```bash
sethlans setup
```

Plugin files are copied unconditionally first. After that the wizard walks through 2
independently steppable sections — each one offers **Configure**, **Test**, **Save & continue**,
or **Skip this step**, looping until you Save or Skip:

| Step | What it does |
|---|---|
| 1 — Sethlans Board | Local only: SQLite (default) or PostgreSQL. `Test` checks Docker/DB reachability without registering anything. `Save` runs `docker compose up -d` against the repo's `docker-compose.yml` (if chosen) and registers the `sethlans-board` MCP server. If you pick PostgreSQL with `localhost`/`127.0.0.1` as host, it is automatically translated to `host.docker.internal` before being handed to the container — `localhost` inside the container means the container itself, not your machine. |
| 2 — Code intelligence (LSP) | Installs `agent-lsp` + `serena` and the LSP backends (pylsp, typescript-language-server, optionally jdtls). Full (all three languages) or Custom per language. |

The PostgreSQL password is entered in plain text (no masking) via `ask()` in
[`lib/prompts.js`](lib/prompts.js).

`sethlans-board` is registered with `-s user` (global scope): available in every project.

> **Integration MCPs** (tickets · docs · code-quality) are **not** configured here. They are wired
> globally on demand by [`/sethlans-onboard`](../sethlans-claude-plugin/commands/sethlans-onboard.md)
> (always `-s user`, one token per provider), and each project keeps only the *references* (Jira
> key, Confluence space, Codacy/CodeScene project) in `.claude/project-profile.yaml`.

A final **confirmation step** prints a summary of what was configured/skipped and asks before
writing `~/.claude/sethlans-config.json` (used by `/sethlans-onboard`); declining lets you restart
the wizard or discard the run.

**Restart Claude Code** after the wizard to load the new skills and agents.

```bash
sethlans setup --update   # re-copy plugin files (overwrites without per-file prompts), re-run board + LSP steps
```

### `sethlans board up` — bring up the board standalone

If you need to (re)start Sethlans Board without going through the full setup wizard (e.g. after a
reboot, or on a machine where the plugin is already configured):

```bash
sethlans board up
```

It asks SQLite (default, zero config) vs PostgreSQL — for PostgreSQL it prompts for
host/port/db/user/password, probes reachability with a disposable
`postgres:16-alpine pg_isready` container (retrying or letting you continue anyway on failure) —
then runs `docker compose up -d` against the repo's `docker-compose.yml` with the resolved
`SETHLANS_SERVICE_DB_URL`. No npm dependency on `pg`; connectivity testing shells out to Docker,
which is already required to run the board.

### `sethlans uninstall` — remove Sethlans

Removes the plugin from `~/.claude/` — skills, the 10 `seth-*` agents, the protocol docs and the
`sethlans-board` MCP server — and deregisters the code-intelligence MCPs (`agent-lsp`, `serena`)
from `~/.claude/.mcp.json` (other servers in that file are left intact). It then **asks** whether to
also deregister the integration MCPs (tickets/docs/code-quality, which may be shared with other
tools) and whether to stop the local board containers.

```bash
sethlans uninstall            # standalone
# or pick "Uninstall Sethlans" from the first prompt of `sethlans setup`
```

The board **database is always preserved**: the containers are brought down with `docker compose
down` (no `--volumes`), so the `sethlans-board-data` volume survives. Globally-installed CLIs
(`agent-lsp`, `serena`, `pylsp`, …) are left in place — remove them manually if you want a fully
clean slate.

### `sethlans preview init` — bundle the board preview into your repo

Makes the Sethlans Board Preview server (so it renders inside Claude Code's Preview pane,
instead of an external browser) available in the **current repo** and writes/updates
`.claude/launch.json` accordingly:

```bash
sethlans preview init
```

Without flags it runs an interactive wizard asking for the mode (embedded / local+Docker /
remote), then upstream/web URL/token where applicable. Non-interactive flags:

```bash
sethlans preview init --mode embedded
sethlans preview init --mode local
sethlans preview init --mode remote --upstream https://board-api.example.com --web-url https://board.example.com --token <t> [--write-token]
sethlans preview init --port 9966
```

| Flag | Meaning |
|---|---|
| `--mode <embedded\|local\|remote>` | Skips the wizard. `embedded`: preview's own SQLite, no external backend. `local`: proxy to the Dockerized FastAPI backend (`http://localhost:9955`). `remote`: proxy to a remote backend (e.g. Render). |
| `--upstream <url>` | Backend URL for `local`/`remote` (defaults: `http://localhost:9955` local, `https://board-api.sethlans-ai.com` remote). |
| `--web-url <url>` | Full React board URL used for the "Open in board" deep-link (defaults: `http://localhost:5173` local, `https://board.sethlans-ai.com` remote). |
| `--port <n>` | Preview port (default `9955` embedded, `9966` local/remote — different from `9955` to avoid clashing with the Dockerized backend). |
| `--token <t>` | `SETHLANS_SERVICE_API_TOKEN` shared token. Never logged. |
| `--write-token` | Actually writes the token in plaintext into `launch.json` (default: not written — pass it as a runtime env var instead). |

What it does:
1. Copies the bundled preview artifact into `.sethlans/board-preview/` in the current repo root
   (git-ignored, idempotent — safe to re-run).
2. Read-merge-writes `.claude/launch.json`: replaces **only** the `sethlans-board-preview` entry,
   preserving any other entries already in the file. If the file exists but is **not valid JSON**,
   it is left untouched and the command exits non-zero with manual-fix instructions — it never
   overwrites unreadable config.
3. Appends `.sethlans/` (and, if `--write-token` was used, `.claude/launch.json`) to the repo's
   `.gitignore`, idempotently.

This logic lives in `lib/preview.js`; the artifact bundling is done at `prepack` time by
`scripts/bundle-preview.js` (see "How the preview bundle works" below).

### Code intelligence — automatic, global

Code intelligence for the subagents is configured **automatically** by the package's `postinstall`
script (`scripts/postinstall.js`), which runs whenever you `npm install -g sethlans` (or upgrade).
No manual per-workspace step is needed. It is idempotent (safe to re-run) and never fails the
install — any problem is reported as a warning with manual remediation instructions.

The script:
- detects and installs `agent-lsp` (`npm i -g @blackwell-systems/agent-lsp`) if missing;
- detects and installs `serena` via `uv tool install -p 3.13 serena-agent` if missing (skips with
  a warning if `uv` itself is not installed — see https://docs.astral.sh/uv/);
- detects and installs the LSP backends used by `agent-lsp`: `python-lsp-server` (pylsp) via `pip`,
  and `typescript`/`typescript-language-server` via npm;
- checks for `jdtls` + a JDK 21 `JAVA_HOME` for Java support — this one is **not** auto-installed
  (too heavyweight); if missing it prints manual setup instructions and continues;
- writes/merges the `agent-lsp` and `serena` MCP entries into the **global**
  `~/.claude/.mcp.json` (creating the file/dir if needed), preserving any other servers already
  configured there (e.g. `sethlans-board`).

| MCP entry | Used by | Purpose |
|---|---|---|
| `agent-lsp` | seth-architect, seth-reviewer | Full LSP analysis (diagnostics, references, symbol navigation) |
| `serena` | seth-be-java, seth-be-python, seth-frontend, seth-fullstack | Token-efficient semantic navigation (find symbol, references, declarations) |

To re-run the postinstall step manually at any time (e.g. after installing a missing prerequisite):
```bash
node <sethlans-package-path>/scripts/postinstall.js
```

Restart Claude Code (or reload MCP servers) after it runs.

### Code intelligence — interactive (Full / Custom, Java support)

`agent-lsp` is a multiplexer, not a language server: it spawns the real per-language backend
(`pylsp`, `typescript-language-server`, `jdtls`) by file extension, so each backend must be
resolvable for that language to actually work through `agent-lsp`. Run the wizard for an
interactive choice:

```bash
sethlans setup --update
```

**Step 5 — Code intelligence (LSP)** offers:
- **Full** — installs/verifies Python + TypeScript + Java backends.
- **Custom** — choose languages one at a time.

Selecting Java additionally lets you:
- point at an existing **JDK 21** by its `JAVA_HOME` path (validated with `java -version` before
  being saved — written as `env.JAVA_HOME` on the `agent-lsp` MCP entry, so no system-wide
  environment variable is required), or
- let the wizard **download `jdtls`** into `~/.claude/tools/jdtls` (extracted via the system
  `tar`, present on Windows 10+/macOS/Linux) and wire its absolute launcher path directly into
  `agent-lsp`'s `java:` argument — the system `PATH` is never modified.

This logic lives in `lib/lsp.js`, shared with `postinstall.js` so both the automatic and the
interactive path install the same backends the same way.

## Package contents

```
sethlans/
  bin/
    cli.js          # entry point: routes sethlans subcommands
  lib/
    setup.js        # interactive wizard logic
    board.js        # `sethlans board up` — docker compose wizard (SQLite/Postgres)
    docker.js       # docker compose bring-up/down + host.docker.internal translation, shared by setup.js and board.js
    preview.js       # `sethlans preview init` — bundles the preview into the user repo,
                     # writes/merges .claude/launch.json idempotently
    copy-plugin.js  # copies claude-plugin/ → ~/.claude/; reads/writes sethlans-config.json
    lsp.js          # agent-lsp/serena/pylsp/typescript-language-server/jdtls installers +
                     # ~/.claude/.mcp.json writer — shared by postinstall.js and setup.js
    prompts.js      # readline-based ask() and menu() helpers (no external deps)
  scripts/
    postinstall.js  # runs on `npm install -g sethlans`: installs agent-lsp/serena + the
                     # lightweight LSP backends (jdtls always left manual, no TTY here)
    bundle-plugin.js# prepack: copies ../sethlans-claude-plugin → ./claude-plugin/
    bundle-preview.js# prepack: copies ../sethlans-board-preview → ./board-preview/
                     # (excludes node_modules/ and data/ — no embedded DB shipped)
  claude-plugin/    # GENERATED at pack time — not in git; source is ../sethlans-claude-plugin/
  board-preview/    # GENERATED at pack time — not in git; source is ../sethlans-board-preview/
  test/
    preview.test.mjs        # mergeLaunchJson / deriveEnvAndPort / buildLaunchEntry unit tests
    bundle-preview.test.mjs # bundling exclusion-filter unit tests
```

## How the plugin bundle works

`packages/sethlans-claude-plugin/` is the source of truth for all skills, agents, and protocol
files. At `npm pack` time the `prepack` script copies it into `claude-plugin/` inside this package,
making the npm tarball self-contained. The `claude-plugin/` directory is git-ignored.

`copy-plugin.js` looks for the plugin files in `claude-plugin/` first (published package), then
falls back to `../../sethlans-claude-plugin` (monorepo dev without prepack).

## How the preview bundle works

`packages/sethlans-board-preview/` (a separate, zero-dependency Node.js + SQLite server, see its
own README) is **not** published to npm and is not a dependency of this package — it has to be
packaged at `prepack` time, same pattern as the plugin: `scripts/bundle-preview.js` copies it into
`board-preview/` inside this package, **excluding** `node_modules/` and `data/` (the embedded
`board.db` is dev-only seed data for this monorepo — it must never ship inside the published
package or end up bundled into a user's repo). `board-preview/` is listed in `files` in
`package.json` and is git-ignored, like `claude-plugin/`.

`lib/preview.js`'s `findPreviewRoot()` looks for the artifact in `board-preview/` first (published
package), then falls back to `../../sethlans-board-preview` (monorepo dev without prepack) — same
two-candidate pattern as `copy-plugin.js`'s `findPluginRoot()`.

## Skills installed

After `sethlans setup` the following skills are available in Claude Code:

| Skill | Description |
|---|---|
| `/sethlans` | Orchestrates the full PO → dev pipeline for a given request. |
| `/sethlans-onboard` | Pre-trains the current project: checks `CLAUDE.md`, configures LSPs, collects MCP project references, mirrors profile and knowledge cards onto the board. |
| `/sethlans-healthcheck` | Verifies Sethlans Board is reachable and the workspace LSPs are configured. |

## Requirements

- Node.js 18+
- Claude Code (CLI, desktop, or IDE extension)
- Docker Desktop — to run Sethlans Board locally
- `claude` CLI available in `PATH` (used by the wizard to register MCP servers)
- For full code intelligence: `uv` (https://docs.astral.sh/uv/) so the postinstall can install
  `serena`; for Java support, either a JDK 21 + `jdtls` already on `PATH`, or just `tar` on `PATH`
  so `sethlans setup --update` can download `jdtls` for you (Java is never auto-installed by
  `npm install`)
