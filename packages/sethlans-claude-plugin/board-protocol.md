# Sethlans Board Protocol — reflecting work state

**Sethlans Board** is the board that visually renders what the workspace
subagents are doing. It is a **FastAPI REST API + SQLite (default) or PostgreSQL** (configurable
via `SETHLANS_SERVICE_DB_URL`, managed with Alembic); the React frontend polls every 4s. Agents
reflect their own state via the **`sethlans-board` MCP server** (preferred) or directly **via
HTTP** (no files to write). Each epic/story/task has a **Markdown document `md`** persisted in
the DB.

This document is the **single source of truth** of the integration: the subagents and
the orchestration command reference it instead of duplicating the recipes.
It is **cross-project**: it lives in the global home (`~/.claude/`) and does not depend
on any specific workspace.

## Guiding principle — best-effort, never blocking
Updating Sethlans Board is **observability**, not part of the real work.
- If the board does not respond (connection refused, timeout, HTTP error), **DO NOT block** the task: proceed with the real work and report in the result that the board update failed.
- Always wrap the calls in `try/catch` (PowerShell) and must not fail the turn over a network error toward the board.

## Preferred path — the `sethlans-board` MCP server
The plugin ships a **stdio MCP server** (`sethlans-board`) that wraps this REST API with typed,
enum-validated tools. **Prefer the MCP tools** over the raw HTTP/PowerShell recipes: they
are **cross-platform** (no shell dependency), encapsulate the find-or-create logic, and
validate enums at the schema. The PowerShell recipes below remain a **fallback** when the
MCP server is unavailable. Same best-effort rule: the tools return a soft error (never throw)
if the board is unreachable — keep working on the real task.

Configuration: the server reads `SETHLANS_SERVICE_API_URL` (default `http://localhost:9955`).

### Optional shared-token auth (`SETHLANS_SERVICE_API_TOKEN`)
When the board is exposed on a network (e.g. Render) it can be protected with an **optional
shared token**, enforced identically by the FastAPI backend and the Node preview (embedded +
proxy):
- **Variable**: `SETHLANS_SERVICE_API_TOKEN`. **Header**: `X-Sethlans-Token: <token>`.
- **Not set** (default): no auth, behaviour unchanged — 100% backward-compatible (local/dev case).
- **Set**: every REST request must carry a matching `X-Sethlans-Token`; missing/wrong → `401`
  with body `{"detail": "token mancante o non valido"}` (generic message, never echoes the
  expected token). Comparison is constant-time (`hmac.compare_digest` / `crypto.timingSafeEqual`).
- **Excluded from the check**: `OPTIONS` requests (CORS preflight has no custom headers) on both
  backends. `/docs`, `/openapi.json`, `/redoc` on FastAPI are **not** excluded (protected like
  everything else when the token is set). Static preview assets are outside the REST surface
  entirely, so they are naturally unaffected.
- **The `sethlans-board` MCP server** sends `X-Sethlans-Token` on every call when
  `SETHLANS_SERVICE_API_TOKEN` is set in its own environment (coexists with CF-Access headers).
  Not set → no header, unchanged.
- **The preview proxy** (proxy mode, upstream FastAPI/Docker) authenticates *itself* to the
  upstream with its own `SETHLANS_SERVICE_API_TOKEN`: when set it injects/overrides
  `X-Sethlans-Token` toward the upstream regardless of what the browser sent; when not set the
  inbound header (if any) passes through unchanged.
- **The token value must match** across every leg that talks to the same board instance:
  preview/BE, MCP/agents, and proxy. There is no token rotation or per-agent token — it is a
  single shared secret set via environment variable on each component.
- No DB migration is involved: this is purely application-level auth (no model/schema change).

| MCP tool | What it does |
|---|---|
| `sethlans_board_get_state` | Snapshot (healthcheck + read). Compact summary by default; `full=true` for the raw `/state`. |
| `sethlans_board_upsert_project` | Find-or-create a project by name; patches `type/jira_key/md`. |
| `sethlans_board_upsert_epic` | Find-or-create an epic by title in a project (`project_id` or `project_name`, the latter created if missing). |
| `sethlans_board_upsert_story` | Find-or-create a story by title under an epic; sets `status/phase/md`. |
| `sethlans_board_create_task` | Create a task under a story; assign by `agent_name` (find-or-register) or `agent_id`. |
| `sethlans_board_set_status` | Set `status` of an epic/story/task (and `phase` for stories). |
| `sethlans_board_get_or_register_agent` | Find-or-register an agent by name; optionally patch `status/current_task/tokens`. |
| `sethlans_board_add_agent_tokens` | Increment an agent's cumulative `tokens` (read-modify-write); optional `task_id` also bumps that task's `tokens` for per-story aggregation. |
| `sethlans_board_append_md` | Append text to the `md` of any entity (read-modify-write). |
| `sethlans_board_request` | Low-level escape hatch: arbitrary REST call (only for cases not covered above). |

Typical flow with the tools: `sethlans_board_upsert_project` → `sethlans_board_upsert_epic` →
`sethlans_board_upsert_story` → `sethlans_board_create_task` (dev) →
`sethlans_board_set_status`/`sethlans_board_append_md` during work →
`sethlans_board_get_or_register_agent` for the agent lifecycle.

## Base URL (raw HTTP / fallback)
- Default: `http://localhost:9955`. Override with the environment variable `SETHLANS_SERVICE_API_URL`.
- Healthcheck: `GET /state` (if it responds 200, the board is reachable).
- If `SETHLANS_SERVICE_API_TOKEN` is set on the target instance, every raw HTTP call (PowerShell
  recipes included) must also send `-Headers @{ "X-Sethlans-Token" = $env:SETHLANS_SERVICE_API_TOKEN }`
  (or the equivalent fetch header), otherwise it gets `401`. See *Optional shared-token auth* above.

## Data model (exact fields)
- **epic**: `id, title, desc, status, md, md_updated_at` — status ∈ `{todo, progress, done}`
- **story**: `id, title, desc, status, phase, epic_id, md, md_updated_at` — status ∈ `{todo, progress, done}`, phase ∈ `{analysis, ux, design, dev, done}`
- **task**: `id, title, status, story_id, agent_id?, md, md_updated_at, tokens` — status ∈ `{todo, progress, done}`
- **agent**: `id, name, current_task, status, tokens` — status ∈ `{active, idle}`

`md` is the associated Markdown document (analysis for stories, description +
architectural choices + work notes for tasks). `md_updated_at` is set by the
server when the `md` changes. IDs are server-generated (prefix `e/s/t/a` +
8 hex): **do not invent them**, always use the `id` returned by the POSTs or read from the GETs.

### Task tokens — per-story aggregation (story `s36b99979`)
`task.tokens` (Integer, default `0`) is **distinct** from the agent's cumulative `tokens`:
it tracks how many tokens were spent on that specific task, and exists to power a
per-story view without touching the agent's global counter.
- **`GET /stories/{story_id}/agent-tokens`** — 404 if the story doesn't exist. Aggregates
  `SUM(task.tokens) GROUP BY task.agent_id` over the story's tasks (tasks with `agent_id
  IS NULL` are excluded), joined with `agent` for name/status/current_task. Response:
  ```json
  {
    "story_id": "s36b99979",
    "total_tokens": 41000,
    "agents": [
      { "agent_id": "a1b2c3d4", "name": "seth-frontend", "status": "active",
        "current_task": "...", "story_tokens": 26000, "tokens": 512000 }
    ]
  }
  ```
  `story_tokens` = tokens spent by that agent on **this story only**; `tokens` = the
  agent's global cumulative (unchanged meaning). Sorted by `story_tokens` DESC, then
  `name` ASC. An agent with no tasks on the story is omitted; an empty/tokenless story
  returns `{"story_id": ..., "total_tokens": 0, "agents": []}`.
- The global `GET /agents` and `GET /state.agents` are **unaffected** — still the
  unfiltered, cumulative-per-agent view used by the dashboard.
- The Agents tab (`frontend/src/components/Agents.jsx`, mounted only inside
  `StoryPage.jsx`) accepts an optional `storyId` prop: when set, it fetches this endpoint
  and renders scope-coherent counters + a per-story token box instead of the global
  cumulative; without it, behaviour is unchanged (dashboard-style, `state.agents`).

### Mockups are a first-class entity — NOT blocks in the `md`
Mockups are **no longer written as ` ```mockup ` HTML blocks inside a story/task `md`**.
They are a dedicated entity created via the API:
- **mockup**: `id (mk########), owner_type ∈ {story, task}, owner_id, title, type ∈ {html, image, figma, claude_canvas, link}, source ∈ {embedded, upload, figma, claude, url}, content?, ref_url?, position, created_at, updated_at`
- API: `GET /mockups?owner_type=&owner_id=` (also `?story_id=` aggregating story+its tasks, `?task_id=`), `GET /mockups/{id}`, `POST /mockups`, `PATCH /mockups/{id}`, `DELETE /mockups/{id}`.
- `mockup-comments` reference a mockup via `mockup_id` (stable FK), not the legacy positional `mockup_index`.

The `seth-ux-designer` creates mockups as `Mockup(type=html, source=embedded, content=<html>)`
records via `POST /mockups` (owner = the story or a task), **not** by pasting HTML into the `md`.
Legacy ` ```mockup ` blocks in old `md`s remain readable for backward compatibility but are
deprecated; new mockups are entities only.

### DesignSystem — a project-level entity, distinct from `Mockup`
A project may have a **generated design system** (color/typography/spacing tokens + a component
inventory, inferred from the project's own codebase): a project-level artifact, **not** tied to a
single story/task like `Mockup` is.
- **design_system**: `id (ds########), project_id (UNIQUE — 1:1 with project), title, md?, tokens? (JSON: colors/typography/spacing/radius), components? (JSON: name + example markup), source ∈ {code_scan, manual}, sync_state ∈ {local, synced, sync_failed}, ext_provider ∈ {penpot}?, ext_file_id?, ext_url?, last_scan_at?, last_sync_at?, created_at, updated_at`.
- API: `GET /design-systems?project_id=` and `GET /design-systems/{id}` (detail-by-id: `md` + tokens + components, for the dedicated page and its previews), `POST /design-systems` / `PATCH /design-systems/{id}` (upsert per `project_id` — idempotent, not append) / `DELETE /design-systems/{id}`.
- **Direction of truth**: the project's codebase is the real source; the `DesignSystem` record on the Board is the canonical, consultable artifact (read-only from the UI, written only by the scan); an optional external provider (Penpot) is a **push-only projection** of the Board record — never a round-trip source.
- **Consumers**: `seth-ux-designer` and `seth-frontend` query `GET /design-systems?project_id=` **best-effort, never blocking** before producing mockups / implementing UI — if present, it is their primary reference for tokens/components instead of re-deriving palette/patterns ad hoc from other stories; if absent or unreachable, they fall back to discovery from `CLAUDE.md`/existing screens as before.
- **Do not** reuse `Mockup.owner_type=story|task` for the design system, and do not add an `owner_type=project` to `Mockup`: granularity and lifecycle differ (one project-wide artifact vs. N per-story/task mockup instances) — keep them as separate entities.

## Story phases (`phase`)
They model the PO→UX→seth-architect→dev flow without touching the raw `status`:
- `analysis` — Product Owner: analysis in progress/to be done.
- `ux` — user-flow mockups are needed → UX Designer.
- `design` — ready for the seth-architect (architectural decisions + breakdown into tasks).
- `dev` — tasks created and being worked on by the devs.
- `done` — story completed.
Typical transitions: `analysis → (ux) → design → dev → done`.

## Canonical agent names (Sethlans Board records)
One `agent` record for each subagent, identified **by name** (the id is dynamic):

| subagent | `name` in Sethlans Board |
|---|---|
| seth-product-owner | `seth-product-owner` |
| seth-ux-designer | `seth-ux-designer` |
| seth-architect | `seth-architect` |
| seth-frontend | `seth-frontend` |
| seth-be-python | `seth-be-python` |
| seth-be-java | `seth-be-java` |
| seth-fullstack | `seth-fullstack` |
| seth-reviewer | `seth-reviewer` |
| seth-tester | `seth-tester` |
| seth-devops | `seth-devops` |

## Task-type → agent map
- UI / Angular → `seth-frontend`
- BE Python (FastAPI/Polars) → `seth-be-python`
- BE Java (Spring Boot) → `seth-be-java`
- cross-repo / end-to-end slice → `seth-fullstack`
- code review → `seth-reviewer`
- test / QA / E2E → `seth-tester`
- environment preparation / repo update / Docker stack startup-restart → `seth-devops`
- `seth-product-owner`, `seth-ux-designer` and `seth-architect` work on the story phases
  (analysis/ux/design), normally **without implementation tasks**: the PO creates/updates
  epics and stories, UX produces mockups **as `Mockup` entities via the API** (no longer HTML
  blocks in the md, see *Mockups are a first-class entity* above), the seth-architect creates the
  tasks for the devs.

## Recipes (PowerShell — Windows environment)
The server runs on Windows; `Invoke-RestMethod` does native JSON parsing (no `jq`).

```powershell
$base = if ($env:SETHLANS_SERVICE_API_URL) { $env:SETHLANS_SERVICE_API_URL } else { 'http://localhost:9955' }
function Tab($method, $path, $bodyObj=$null) {
  $args = @{ Method = $method; Uri = "$base$path"; ContentType = 'application/json' }
  if ($bodyObj) { $args.Body = ($bodyObj | ConvertTo-Json -Depth 6) }
  Invoke-RestMethod @args
}

# Find-or-register an agent by name → returns the id
function Get-AgentId($name) {
  $a = (Tab GET '/agents') | Where-Object { $_.name -eq $name } | Select-Object -First 1
  if (-not $a) { $a = Tab POST '/agents' @{ name = $name; status = 'idle'; current_task = 'Inattivo'; tokens = 0 } }
  return $a.id
}
```

### Life cycle of a dev/seth-reviewer/seth-tester agent
```powershell
$me = Get-AgentId 'seth-frontend'                                  # your canonical name
# start
Tab PATCH "/agents/$me" @{ status = 'active'; current_task = 'Form di login (s12)' }
Tab PATCH "/tasks/$taskId" @{ status = 'progress'; agent_id = $me }
# ... real work ...
# successful end
Tab PATCH "/tasks/$taskId" @{ status = 'done' }
Tab PATCH "/agents/$me" @{ status = 'idle'; current_task = 'Inattivo' }
```
On error/block: **leave the task in `progress`** (do not set it to `done`),
report the reason, and return the agent to `idle` only if you have really stopped working on it.

### Find-or-create epic (match by title, no server-side search exists)
```powershell
$epicTitle = 'NAU-177 Sistema di autenticazione'
$epic = (Tab GET '/epics') | Where-Object { $_.title -eq $epicTitle } | Select-Object -First 1
if (-not $epic) { $epic = Tab POST '/epics' @{ title = $epicTitle; desc = '...'; status = 'progress' } }
$epicId = $epic.id
```

### Find-or-create story under the epic (with phase and md) — done by the Product Owner
```powershell
$storyTitle = 'Login page'
$story = (Tab GET "/stories?epic_id=$epicId") | Where-Object { $_.title -eq $storyTitle } | Select-Object -First 1
if (-not $story) {
  $story = Tab POST '/stories' @{ title = $storyTitle; desc = '...'; status = 'todo'; phase = 'analysis'; epic_id = $epicId; md = '# Analysis...' }
}
$storyId = $story.id
# update analysis and phase:
Tab PATCH "/stories/$storyId" @{ md = '# Updated analysis...'; phase = 'design' }
```

### Create an assigned task with md (description + architectural choices) — done by the seth-architect
```powershell
$agentId = Get-AgentId 'seth-be-python'        # task-type → agent map
Tab POST '/tasks' @{ title = 'Endpoint POST /datasets'; status = 'todo'; story_id = $storyId; agent_id = $agentId; md = "## Work\n...\n## Architectural choices\n..." }
# the seth-architect moves the story to the dev phase:
Tab PATCH "/stories/$storyId" @{ phase = 'dev'; status = 'progress' }
```

### Update the md (any entity)
```powershell
# read the current md and append (the devs at the end of work):
$t = Tab GET "/tasks/$taskId"
$new = $t.md + "`n`n## Work done`n- file X, choice Y, note Z"
Tab PATCH "/tasks/$taskId" @{ md = $new }   # md_updated_at is set by the server
```

### State cascade (orchestrator, optional)
- When the seth-architect creates the tasks: move the story to `phase=dev`, `status=progress`.
- When **all** the tasks of a story are `done`: move the story to `status=done` and `phase=done`.
- When **all** the stories of an epic are `done`: move the epic to `done`.
```powershell
$tasks = Tab GET "/tasks?story_id=$storyId"
if ($tasks.Count -gt 0 -and ($tasks | Where-Object { $_.status -ne 'done' }).Count -eq 0) {
  Tab PATCH "/stories/$storyId" @{ status = 'done'; phase = 'done' }
}
```

## Operational notes
- To **release** a task from an agent: the PATCH ignores `null` fields, so you cannot clear `agent_id` via PATCH — reassign it to another agent or leave it unchanged.
- `agent.tokens`: it is populated by **the orchestrator** (not the subagents, which do not know their own consumption) with a **cumulative estimate** at the close of each subagent — `GET` the current value, add the estimate, `PATCH` (or use `sethlans_board_add_agent_tokens`). It is best-effort and approximate; if the board does not respond, leave it unchanged. Pass `task_id` to the same call when the estimate should also be attributed to a specific task (feeds `GET /stories/{id}/agent-tokens`); this is optional and independent of the global increment, which always happens regardless of whether the task-side update succeeds.
- States: use **exactly** the enum values above, otherwise the server responds 422.
- Run the state PATCHes at the start and end of the work, not at every micro-step (avoid noise on the board).
