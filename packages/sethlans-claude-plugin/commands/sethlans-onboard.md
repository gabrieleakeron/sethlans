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

## 0-C. Integration MCPs (tickets · docs · code quality) — global servers, per-project references
One rule governs the three integration slots — **tickets**, **docs**, **code quality**:

> **The MCP server + its token live globally** (one per provider, registered `-s user`); **the
> project stores only the *reference*** — which Jira project / Confluence space / repo / Codacy or
> CodeScene project to act on.

A token is a **machine/user credential reused across every repo** — never project-scoped, and
**never written into a config file as a literal value**. The golden rule (see
`~/.claude/code-quality-protocol.md`): the **user** stores the secret once in an **environment
variable** (`setx VAR "<token>"` on Windows; `export VAR="<token>"` in `~/.zshrc`/`~/.bashrc` on
macOS/Linux), and **you** register the server with the literal placeholder `'${VAR}'` (single-quoted
so the shell doesn't expand it) — Claude Code resolves it from the environment at launch, so the
token never touches disk. This step **populates the global servers on demand** as you onboard
projects, and records the lightweight per-project references. Everything here is **optional,
best-effort, never blocking**: if the user declines a slot, skip it silently — the subagents
degrade gracefully (the reviewer omits Code Health, the PO works from descriptions written on the spot).

**The user only ever supplies three things per slot: the provider, the token (as an env var), and
the project reference.** You do everything else — the user never types `claude mcp add`.

Read `~/.claude/sethlans-config.json` first: `mcps.{ticket,docs,codeQuality}` records the **global
default provider** per slot (this file is updated here, as onboards happen). Run the loop below
**once per slot**.

### Step 1 — confirm the provider for this slot
Default = the global `mcps.<slot>` when set; otherwise ask. Known providers:

| Slot | Known providers |
|---|---|
| ticket | `atlassian` · `linear` · `github` |
| docs | `atlassian` · `notion` · `github-wiki` |
| code quality | `codescene` · `sonarqube` · `codacy` |

`github-wiki` (docs) is the only **non-MCP** provider — for it, skip Step 2 and go straight to
Step 3. The official **Codacy** MCP also runs **local** analysis via its `codacy_cli_analyze` tool,
so no separate "local Codacy" provider is needed.

### Step 2 — ensure the provider's MCP is wired **globally** (`-s user`)
Check whether the provider's `mcp__<server>__*` tools are loaded — i.e. it is registered at **user
scope** in `~/.claude.json`. There is **only one scope to check**: global.

- **Already wired** → nothing to do (the env var is already set, shared by every repo).
- **`github-wiki`** (docs) → no MCP, no token; skip to Step 3.
- **Not wired** → run the **turnkey token walk-through**, never `claude mcp add` typed by the user:
  1. Find the provider's row in the catalog below to get its **env var** and **token-creation path**.
  2. Tell the user *exactly* where to create the token (the "create token" column), then print the
     **one command they run** to store it — Windows `setx <VAR> "<token>"`, macOS/Linux
     `export <VAR>="<token>"` appended to their shell profile. Wait for them to confirm it's set.
  3. **You** then register the server `-s user` with the **literal placeholder** `'${VAR}'`
     (single-quoted) — **never `--scope project`**, **never hand-edit `~/.claude.json`**, **never
     inline the token value**. Non-secret bits (instance URL, email) may be inline on `-e`.
  4. **Record the global default** under `mcps.<slot>` in `~/.claude/sethlans-config.json`, and tell
     the user to **restart Claude Code and their terminal** so the new env var resolves and the
     tools load.

  **Provider catalog** (env var · where the user creates the token · the command *you* run):

  | Provider | Slot(s) | Env var the user `setx`/`export`s | Where to create the token | Registration you run |
  |---|---|---|---|---|
  | **atlassian** | ticket + docs | `ATLASSIAN_API_TOKEN` | id.atlassian.com → **Security** → **API tokens** → **Create** | `claude mcp add atlassian -s user -e ATLASSIAN_BASE_URL=<url> -e ATLASSIAN_EMAIL=<email> -e ATLASSIAN_API_TOKEN='${ATLASSIAN_API_TOKEN}' -- npx -y @atlassian/mcp@latest` |
  | **github** | ticket | `GITHUB_TOKEN` | github.com → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained** → **Generate** (grant on the target repos: Contents RO, Pull requests RW, Issues RW, Metadata RO) | `claude mcp add github -s user -e GITHUB_PERSONAL_ACCESS_TOKEN='${GITHUB_TOKEN}' -- docker run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN ghcr.io/github/github-mcp-server` |
  | **linear** | ticket | `LINEAR_API_KEY` | linear.app → **Settings** → **Security & access** → **Personal API keys** → **New key** | `claude mcp add linear -s user -e LINEAR_API_KEY='${LINEAR_API_KEY}' -- npx -y @linear/mcp@latest` |
  | **notion** | docs | `NOTION_API_TOKEN` | notion.so/my-integrations → **New integration** → copy the secret | `claude mcp add notion -s user -e NOTION_API_TOKEN='${NOTION_API_TOKEN}' -- npx -y @modelcontextprotocol/server-notion@latest` |
  | **codacy** | code quality | `CODACY_ACCOUNT_TOKEN` | Codacy → **Account** → **Access Management** → **Create API token** | `claude mcp add codacy -s user -e CODACY_ACCOUNT_TOKEN='${CODACY_ACCOUNT_TOKEN}' -- npx -y @codacy/codacy-mcp@latest` |
  | **codescene** | code quality | `CS_ACCESS_TOKEN` (+ `CS_ONPREM_URL` on-prem) | Cloud → **codescene.io/users/me/pat** · on-prem → `https://<host>/configuration/user/token` | **Token/URL only here** (global env vars). CodeScene's MCP runs in Docker and must **bind-mount the project tree**, so the *server* is registered **per-workspace in Step 3** at `-s local`, **not** `-s user`. See `~/.claude/code-quality-protocol.md` → *CodeScene runs in Docker*. |
  | **sonarqube** | code quality | `SONARQUBE_TOKEN` | Sonar → **My Account** → **Security** → **Generate Tokens** | `claude mcp add sonarqube -s user -e SONARQUBE_URL=<url> -e SONARQUBE_TOKEN='${SONARQUBE_TOKEN}' -- <sonar-mcp-launch-command>` |

  > **GitHub env-var mapping:** the user stores the de-facto-standard `GITHUB_TOKEN`, but the
  > official `github-mcp-server` reads `GITHUB_PERSONAL_ACCESS_TOKEN` — hence the registration maps
  > one to the other (`-e GITHUB_PERSONAL_ACCESS_TOKEN='${GITHUB_TOKEN}'`). The old
  > `@modelcontextprotocol/server-github` npm package is archived; use the `ghcr.io` image above.

  > **CodeScene is the exception to "wire globally `-s user`".** Its MCP runs in a Docker
  > container that must **bind-mount the project tree** (`--mount` + `CS_MOUNT_PATH`) — a path that
  > is per-workspace. So here you only ensure the **global env vars** are set (`CS_ACCESS_TOKEN`,
  > plus `CS_ONPREM_URL` for on-prem); the **server itself is registered in Step 3** at `-s local`
  > with the mount. Never register codescene `-s user` — one global path can't serve every repo.

  The full code-quality catalog (CodeScene/SonarQube/Codacy, plus Codacy's `codacy_cli_analyze`
  local analysis — needs **WSL** on Windows) lives in `~/.claude/code-quality-protocol.md`.

### Step 3 — record the per-project reference (no token, no server)
Ask **only** for the slot's reference and save it into `.claude/project-profile.yaml` under `slots`
(plus the per-role pointer that flows into the board in step 2):
- **ticket** → `slots.ticket = { provider, project: <Jira key / GitHub Project / Linear team>, repo: <owner>/<repo> }`,
  mirrored to `roles.seth-product-owner.ticket`. Legacy flat key `roles.seth-product-owner.jira_project`
  stays valid as the `provider: atlassian` shorthand.
- **docs** → `slots.docs = { provider, space|url }` — **or**, for `github-wiki`,
  `{ provider: github-wiki, wiki_repo: <url>, local_path: <optional> }` (a `<repo>.wiki.git` git
  repo, no MCP). Mirror to `roles.seth-product-owner.docs` **and** `roles.seth-architect.docs`.
  Legacy `docs_space` stays valid.
- **code quality** → `slots.codeQuality = { provider, project: <repo on the MCP> }`, mirrored to
  `roles.seth-reviewer.codeQuality`. Legacy `codeQuality_project` stays valid.
  - **codescene only** — also **register the Docker MCP for this workspace** (it can't be global,
    it needs a bind-mount). Decide the mount **root**: the **common parent of this project's repos**
    (from the workspace layout in step 2) so a single container covers a multi-repo workspace; if the
    repos live under unrelated roots, register one server per repo (`codescene-<repo>`) instead.
    Skip if a `codescene` server is already registered for this workspace with the right mount.
    Use forward slashes and run (Cloud → drop both `CS_ONPREM_URL` lines):
    ```bash
    claude mcp add codescene -s local \
      -e CS_ACCESS_TOKEN='${CS_ACCESS_TOKEN}' \
      -e CS_ONPREM_URL='${CS_ONPREM_URL}' \
      -- docker run -i --rm \
         -e CS_ACCESS_TOKEN -e CS_ONPREM_URL \
         -e CS_MOUNT_PATH=<root> \
         --mount type=bind,src=<root>,dst=/mount/,ro \
         codescene/codescene-mcp
    ```
    Record the chosen root in `slots.codeQuality.mount_root` (and, for the multi-container case, the
    per-repo server names) so `/sethlans-healthcheck` can verify it. `CS_ACCESS_TOKEN`/`CS_ONPREM_URL`
    stay global env vars; `-s local` keeps the machine-specific path out of any committed file.

These per-role pointers flow into the board's `project.config` in step 2 — this is how they reach
the subagents.

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
