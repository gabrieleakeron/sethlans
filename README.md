# Sethlans

**Sethlans** (the Etruscan god of fire and the forge) is a **subagent orchestration** system for
Claude Code: starting from a request (Jira key, Confluence link, or free-form description) it
coordinates the **PO → UX → architect → dev → review/test** workflow, delegating each phase to a
specialized subagent. Progress is made visible in real time on **Sethlans Board**, the board that
serves as the system's visual component.

```
                          /sethlans  (orchestrator)
                               │
   seth-product-owner → seth-ux-designer → seth-architect → dev (fe / be / fullstack) → seth-reviewer / seth-tester
                               │
                               ▼
                Sethlans Board  (board: epics · stories · tasks · agents)
```

## The components

| Component | What it is | Where |
|---|---|---|
| **`/sethlans`** | Orchestrator skill: request ingest and phase coordination. | [`packages/sethlans-claude-plugin/commands/sethlans.md`](packages/sethlans-claude-plugin/commands/sethlans.md) |
| **`/sethlans-onboard`** | Pre-training skill: configures the project (CLAUDE.md, LSP, MCP references, board profile + knowledge cards). | [`packages/sethlans-claude-plugin/commands/sethlans-onboard.md`](packages/sethlans-claude-plugin/commands/sethlans-onboard.md) |
| **`/sethlans-healthcheck`** | Diagnostic skill: verifies board reachability and workspace LSP status. | [`packages/sethlans-claude-plugin/commands/sethlans-healthcheck.md`](packages/sethlans-claude-plugin/commands/sethlans-healthcheck.md) |
| **Subagents** | 10 generic, reusable agents, all `seth-*`-prefixed (PO, UX, seth-architect, seth-frontend, seth-be-python, seth-be-java, seth-fullstack, seth-devops, seth-reviewer, seth-tester). They read the `CLAUDE.md` of the repo they work on. | [`packages/sethlans-claude-plugin/agents/`](packages/sethlans-claude-plugin/agents) |
| **Protocol** | Integration contract with the board (base URL, data model, enums, recipes): single source of truth. | [`packages/sethlans-claude-plugin/board-protocol.md`](packages/sethlans-claude-plugin/board-protocol.md) |
| **Sethlans Board** | The visual component: board (FastAPI + SQLite/PostgreSQL + React) that renders what the agents are doing. | `packages/sethlans-board/` |
| **Sethlans Board Preview** | Zero-dependency Node.js companion server that renders the board inside Claude Code's Preview pane (Claude Cloud / mobile sessions) — embedded SQLite or proxy to a real backend. Bundled into `sethlans` and set up via `sethlans preview init`. | [`packages/sethlans-board-preview/`](packages/sethlans-board-preview) |
| **`sethlans` npm package** | CLI that installs the toolkit globally and configures MCPs interactively. | [`packages/sethlans/`](packages/sethlans) |

Skills, subagents, and protocol are **global** Claude Code configuration (they live in `~/.claude/`);
Sethlans Board is a standalone **app** updated via HTTP. Board updates are **best-effort and never
blocking**: if the board does not respond, development proceeds all the same.

## Getting started

### 1. Install the toolkit

Download the latest `.tgz` from [GitHub Releases](https://github.com/GabrieleConsonni/sethlans/releases) and install:

```bash
npm install -g https://github.com/GabrieleConsonni/sethlans/releases/latest/download/sethlans-latest.tgz
```

Then run the interactive setup wizard:

```bash
sethlans setup
```

The wizard:
1. Copies the skills, agents, and protocol into `~/.claude/`.
2. Registers the `sethlans-board` MCP server (local or remote, SQLite or PostgreSQL).
3. Optionally configures a **ticket MCP** (Atlassian Jira, Linear, GitHub Issues), a **document
   MCP** (Confluence, Notion), and a **code-quality MCP** (CodeScene, SonarQube, Codacy).

Restart Claude Code after the wizard completes.

### 2. Start Sethlans Board (the board)

```bash
docker volume create sethlans-board-data

docker run -d --name sethlans-server \
  -v sethlans-board-data:/data -p 9955:9955 --restart unless-stopped \
  gabrieleconsonni/sethlans-server:latest

docker run -d --name sethlans-board \
  -p 5173:80 --restart unless-stopped \
  gabrieleconsonni/sethlans-board:latest
```

Interface → <http://localhost:5173> · API/docs → <http://localhost:9955/docs>

### 3. Onboard your project

In Claude Code, navigate to your project workspace and run:

```
/sethlans-onboard
```

This checks `CLAUDE.md`, configures LSP-over-MCP, collects per-project MCP references, mirrors
the project profile onto the board, and builds per-role knowledge cards.

### 4. Run the workflow

```
/sethlans NAU-177
/sethlans https://your-org.atlassian.net/wiki/.../analysis-page
/sethlans Add a login page with email + password and a "forgot password" link
```

Full guide: **[Getting Started](https://github.com/GabrieleConsonni/sethlans/wiki/Getting-Started)**

## The workflow in brief

1. **Healthcheck** of Sethlans Board (best-effort).
2. **Product Owner** — ingest & analysis: find/create epic + story, write the `md`, set the `phase`.
3. **UX Designer** — HTML/CSS mockups *(when the story requires UX flows)*.
4. **Architect** — architectural decisions + breakdown into tasks (with `agent_id` per type).
5. **DevOps** *(on-demand)* — prepares the ecosystem (updated repos, infra/services on Docker).
6. **Dev** — the target subagents implement the tasks (parallelizing the independent ones).
7. **Reviewer / Tester** — review of the diff and E2E/UI tests against the acceptance criteria.
8. **State cascade** and final summary.

## Repository structure

```
sethlans/
├── README.md
├── CLAUDE.md                       # project guide for the subagents
├── LICENSE · NOTICE                # Apache 2.0
├── .github/workflows/release.yml   # produces the .tgz asset on every v* tag
└── packages/
    ├── sethlans/                   # npm package: CLI + bundled plugin (npm install -g sethlans)
    │   ├── bin/cli.js              #   sethlans <subcommand>
    │   ├── lib/setup.js            #   interactive setup wizard
    │   ├── lib/copy-plugin.js      #   copies plugin files into ~/.claude/
    │   ├── lib/mcp-providers.js    #   registry of known MCP providers
    │   ├── scripts/postinstall.js  #   postinstall: installs agent-lsp/serena + LSP backends,
    │   │                           #   writes global ~/.claude/.mcp.json
    │   ├── scripts/bundle-plugin.js#   prepack: copies sethlans-claude-plugin → claude-plugin/
    │   └── claude-plugin/          #   GENERATED at pack time, git-ignored
    ├── sethlans-claude-plugin/     # source of truth: skills, agents, protocol, MCP server
    │   ├── plugin.json             #   Claude Code plugin manifest
    │   ├── commands/                #   sethlans.md, sethlans-onboard.md, sethlans-healthcheck.md
    │   ├── agents/                 #   the 10 generic subagents
    │   ├── mcp/server.mjs          #   sethlans-board MCP server (zero-dep stdio wrapper)
    │   ├── board-protocol.md      #   board API contract
    │   ├── code-quality-protocol.md#   optional Code Health MCP wiring
    │   └── scripts/                #   install.ps1 / install.sh (legacy manual installer)
    ├── sethlans-board/
    │   ├── backend/                # FastAPI + SQLAlchemy 2.0 + Alembic
    │   └── frontend/               # React 18 + Vite 5 SPA
    ├── sethlans-board-preview/     # Node.js companion server for Claude Preview (Cloud/mobile);
    │                               #   bundled into packages/sethlans/ at prepack time
    └── sethlans-tools/             # DEPRECATED — superseded by packages/sethlans/
```

> `packages/sethlans/claude-plugin/` is generated by the `prepack` script from
> `packages/sethlans-claude-plugin/`. It is git-ignored. **Edit skills and agents in
> `packages/sethlans-claude-plugin/` only.**

## License

Distributed under the **Apache 2.0** license — see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
