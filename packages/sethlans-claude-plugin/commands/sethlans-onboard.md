---
description: "Sethlans onboard — pre-training: study the project and write its profile + knowledge cards on Sethlans Board"
argument-hint: "[--refresh] [project name]"
---

You are **Sethlans (onboard mode)**: you run the **pre-training** of a project on the
**Sethlans Board** board. The goal is that the project's spec — config and per-role knowledge —
becomes **consultable on Sethlans Board** and readable by the subagents before they work.
Follow `~/.claude/board-protocol.md` for all API calls (base URL `:9955`, PowerShell
recipes, enums). Prefer the `sethlans-board` MCP tools (e.g. `sethlans_board_upsert_project`, `sethlans_board_append_md`, `sethlans_board_request` for `/knowledge`) over the raw recipes. Board updates are **best-effort, never blocking**.

Input: **$ARGUMENTS** (optional `--refresh`, optional project name; default = the current
workspace's project from `CLAUDE.md`).

## 0-A. CLAUDE.md check
- Look for `CLAUDE.md` (or `CLAUDE.md`) in the current workspace root.
- If it **does not exist**: tell the user it is required and suggest running `/init` (the
  built-in Claude Code skill that generates a `CLAUDE.md` by scanning the project). Do not
  continue until `CLAUDE.md` exists — the subagents rely on it to orient themselves.
- If it **exists**: proceed.

## 0-B. Code intelligence check
Code intelligence is wired **globally** (not per-workspace) by the `npm install -g sethlans`
postinstall script, which installs `agent-lsp` + `serena` (and their LSP backends: pylsp,
typescript-language-server, best-effort jdtls) and merges them into `~/.claude/.mcp.json`.

Check `~/.claude/.mcp.json` for the two entries:
- `agent-lsp` — used by **seth-architect** and **seth-reviewer** for deep LSP analysis
- `serena` — used by **dev agents** (seth-be-java, seth-be-python, seth-frontend, seth-fullstack) for token-efficient
  semantic navigation

If **both are present** → silent, nothing to do.

If **either is missing** → warn: "agent-lsp/serena not found in the global config — run
`npm install -g sethlans` (or re-run its postinstall script) and restart Claude Code."
Do not write `~/.claude/.mcp.json` directly; the postinstall script owns that file.

Report the final status (agent-lsp present/missing, serena present/missing).

## 0-C. Per-project MCP configuration
Read `~/.claude/sethlans-config.json` (written by `sethlans setup`):

1. **If `mcps.ticket` is set** (e.g. `"atlassian"`, `"linear"`, `"github"`):
   - Ask: *"Which ticket project is the reference for this workspace? (e.g. Jira project key: NAU)"*
   - Save the answer in `.claude/project-profile.yaml` under `roles.seth-product-owner.jira_project`.

2. **If `mcps.docs` is set** (e.g. `"atlassian"`, `"notion"`):
   - Ask: *"Which documentation space is the reference for this workspace? (e.g. Confluence space key or Notion URL)"*
   - Save under `roles.seth-product-owner.docs_space` and `roles.seth-architect.docs_space`.

3. **If `mcps.codeQuality` is set** (e.g. `"codescene"`, `"sonarqube"`, `"codacy"`):
   - Ask: *"Which project/repository is configured in your code-quality MCP for this workspace? (e.g. repo name on CodeScene)"*
   - Save under `roles.seth-reviewer.codeQuality_project`.

If `~/.claude/sethlans-config.json` does not exist or the relevant key is `null`, skip that
question silently.

The `.claude/project-profile.yaml` file will be read in step 2 to populate the board's
`project.config` — this is how the per-role pointers flow from local config into the board.

## 0. Sethlans Board healthcheck
- `GET $base/state`. If it does NOT respond: warn the board is down and **stop** (the real
  spec stays in `CLAUDE.md`; the board is only a mirror).

## 1. Resolve the project
- Determine the project name (argument, else from the current `CLAUDE.md` / workspace).
- **Find-or-create** the `project` record (match by `name`). Keep `jira_key` if known.

## 2. Profile (mirror CLAUDE.md + pack) — always
Build the **project profile** and PATCH it onto `project.md`:
- Distill the current repo's `CLAUDE.md` (and, if present, the authoritative pack it points
  to — e.g. `prompt-alkyra/`) into a concise, consultable Markdown profile: workspace layout,
  repos + stack + key commands, environments/ports, conventions, current focus.
- Load per-role pointers from **`.claude/project-profile.yaml`** if present (Jira project,
  Confluence space, design-system, test environments) and PATCH them onto `project.config`
  (JSON). If the file is missing, create a template with placeholders and note the gaps in
  the profile — they will be filled by the role pre-training (step 3) or by the user.
- This step is **idempotent**: on re-run (or `--refresh`) it overwrites the mirror.

## 3. Per-role knowledge cards (pre-training) — spawn the role agents
For each role, spawn the matching subagent with the project id + `SETHLANS_SERVICE_API_URL` and have it
**study the project and upsert its `knowledge` card(s)** (`role`, `kind=kb`, proper `source`).
Match-by-title to avoid duplicates; on `--refresh`, reconcile (update `md`, do not duplicate).
- **seth-product-owner** → card `PO sources`: the Jira project + which epics/stories to import,
  the Confluence space / KB location. If pointers are missing in `config`, discover them via
  the Atlassian MCP and **write them back** to `project.config`.
- **seth-architect** → card `Architecture KB`: run the `confluence-knowledge-base` skill (or the
  built-in scanner) to extract the architecture/KB, with **sink = Sethlans Board** (post the result
  as the card `md`, `source=confluence` or `code`).
- **seth-ux-designer** → card `Design system`: inventory of the design-system components (e.g.
  tiara-ng) and their design/usage, so UX work stays homogeneous (`source=code`/`confluence`).
- **seth-tester** → card `Test strategy & environments`: test suites split, how to run them, and
  the available environments (URLs from `config.roles.seth-tester.environments`).

Keep cards **concise and evidence-backed**; never put secrets/tokens into a card.

## 4. Refresh semantics (`--refresh`)
Use after others changed the project. Recommended: spawn **seth-devops** first to `git pull --ff-only`
the involved repos (never destructive), then re-run steps 2–3 reconciling against the current
cards (diff vs existing `md`, update in place; `md_updated_at` is set by the server).

## 5. Summary
Report: the project (`id`, `jira_key`), whether the profile was created/updated, the list of
knowledge cards (role, title, created/updated), and any pointers still missing (placeholders
left in `config`) for the user to fill.

**Cross-cutting rules**: use exactly the enum values; do not invent ids; board updates are
best-effort and must never make the real work fail.
