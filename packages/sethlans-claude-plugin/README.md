# sethlans-claude-plugin

**Source of truth** for the Sethlans Claude Code plugin: the `/sethlans` orchestrator skill, the
10 generic subagents, the Sethlans Board MCP server, and the board integration protocol.

> This package is **distributed via the `sethlans` npm package** — install with:
> ```bash
> npm install -g <tgz-from-github-release>
> sethlans setup
> ```
> The `prepack` script in `packages/sethlans/` bundles this directory into `claude-plugin/` inside
> the npm package automatically. **Edit files here, not in `packages/sethlans/claude-plugin/`.**

```
sethlans-claude-plugin/
  plugin.json               # Claude Code plugin manifest
  commands/
    sethlans.md             # /sethlans — orchestrator
    sethlans-onboard.md     # /sethlans-onboard — project pre-training
    sethlans-healthcheck.md # /sethlans-healthcheck — board + LSP diagnostic
    sethlans-design.md      # /sethlans-design — code scan -> DesignSystem artifact on the board
  agents/                   # the 10 generic subagents (one .md each), all `seth-*`-prefixed
    seth-architect.md
    seth-be-java.md
    seth-be-python.md
    seth-devops.md
    seth-frontend.md
    seth-fullstack.md
    seth-product-owner.md
    seth-reviewer.md
    seth-tester.md
    seth-ux-designer.md
  mcp/
    server.mjs              # sethlans-board MCP server (zero-dep stdio wrapper over REST API)
  board-protocol.md        # board API contract — single source of truth for all board calls
  code-quality-protocol.md  # optional Code Health MCP wiring (CodeScene / SonarQube / Codacy)
  scripts/
    install.ps1             # legacy manual installer (Windows/PowerShell)
    install.sh              # legacy manual installer (macOS/Linux)
  README.md                 # this file
```

## Skills

| Skill | Trigger | What it does |
|---|---|---|
| `/sethlans` | `/sethlans <Jira key \| Confluence link \| description>` | Orchestrates the full PO → UX → architect → dev → review/test pipeline. |
| `/sethlans-onboard` | `/sethlans-onboard [--refresh]` | Pre-trains the project: checks `CLAUDE.md`, configures code-intelligence MCPs (`agent-lsp` + `serena`), asks for per-project MCP references (Jira project, Confluence space, code-quality project), mirrors profile and knowledge cards onto the board. |
| `/sethlans-healthcheck` | `/sethlans-healthcheck` | Verifies that Sethlans Board is reachable and that the workspace has `agent-lsp` and `serena` configured in `.mcp.json`. Read-only, no side effects. |
| `/sethlans-design` | `/sethlans-design [--refresh]` | Scans the project's stylesheets for design tokens (CSS custom properties, typography/spacing/radius scale — L1, mandatory) and a recurring-component inventory (L2, best-effort), then upserts a `DesignSystem` artifact for the project on Sethlans Board (`POST /design-systems`, idempotent by `project_id`). Optionally pushes to Penpot if `SETHLANS_DESIGN_PENPOT_URL`/`SETHLANS_DESIGN_PENPOT_TOKEN` are set (push-only, code/Board remain the source of truth); without them it stays `sync_state=local` and never fails. Consumed by `seth-ux-designer`/`seth-frontend` as their design reference. |

## Subagents

| Agent | Canonical name | Role |
|---|---|---|
| Product Owner | `seth-product-owner` | Request ingest, analysis, epic/story management. |
| UX Designer | `seth-ux-designer` | HTML/CSS mockups for UX flows. |
| Architect | `seth-architect` | Architectural decisions, task breakdown. |
| Frontend | `seth-frontend` | Angular dev (standalone components, signals, RxJS, DevExtreme). |
| Backend Python | `seth-be-python` | FastAPI, Polars, Alembic, pytest. |
| Backend Java | `seth-be-java` | Spring Boot, Hibernate/JPA, Maven, JUnit 5. |
| Fullstack | `seth-fullstack` | Cross-repo FE + BE slices. |
| DevOps | `seth-devops` | Repo updates, Docker infra/services. |
| Reviewer | `seth-reviewer` | Code review + optional Code Health via code-quality MCP. |
| Tester | `seth-tester` | E2E/UI/API tests. |

## MCP server (`mcp/server.mjs`)

A zero-dependency stdio MCP server that wraps the Sethlans Board REST API with typed,
enum-validated tools. Registered automatically by `sethlans setup` (or by the Claude Code plugin
system). Reads `SETHLANS_SERVICE_API_URL` (default `http://localhost:9955`). If the
board is behind Cloudflare Access, also set `SETHLANS_SERVICE_CF_ACCESS_CLIENT_ID` /
`SETHLANS_SERVICE_CF_ACCESS_CLIENT_SECRET` (Zero Trust → Access → Service Auth →
Service Tokens) to authenticate every request via Service Token.

Tools exposed: `sethlans_board_get_state`, `sethlans_board_upsert_project`,
`sethlans_board_upsert_epic`, `sethlans_board_upsert_story`, `sethlans_board_create_task`,
`sethlans_board_set_status`, `sethlans_board_get_or_register_agent`,
`sethlans_board_add_agent_tokens`, `sethlans_board_append_md`, `sethlans_board_request`.

## `/sethlans-design` environment variables (optional)

| Variable | Required | Notes |
|---|---|---|
| `SETHLANS_DESIGN_PENPOT_URL` | No | Penpot instance base URL. If unset (default), `/sethlans-design` skips the Penpot push entirely and leaves `sync_state=local` — never a failure. |
| `SETHLANS_DESIGN_PENPOT_TOKEN` | No | Penpot API token, read at runtime only, never logged or written into the generated `md`. |

Both must be set together to attempt a push. The Penpot push is currently a **placeholder**
(reachability check + `sync_state` bookkeeping) — see `commands/sethlans-design.md` §6 for the
exact scope until the full Penpot API integration is implemented.

## Board protocol

`board-protocol.md` is the **single source of truth** for all calls to Sethlans Board: base URL,
data model, status/phase enums, task-type→agent map, and HTTP recipes. Skill and agents reference
it instead of duplicating the calls.

## Code intelligence MCPs

Two MCPs provide code intelligence to the agents, configured automatically and globally (one
`~/.claude/.mcp.json` for all workspaces) by the `npm install -g sethlans` postinstall — no
manual per-workspace step:

| MCP | Used by | What it provides |
|---|---|---|
| `agent-lsp` ([blackwell-systems/agent-lsp](https://github.com/blackwell-systems/agent-lsp)) | seth-architect, seth-reviewer | Full LSP: diagnostics, find-references, blast-radius, hover, rename |
| `serena` ([oraios/serena](https://github.com/oraios/serena)) | seth-be-java, seth-be-python, seth-frontend, seth-fullstack | Semantic navigation: find-symbol, find-referencing-symbols, declarations, implementations |

Both are best-effort: if unavailable the agent falls back to reading files directly.

## Optional: code-quality MCP

The `seth-reviewer` can also consume a code-quality MCP (CodeScene, SonarQube, Codacy) for its Code
Health section. Configure it during `sethlans setup`'s code-quality MCP step or manually with
`claude mcp add`. Wiring templates are in `code-quality-protocol.md`. Without it the seth-reviewer
simply omits the section.

## Legacy manual install

The `scripts/` directory contains `install.ps1` (Windows) and `install.sh` (macOS/Linux) for
copying files directly into `~/.claude/`. These are kept for environments where npm is not
available. Prefer the npm package for new installs.
