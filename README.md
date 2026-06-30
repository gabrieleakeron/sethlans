# Sethlans

**Sethlans** is a **subagent orchestration** system for
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
## Getting started

### 1. Install the toolkit

Download the latest `.tgz` from [GitHub Releases](https://github.com/gabrieleakeron/sethlans/releases) and install:

```bash
npm install -g https://github.com/gabrieleakeron/sethlans/releases/latest/download/sethlans-latest.tgz
```

Then run the interactive setup wizard:

```bash
sethlans setup
```

The wizard:
1. Copies the skills, agents, and protocol into `~/.claude/`.
2. Install the `sethlans-board` : Local (Docker, SQLite/PostgreSQL) or remote URL.
3. Registers the `sethlans-board` MCP server .
4. Optionally configures a **ticket MCP** (Atlassian Jira, Linear, GitHub Issues), a **document
   MCP** (Confluence, Notion), and a **code-quality MCP** (CodeScene, SonarQube, Codacy).

Restart Claude Code after the wizard completes.

### 2. Onboard your project

In Claude Code, navigate to your project workspace and run:

```
/sethlans-onboard
```

This checks `CLAUDE.md`, configures LSP-over-MCP, collects per-project MCP references, mirrors
the project profile onto the board, and builds per-role knowledge cards.

### 3. Run the workflow

```
/sethlans NAU-177
/sethlans https://your-org.atlassian.net/wiki/.../analysis-page
/sethlans Add a login page with email + password and a "forgot password" link
```

Full guide: **[Getting Started](https://github.com/gabrieleakeron/sethlans/wiki/Getting-Started)**

## The workflow in brief

1. **Healthcheck** of Sethlans Board (best-effort).
2. **Product Owner** — ingest & analysis: find/create epic + story, write the `md`, set the `phase`.
3. **UX Designer** — HTML/CSS mockups *(when the story requires UX flows)*.
4. **Architect** — architectural decisions + breakdown into tasks (with `agent_id` per type).
5. **DevOps** *(on-demand)* — prepares the ecosystem (updated repos, infra/services on Docker).
6. **Dev** — the target subagents implement the tasks (parallelizing the independent ones).
7. **Reviewer / Tester** — review of the diff and E2E/UI tests against the acceptance criteria.
8. **State cascade** and final summary.

## Wiki pages

**[Getting Started](https://github.com/gabrieleakeron/sethlans/wiki/Getting-Started)**

## License

Distributed under the **Apache 2.0** license — see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
