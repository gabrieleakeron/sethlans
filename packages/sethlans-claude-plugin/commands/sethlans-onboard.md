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

## 0-C. Per-project integration MCPs (tickets · docs · code quality)
The three integration slots — **tickets**, **docs**, **code quality** — are configured **per
project**, and the provider for a slot may differ from the global default. The global
`~/.claude/sethlans-config.json` (`mcps.{ticket,docs,codeQuality}`, written by `sethlans setup`)
only supplies the **default suggestion**; this step lets the user pick a per-project provider,
**wire** the MCP-based ones scoped to the project, and **record** the non-MCP ones as pointers the
subagents act on. Everything here is **optional, best-effort, never blocking**: if the user
declines a slot, skip it silently — the subagents degrade gracefully (the reviewer omits Code
Health, the PO works from descriptions written on the spot).

Run the loop below **once per slot**. Read `~/.claude/sethlans-config.json` first (if present) to
seed the default provider per slot; if it is missing or the key is `null`, just ask directly.

### Step 1 — choose the provider for this project
Show the slot's known providers (default = the global `mcps.<slot>` when set) and let the user pick
or confirm. Record the choice under `mcps.<slot>` in `.claude/project-profile.yaml` (this is the
per-project override of the global default):

| Slot | Known providers |
|---|---|
| ticket | `atlassian` · `linear` · `github` |
| docs | `atlassian` · `notion` · `github-wiki` |
| code quality | `codescene` · `sonarqube` · `codacy` |

All code-quality providers (incl. **`codacy`**) are MCP servers (Step 2a). The official **Codacy**
MCP also runs **local** analysis through its `codacy_cli_analyze` tool — so a separate "local
Codacy" provider is **not** needed; pick `codacy`. The only **non-MCP** provider is **`github-wiki`**
(docs, Step 2b).

### Step 2a — MCP-based provider → resolve, then offer to wire
For `atlassian` / `linear` / `github` / `notion` / `codescene` / `sonarqube` / `codacy`:
- **Resolve** whether the server's `mcp__<server>__*` tools are already wired, in the order used by
  `~/.claude/commands/sethlans-healthcheck.md` §3: project `./.mcp.json` → the active project's
  block in `~/.claude.json` → the global block (fallback). If it resolves only globally, note it
  is *global-only* (not scoped to this project).
- If it is **not wired at project scope**, ask: *"Wire `<provider>` for this project now? [y/n]"*.
  On yes, register it **project-scoped** with `claude mcp add --scope project …` — never by
  hand-editing `~/.claude.json`. Use the recipes already documented in
  `~/.claude/code-quality-protocol.md` (code-quality vendors) and
  `~/.claude/commands/sethlans-healthcheck.md` §3a (Atlassian http transport). For **GitHub**, use
  the recipe consistent with the `sethlans setup` registry
  (`claude mcp add --scope project github -e GITHUB_TOKEN=<token> -- npx -y @modelcontextprotocol/server-github@latest`).
  For **Codacy**, use the official MCP
  (`claude mcp add --scope project codacy -e CODACY_ACCOUNT_TOKEN=<token> -- npx -y @codacy/codacy-mcp@latest`);
  its `codacy_cli_analyze` tool does local analysis (the account token is required even for that,
  and on **Windows** the local path needs **WSL**). Pass URLs/tokens via **env vars only — never
  hardcode secrets**.
- Then ask: *"Also add `<provider>` to the global config (available in every project)? [y/n]"* — on
  yes, register it again with `-s user`. Remind the user to restart Claude Code (or reload MCP
  servers) so the new tools load.

### Step 2b — non-MCP provider → record the pointer (no `claude mcp add`)
- **`github-wiki`** (docs): the project's GitHub wiki is a git repo (`<repo>.wiki.git`), not an
  MCP. Ask for the wiki repo URL (and, optionally, a local clone path). Record under
  `roles.seth-product-owner.docs` and `roles.seth-architect.docs` as
  `{ provider: github-wiki, wiki_repo: <url>, local_path: <optional> }`.

### Step 3 — record the per-role pointer
Ask the slot's identifier and save it into `.claude/project-profile.yaml`:
- **ticket** → `roles.seth-product-owner.ticket` = `{ provider, repo: <owner>/<repo>, project: <GitHub Project name / Jira key / Linear team> }`.
  *(GitHub example: `repo: <owner>/sethlans`, `project: sethlans-project`.)* The legacy flat key
  `roles.seth-product-owner.jira_project` stays valid as the `provider: atlassian` shorthand.
- **docs** → `roles.seth-product-owner.docs` **and** `roles.seth-architect.docs` (Confluence space,
  Notion URL, or the `github-wiki` block from Step 2b). Legacy `docs_space` stays valid.
- **code quality** → `roles.seth-reviewer.codeQuality` = `{ provider, project: <repo on the MCP> }`
  (for Codacy, the repo as configured on the account; local runs go through `codacy_cli_analyze`).
  Legacy flat key `codeQuality_project` stays valid.

These per-role pointers flow into the board's `project.config` in step 2 (unchanged mechanism) —
this is how they reach the subagents.

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
