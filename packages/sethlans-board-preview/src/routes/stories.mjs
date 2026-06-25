import { db, nowIso } from "../db.mjs";
import { newId } from "../ids.mjs";
import { validateEnum, STATUS_WORK, PHASE_STORY } from "../enums.mjs";
import { rowToStory } from "../serializers.mjs";
import { fetchRowOr404 } from "../fetch-helpers.mjs";
import { storyMockupDescendantCount } from "../derived.mjs";

function storyToDict(storyRow) {
  const tasks = db.prepare("SELECT * FROM tasks WHERE story_id = ?").all(storyRow.id);
  return rowToStory(storyRow, storyMockupDescendantCount(storyRow, tasks));
}

export function registerStoryRoutes(router) {
  router.get("/stories", (req, res, params, query) => {
    let sql = "SELECT stories.* FROM stories";
    const conds = [];
    const args = [];
    if (query.project_id) {
      sql += " JOIN epics ON stories.epic_id = epics.id";
      conds.push("epics.project_id = ?");
      args.push(query.project_id);
    }
    if (query.epic_id) {
      conds.push("stories.epic_id = ?");
      args.push(query.epic_id);
    }
    if (query.status) {
      conds.push("stories.status = ?");
      args.push(query.status);
    }
    if (query.phase) {
      conds.push("stories.phase = ?");
      args.push(query.phase);
    }
    if (conds.length) sql += " WHERE " + conds.join(" AND ");
    const rows = db.prepare(sql).all(...args);
    return rows.map(storyToDict);
  });

  router.post("/stories", (req, res, params, query, body) => {
    validateEnum(body.status, STATUS_WORK);
    validateEnum(body.phase, PHASE_STORY, "phase");
    fetchRowOr404("epics", "epic", body.epic_id);
    const id = newId("s");
    const md = body.md || "";
    db.prepare(
      "INSERT INTO stories (id, title, desc, status, phase, epic_id, md, md_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      id,
      body.title,
      body.desc ?? "",
      body.status ?? "todo",
      body.phase ?? "analysis",
      body.epic_id,
      md,
      md ? nowIso() : null
    );
    return [201, storyToDict(fetchRowOr404("stories", "story", id))];
  });

  router.get("/stories/:story_id", (req, res, params) => {
    return storyToDict(fetchRowOr404("stories", "story", params.story_id));
  });

  router.patch("/stories/:story_id", (req, res, params, query, body) => {
    validateEnum(body.status, STATUS_WORK);
    validateEnum(body.phase, PHASE_STORY, "phase");
    const row = fetchRowOr404("stories", "story", params.story_id);
    if (body.epic_id !== undefined && body.epic_id !== null) {
      fetchRowOr404("epics", "epic", body.epic_id);
    }
    const fields = [];
    const args = [];
    for (const key of ["title", "desc", "status", "phase", "epic_id", "md"]) {
      if (body[key] !== undefined && body[key] !== null) {
        fields.push(`${key} = ?`);
        args.push(body[key]);
      }
    }
    if (body.md !== undefined && body.md !== null) {
      fields.push("md_updated_at = ?");
      args.push(nowIso());
    }
    if (fields.length > 0) {
      db.prepare(`UPDATE stories SET ${fields.join(", ")} WHERE id = ?`).run(...args, row.id);
    }
    return storyToDict(fetchRowOr404("stories", "story", row.id));
  });

  router.delete("/stories/:story_id", (req, res, params) => {
    fetchRowOr404("stories", "story", params.story_id);
    db.prepare("DELETE FROM stories WHERE id = ?").run(params.story_id);
    return { deleted: params.story_id };
  });
}

export { storyToDict };
