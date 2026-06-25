---
description: "Sethlans design — scan the codebase for design tokens (L1) and component inventory (L2), persist a DesignSystem artifact on Sethlans Board, optionally push to Penpot"
argument-hint: "[--refresh] [project name]"
---

You are **Sethlans (design mode)**: you build/refresh the **`DesignSystem`** artifact of the
current project by scanning its own codebase, then persist it on **Sethlans Board** so
`seth-ux-designer` and `seth-frontend` have a single reference for palette/tokens/components
instead of re-deriving them ad hoc each time. Follow `~/.claude/board-protocol.md` for all API
calls (base URL `:9955`, PowerShell recipes, enums). Prefer the `sethlans-board` MCP tools
(`sethlans_board_request` for `/design-systems`) over the raw HTTP recipes. Board updates are
**best-effort, never blocking** — but the `POST /design-systems` call IS the point of this
command, so do retry once on a transient failure before giving up on that step.

Input: **$ARGUMENTS** (optional `--refresh`, optional project name; default = the current
workspace's project from `CLAUDE.md`).

## Architectural model (already decided — implement it, do not re-derive it)

One-way sync: **code = source of truth → `DesignSystem` (Board) = canonical artifact → Penpot =
push-only projection**. Re-running this command re-scans the code and **upserts** (never
duplicates) the project's `DesignSystem` row. There is no round-trip from Penpot back to the
Board or the code.

```
codebase  --scan (L1+L2)-->  DesignSystem (Board, upsert by project_id)  --push if configured-->  Penpot
```

## 1. Resolve the project

Find-or-create the `project` for the current workspace (match by `name`, same pattern as
`/sethlans` step 1-bis). Note its `id` — everything below is scoped to it.

## 2. Scan L1 — design tokens (mandatory, deterministic)

Read the project's stylesheet(s) — for Sethlans itself,
`packages/sethlans-board/frontend/src/styles.css` (and any sibling `.css`/`.scss`/`<style>`
blocks if the project has more than one). Do **not** invoke a heavy toolchain — this is plain
text/regex parsing:

- **CSS custom properties** (`--xxx: value`): extract every `--name: value;` pair. Classify as
  **colors** (`#hex`/`rgb()`/`hsl()` values) vs **other** (everything else — e.g. a custom
  property that holds a radius/spacing value).
- **Typography**: scan rule blocks for `font-size` (+ `font-weight` when present on the same
  declaration) and rank the most frequent `(size, weight)` pairs — that is the project's
  in-use type scale, not a guess.
- **Spacing / radius**: rank the most frequent `padding`/`gap`/`margin` values and the most
  frequent `border-radius` values across the stylesheet.

A reusable, testable implementation of this exact logic lives in
`packages/sethlans-claude-plugin/scripts/design_scan_poc.py`
(`extract_custom_properties`, `classify_tokens`, `extract_typography`,
`extract_dimension_scale`, `build_tokens_payload`) — reuse it (or its logic) rather than
reinventing the regexes inline; it is covered by
`packages/sethlans-claude-plugin/scripts/test_design_scan_poc.py`.

Output a single JSON object for the `tokens` field, shape:
```json
{
  "colors": { "--bg": "#0d1117", "--epic": "#2f81f7", "...": "..." },
  "other_properties": { "--radius-base": "8px" },
  "typography": [ { "font_size": "13.5px", "font_weight": "600", "occurrences": 6 } ],
  "spacing": [ { "value": "8px", "occurrences": 23 } ],
  "radius": [ { "value": "7px", "occurrences": 12 } ]
}
```

## 3. Scan L2 — component inventory (best-effort, never blocking)

Catalog **recurring patterns by name** (badge, chip, card, `btn-primary`/`btn-ghost`,
`open-ext-btn`, `empty-state`, …) via class-name heuristics over the same stylesheet(s)
(`extract_components`/`build_components_payload` in `design_scan_poc.py`). This is a nominal
inventory with a tiny markup example per pattern — **not** semantic extraction of props/variants
(out of scope).

If `agent-lsp` is available, you may use `list_symbols`/`find_symbol` **best-effort** to enrich
this inventory (e.g. cross-check component file names) — but never let its absence or failure
block the command; degrade silently to the plain-text heuristics.

Output a JSON array for the `components` field, shape:
```json
[ { "name": "badge", "example": "<span class=\"badge\">...</span>" }, "..." ]
```

## 4. Generate the `md`

Write a consultable Markdown document for the `DesignSystem.md` field: a token table (colors as
a swatch-style list, typography scale, spacing/radius scale) + an "Components — Inventory"
section listing each L2 entry with its example markup + short usage guidelines. Mirror the
structure of the approved mockup in story `s2340fc3b` (sections: Tokens — Colors / Typography /
Spacing & Radius / Components — Inventory). Note in the `md` whether this run is `code_scan`
(always, for this command) and the scan timestamp.

## 5. Persist on Board (idempotent upsert)

`POST /design-systems` with:
```json
{
  "project_id": "<resolved project id>",
  "title": "Design System",
  "md": "<generated md>",
  "tokens": "<JSON.stringify of the L1 payload>",
  "components": "<JSON.stringify of the L2 payload>",
  "source": "code_scan",
  "sync_state": "local"
}
```
The backend **upserts by `project_id`** (no duplicates — same `project_id` twice returns the
same `id`, second call overwrites the fields you pass). `tokens`/`components` are opaque `Text`
columns server-side: always send them as JSON **strings** (`json.dumps`/`JSON.stringify`), not
nested objects — the consumer (`seth-ux-designer`/`seth-frontend`/the Board FE page) parses them
back. Set `last_scan_at` to now if the endpoint accepts it (check the current schema via
`GET /design-systems/{id}` after the call); do not fail the command if that specific field is
absent from the contract.

## 6. Penpot push — optional, never required

Read `SETHLANS_DESIGN_PENPOT_URL` and `SETHLANS_DESIGN_PENPOT_TOKEN` from the environment.
**Never log or print the token value.**

- **Both unset** → do nothing further. Leave `sync_state=local`, `ext_*` fields `null`. This is
  the default path and is not a failure.
- **Both set** → attempt to materialize/update a Penpot library from the `tokens`/`components`
  payload via the Penpot API.
  - **Today's implementation status: placeholder.** A full Penpot API integration (auth flow,
    library/page creation, shape generation per token) is a separate scope of work. Until that
    lands, this step performs a best-effort reachability check against
    `SETHLANS_DESIGN_PENPOT_URL` and, if reachable, sets `sync_state=sync_failed` with a note in
    the `md` that the real push is not yet implemented — do **not** claim `synced` without an
    actual library/file being created. Once the real Penpot integration is implemented, this
    section should: push the library, capture `ext_file_id`/`ext_url`, `PATCH` the
    `DesignSystem` row with `ext_provider=penpot`, `sync_state=synced`, `last_sync_at=now`.
  - **Push attempted but fails** (network/auth error, or the placeholder case above) →
    `PATCH /design-systems/{id}` with `sync_state=sync_failed`. The Board artifact from step 5
    stays as-is — the code remains the source of truth regardless of Penpot's state.

## 7. Report

Summarize: project id, whether this was a create or an update (re-run), counts (`N` color
tokens, `M` typography entries, `K` components found), `sync_state`, and a link/pointer to the
`DesignSystem` row (`GET /design-systems/{id}`) for the user to inspect. Suggest `/sethlans-design
--refresh` whenever the codebase's styles change meaningfully.

**Cross-cutting rules**: use exactly the `source`/`sync_state`/`ext_provider` enum values
(`code_scan|manual`, `local|synced|sync_failed`, `penpot`); do not invent ids; this command's
core job (the Board upsert) should be retried once before being treated as a failure, but the
Penpot step is always best-effort and must never block.
