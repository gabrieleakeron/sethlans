# Sethlans Board

**Sethlans Board** is the board that visualizes the work of Claude's subagents, organized by
**projects** → **epics** → **stories** → **tasks**, plus a shared pool of **agents**. It is the
visual component of [Sethlans](../../README.md); the `/sethlans` orchestrator and the subagents
update it over HTTP, best-effort.

```
sethlans-board/
  backend/    # FastAPI REST API on SQLite (default) or PostgreSQL, Alembic migrations
  frontend/   # React/Vite SPA, polls GET /state every ~4s
```

## Quick start

### Docker (recommended)

The pre-built images are available on Docker Hub:

```bash
docker volume create sethlans-board-data

docker run -d --name sethlans-server \
  -v sethlans-board-data:/data \
  -p 9955:9955 \
  --restart unless-stopped \
  gifsonick/sethlans-server:latest

docker run -d --name sethlans-board \
  -p 5173:80 \
  --restart unless-stopped \
  gifsonick/sethlans-board:latest
```

- Interface → <http://localhost:5173>
- API / docs → <http://localhost:9955/docs>

To use **PostgreSQL** instead of SQLite, add `-e SETHLANS_SERVICE_DB_URL=postgresql+psycopg2://user:pass@host:5432/sethlans_service` to the backend container.

To stop and remove the containers (data volume is kept):
```bash
docker stop sethlans-board sethlans-server
docker rm   sethlans-board sethlans-server
```

### Build from source

```bash
docker build -t sethlans-server backend
docker build -t sethlans-board frontend
# then docker run as above, replacing the image names
```

### Without Docker

```bash
# Backend
cd backend
python -m venv .venv && .venv\Scripts\Activate.ps1   # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head                                  # creates schema + tables
python server.py                               # :9955

# Frontend
cd frontend
npm install
npm run dev                                            # :5173
```

## Configuration

| Variable | Side | Default | Notes |
|---|---|---|---|
| `SETHLANS_SERVICE_DB_URL` | backend | `sqlite:///./service.db` | SQLite by default; pass a `postgresql+psycopg2://...` URL for Postgres. |
| `SETHLANS_SERVICE_PORT` | backend | `9955` | API port. |
| `VITE_API_URL` | frontend | `http://localhost:9955` | Backend base URL (also settable at runtime from the UI header). |
| `VITE_READONLY` | frontend | `true` | Read-only UI: only agents edit the board via HTTP. Set `false` to allow in-UI editing. |

## Data model

```
Project       { id, name, type, jira_key }
Epic          { id, title, desc, status, project_id, md, mockup_descendant_count }
                                                              status ∈ {todo, progress, done}
Story         { id, title, desc, status, phase, epic_id, md, mockup_count, mockup_descendant_count }
                                                              phase  ∈ {analysis, ux, design, dev, done}
Task          { id, title, status, story_id, agent_id, md, mockup_count }
                                                              status ∈ {todo, progress, done}
Agent         { id, name, current_task, status, tokens }     status ∈ {active, idle}
Mockup        { id, owner_type, owner_id, title, type, source, content, ref_url, position,
                created_at, updated_at }
                                                              owner_type ∈ {story, task}
                                                              type ∈ {html, image, figma, claude_canvas, link}
                                                              source ∈ {embedded, upload, figma, claude, url}
MockupComment { id, target_type, target_id, mockup_index, mockup_id, author, text, image, created_at }
                                                              target_type ∈ {story, task} (legacy, nullable)
DesignSystem  { id, project_id, title, md, tokens, components, source, sync_state,
                ext_provider, ext_file_id, ext_url, last_scan_at, last_sync_at,
                created_at, updated_at }
                                                              project_id UNIQUE (1:1 with Project)
                                                              source ∈ {code_scan, manual}
                                                              sync_state ∈ {local, synced, sync_failed}
                                                              ext_provider ∈ {penpot} (nullable)
```

**Project → Epic → Story → Task** hierarchy with cascade delete. `md` holds the Markdown document
for each entity; legacy stories/tasks may still contain HTML mockups in ` ```mockup ``` ` blocks
(read-only support, see below). `md_updated_at` is set server-side when `md` changes — never
set it from the client.

`mockup_count` / `mockup_descendant_count` are **derived, read-only** fields computed at request
time from the ` ```mockup ``` ` blocks in a target's `md` (and its descendants', for
`mockup_descendant_count`) — never persisted, never accepted in `POST`/`PATCH`. They remain in
place for backward compatibility; they are not aware of the `Mockup` entity rows.

`Mockup` (story `s443652b6`) is the first-class entity for mockups, superseding embedded `md`
blocks as the source of truth. Polymorphic owner (`owner_type`+`owner_id`, integrity enforced in
the API, no physical FK — same pattern as `MockupComment`); `type`/`source` are open enums so new
providers (image upload, Figma, Claude canvas, link) plug in without schema changes. `content`
holds the opaque payload (HTML, or a data URI for images); `ref_url` holds the external link for
providers that don't embed content. Agents should create mockups via `POST /mockups`, not by
pasting HTML into a story/task's `md`.

`MockupComment` is an independent entity for annotated change requests (text and/or a base64
data-URI image, capped at ~2MB). The **preferred** link is `mockup_id` (FK to `Mockup.id`, stable
across `md` rewrites); the legacy `(target_type, target_id, mockup_index)` triple is kept nullable
for backward-reading comments created before the Mockup entity existed.

`DesignSystem` (story `s2340fc3b`) is the canonical, project-level design-system artifact built by
the `sethlans-design` skill from a scan of the project's own codebase. Owner = project with **1:1**
cardinality (`project_id` is `UNIQUE`, one row per project) — not polymorphic like `Mockup`, and
not reused as a new `Mockup.owner_type`. `tokens`/`components` are opaque JSON payloads (`Text`
columns) for the inferred design tokens and the best-effort component inventory; `md` holds the
human-readable spec. The project's codebase is the source of truth (re-running `sethlans-design`
re-infers tokens and **upserts** this row, never appending); an optional external system (default
Penpot, `ext_provider`/`ext_file_id`/`ext_url`) is a push-only projection tracked by `sync_state`
(`local`/`synced`/`sync_failed`) — no Penpot→Board round-trip. Penpot is fully optional: without it
configured, `sethlans-design` still writes this row (Board-only fallback).

## REST API surface

Uniform REST resources (`GET`/`POST` collection, `GET`/`PATCH`/`DELETE` by id):
`/projects`, `/epics`, `/stories`, `/tasks`, `/agents`, `/mockups`, `/mockup-comments`,
`/design-systems`.

Full board snapshot: `GET /state` (includes `mockup_comments` and `design_systems`; fetch
`mockups` per-owner via `GET /mockups`).

Useful filters: `/epics?project_id=`, `/stories?epic_id=`, `/tasks?story_id=`, `/tasks?agent_id=`,
`?status=`, `/mockups?owner_type=&owner_id=`, `/mockup-comments?mockup_id=`,
`/design-systems?project_id=`.

`POST /design-systems` is an **upsert keyed on `project_id`**: calling it again with the same
`project_id` updates the existing row instead of creating a duplicate (idempotent — required by
the `sethlans-design` skill, which re-runs the scan and re-posts on every invocation).

Mockup CRUD: `POST /mockups`, `GET /mockups/{id}`, `PATCH /mockups/{id}`, `DELETE /mockups/{id}`.
Mockup listing: `GET /mockups?owner_type=&owner_id=` (preferred) or, **backward-compatible**,
`GET /mockups?epic_id=|story_id=|task_id=` (exactly one filter) — same aggregation shape as before
this story; falls back to deriving mockups from `md` blocks for owners not yet backfilled into the
`mockups` table. See the [Board wiki page](../../sethlans.wiki/Board.md) for the full contract,
including the one-shot backfill script (`scripts/backfill_mockups.py`).

The preferred integration for agent code is the **`sethlans-board` MCP server**
(`packages/sethlans-claude-plugin/mcp/server.mjs`), which wraps these endpoints with typed,
enum-validated tools.

## Conventions

- **Server-generated IDs** — type prefix + 8 hex chars (`new_id()` in `models.py`, e.g.
  `s1a2b3c4`, `mk1a2b3c4`). Never invent IDs client-side; use the `id` returned by POSTs.
- **Enums validated** — use only the values in `STATUS_WORK` / `STATUS_AGENT` / `PHASE_STORY` /
  `TYPE_PROJECT` / `MOCKUP_OWNER` / `MOCKUP_TYPE` / `MOCKUP_SOURCE` / `DESIGN_SOURCE` /
  `DESIGN_SYNC_STATE` / `DESIGN_PROVIDER` (`models.py`). The API returns HTTP 422 for unknown
  values.
- **Alembic for every schema change** — `alembic revision --autogenerate -m "..."` → review →
  `alembic upgrade head`. Never modify the DB schema by hand.
- **Implicit Postgres schema** — models do not declare the `sethlans_service` schema; it is applied at
  runtime via `schema_translate_map` in `db.py` and `alembic/env.py`.
